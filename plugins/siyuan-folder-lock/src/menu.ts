// 文档树安全锁菜单

import {showMessage} from "siyuan";
import {LockStore} from "./store";
import {showRecoveryDialog, showRemoveLockDialog, showSetPasswordDialog, showUnlockDialog} from "./dialog";

export class MenuIntegration {
    private store: LockStore;
    private i18n: any;
    private onLock: (folderId: string, password: string) => Promise<void>;
    private onUnlock: (folderId: string, password: string) => Promise<void>;
    private onRecover: (folderId: string, recoveryCode: string) => Promise<void>;
    private onRemove: (folderId: string) => Promise<void>;
    private getFolderName: (folderId: string) => string;

    constructor(options: {
        store: LockStore;
        i18n: any;
        onLock: (folderId: string, password: string) => Promise<void>;
        onUnlock: (folderId: string, password: string) => Promise<void>;
        onRecover: (folderId: string, recoveryCode: string) => Promise<void>;
        onRemove: (folderId: string) => Promise<void>;
        getFolderName: (folderId: string) => string;
    }) {
        this.store = options.store;
        this.i18n = options.i18n;
        this.onLock = options.onLock;
        this.onUnlock = options.onUnlock;
        this.onRecover = options.onRecover;
        this.onRemove = options.onRemove;
        this.getFolderName = options.getFolderName;
    }

    public bind(eventBus: any): void {
        eventBus.on("open-menu-doctree", (event: CustomEvent) => this.handleMenuEvent(event));
    }

    /** 文档打开和右键菜单共用同一套解锁流程 */
    public async promptUnlock(folderId: string, targetName?: string): Promise<boolean> {
        const choice = await showUnlockDialog(this.i18n, targetName || this.getFolderName(folderId));
        if (!choice) {
            return false;
        }

        if (choice.type === "recovery") {
            const recoveryCode = await showRecoveryDialog(this.i18n);
            if (!recoveryCode) {
                return false;
            }
            try {
                await this.onRecover(folderId, recoveryCode);
                showMessage(this.i18n.recoveryUnlockSuccess, 3000, "info");
                return true;
            } catch (error) {
                console.error("恢复码解锁失败：", error);
                showMessage(`${this.i18n.recoveryUnlockFailed}: ${(error as Error).message}`, 5000, "error");
                return false;
            }
        }

        try {
            await this.onUnlock(folderId, choice.password);
            showMessage(this.i18n.unlockSuccess, 3000, "info");
            return true;
        } catch (error) {
            console.error("解锁失败：", error);
            showMessage(`${this.i18n.unlockFailed}: ${(error as Error).message}`, 5000, "error");
            return false;
        }
    }

    private handleMenuEvent(event: CustomEvent): void {
        const detail = event.detail;
        if (!detail || (detail.type !== "doc" && detail.type !== "docs")) {
            return;
        }
        const elements = detail.elements as HTMLElement[];
        if (!elements || elements.length !== 1) {
            return;
        }
        const folderId = elements[0].getAttribute("data-node-id");
        if (!folderId || !detail.menu || typeof detail.menu.addItem !== "function") {
            return;
        }

        const lockInfo = this.store.isDocLocked(folderId);
        if (lockInfo) {
            detail.menu.addItem({
                icon: "iconUnlock",
                label: this.i18n.unlock,
                click: () => this.promptUnlock(lockInfo.folderId),
            });
            if (folderId === lockInfo.folderId) {
                detail.menu.addItem({
                    icon: "iconTrashcan",
                    label: this.i18n.removeLock,
                    click: () => this.handleRemove(lockInfo.folderId),
                });
            }
        } else {
            detail.menu.addItem({
                icon: "iconLock",
                label: this.i18n.lockFolder,
                click: () => this.handleLock(folderId),
            });
        }
    }

    private async handleLock(folderId: string): Promise<void> {
        const password = await showSetPasswordDialog(this.i18n);
        if (!password) {
            return;
        }
        try {
            await this.onLock(folderId, password);
            showMessage(this.i18n.lockSuccess, 3000, "info");
        } catch (error) {
            console.error("加锁失败：", error);
            showMessage(`${this.i18n.lockFailed}: ${(error as Error).message}`, 5000, "error");
        }
    }

    private async handleRemove(folderId: string): Promise<void> {
        if (!await showRemoveLockDialog(this.i18n)) {
            return;
        }
        if (!await this.promptUnlock(folderId)) {
            return;
        }
        try {
            await this.onRemove(folderId);
            showMessage(this.i18n.removeLockSuccess, 3000, "info");
        } catch (error) {
            console.error("移除安全锁失败：", error);
            showMessage(`${this.i18n.removeLockFailed}: ${(error as Error).message}`, 5000, "error");
        }
    }
}
