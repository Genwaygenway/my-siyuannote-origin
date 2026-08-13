// 文档树锁图标渲染
// 使用 MutationObserver 监听文档树变化，为加锁文件夹显示锁图标

import { LockStore } from "./store";

/** 复用思源内置锁图标。 */
const LOCK_ICON_ID = "iconLock";

/** 锁定状态指示器 */
export class LockIndicator {
    private store: LockStore;
    private lockedTitle: string;
    private observer: MutationObserver | null = null;

    constructor(store: LockStore, lockedTitle: string) {
        this.store = store;
        this.lockedTitle = lockedTitle;
    }

    /** 启动监听 */
    public start(): void {
        this.updateAllIndicators();
        this.observer = new MutationObserver(() => {
            this.updateAllIndicators();
        });
        // 监听文档树容器
        const fileTree = document.querySelector("#fileTree") || document.querySelector(".sy__file");
        if (fileTree) {
            this.observer.observe(fileTree, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["data-node-id"],
            });
        }
    }

    /** 停止监听 */
    public stop(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        // 移除所有锁图标
        document.querySelectorAll(".fld-lock-indicator").forEach((el) => el.remove());
    }

    /** 更新所有锁图标 */
    private updateAllIndicators(): void {
        const lockedIds = new Set(this.store.getLockedFolderIds());
        if (lockedIds.size === 0) {
            return;
        }
        // 查找所有文档树节点
        const navItems = document.querySelectorAll("[data-node-id]");
        navItems.forEach((item) => {
            const nodeId = item.getAttribute("data-node-id");
            if (!nodeId || !lockedIds.has(nodeId)) {
                return;
            }
            // 检查是否已有锁图标
            const existing = item.querySelector(".fld-lock-indicator");
            if (existing) {
                return;
            }
            // 在节点文本旁添加锁图标
            const textEl = item.querySelector(".b3-list-item__text") || item.querySelector(".ft__on-surface");
            if (textEl) {
                const lockIcon = document.createElement("span");
                lockIcon.className = "fld-lock-indicator";
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.classList.add("fld-lock-svg");
                const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
                use.setAttribute("href", `#${LOCK_ICON_ID}`);
                svg.appendChild(use);
                lockIcon.appendChild(svg);
                lockIcon.title = this.lockedTitle;
                textEl.appendChild(lockIcon);
            }
        });
    }

    /** 刷新指定文件夹的锁图标 */
    public refresh(folderId?: string): void {
        if (folderId) {
            // 移除指定文件夹的锁图标
            const item = document.querySelector(`[data-node-id="${folderId}"]`);
            if (item) {
                item.querySelector(".fld-lock-indicator")?.remove();
            }
        } else {
            // 移除所有锁图标
            document.querySelectorAll(".fld-lock-indicator").forEach((el) => el.remove());
        }
        this.updateAllIndicators();
    }
}
