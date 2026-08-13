// 加密元数据与不可变恢复快照存储管理

export const SNAPSHOT_STORAGE_VERSION = 2;
export const KRAMDOWN_CONTENT_FORMAT = "kramdown-v1";
export const RAW_SY_CONTENT_FORMAT = "sy-json-v1";
export type SnapshotContentFormat = typeof KRAMDOWN_CONTENT_FORMAT | typeof RAW_SY_CONTENT_FORMAT;
const MANIFEST_STORAGE_VERSION = 1;
const MANIFEST_SLOTS = ["locks-v2-a", "locks-v2-b"] as const;
const SIYUAN_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const GENERATION_ID_PATTERN = /^[0-9a-z]+-[0-9a-f]{32}$/;

export interface IEncryptedDocument {
    ciphertext: string;
    iv: string;
}

export interface ILockSnapshotReference {
    storageName: string;
    generationId: string;
    createdAt: number;
    docCount: number;
}

export interface ILockSnapshot {
    storageVersion: 1 | 2;
    generationId: string;
    folderId: string;
    createdAt: number;
    notebookId: string;
    folderPath: string;
    docIds: string[];
    encryptedDocs: Record<string, IEncryptedDocument>;
    placeholder: string;
    cryptoFormatVersion: number;
    contentFormat?: SnapshotContentFormat;
    previousGenerationId?: string;
}

export interface IFolderLockData {
    formatVersion?: 1 | 2;
    kdf?: {
        algorithm: "PBKDF2";
        hash: "SHA-256";
        iterations: number;
    };
    salt: string;
    masterKeyWrapped: string;
    masterKeyIv: string;
    recoverySalt: string;
    recoveryKeyWrapped: string;
    recoveryKeyIv: string;
    lockedAt: number;
    notebookId: string;
    folderPath: string;
    docIds: string[];
    encryptedDocs?: Record<string, IEncryptedDocument>;
    placeholder?: string;
    activeSnapshot?: ILockSnapshotReference;
    snapshotHistory?: ILockSnapshotReference[];
}

interface ILocksManifest {
    storageVersion: 1;
    sequence: number;
    commitId: string;
    locks: Record<string, IFolderLockData>;
}

/** 返回当前快照及历史快照，自动移除重复引用。 */
export function getSnapshotReferences(lockData: IFolderLockData): ILockSnapshotReference[] {
    const references = [lockData.activeSnapshot, ...(lockData.snapshotHistory || [])];
    const seen = new Set<string>();
    return references.filter((reference): reference is ILockSnapshotReference => {
        if (!reference || seen.has(reference.storageName)) {
            return false;
        }
        seen.add(reference.storageName);
        return true;
    });
}

/** 旧版快照没有内容格式字段，默认按 Kramdown 兼容读取。 */
export function getSnapshotContentFormat(
    snapshot: Pick<ILockSnapshot, "contentFormat">,
): SnapshotContentFormat {
    return snapshot.contentFormat || KRAMDOWN_CONTENT_FORMAT;
}

export class LockStore {
    private plugin: any;
    private locks: Record<string, IFolderLockData> = {};
    private sequence = 0;
    private activeSlot: typeof MANIFEST_SLOTS[number] | null = null;
    private locksWriteQueue: Promise<void> = Promise.resolve();

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    /** 从双槽清单恢复最新有效状态；仅在没有新版清单时读取旧版单文件。 */
    async initialize(): Promise<void> {
        const validManifests: Array<{ slot: typeof MANIFEST_SLOTS[number]; manifest: ILocksManifest }> = [];
        let manifestSlotExists = false;
        for (const slot of MANIFEST_SLOTS) {
            const raw = await this.loadStorage(slot);
            if (isEmptyStorageValue(raw)) {
                continue;
            }
            manifestSlotExists = true;
            try {
                validManifests.push({slot, manifest: parseManifest(raw)});
            } catch (error) {
                console.error(`安全锁清单槽 ${slot} 损坏：`, error);
            }
        }

        if (validManifests.length > 0) {
            validManifests.sort((left, right) => right.manifest.sequence - left.manifest.sequence);
            const latest = validManifests[0];
            this.locks = cloneJSON(latest.manifest.locks);
            this.sequence = latest.manifest.sequence;
            this.activeSlot = latest.slot;
            this.plugin.data.locks = this.locks;
            return;
        }
        if (manifestSlotExists) {
            throw new Error("安全锁双槽清单均已损坏，已停止加载以避免覆盖恢复数据");
        }

        const legacy = await this.loadStorage("locks");
        this.locks = parseLegacyLocks(legacy);
        this.plugin.data.locks = this.locks;
    }

    async addLock(folderId: string, lockData: IFolderLockData): Promise<void> {
        await this.mutateLocks((locks) => {
            locks[folderId] = lockData;
        });
    }

    async removeLock(folderId: string): Promise<void> {
        await this.mutateLocks((locks) => {
            delete locks[folderId];
        });
    }

    getLock(folderId: string): IFolderLockData | null {
        return this.locks[folderId] || null;
    }

    isLocked(folderId: string): boolean {
        return Boolean(this.locks[folderId]);
    }

    getLockedFolderIds(): string[] {
        return Object.keys(this.locks);
    }

    isDocLocked(docId: string): { folderId: string; lockData: IFolderLockData } | null {
        for (const folderId of this.getLockedFolderIds()) {
            const lockData = this.getLock(folderId);
            if (lockData?.docIds.includes(docId)) {
                return {folderId, lockData};
            }
        }
        return null;
    }

    /** 写入只增不改的快照，并从磁盘读回逐字段核对后返回引用。 */
    async saveSnapshot(snapshot: ILockSnapshot): Promise<ILockSnapshotReference> {
        validateSnapshot(snapshot);
        const storageName = `snapshots/${snapshot.folderId}/${snapshot.generationId}.json`;
        const existing = await this.loadStorage(storageName);
        if (!isEmptyStorageValue(existing)) {
            throw new Error(`恢复快照已存在，拒绝覆盖：${snapshot.generationId}`);
        }

        await this.saveStorage(storageName, snapshot);
        const persisted = parseSnapshot(await this.loadStorage(storageName));
        if (JSON.stringify(persisted) !== JSON.stringify(snapshot)) {
            throw new Error(`恢复快照写入校验失败：${snapshot.generationId}`);
        }
        return {
            storageName,
            generationId: snapshot.generationId,
            createdAt: snapshot.createdAt,
            docCount: snapshot.docIds.length,
        };
    }

    async loadSnapshot(reference: ILockSnapshotReference): Promise<ILockSnapshot> {
        validateSnapshotReference(reference);
        const snapshot = parseSnapshot(await this.loadStorage(reference.storageName));
        if (snapshot.generationId !== reference.generationId || snapshot.docIds.length !== reference.docCount) {
            throw new Error(`恢复快照引用不一致：${reference.generationId}`);
        }
        return snapshot;
    }

    /** 串行提交下一代清单；先写备用槽并读回验证，再同步冗余槽、内存和兼容镜像。 */
    private mutateLocks(mutator: (locks: Record<string, IFolderLockData>) => void): Promise<void> {
        const write = this.locksWriteQueue.then(async () => {
            const locks = cloneJSON(this.locks);
            mutator(locks);
            validateLocks(locks);
            const targetSlot = this.activeSlot === MANIFEST_SLOTS[0] ? MANIFEST_SLOTS[1] : MANIFEST_SLOTS[0];
            const manifest: ILocksManifest = {
                storageVersion: MANIFEST_STORAGE_VERSION,
                sequence: this.sequence + 1,
                commitId: randomIdentifier(),
                locks,
            };
            await this.saveStorage(targetSlot, manifest);
            const persisted = parseManifest(await this.loadStorage(targetSlot));
            if (JSON.stringify(persisted) !== JSON.stringify(manifest)) {
                throw new Error("安全锁清单写入校验失败");
            }

            const mirrorSlot = targetSlot === MANIFEST_SLOTS[0] ? MANIFEST_SLOTS[1] : MANIFEST_SLOTS[0];
            try {
                await this.saveStorage(mirrorSlot, manifest);
                const mirrored = parseManifest(await this.loadStorage(mirrorSlot));
                if (JSON.stringify(mirrored) !== JSON.stringify(manifest)) {
                    throw new Error("安全锁冗余清单写入校验失败");
                }
            } catch (error) {
                // 主清单已经完成持久化和读回校验，冗余槽失败时保留本次提交并在下次写入时重试。
                console.warn(`安全锁清单槽 ${mirrorSlot} 同步失败：`, error);
            }

            this.locks = locks;
            this.sequence = manifest.sequence;
            this.activeSlot = targetSlot;
            this.plugin.data.locks = this.locks;
            try {
                await this.saveStorage("locks", this.locks);
            } catch (error) {
                console.warn("安全锁兼容清单写入失败，双槽清单仍然有效：", error);
            }
        }).catch((error) => {
            console.error("安全锁清单提交失败：", error);
            throw new Error(this.plugin.i18n?.manifestSaveFailed || "Failed to save the lock manifest");
        });
        this.locksWriteQueue = write.catch(() => undefined);
        return write;
    }

    /** 直接检查文件接口状态，避免 SDK 将读取失败和文件不存在都折叠为空值。 */
    private async loadStorage(storageName: string): Promise<unknown> {
        if (typeof window === "undefined") {
            return this.plugin.loadData(storageName);
        }
        const response = await fetch("/api/file/getFile", {
            method: "POST",
            body: JSON.stringify({path: `/data/storage/petal/${this.plugin.name}/${storageName}`}),
        });
        if (response.status === 202) {
            this.plugin.data[storageName] = "";
            return "";
        }
        if (!response.ok) {
            throw new Error(`读取安全锁存储失败：HTTP ${response.status}`);
        }
        const value = await response.text();
        this.plugin.data[storageName] = value;
        return value;
    }

    /** 直接检查写入接口返回码，只有内核确认成功后才更新插件内存。 */
    private async saveStorage(storageName: string, data: unknown): Promise<void> {
        if (typeof window === "undefined") {
            await this.plugin.saveData(storageName, data);
            return;
        }
        const path = `/data/storage/petal/${this.plugin.name}/${storageName}`;
        const serialized = typeof data === "object" ? JSON.stringify(data) : String(data);
        const formData = new FormData();
        formData.append("path", path);
        formData.append("file", new File([serialized], path.split("/").pop() || "data", {
            type: "application/json",
        }));
        formData.append("isDir", "false");
        const response = await fetch("/api/file/putFile", {method: "POST", body: formData});
        if (!response.ok) {
            throw new Error(`写入安全锁存储失败：HTTP ${response.status}`);
        }
        const result = await response.json() as { code: number; msg?: string };
        if (result.code !== 0) {
            throw new Error(result.msg || "写入安全锁存储失败");
        }
        this.plugin.data[storageName] = data;
    }
}

function parseManifest(raw: unknown): ILocksManifest {
    const value = parseStoredValue(raw);
    if (!isRecord(value) || value.storageVersion !== MANIFEST_STORAGE_VERSION ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.commitId !== "string" ||
        !isRecord(value.locks)) {
        throw new Error("清单格式无效");
    }
    validateLocks(value.locks as Record<string, IFolderLockData>);
    return value as unknown as ILocksManifest;
}

function parseLegacyLocks(raw: unknown): Record<string, IFolderLockData> {
    if (isEmptyStorageValue(raw)) {
        return {};
    }
    const value = parseStoredValue(raw);
    if (!isRecord(value)) {
        throw new Error("旧版安全锁清单格式无效，已停止加载以保护恢复数据");
    }
    validateLocks(value as Record<string, IFolderLockData>);
    return cloneJSON(value as Record<string, IFolderLockData>);
}

function parseSnapshot(raw: unknown): ILockSnapshot {
    const value = parseStoredValue(raw);
    validateSnapshot(value as ILockSnapshot);
    return value as ILockSnapshot;
}

function parseStoredValue(raw: unknown): unknown {
    if (typeof raw !== "string") {
        return raw;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return "";
    }
    return JSON.parse(trimmed);
}

function validateLocks(locks: Record<string, IFolderLockData>): void {
    for (const [folderId, lockData] of Object.entries(locks)) {
        if (!SIYUAN_ID_PATTERN.test(folderId) || !isRecord(lockData) || typeof lockData.salt !== "string" ||
            typeof lockData.masterKeyWrapped !== "string" || typeof lockData.masterKeyIv !== "string" ||
            typeof lockData.recoverySalt !== "string" || typeof lockData.recoveryKeyWrapped !== "string" ||
            typeof lockData.recoveryKeyIv !== "string" || !Array.isArray(lockData.docIds) ||
            !SIYUAN_ID_PATTERN.test(lockData.notebookId) || typeof lockData.folderPath !== "string" ||
            !lockData.folderPath.startsWith("/") || lockData.folderPath.includes("..") ||
            !Number.isSafeInteger(lockData.lockedAt) ||
            (lockData.formatVersion !== undefined && lockData.formatVersion !== 1 && lockData.formatVersion !== 2)) {
            throw new Error(`锁记录格式无效：${folderId || "未知目录"}`);
        }
        if (lockData.docIds.length === 0 || new Set(lockData.docIds).size !== lockData.docIds.length ||
            lockData.docIds.some((docId) => !SIYUAN_ID_PATTERN.test(docId))) {
            throw new Error(`锁记录文档集合无效：${folderId}`);
        }
        if (lockData.kdf && (lockData.kdf.algorithm !== "PBKDF2" || lockData.kdf.hash !== "SHA-256" ||
            !Number.isSafeInteger(lockData.kdf.iterations) || lockData.kdf.iterations < 100000 ||
            lockData.kdf.iterations > 5000000)) {
            throw new Error(`锁记录密钥派生参数无效：${folderId}`);
        }
        if (!lockData.activeSnapshot && !isEncryptedDocumentMap(lockData.encryptedDocs)) {
            throw new Error(`锁记录缺少恢复数据：${folderId}`);
        }
        if (lockData.activeSnapshot) {
            validateSnapshotReference(lockData.activeSnapshot);
        }
        (lockData.snapshotHistory || []).forEach(validateSnapshotReference);
    }
}

function validateSnapshot(snapshot: ILockSnapshot): void {
    if (!isRecord(snapshot) || (snapshot.storageVersion !== 1 && snapshot.storageVersion !== SNAPSHOT_STORAGE_VERSION) ||
        typeof snapshot.generationId !== "string" || !GENERATION_ID_PATTERN.test(snapshot.generationId) ||
        !SIYUAN_ID_PATTERN.test(snapshot.folderId) || !Number.isSafeInteger(snapshot.createdAt) ||
        !SIYUAN_ID_PATTERN.test(snapshot.notebookId) || typeof snapshot.folderPath !== "string" ||
        !snapshot.folderPath.startsWith("/") || snapshot.folderPath.includes("..") || !Array.isArray(snapshot.docIds) ||
        typeof snapshot.placeholder !== "string" || !Number.isSafeInteger(snapshot.cryptoFormatVersion) ||
        snapshot.cryptoFormatVersion < 0 || snapshot.cryptoFormatVersion > 2 ||
        !isEncryptedDocumentMap(snapshot.encryptedDocs)) {
        throw new Error("恢复快照格式无效");
    }
    const invalidLegacyFormat = snapshot.storageVersion === 1 && snapshot.contentFormat !== undefined &&
        snapshot.contentFormat !== KRAMDOWN_CONTENT_FORMAT;
    const invalidRawFormat = snapshot.storageVersion === SNAPSHOT_STORAGE_VERSION &&
        snapshot.contentFormat !== RAW_SY_CONTENT_FORMAT;
    if (invalidLegacyFormat || invalidRawFormat) {
        throw new Error(`恢复快照内容格式无效：${snapshot.generationId}`);
    }
    if (snapshot.docIds.length === 0 || new Set(snapshot.docIds).size !== snapshot.docIds.length ||
        Object.keys(snapshot.encryptedDocs).length !== snapshot.docIds.length ||
        snapshot.docIds.some((docId) => !SIYUAN_ID_PATTERN.test(docId) || !snapshot.encryptedDocs[docId])) {
        throw new Error(`恢复快照文档集合无效：${snapshot.generationId}`);
    }
}

function validateSnapshotReference(reference: ILockSnapshotReference): void {
    if (!isRecord(reference) || typeof reference.storageName !== "string" ||
        !/^snapshots\/[0-9a-z-]+\/[0-9a-z-]+\.json$/.test(reference.storageName) ||
        typeof reference.generationId !== "string" || !GENERATION_ID_PATTERN.test(reference.generationId) ||
        !Number.isSafeInteger(reference.createdAt) || !Number.isSafeInteger(reference.docCount) ||
        reference.docCount < 1 || !reference.storageName.endsWith(`/${reference.generationId}.json`)) {
        throw new Error("恢复快照引用无效");
    }
}

function isEncryptedDocumentMap(value: unknown): value is Record<string, IEncryptedDocument> {
    if (!isRecord(value) || Object.keys(value).length === 0) {
        return false;
    }
    return Object.values(value).every((encrypted) => isRecord(encrypted) &&
        typeof encrypted.ciphertext === "string" && encrypted.ciphertext.length > 0 &&
        typeof encrypted.iv === "string" && encrypted.iv.length > 0);
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyStorageValue(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

function cloneJSON<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function randomIdentifier(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
