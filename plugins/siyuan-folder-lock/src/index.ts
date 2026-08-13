// 安全锁插件入口
// 负责文档加锁、密码解锁和恢复码解锁

import {getAllEditor, Plugin, showMessage, type Protyle} from "siyuan";
import {
    getSnapshotReferences,
    IFolderLockData,
    ILockSnapshot,
    ILockSnapshotReference,
    RAW_SY_CONTENT_FORMAT,
    SnapshotContentFormat,
    LockStore,
} from "./store";
import {LockIndicator} from "./indicator";
import {MenuIntegration} from "./menu";
import {
    decryptText,
    deriveKey,
    encryptText,
    generateMasterKey,
    generateRecoveryCode,
    generateSalt,
    PBKDF2_ITERATIONS,
    unwrapKey,
    wrapKey,
} from "./crypto";
import {
    getBlockInfo,
    getDocIDs,
    getDocKramdown,
    getDocRaw,
    updateDocKramdown,
    updateDocRaw,
} from "./api";
import {showRecoveryCodeDialog} from "./dialog";
import {DocumentTransactionError, updateDocumentsTransactional} from "./transaction";
import {
    containsLockedPlaceholder,
    documentPathWithinTree,
    documentTreesOverlap,
    isLockedPlaceholderContent,
    isSameSyJSON,
    mergeProtectedDocumentIds,
    selectSafeRestorePlan,
    shouldReloadUnlockedProtyle,
} from "./document";
import {
    createEncryptedSnapshot,
    decryptCompleteSnapshot,
    prependSnapshotReference,
    verifySnapshotRoundTrip,
} from "./snapshot";
import "./index.css";

const FORMAT_VERSION = 2;
const LEGACY_PBKDF2_ITERATIONS = 100000;

interface IUnlockedFolderState {
    masterKey: CryptoKey;
    protyles: Set<any>;
    idleRelockTimer: ReturnType<typeof setTimeout> | null;
}

export default class FolderLockPlugin extends Plugin {
    private store!: LockStore;
    private indicator?: LockIndicator;
    private menu!: MenuIntegration;
    private unlockingFolders = new Set<string>();
    private unlockedFolders = new Map<string, IUnlockedFolderState>();
    private pendingProtyles = new Map<string, Set<any>>();
    private relockTasks = new Map<string, Promise<void>>();
    private folderOperations = new Set<string>();
    private refreshingProtyles = new WeakSet<object>();
    private suppressedLockedDocPrompts = new WeakSet<object>();

    async onload(): Promise<void> {
        this.store = new LockStore(this);
        try {
            await this.store.initialize();
        } catch (error) {
            console.error("安全锁存储加载失败：", error);
            showMessage(this.i18n.storageCorrupt, 0, "error");
            throw error;
        }

        this.indicator = new LockIndicator(this.store, this.i18n.locked);
        this.menu = new MenuIntegration({
            store: this.store,
            i18n: this.i18n,
            onLock: (folderId, password) => this.lockFolder(folderId, password),
            onUnlock: (folderId, password) => this.unlockFolder(folderId, password),
            onRecover: (folderId, recoveryCode) => this.unlockFolderWithRecoveryCode(folderId, recoveryCode),
            onRemove: (folderId) => this.removeFolderLock(folderId),
            getFolderName: (folderId) => this.getFolderName(folderId),
        });
        this.menu.bind(this.eventBus);

        this.eventBus.on("loaded-protyle-static", (event: CustomEvent) => {
            this.handleLockedDocLoaded(event);
        });
        this.eventBus.on("destroy-protyle", (event: CustomEvent) => {
            void this.handleProtyleDestroyed(event);
        });
        getAllEditor().forEach((editor) => {
            void this.handleLockedDocLoaded(new CustomEvent("loaded-protyle-static", {
                detail: {protyle: editor.protyle},
            }));
        });

        setTimeout(() => {
            this.indicator?.start();
        }, 2000);
    }

    async onunload(): Promise<void> {
        this.indicator?.stop();
        const relockPromises: Promise<void>[] = [];
        this.unlockedFolders.forEach((state, folderId) => {
            if (state.idleRelockTimer) {
                clearTimeout(state.idleRelockTimer);
            }
            const relockPromise = this.startRelockTask(folderId, state);
            relockPromises.push(relockPromise.catch((error) => {
                console.error("插件卸载时重新上锁失败：", error);
            }));
        });
        await Promise.all(relockPromises);
    }

    /** 打开加锁文档时直接进入统一的解锁流程 */
    private async handleLockedDocLoaded(event: CustomEvent): Promise<void> {
        const protyle = event.detail?.protyle;
        if (!protyle || protyle.options?.backlinkData) {
            return;
        }
        const docId = protyle.block?.rootID;
        if (!docId) {
            return;
        }
        if (this.suppressedLockedDocPrompts.delete(protyle)) {
            return;
        }
        const directLock = this.store.isDocLocked(docId);
        let lockInfo = directLock || await this.findLockForDoc(docId);
        if (!lockInfo) {
            return;
        }

        const relockTask = this.relockTasks.get(lockInfo.folderId);
        if (relockTask) {
            try {
                await relockTask;
            } catch {
                // 重新上锁失败时由关闭事件统一提示，这里按当前状态继续处理
            }
            lockInfo = await this.findLockForDoc(docId);
            if (!lockInfo) {
                return;
            }
        }

        const unlockedState = this.unlockedFolders.get(lockInfo.folderId);
        if (unlockedState) {
            this.clearIdleRelockTimer(unlockedState);
            unlockedState.protyles.add(protyle);
            this.reloadUnlockedProtyle(protyle, lockInfo.lockData.placeholder || this.placeholderContent());
            return;
        }
        if (this.unlockingFolders.has(lockInfo.folderId)) {
            this.addPendingProtyle(lockInfo.folderId, protyle);
            return;
        }

        this.unlockingFolders.add(lockInfo.folderId);
        this.addPendingProtyle(lockInfo.folderId, protyle);
        try {
            const unlocked = await this.menu.promptUnlock(
                lockInfo.folderId,
                this.getDocName(protyle, docId),
            );
            if (unlocked) {
                const state = this.unlockedFolders.get(lockInfo.folderId);
                if (state) {
                    this.clearIdleRelockTimer(state);
                }
                this.pendingProtyles.get(lockInfo.folderId)?.forEach((pendingProtyle) => {
                    state?.protyles.add(pendingProtyle);
                });
            }
        } finally {
            this.pendingProtyles.delete(lockInfo.folderId);
            this.unlockingFolders.delete(lockInfo.folderId);
        }
    }

    private addPendingProtyle(folderId: string, protyle: any): void {
        const protyles = this.pendingProtyles.get(folderId) || new Set<any>();
        protyles.add(protyle);
        this.pendingProtyles.set(folderId, protyles);
    }

    /** 解锁写回正文后刷新编辑器，并跳过本次刷新触发的加载事件。 */
    private reloadUnlockedProtyle(protyle: any, placeholder: string, force = false): void {
        if (!protyle || typeof protyle !== "object") {
            return;
        }
        if (this.refreshingProtyles.delete(protyle)) {
            return;
        }
        const visibleText = protyle.wysiwyg?.element?.textContent || "";
        if (!shouldReloadUnlockedProtyle(visibleText, placeholder, force)) {
            return;
        }
        const protyleInstance = protyle.getInstance?.();
        if (protyleInstance && typeof protyleInstance.reload === "function") {
            this.refreshingProtyles.add(protyle);
            try {
                protyleInstance.reload(false);
            } catch (error) {
                this.refreshingProtyles.delete(protyle);
                console.error("刷新解锁文档失败：", error);
            }
        }
    }

    /** 覆盖自动弹窗和文档树菜单两种解锁入口，立即刷新全部已打开的受保护文档。 */
    private reloadOpenUnlockedEditors(folderId: string, docIds: string[], placeholder: string): void {
        const state = this.unlockedFolders.get(folderId);
        if (!state) {
            return;
        }
        const protectedDocIds = new Set(docIds);
        const protyles = new Set<any>();
        this.getOpenProtectedEditors(docIds).forEach((editor) => {
            protyles.add(editor.protyle);
        });
        this.pendingProtyles.get(folderId)?.forEach((protyle) => {
            if (protectedDocIds.has(protyle?.block?.rootID)) {
                protyles.add(protyle);
            }
        });
        protyles.forEach((protyle) => {
            state.protyles.add(protyle);
            this.reloadUnlockedProtyle(protyle, placeholder, true);
        });
    }

    /** 最后一个相关文档关闭后，保存最新密文并恢复锁定状态 */
    private async handleProtyleDestroyed(event: CustomEvent): Promise<void> {
        const protyle = event.detail?.protyle;
        const docId = protyle?.block?.rootID;
        if (!protyle || !docId) {
            return;
        }
        const lockInfo = await this.findLockForDoc(docId);
        if (!lockInfo) {
            return;
        }
        const state = this.unlockedFolders.get(lockInfo.folderId);
        if (!state) {
            return;
        }
        state.protyles.delete(protyle);
        if (state.protyles.size > 0 || this.relockTasks.has(lockInfo.folderId)) {
            return;
        }

        try {
            await this.startRelockTask(lockInfo.folderId, state);
        } catch (error) {
            console.error("文档关闭后重新上锁失败：", error);
            showMessage(`${this.i18n.lockFailed}: ${(error as Error).message}`, 5000, "error");
            // 错误已提示；持久化前失败时会保留临时解锁状态，持久化后失败时仍保留可恢复密文
        }
    }

    /** 加锁当前文档及其全部子文档 */
    private async lockFolder(folderId: string, password: string): Promise<void> {
        return this.runFolderOperation(folderId, async () => {
            await this.lockFolderCore(folderId, password);
        });
    }

    private async lockFolderCore(folderId: string, password: string): Promise<void> {
        const blockInfo = await getBlockInfo(folderId);
        if (!blockInfo) {
            throw new Error(this.i18n.folderNotFound);
        }
        const docs = await getDocIDs(blockInfo.box, blockInfo.path, blockInfo.rootID);
        if (docs.length === 0) {
            throw new Error(this.i18n.noDocuments);
        }
        this.ensureNoOverlappingLock(docs, blockInfo.box, blockInfo.path);

        const salt = generateSalt();
        const wrappingKey = await deriveKey(password, salt);
        const masterKey = await generateMasterKey();
        const wrapped = await wrapKey(masterKey, wrappingKey, this.keyContext(folderId, "password", FORMAT_VERSION));
        const recoveryCode = generateRecoveryCode();
        const recoverySalt = generateSalt();
        const recoveryWrappingKey = await deriveKey(recoveryCode, recoverySalt);
        const recoveryWrapped = await wrapKey(
            masterKey,
            recoveryWrappingKey,
            this.keyContext(folderId, "recovery", FORMAT_VERSION),
        );
        const originalDocs: Record<string, string> = {};
        const docIds: string[] = [];

        for (const docId of docs) {
            const content = await getDocRaw(docId);
            originalDocs[docId] = content;
            docIds.push(docId);
        }
        if (docIds.length === 0) {
            throw new Error(this.i18n.encryptFailed);
        }

        const placeholder = this.placeholderContent();
        this.ensureSnapshotContainsPlaintext(originalDocs, placeholder, RAW_SY_CONTENT_FORMAT);
        const snapshot = await createEncryptedSnapshot({
            folderId,
            notebookId: blockInfo.box,
            folderPath: blockInfo.path,
            docIds,
            plaintextDocs: originalDocs,
            placeholder,
            cryptoFormatVersion: FORMAT_VERSION,
            contentFormat: RAW_SY_CONTENT_FORMAT,
            encrypt: (docId, content) => encryptText(
                content,
                masterKey,
                this.docContext(docId, FORMAT_VERSION),
            ),
        });
        const snapshotReference = await this.persistVerifiedSnapshot(snapshot, originalDocs, masterKey);
        const lockData: IFolderLockData = {
            formatVersion: FORMAT_VERSION,
            kdf: {
                algorithm: "PBKDF2",
                hash: "SHA-256",
                iterations: PBKDF2_ITERATIONS,
            },
            salt,
            masterKeyWrapped: wrapped.wrappedKey,
            masterKeyIv: wrapped.iv,
            recoverySalt,
            recoveryKeyWrapped: recoveryWrapped.wrappedKey,
            recoveryKeyIv: recoveryWrapped.iv,
            lockedAt: snapshot.createdAt,
            notebookId: blockInfo.box,
            folderPath: blockInfo.path,
            docIds,
            placeholder,
            activeSnapshot: snapshotReference,
            snapshotHistory: [snapshotReference],
        };

        // 不可变快照和双槽清单全部验证成功后，才能替换可见正文。
        await this.store.addLock(folderId, lockData);
        await showRecoveryCodeDialog(this.i18n, recoveryCode);
        const openProtectedEditors = this.getOpenProtectedEditors(docIds);
        try {
            await updateDocumentsTransactional(
                docIds,
                this.placeholderContents(docIds, lockData.placeholder),
                originalDocs,
                updateDocKramdown,
                (docId, content) => this.updateAndVerifyRawDocument(docId, content),
            );
        } catch (error) {
            if (error instanceof DocumentTransactionError && error.rollbackFailures.length === 0) {
                await this.store.removeLock(folderId);
            }
            throw new Error(this.transactionErrorMessage(error));
        }
        this.reloadLockedEditors(openProtectedEditors);
        this.indicator?.refresh(folderId);
    }

    /** 使用密码解锁 */
    private async unlockFolder(folderId: string, password: string): Promise<void> {
        return this.runFolderOperation(folderId, async () => {
            await this.unlockFolderCore(folderId, password);
        });
    }

    private async unlockFolderCore(folderId: string, password: string): Promise<void> {
        const lockData = this.getLockData(folderId);
        const wrappingKey = await deriveKey(password, lockData.salt, this.kdfIterations(lockData));
        let masterKey: CryptoKey;
        try {
            masterKey = await unwrapKey(
                lockData.masterKeyWrapped,
                lockData.masterKeyIv,
                wrappingKey,
                this.lockContext(lockData, folderId, "password"),
            );
        } catch {
            throw new Error(this.i18n.passwordError);
        }
        const docIds = await this.restoreDocuments(folderId, lockData, masterKey);
        this.rememberUnlockedFolder(folderId, masterKey);
        this.reloadOpenUnlockedEditors(
            folderId,
            docIds,
            lockData.placeholder || this.placeholderContent(),
        );
    }

    /** 使用恢复码直接解锁 */
    private async unlockFolderWithRecoveryCode(folderId: string, recoveryCode: string): Promise<void> {
        return this.runFolderOperation(folderId, async () => {
            await this.unlockFolderWithRecoveryCodeCore(folderId, recoveryCode);
        });
    }

    private async unlockFolderWithRecoveryCodeCore(folderId: string, recoveryCode: string): Promise<void> {
        const lockData = this.getLockData(folderId);
        const wrappingKey = await deriveKey(recoveryCode, lockData.recoverySalt, this.kdfIterations(lockData));
        let masterKey: CryptoKey;
        try {
            masterKey = await unwrapKey(
                lockData.recoveryKeyWrapped,
                lockData.recoveryKeyIv,
                wrappingKey,
                this.lockContext(lockData, folderId, "recovery"),
            );
        } catch {
            throw new Error(this.i18n.recoveryCodeError);
        }
        const docIds = await this.restoreDocuments(folderId, lockData, masterKey);
        this.rememberUnlockedFolder(folderId, masterKey);
        this.reloadOpenUnlockedEditors(
            folderId,
            docIds,
            lockData.placeholder || this.placeholderContent(),
        );
    }

    /** 完整验证不可变快照后再恢复正文；解锁过程永远不覆盖任何已有密文。 */
    private async restoreDocuments(
        folderId: string,
        lockData: IFolderLockData,
        masterKey: CryptoKey,
    ): Promise<string[]> {
        const blockInfo = await getBlockInfo(folderId);
        if (!blockInfo) {
            throw new Error(this.i18n.folderNotFound);
        }
        const docs = await getDocIDs(blockInfo.box, blockInfo.path, blockInfo.rootID);
        const docIds = mergeProtectedDocumentIds(docs, lockData.docIds);
        const currentKramdown: Record<string, string> = {};
        const currentRaw: Record<string, string> = {};
        for (const docId of docIds) {
            currentKramdown[docId] = await getDocKramdown(docId);
            currentRaw[docId] = await getDocRaw(docId);
        }

        const snapshots = await this.loadSnapshotCandidates(folderId, lockData);
        let selectedRestore;
        try {
            selectedRestore = await selectSafeRestorePlan(
                docIds,
                (snapshot) => snapshot.contentFormat === RAW_SY_CONTENT_FORMAT ? currentRaw : currentKramdown,
                snapshots,
                (snapshot) => decryptCompleteSnapshot(
                    snapshot,
                    (docId, encrypted) => decryptText(
                        encrypted.ciphertext,
                        encrypted.iv,
                        masterKey,
                        this.docContext(docId, snapshot.cryptoFormatVersion),
                    ),
                ),
            );
        } catch (error) {
            console.error("安全锁全部恢复快照验证失败：", error);
            throw new Error(this.i18n.decryptFailed);
        }

        const restorePlan = selectedRestore.plan;
        const updateDocument = selectedRestore.contentFormat === RAW_SY_CONTENT_FORMAT ?
            (docId: string, content: string) => this.updateAndVerifyRawDocument(docId, content) :
            updateDocKramdown;
        try {
            await updateDocumentsTransactional(
                restorePlan.restoreDocIds,
                restorePlan.plaintextDocs,
                restorePlan.rollbackContents,
                updateDocument,
            );
        } catch (error) {
            if (error instanceof DocumentTransactionError && error.rollbackFailures.length > 0) {
                // 混合占位与正文的状态无法直接再次加密，清除临时密钥后让下次解锁从已验证快照恢复。
                const state = this.unlockedFolders.get(folderId);
                if (state) {
                    this.clearIdleRelockTimer(state);
                }
                this.unlockedFolders.delete(folderId);
            }
            throw new Error(this.transactionErrorMessage(error));
        }
        return docIds;
    }

    /** 将当前正文写入新一代不可变快照，验证和提交清单后再恢复锁定占位。 */
    private async relockFolder(folderId: string, masterKey: CryptoKey): Promise<void> {
        return this.runFolderOperation(folderId, async () => {
            await this.relockFolderCore(folderId, masterKey);
        });
    }

    private async relockFolderCore(folderId: string, masterKey: CryptoKey): Promise<void> {
        const lockData = this.getLockData(folderId);
        const blockInfo = await getBlockInfo(folderId);
        if (!blockInfo) {
            throw new Error(this.i18n.folderNotFound);
        }
        const docs = await getDocIDs(blockInfo.box, blockInfo.path, blockInfo.rootID);
        if (docs.length === 0) {
            throw new Error(this.i18n.noDocuments);
        }

        const plaintextDocs: Record<string, string> = {};
        const docIds: string[] = [];
        for (const docId of docs) {
            const content = await getDocRaw(docId);
            plaintextDocs[docId] = content;
            docIds.push(docId);
        }

        const cryptoFormatVersion = lockData.formatVersion || 0;
        const placeholder = lockData.placeholder || this.placeholderContent();
        this.ensureSnapshotContainsPlaintext(plaintextDocs, placeholder, RAW_SY_CONTENT_FORMAT);
        const previousReferences = getSnapshotReferences(lockData);
        const snapshot = await createEncryptedSnapshot({
            folderId,
            notebookId: blockInfo.box,
            folderPath: blockInfo.path,
            docIds,
            plaintextDocs,
            placeholder,
            cryptoFormatVersion,
            contentFormat: RAW_SY_CONTENT_FORMAT,
            previousGenerationId: previousReferences[0]?.generationId,
            encrypt: (docId, content) => encryptText(
                content,
                masterKey,
                this.docContext(docId, cryptoFormatVersion),
            ),
        });
        const snapshotReference = await this.persistVerifiedSnapshot(snapshot, plaintextDocs, masterKey);
        await this.store.addLock(folderId, {
            ...lockData,
            lockedAt: snapshot.createdAt,
            notebookId: blockInfo.box,
            folderPath: blockInfo.path,
            docIds,
            placeholder,
            activeSnapshot: snapshotReference,
            snapshotHistory: prependSnapshotReference(snapshotReference, previousReferences),
        });

        const openProtectedEditors = this.getOpenProtectedEditors(docIds);
        try {
            await updateDocumentsTransactional(
                docIds,
                this.placeholderContents(docIds, placeholder),
                plaintextDocs,
                updateDocKramdown,
                (docId, content) => this.updateAndVerifyRawDocument(docId, content),
            );
        } catch (error) {
            throw new Error(this.transactionErrorMessage(error));
        }
        this.reloadLockedEditors(openProtectedEditors);
        const state = this.unlockedFolders.get(folderId);
        if (state) {
            this.clearIdleRelockTimer(state);
        }
        this.unlockedFolders.delete(folderId);
        this.indicator?.refresh(folderId);
    }

    private getOpenProtectedEditors(docIds: string[]): Protyle[] {
        const protectedDocIds = new Set(docIds);
        return getAllEditor().filter((editor) => {
            const rootID = editor?.protyle?.block?.rootID;
            return typeof rootID === "string" && protectedDocIds.has(rootID);
        });
    }

    /** 锁定写入完成后重新载入占位内容，并跳过这次程序触发的解锁提示。 */
    private reloadLockedEditors(editors: Protyle[]): void {
        editors.forEach((editor) => {
            const protyle = editor.protyle;
            this.suppressedLockedDocPrompts.add(protyle);
            try {
                editor.reload(false);
            } catch (error) {
                this.suppressedLockedDocPrompts.delete(protyle);
                console.error("刷新锁定文档失败：", error);
            }
        });
    }

    /** 文档已完整恢复后持久移除锁记录，供卸载前安全退出。 */
    private async removeFolderLock(folderId: string): Promise<void> {
        await this.runFolderOperation(folderId, async () => {
            const state = this.unlockedFolders.get(folderId);
            if (!state) {
                throw new Error(this.i18n.notUnlocked);
            }
            await this.store.removeLock(folderId);
            this.clearIdleRelockTimer(state);
            this.unlockedFolders.delete(folderId);
            this.indicator?.refresh(folderId);
        });
    }

    private rememberUnlockedFolder(folderId: string, masterKey: CryptoKey): void {
        const state: IUnlockedFolderState = {
            masterKey,
            protyles: new Set(),
            idleRelockTimer: null,
        };
        this.unlockedFolders.set(folderId, state);
        this.scheduleIdleRelock(folderId, state);
    }

    private scheduleIdleRelock(folderId: string, state: IUnlockedFolderState): void {
        this.clearIdleRelockTimer(state);
        state.idleRelockTimer = setTimeout(() => {
            state.idleRelockTimer = null;
            if (state.protyles.size > 0 || this.unlockedFolders.get(folderId) !== state) {
                return;
            }
            void this.startRelockTask(folderId, state).catch((error) => {
                console.error("空闲状态重新上锁失败：", error);
                showMessage(`${this.i18n.lockFailed}: ${(error as Error).message}`, 5000, "error");
                if (this.unlockedFolders.get(folderId) === state && state.protyles.size === 0) {
                    this.scheduleIdleRelock(folderId, state);
                }
            });
        }, 30000);
    }

    private clearIdleRelockTimer(state: IUnlockedFolderState): void {
        if (state.idleRelockTimer) {
            clearTimeout(state.idleRelockTimer);
            state.idleRelockTimer = null;
        }
    }

    /** 复用目录级重锁任务，避免关闭页签、空闲定时器和插件卸载同时写入。 */
    private startRelockTask(folderId: string, state: IUnlockedFolderState): Promise<void> {
        const existing = this.relockTasks.get(folderId);
        if (existing) {
            return existing;
        }
        const task = this.relockFolder(folderId, state.masterKey).finally(() => {
            this.relockTasks.delete(folderId);
        });
        this.relockTasks.set(folderId, task);
        return task;
    }

    private async runFolderOperation<T>(folderId: string, operation: () => Promise<T>): Promise<T> {
        if (this.folderOperations.has(folderId)) {
            throw new Error(this.i18n.operationInProgress);
        }
        this.folderOperations.add(folderId);
        try {
            return await operation();
        } finally {
            this.folderOperations.delete(folderId);
        }
    }

    private ensureNoOverlappingLock(docIds: string[], notebookId: string, folderPath: string): void {
        const newDocIds = new Set(docIds);
        for (const lockedFolderId of this.store.getLockedFolderIds()) {
            const lockData = this.store.getLock(lockedFolderId);
            if (lockData && (
                lockData.notebookId === notebookId && documentTreesOverlap(lockData.folderPath, folderPath) ||
                lockData.docIds.some((docId) => newDocIds.has(docId))
            )) {
                throw new Error(this.i18n.overlappingLock);
            }
        }
    }

    /** 快照必须落盘、读回并完整解密比对成功，之后才允许进入清单。 */
    private async persistVerifiedSnapshot(
        snapshot: ILockSnapshot,
        plaintextDocs: Record<string, string>,
        masterKey: CryptoKey,
    ): Promise<ILockSnapshotReference> {
        try {
            const reference = await this.store.saveSnapshot(snapshot);
            const persisted = await this.store.loadSnapshot(reference);
            await verifySnapshotRoundTrip(
                persisted,
                plaintextDocs,
                (docId, encrypted) => decryptText(
                    encrypted.ciphertext,
                    encrypted.iv,
                    masterKey,
                    this.docContext(docId, persisted.cryptoFormatVersion),
                ),
            );
            return reference;
        } catch (error) {
            console.error("安全锁快照提交失败：", error);
            throw new Error(this.i18n.snapshotSaveFailed);
        }
    }

    /** 按新到旧加载快照；新版快照损坏时仍可回退到历史快照或旧版内联密文。 */
    private async loadSnapshotCandidates(
        folderId: string,
        lockData: IFolderLockData,
    ): Promise<ILockSnapshot[]> {
        const snapshots: ILockSnapshot[] = [];
        for (const reference of getSnapshotReferences(lockData)) {
            try {
                const snapshot = await this.store.loadSnapshot(reference);
                if (snapshot.folderId !== folderId) {
                    throw new Error(`Snapshot folder mismatch: ${snapshot.generationId}`);
                }
                snapshots.push(snapshot);
            } catch (error) {
                console.error(`安全锁快照 ${reference.generationId} 读取失败：`, error);
            }
        }
        if (lockData.encryptedDocs) {
            snapshots.push({
                storageVersion: 1,
                generationId: "legacy-inline",
                folderId,
                createdAt: lockData.lockedAt,
                notebookId: lockData.notebookId,
                folderPath: lockData.folderPath,
                docIds: [...lockData.docIds],
                encryptedDocs: lockData.encryptedDocs,
                placeholder: lockData.placeholder || this.placeholderContent(),
                cryptoFormatVersion: lockData.formatVersion || 0,
            });
        }
        return snapshots;
    }

    private placeholderContents(docIds: string[], placeholder = this.placeholderContent()): Record<string, string> {
        const contents: Record<string, string> = {};
        docIds.forEach((docId) => {
            contents[docId] = placeholder;
        });
        return contents;
    }

    /** 占位内容绝不能进入新快照，否则必须依赖上一代快照继续恢复。 */
    private ensureSnapshotContainsPlaintext(
        contents: Record<string, string>,
        placeholder: string,
        contentFormat: SnapshotContentFormat = "kramdown-v1",
    ): void {
        if (contentFormat === RAW_SY_CONTENT_FORMAT ?
            Object.values(contents).some((content) =>
                isLockedPlaceholderContent(content, placeholder, RAW_SY_CONTENT_FORMAT)) :
            containsLockedPlaceholder(contents, placeholder)) {
            throw new Error(this.i18n.placeholderSnapshotRejected);
        }
    }

    /** 内核完成原始结构恢复后再逐字段读回；任何差异都会触发整批回滚。 */
    private async updateAndVerifyRawDocument(docId: string, content: string): Promise<void> {
        await updateDocRaw(docId, content);
        const persisted = await getDocRaw(docId);
        if (!isSameSyJSON(persisted, content)) {
            throw new Error(`原始文档写入校验失败: ${docId}`);
        }
    }

    private placeholderContent(): string {
        return `> 🔒 ${this.i18n.encryptedPlaceholder}`;
    }

    private kdfIterations(lockData: IFolderLockData): number {
        return lockData.kdf?.iterations || LEGACY_PBKDF2_ITERATIONS;
    }

    private docContext(docId: string, formatVersion = FORMAT_VERSION): string | undefined {
        if (formatVersion < 1) {
            return undefined;
        }
        return `siyuan-folder-lock:doc:${docId}:v${formatVersion}`;
    }

    private keyContext(
        folderId: string,
        type: "password" | "recovery",
        formatVersion = FORMAT_VERSION,
    ): string | undefined {
        if (formatVersion < 1) {
            return undefined;
        }
        return `siyuan-folder-lock:key:${folderId}:${type}:v${formatVersion}`;
    }

    private lockContext(
        lockData: IFolderLockData,
        id: string,
        type: "doc" | "password" | "recovery",
    ): string | undefined {
        const formatVersion = lockData.formatVersion || 0;
        return type === "doc" ? this.docContext(id, formatVersion) : this.keyContext(id, type, formatVersion);
    }

    private transactionErrorMessage(error: unknown): string {
        if (error instanceof DocumentTransactionError && error.rollbackFailures.length > 0) {
            return `${this.i18n.partialRollback}: ${error.rollbackFailures.length}`;
        }
        return error instanceof Error ? error.message : String(error);
    }

    private getLockData(folderId: string): IFolderLockData {
        const lockData = this.store.getLock(folderId);
        if (!lockData) {
            throw new Error(this.i18n.notLocked);
        }
        return lockData;
    }

    private async findLockForDoc(
        docId: string,
    ): Promise<{ folderId: string; lockData: IFolderLockData } | null> {
        const directLock = this.store.isDocLocked(docId);
        if (directLock) {
            return directLock;
        }
        const blockInfo = await getBlockInfo(docId);
        if (!blockInfo) {
            return null;
        }
        for (const folderId of this.store.getLockedFolderIds()) {
            const lockData = this.store.getLock(folderId);
            if (lockData && lockData.notebookId === blockInfo.box &&
                documentPathWithinTree(blockInfo.path, lockData.folderPath)) {
                return {folderId, lockData};
            }
        }
        return null;
    }

    private getDocName(protyle: any, docId: string): string {
        const title = protyle?.title?.editElement?.textContent?.trim();
        return title || docId.substring(0, 8);
    }

    private getFolderName(folderId: string): string {
        const item = document.querySelector(`[data-node-id="${folderId}"] .b3-list-item__text`);
        return item?.textContent?.trim() || this.i18n.lockedDocument;
    }
}
