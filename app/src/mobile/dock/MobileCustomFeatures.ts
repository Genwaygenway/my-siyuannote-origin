import {App} from "../../index";
import {Constants} from "../../constants";
import {Calendar} from "../../layout/dock/Calendar";
import {Todo} from "../../layout/dock/Todo";
import {CodexChat} from "../../layout/dock/agent/CodexChat";
import {Tab} from "../../layout/Tab";
import {fetchPost} from "../../util/fetch";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {setStorageVal} from "../../protyle/util/compatibility";
import {bindSharedStorage} from "../../util/sharedStorage";
import {newFile} from "../../util/newFile";
import {openMobileFileById} from "../editor";
import {popSearch} from "../menu/search";

type Feature = "todo" | "knowledge" | "calendar" | "codex";

interface IMobileFeatureView {
    element: HTMLElement;
    activate?: () => void;
    handleBack?: () => boolean;
    deactivate?: () => void;
}

const FEATURES: Array<{id: Feature, icon: string}> = [
    {id: "todo", icon: "iconList"},
    {id: "knowledge", icon: "iconFiles"},
    {id: "calendar", icon: "iconCalendar"},
    {id: "codex", icon: "iconSparkles"},
];

const createMobileTab = (panelElement: HTMLElement, type: Feature) => ({
    id: `mobile-custom-${type}`,
    panelElement,
} as Tab);

class MobileKnowledge implements IMobileFeatureView {
    public readonly element: HTMLElement;
    private notebookID = "";
    private path = "/";
    private pathStack: string[] = [];
    private manage = false;
    private requestID = 0;

    constructor(private readonly app: App, private readonly closeWorkspace: () => void) {
        this.element = document.createElement("div");
        this.element.classList.add("mobile-knowledge", "fn__flex-column", "fn__flex-1");
        this.element.addEventListener("click", this.handleClick.bind(this));
        bindSharedStorage(this.element, (key) => {
            if (key === Constants.LOCAL_KNOWLEDGE) {
                this.render();
            }
        });
        this.render();
    }

    private getStorage() {
        return window.siyuan.storage[Constants.LOCAL_KNOWLEDGE] as {
            notebooks?: string[];
            updatedAt?: Record<string, number>;
            removedAt?: Record<string, number>;
        } || {};
    }

    private setNotebookSelected(id: string, selected: boolean) {
        const storage = this.getStorage();
        const updatedAt = {...(storage.updatedAt || {})};
        const removedAt = {...(storage.removedAt || {})};
        const notebookIDs = new Set(storage.notebooks || []);
        const now = Date.now();
        if (selected) {
            notebookIDs.add(id);
            updatedAt[id] = now;
            delete removedAt[id];
        } else {
            notebookIDs.delete(id);
            removedAt[id] = now;
        }
        const notebooks = window.siyuan.notebooks.filter((notebook) => {
            const updated = updatedAt[notebook.id] || 0;
            const removed = removedAt[notebook.id] || 0;
            return notebookIDs.has(notebook.id) && (updated > removed || updated === 0 && removed === 0);
        }).map((notebook) => notebook.id);
        window.siyuan.storage[Constants.LOCAL_KNOWLEDGE] = {notebooks, updatedAt, removedAt};
        setStorageVal(Constants.LOCAL_KNOWLEDGE, {notebooks, updatedAt, removedAt});
    }

    private getSelectedNotebooks() {
        const selected = new Set(this.getStorage().notebooks || []);
        return window.siyuan.notebooks.filter((notebook) => selected.has(notebook.id) && !notebook.closed);
    }

    private render() {
        if (this.notebookID) {
            this.element.innerHTML = `<div class="mobile-knowledge__path">
    <button class="mobile-knowledge__path-back" data-type="knowledge-back" type="button" aria-label="${escapeAttr(window.siyuan.languages.back)}"><svg aria-hidden="true"><use xlink:href="#iconLeft"></use></svg></button>
    <div class="mobile-knowledge__path-copy"><strong>${escapeHtml(window.siyuan.notebooks.find((notebook) => notebook.id === this.notebookID)?.name || window.siyuan.languages.knowledge)}</strong><span>${escapeHtml(this.getPathLabel())}</span></div>
</div>
<div class="mobile-knowledge__list fn__flex-1" data-type="knowledge-docs"><div class="mobile-workspace__loading">${escapeHtml(window.siyuan.languages.loading)}</div></div>`;
            this.loadDocs();
            return;
        }
        const notebooks = this.manage ? window.siyuan.notebooks.filter((notebook) => !notebook.closed) : this.getSelectedNotebooks();
        const selected = new Set(this.getStorage().notebooks || []);
        this.element.innerHTML = `<div class="mobile-knowledge__intro">
    <p>${escapeHtml(this.manage ? window.siyuan.languages.select : `${notebooks.length} · ${window.siyuan.languages.workspace}`)}</p>
    <button class="mobile-knowledge__manage" data-type="knowledge-manage" type="button"><svg aria-hidden="true"><use xlink:href="#${this.manage ? "iconCheck" : "iconSettings"}"></use></svg><span>${escapeHtml(this.manage ? window.siyuan.languages.close : window.siyuan.languages.manage)}</span></button>
</div>
<div class="mobile-knowledge__list fn__flex-1">${notebooks.length ? notebooks.map((notebook) =>
            `<button class="mobile-knowledge__row" data-notebook-id="${escapeAttr(notebook.id)}" type="button">
    <span class="mobile-knowledge__row-icon"><svg aria-hidden="true"><use xlink:href="#iconFilesRoot"></use></svg></span>
    <span class="mobile-knowledge__row-copy"><strong>${escapeHtml(notebook.name)}</strong><small>${escapeHtml(window.siyuan.languages.knowledge)}</small></span>
    <span class="mobile-knowledge__row-action"><svg aria-hidden="true"><use xlink:href="#${this.manage ? (selected.has(notebook.id) ? "iconSelect" : "iconUncheck") : "iconRight"}"></use></svg></span>
</button>`).join("") : `<div class="mobile-workspace__empty"><svg aria-hidden="true"><use xlink:href="#iconFiles"></use></svg><strong>${escapeHtml(window.siyuan.languages.emptyContent)}</strong><button data-type="knowledge-manage" type="button">${escapeHtml(window.siyuan.languages.manage)}</button></div>`}</div>`;
    }

    private getPathLabel() {
        if (this.path === "/") {
            return "/";
        }
        return this.pathStack.length > 0 ? this.pathStack.map((item) => item.replace(/\.sy$/, "")).join(" / ") : this.path;
    }

    private loadDocs() {
        const requestID = ++this.requestID;
        fetchPost("/api/filetree/listDocsByPath", {
            notebook: this.notebookID,
            path: this.path,
            app: Constants.SIYUAN_APPID,
        }, (response) => {
            const listElement = this.element.querySelector('[data-type="knowledge-docs"]') as HTMLElement;
            if (!listElement || requestID !== this.requestID || response.code !== 0) {
                return;
            }
            const files = response.data.files as IFile[];
            listElement.innerHTML = files.length ? files.map((file) => {
                const hasChildren = file.subFileCount > 0;
                return `<div class="mobile-knowledge__row">
    <button class="mobile-knowledge__row-main" data-doc-id="${escapeAttr(file.id)}" type="button">
        <span class="mobile-knowledge__row-icon"><svg aria-hidden="true"><use xlink:href="#iconFile"></use></svg></span>
        <span class="mobile-knowledge__row-copy"><strong>${escapeHtml(file.name1 || file.name)}</strong><small>${escapeHtml(file.hMtime || window.siyuan.languages.modifiedAt)}</small></span>
        ${hasChildren ? "" : '<span class="mobile-knowledge__row-action"><svg aria-hidden="true"><use xlink:href="#iconOpen"></use></svg></span>'}
    </button>
    ${hasChildren ? `<button class="mobile-knowledge__row-children" data-child-path="${escapeAttr(file.path)}" data-name="${escapeAttr(file.name1 || file.name)}" type="button" aria-label="${escapeAttr(window.siyuan.languages.expand)}"><svg aria-hidden="true"><use xlink:href="#iconRight"></use></svg></button>` : ""}
</div>`;
            }).join("") : `<div class="mobile-workspace__empty"><svg aria-hidden="true"><use xlink:href="#iconFiles"></use></svg><strong>${escapeHtml(window.siyuan.languages.emptyContent)}</strong></div>`;
        });
    }

    private handleClick(event: MouseEvent) {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-type], [data-notebook-id], [data-doc-id], [data-child-path]");
        if (!target) {
            return;
        }
        const type = target.getAttribute("data-type");
        if (type === "knowledge-manage") {
            this.manage = !this.manage;
            this.render();
        } else if (type === "knowledge-back") {
            this.handleBack();
        } else if (target.dataset.notebookId) {
            const id = target.dataset.notebookId;
            if (this.manage) {
                this.setNotebookSelected(id, !new Set(this.getStorage().notebooks || []).has(id));
                this.render();
            } else {
                this.notebookID = id;
                this.path = "/";
                this.pathStack = [];
                this.render();
            }
        } else if (target.dataset.childPath) {
            this.path = target.dataset.childPath;
            this.pathStack.push(target.dataset.name || "");
            this.render();
        } else if (target.dataset.docId) {
            openMobileFileById(this.app, target.dataset.docId, [Constants.CB_GET_SCROLL]);
            this.closeWorkspace();
        }
        event.preventDefault();
    }

    public handleBack() {
        if (this.manage) {
            this.manage = false;
            this.render();
            return true;
        }
        if (this.pathStack.length > 0) {
            this.pathStack.pop();
            const parts = this.path.split("/").filter(Boolean);
            parts.pop();
            this.path = parts.length > 0 ? `/${parts.join("/")}` : "/";
            this.render();
            return true;
        }
        if (this.notebookID) {
            this.notebookID = "";
            this.path = "/";
            this.render();
            return true;
        }
        return false;
    }

    public activate() {
        this.render();
    }
}

/** 在手机全屏容器中提供独立工作台导航和专用移动视图。 */
export class MobileCustomFeatures {
    private readonly views = new Map<Feature, IMobileFeatureView>();
    private activeFeature?: Feature;
    private readonly modelElement: HTMLElement;
    private readonly titleElement: HTMLElement;
    private readonly mainElement: HTMLElement;
    private readonly leadingButton: HTMLElement;
    private readonly bottomNav: HTMLElement;
    private hubRequestID = 0;

    constructor(private readonly app: App) {
        this.modelElement = document.getElementById("model");
        this.titleElement = this.modelElement.querySelector(".toolbar__text") as HTMLElement;
        this.mainElement = document.getElementById("modelMain") as HTMLElement;
        this.leadingButton = this.modelElement.querySelector(".toolbar > .toolbar__icon") as HTMLElement;
        this.bottomNav = document.createElement("nav");
        this.bottomNav.className = "mobile-workspace__nav";
        this.bottomNav.setAttribute("aria-label", window.siyuan.languages.workspace);
        this.bottomNav.innerHTML = this.renderBottomNav();
        this.bottomNav.addEventListener("click", (event) => {
            const button = (event.target as HTMLElement).closest<HTMLElement>("[data-workspace-route]");
            if (!button) {
                return;
            }
            const route = button.dataset.workspaceRoute;
            if (route === "hub") {
                this.openHub();
            } else {
                this.open(route as Feature);
            }
        });
        this.leadingButton.addEventListener("click", (event) => {
            if (this.modelElement.classList.contains("mobile-workspace") && this.activeFeature) {
                event.stopImmediatePropagation();
                this.openHub();
            }
        }, true);
        this.modelElement.addEventListener("siyuan-model-back", (event) => {
            if (this.handleBack()) {
                event.preventDefault();
            }
        });
        this.modelElement.addEventListener("siyuan-model-hide", () => {
            this.deactivateShell();
        });
        bindSharedStorage(this.modelElement, () => {
            if (!this.activeFeature && this.modelElement.classList.contains("mobile-workspace")) {
                this.mainElement.innerHTML = "";
                this.mainElement.append(this.getHub());
            }
        });
    }

    private renderBottomNav() {
        const home = `<button data-workspace-route="hub" type="button"><svg aria-hidden="true"><use xlink:href="#iconLayoutGrid"></use></svg><span>${escapeHtml(window.siyuan.languages.workspace)}</span></button>`;
        return home + FEATURES.map((feature) => `<button data-workspace-route="${feature.id}" type="button"><svg aria-hidden="true"><use xlink:href="#${feature.icon}"></use></svg><span>${escapeHtml(this.getFeatureTitle(feature.id))}</span></button>`).join("");
    }

    private getFeatureTitle(feature: Feature) {
        return feature === "todo" ? window.siyuan.languages.todo : feature === "knowledge" ?
            window.siyuan.languages.knowledge : feature === "calendar" ? window.siyuan.languages.calendarTitle : "Codex";
    }

    private activateShell() {
        this.modelElement.classList.add("mobile-workspace");
        this.mainElement.classList.add("fn__flex-column", "mobile-workspace__main");
        this.modelElement.style.transform = "translateY(0px)";
        this.modelElement.style.zIndex = (++window.siyuan.zIndex).toString();
        if (!this.bottomNav.isConnected) {
            this.modelElement.append(this.bottomNav);
        }
    }

    private deactivateShell() {
        this.views.get(this.activeFeature)?.deactivate?.();
        this.modelElement.classList.remove("mobile-workspace", "mobile-workspace--hub");
        this.mainElement.classList.remove("fn__flex-column", "mobile-workspace__main");
    }

    private closeShell() {
        this.deactivateShell();
        this.modelElement.style.transform = "";
    }

    public openHub() {
        this.views.get(this.activeFeature)?.deactivate?.();
        this.activeFeature = undefined;
        this.activateShell();
        this.modelElement.classList.add("mobile-workspace--hub");
        this.titleElement.textContent = window.siyuan.languages.workspace;
        this.leadingButton.classList.add("fn__none");
        this.mainElement.innerHTML = "";
        this.mainElement.append(this.getHub());
        this.setActiveRoute("hub");
    }

    private getHub() {
        const counts = this.getHubCounts();
        const formatter = new Intl.DateTimeFormat(navigator.language, {month: "long", day: "numeric", weekday: "long"});
        const title = formatter.format(new Date());
        const requestID = ++this.hubRequestID;
        const hub = document.createElement("div");
        hub.className = "mobile-workspace__hub fn__flex-column fn__flex-1";
        hub.innerHTML = `<header class="mobile-workspace__home-actions">
    <button class="mobile-workspace__search" data-hub-action="search" type="button">
        <svg aria-hidden="true"><use xlink:href="#iconSearch"></use></svg>
        <span>${escapeHtml(window.siyuan.languages.search)}</span>
    </button>
    <button class="mobile-workspace__new" data-hub-action="new" type="button" aria-label="${escapeAttr(window.siyuan.languages.newFile)}">
        <svg aria-hidden="true"><use xlink:href="#iconAdd"></use></svg>
    </button>
    <button class="mobile-workspace__close" data-hub-action="close" type="button" aria-label="${escapeAttr(window.siyuan.languages.close)}">
        <svg aria-hidden="true"><use xlink:href="#iconCloseRound"></use></svg>
    </button>
</header>
<section class="mobile-workspace__today">
    <header><strong>${escapeHtml(window.siyuan.languages.todoToday)}</strong><span>${escapeHtml(title)}</span></header>
    <p>${counts.todo} ${escapeHtml(window.siyuan.languages.todoItems)} · ${counts.calendar} ${escapeHtml(window.siyuan.languages.calendarTitle)}</p>
    <div class="mobile-workspace__quick-actions">
        ${FEATURES.map((feature) => `<button data-feature="${feature.id}" type="button">
            <svg aria-hidden="true"><use xlink:href="#${feature.icon}"></use></svg>
            <span>${escapeHtml(this.getFeatureTitle(feature.id))}</span>
        </button>`).join("")}
    </div>
</section>
<section class="mobile-workspace__recent" aria-labelledby="mobile-workspace-recent-title">
    <header><h2 id="mobile-workspace-recent-title">${escapeHtml(window.siyuan.languages.recentDocs)}</h2></header>
    <div class="mobile-workspace__recent-list" data-hub-recent>
        <div class="mobile-workspace__recent-loading"><svg aria-hidden="true"><use xlink:href="#iconRefresh"></use></svg><span>${escapeHtml(window.siyuan.languages.loading)}</span></div>
    </div>
</section>`;
        hub.addEventListener("click", (event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-feature], [data-hub-action], [data-doc-id]");
            if (!target) {
                return;
            }
            if (target.dataset.feature) {
                this.open(target.dataset.feature as Feature);
            } else if (target.dataset.hubAction === "close") {
                this.closeShell();
            } else if (target.dataset.hubAction === "search") {
                this.closeShell();
                popSearch(this.app);
            } else if (target.dataset.hubAction === "new") {
                this.closeShell();
                newFile(this.app);
            } else if (target.dataset.docId) {
                openMobileFileById(this.app, target.dataset.docId, [Constants.CB_GET_SCROLL]);
                this.closeShell();
            }
        });
        fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
            const listElement = hub.querySelector<HTMLElement>("[data-hub-recent]");
            if (!listElement || requestID !== this.hubRequestID || response.code !== 0) {
                return;
            }
            const blocks = Array.isArray(response.data) ? response.data.slice(0, 6) as IBlock[] : [];
            listElement.innerHTML = blocks.length > 0 ? blocks.map((block) => {
                const contentElement = document.createElement("span");
                contentElement.innerHTML = block.content || "";
                const label = contentElement.textContent?.trim() || window.siyuan.languages.untitled;
                const path = (block.hPath || "/").split("/").filter(Boolean).join(" / ");
                return `<button class="mobile-workspace__recent-row" data-doc-id="${escapeAttr(block.id || block.rootID || "")}" type="button">
    <span class="mobile-workspace__recent-icon"><svg aria-hidden="true"><use xlink:href="#iconFile"></use></svg></span>
    <span class="mobile-workspace__recent-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(path || window.siyuan.languages.workspace)}</small></span>
    <svg class="mobile-workspace__recent-chevron" aria-hidden="true"><use xlink:href="#iconRight"></use></svg>
</button>`;
            }).join("") : `<div class="mobile-workspace__recent-empty"><svg aria-hidden="true"><use xlink:href="#iconFile"></use></svg><span>${escapeHtml(window.siyuan.languages.emptyContent)}</span></div>`;
        });
        return hub;
    }

    private getHubCounts() {
        const storage = window.siyuan.storage[Constants.LOCAL_TODO] || {};
        const today = new Date();
        const date = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`;
        const todo = Array.isArray(storage.items) ? storage.items.filter((item: any) =>
            !item.completed && !item.deletedAt && !item.purgedAt && item.due && item.due <= date).length : 0;
        const calendar = Array.isArray(storage.calendarEntries) ? storage.calendarEntries.filter((item: any) =>
            !item.deletedAt && item.date === date).length : 0;
        const knowledge = this.getKnowledgeIDs().length;
        return {todo, calendar, knowledge};
    }

    private getKnowledgeIDs() {
        const storage = window.siyuan.storage[Constants.LOCAL_KNOWLEDGE] || {};
        return Array.isArray(storage.notebooks) ? storage.notebooks : [];
    }

    public open(feature: Feature) {
        if (this.modelElement.classList.contains("mobile-workspace") && this.activeFeature === feature) {
            return;
        }
        this.views.get(this.activeFeature)?.deactivate?.();
        this.activeFeature = feature;
        this.activateShell();
        this.modelElement.classList.remove("mobile-workspace--hub");
        this.titleElement.textContent = this.getFeatureTitle(feature);
        this.leadingButton.classList.remove("fn__none");
        this.leadingButton.querySelector("use")?.setAttribute("xlink:href", "#iconLeft");
        this.leadingButton.setAttribute("aria-label", window.siyuan.languages.back);
        this.mainElement.innerHTML = "";
        const view = this.getView(feature);
        this.mainElement.append(view.element);
        view.activate?.();
        this.setActiveRoute(feature);
    }

    private setActiveRoute(route: Feature | "hub") {
        this.bottomNav.querySelectorAll<HTMLElement>("[data-workspace-route]").forEach((button) => {
            const active = button.dataset.workspaceRoute === route;
            button.classList.toggle("mobile-workspace__nav-item--active", active);
            if (active) {
                button.setAttribute("aria-current", "page");
            } else {
                button.removeAttribute("aria-current");
            }
        });
    }

    private getView(feature: Feature) {
        const existing = this.views.get(feature);
        if (existing) {
            return existing;
        }
        let view: IMobileFeatureView;
        if (feature === "knowledge") {
            const knowledge = new MobileKnowledge(this.app, () => this.closeShell());
            view = {element: knowledge.element, activate: () => knowledge.activate(),
                handleBack: () => knowledge.handleBack()};
        } else {
            const element = document.createElement("div");
            element.classList.add("mobile-workspace__feature", "fn__flex-column", "fn__flex-1");
            if (feature === "todo") {
                const todo = new Todo(this.app, createMobileTab(element, feature), {mobile: true});
                view = {element, activate: () => todo.refreshFromStorage(), deactivate: () => todo.deactivate()};
            } else if (feature === "calendar") {
                const calendar = new Calendar(this.app, createMobileTab(element, feature), {mobile: true});
                view = {element, activate: () => calendar.refreshFromStorage(), deactivate: () => calendar.deactivate()};
            } else {
                const codex = new CodexChat(this.app, createMobileTab(element, feature), {mobile: true});
                view = {element, handleBack: () => codex.handleMobileBack(), deactivate: () => codex.deactivate()};
            }
        }
        this.views.set(feature, view);
        return view;
    }

    private handleBack() {
        if (!this.modelElement.classList.contains("mobile-workspace") || this.modelElement.style.transform !== "translateY(0px)") {
            return false;
        }
        const view = this.views.get(this.activeFeature);
        if (view?.handleBack?.()) {
            return true;
        }
        if (this.activeFeature) {
            this.openHub();
            return true;
        }
        return false;
    }
}
