import {escapeAttr, escapeHtml} from "../../util/escape";
import {setStorageVal, updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {Constants} from "../../constants";
import {App} from "../../index";
import {Model} from "../Model";
import {Tab} from "../Tab";
import {getDockByType} from "../tabUtil";
import {setPanelFocus} from "../util";
import {confirmDialog} from "../../dialog/confirmDialog";
import {bindSharedStorage} from "../../util/sharedStorage";
import {fetchPost} from "../../util/fetch";
import type {ICalendarEntry} from "./Calendar";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {getMondayBasedWeekRange, getTodoDefaultDue} from "./todoDate";
import {getTodoReorderState} from "./todoHierarchy";
import {getTodoCategoryHierarchy, isTodoAIProjectCategory, isTodoCategoryMatch} from "./todoCategory";
import {
    getTodoCodexProjectSync,
    getTodoAIProjectCategory,
    getTodoProjectHierarchy,
    type ITodoCodexProject,
    isTodoProjectMatch,
    isTodoSiyuanProject,
    TODO_SIYUAN_PARENT_PROJECT,
} from "./todoProject";
import {
    areTodoStatisticsRowsExpanded,
    getTodoStatisticsCategoryHierarchy,
    getTodoStatisticsDate,
    getTodoStatisticsPresetRange,
    getTodoStatisticsProjectHierarchy,
    isTodoWithinStatisticsRange,
    isTodoStatisticsRowExpanded,
    type TTodoStatisticsCategoryInput,
    type TTodoStatisticsDatePreset,
} from "./todoStatistics";

interface ITodoItem {
    id: string;
    parentId?: string;
    title: string;
    // 保留首个标签，兼容尚未升级的客户端读取旧版待办数据
    category: string;
    categories: string[];
    project: string;
    due: string;
    priority: number;
    completed: boolean;
    order?: number;
    orderUpdatedAt?: number;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    deletedAt?: number;
    purgedAt?: number;
}

interface ITodoStorage {
    items: ITodoItem[];
    categories: string[];
    categoryUpdatedAt: Record<string, number>;
    deletedCategories: Record<string, number>;
    projects: string[];
    projectUpdatedAt: Record<string, number>;
    deletedProjects: Record<string, number>;
    projectLabels: Record<string, string>;
    projectLabelOverrides: Record<string, string>;
    projectCodexIDs: Record<string, string>;
    calendarEntries: ICalendarEntry[];
}

type TTodoFilter = "today" | "week" | "lastWeek" | "all" | "completed" | "statistics" | "trash" |
    `category:${string}` | `project:${string}` | `completed:category:${string}` | `completed:project:${string}`;

type TTodoTaxonomy = "tags" | "projects";

type TTodoLangKey = "todo" | "todoSearch" | "todoToday" | "todoWeek" | "todoLastWeek" | "todoCompleted" |
    "todoAll" | "todoCategory" | "todoUncategorized" | "todoTrash" | "todoAddPlaceholder" | "todoCategoryName" |
    "todoTag" | "todoProject" | "todoTagProject" | "todoProjectName" | "todoNoProject" |
    "todoInProgress" | "todoItems" | "todoNoTasks" | "todoToggle" | "todoRestore" | "todoDueDate" |
    "todoDeleteForever" | "todoNotUrgentNotImportant" | "todoImportantNotUrgent" | "todoUrgentNotImportant" |
    "todoUrgentImportant" | "todoPriority" | "todoAddSubtask" | "todoStatistics" | "todoTotal" |
    "todoCompletionRate" | "date" | "endDate" | "expandAll" | "foldAll" | "all" | "custom";

const TODO_PRIORITIES = [0, 1, 2, 3] as const;

const SYSTEM_CATEGORIES = [
    {id: "system:not-urgent-not-important", lang: "todoNotUrgentNotImportant", legacy: "不紧急不重要"},
    {id: "system:important-not-urgent", lang: "todoImportantNotUrgent", legacy: "重要不紧急"},
    {id: "system:urgent-not-important", lang: "todoUrgentNotImportant", legacy: "紧急不重要"},
    {id: "system:urgent-important", lang: "todoUrgentImportant", legacy: "紧急重要"},
] as const;

interface ITodoStatisticsEntry extends TTodoStatisticsCategoryInput<ITodoItem> {
    completionRate: number;
    parentCategory?: string;
    hasChildren: boolean;
}

export class Todo extends Model {
    private element: HTMLElement;
    private data: ITodoStorage;
    private filter: TTodoFilter = "today";
    private search = "";
    private center: boolean;
    private mobile: boolean;
    private addingCategory = false;
    private taxonomy: TTodoTaxonomy = "tags";
    private addingSubtaskFor = "";
    private draftCategories: [string, string] = ["", ""];
    private draftProject = "";
    private draftTitle = "";
    private draftDue = "";
    private draftPriority = 0;
    private mobileQuickExpanded = false;
    private expandedMobileItems = new Set<string>();
    private draggingItemID = "";
    private dragTargetItemID = "";
    private dragTargetPosition: "before" | "inside" | "after" | "" = "";
    private dragGhostElement?: HTMLElement;
    private dragHandleElement?: HTMLElement;
    private dragPointerID?: number;
    private pendingStorageRender = false;
    private statisticsStartDate = "";
    private statisticsEndDate = "";
    private statisticsDatePreset: TTodoStatisticsDatePreset = "all";
    private expandedStatisticsCategories = new Set<string>();
    private expandedStatisticsCategoryGroups = new Set<string>();
    private expandedStatisticsProjects = new Set<string>();
    private expandedStatisticsProjectGroups = new Set<string>();

    constructor(app: App, tab: Tab, options: { center?: boolean, mobile?: boolean } = {}) {
        super({app});
        this.center = Boolean(options.center);
        this.mobile = Boolean(options.mobile);
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "sy__todo");
        if (this.mobile) {
            this.element.classList.add("sy__todo--mobile");
        }
        if (this.center) {
            this.element.classList.add("sy__todo--center");
        } else if (!this.mobile) {
            this.element.classList.add("file-tree", "dockPanel");
        }
        this.data = this.getStorage();
        bindSharedStorage(this.element, (key, value) => {
            if (key === Constants.LOCAL_TODO) {
                this.data = this.getStorage(value);
                if (this.hasEditableFocus()) {
                    this.pendingStorageRender = true;
                    return;
                }
                this.pendingStorageRender = false;
                this.renderPreservingScroll();
            }
        });
        this.render();
        this.bindEvents();
        this.save(false);
        this.syncCodexProjectTitles();
    }

    private lang(key: TTodoLangKey) {
        return window.siyuan.languages[key];
    }

    private getStorage(source?: ITodoStorage) {
        const localData = source || window.siyuan.storage[Constants.LOCAL_TODO] as ITodoStorage;
        const categories = this.cleanCategories(localData?.categories);
        const categoryUpdatedAt = {...(localData?.categoryUpdatedAt || {})};
        const deletedCategories = {...(localData?.deletedCategories || {})};
        const projects = this.cleanProjects(localData?.projects);
        const projectUpdatedAt = {...(localData?.projectUpdatedAt || {})};
        const deletedProjects = {...(localData?.deletedProjects || {})};
        const projectLabels = this.cleanProjectLabels(localData?.projectLabels);
        const projectLabelOverrides = this.cleanProjectLabels(localData?.projectLabelOverrides);
        const projectCodexIDs = this.cleanProjectCodexIDs(localData?.projectCodexIDs);
        categories.forEach((category) => {
            categoryUpdatedAt[category] = categoryUpdatedAt[category] || 0;
        });
        projects.forEach((project) => {
            projectUpdatedAt[project] = projectUpdatedAt[project] || 0;
        });
        const items = Array.isArray(localData?.items) ? localData.items.map((item) => {
            const categories = this.cleanItemCategories(item.categories, item.category);
            return {
                ...item,
                parentId: typeof item.parentId === "string" ? item.parentId : undefined,
                title: item.title || "",
                category: categories[0] || "",
                categories,
                project: this.cleanProject(item.project),
                due: item.due || "",
                priority: this.cleanPriority(item.priority),
                order: Number.isFinite(Number(item.order)) ? Number(item.order) : undefined,
                orderUpdatedAt: Number.isFinite(Number(item.orderUpdatedAt)) ? Number(item.orderUpdatedAt) : undefined,
            };
        }) : [];
        const itemById = new Map(items.map(item => [item.id, item]));
        items.forEach((item) => {
            const parent = item.parentId ? itemById.get(item.parentId) : undefined;
            if (!parent || parent.id === item.id) {
                item.parentId = undefined;
            } else if (parent.parentId) {
                item.parentId = parent.parentId;
            }
        });
        items.forEach((item) => {
            const parent = item.parentId ? itemById.get(item.parentId) : undefined;
            if (parent) {
                item.project = parent.project;
            }
        });
        const knownAIProjects = new Set(items.filter(item =>
            item.project && item.categories.some(isTodoAIProjectCategory)).map(item => item.project));
        items.forEach((item) => {
            const automaticCategory = getTodoAIProjectCategory(item.project, item.title, knownAIProjects);
            if (!automaticCategory) {
                return;
            }
            const itemCategories = [automaticCategory, ...item.categories.filter(category =>
                !isTodoAIProjectCategory(category))].slice(0, 2);
            item.category = itemCategories[0] || "";
            item.categories = itemCategories;
            if (!categories.includes(automaticCategory)) {
                categories.push(automaticCategory);
                categoryUpdatedAt[automaticCategory] = Date.now();
            }
        });
        this.fillMissingOrders(items);
        return {
            items,
            categories: categories.filter((category) =>
                (categoryUpdatedAt[category] || 0) >= (deletedCategories[category] || 0)),
            categoryUpdatedAt,
            deletedCategories,
            projects: projects.filter((project) =>
                (projectUpdatedAt[project] || 0) >= (deletedProjects[project] || 0)),
            projectUpdatedAt,
            deletedProjects,
            projectLabels,
            projectLabelOverrides,
            projectCodexIDs,
            calendarEntries: Array.isArray(localData?.calendarEntries) ? localData.calendarEntries : [],
        };
    }

    private cleanPriority(value: unknown) {
        // 优先级仅支持 P0 至 P3，超出范围的历史数据收敛到最接近的有效值
        const priority = Math.floor(Number(value));
        return Number.isFinite(priority) ? Math.min(3, Math.max(0, priority)) : 0;
    }

    private getDefaultCategories() {
        return SYSTEM_CATEGORIES.map(category => category.id);
    }

    private cleanCategory(category: unknown) {
        if (typeof category !== "string" || category === "undefined") {
            return "";
        }
        const systemCategory = SYSTEM_CATEGORIES.find(item =>
            item.id === category || item.legacy === category || this.lang(item.lang) === category);
        return systemCategory?.id || category;
    }

    private cleanCategories(categories?: string[]) {
        if (!Array.isArray(categories)) {
            return this.getDefaultCategories();
        }
        return categories.map(category => this.cleanCategory(category))
            .filter((category, index, list) => category && list.indexOf(category) === index);
    }

    private cleanItemCategories(categories: unknown, legacyCategory?: unknown) {
        const values = Array.isArray(categories) ? categories : [legacyCategory];
        return values.map(category => this.cleanCategory(category))
            .filter((category, index, list) => category && list.indexOf(category) === index)
            .slice(0, 2);
    }

    private cleanProject(project: unknown) {
        return typeof project === "string" && project !== "undefined" ? project.trim() : "";
    }

    private cleanProjects(projects?: string[]) {
        if (!Array.isArray(projects)) {
            return [];
        }
        return projects.map(project => this.cleanProject(project))
            .filter((project, index, list) => project && list.indexOf(project) === index);
    }

    private cleanProjectLabels(projectLabels?: Record<string, string>) {
        if (!projectLabels || typeof projectLabels !== "object") {
            return {};
        }
        return Object.entries(projectLabels).reduce<Record<string, string>>((labels, [project, label]) => {
            const cleanProject = this.cleanProject(project);
            const cleanLabel = this.cleanProject(label);
            if (cleanProject && cleanLabel) {
                labels[cleanProject] = cleanLabel;
            }
            return labels;
        }, {});
    }

    private cleanProjectCodexIDs(projectCodexIDs?: Record<string, string>) {
        if (!projectCodexIDs || typeof projectCodexIDs !== "object") {
            return {};
        }
        return Object.entries(projectCodexIDs).reduce<Record<string, string>>((ids, [project, codexID]) => {
            const cleanProject = this.cleanProject(project);
            const cleanCodexID = this.cleanProject(codexID);
            if (cleanProject && cleanCodexID) {
                ids[cleanProject] = cleanCodexID;
            }
            return ids;
        }, {});
    }

    private getItemCategories(item: ITodoItem) {
        return item.categories;
    }

    private getItemProject(item: ITodoItem) {
        return item.project;
    }

    private getProjectLabel(project: string) {
        return this.data.projectLabels[project] || project;
    }

    private getItemCategoryLabel(item: ITodoItem) {
        return this.getItemCategories(item).map(category => this.getCategoryLabel(category)).join(" ");
    }

    private getItemProjectLabel(item: ITodoItem) {
        const project = this.getItemProject(item);
        return project ? this.getProjectLabel(project) : this.lang("todoNoProject");
    }

    private getKnownAIProjects() {
        return new Set(this.data.items.filter(item =>
            item.project && this.getItemCategories(item).some(isTodoAIProjectCategory)).map(item => item.project));
    }

    private applyAutomaticProjectCategory(item: ITodoItem) {
        const automaticCategory = getTodoAIProjectCategory(item.project, item.title, this.getKnownAIProjects());
        if (!automaticCategory) {
            return false;
        }
        const categories = [automaticCategory, ...this.getItemCategories(item).filter(category =>
            !isTodoAIProjectCategory(category))].slice(0, 2);
        if (categories.length === item.categories.length && categories.every((category, index) =>
            category === item.categories[index])) {
            return false;
        }
        item.category = categories[0] || "";
        item.categories = categories;
        if (!this.data.categories.includes(automaticCategory)) {
            const now = Date.now();
            this.data.categories.push(automaticCategory);
            this.data.categoryUpdatedAt[automaticCategory] = now;
            delete this.data.deletedCategories[automaticCategory];
        }
        return true;
    }

    private getCategoryPickerLabel(categories: string[]) {
        const labels = this.cleanItemCategories(categories).map(category => this.getCategoryLabel(category));
        return labels.join("、") || this.lang("todoUncategorized");
    }

    private renderCategoryPicker(categories: string[], target: "new" | "item") {
        const selected = this.cleanItemCategories(categories);
        const maxReached = selected.length >= 2;
        const label = this.getCategoryPickerLabel(selected);
        const options = this.getCategories().filter(Boolean).map((category) => {
            const checked = selected.includes(category);
            return `<label class="todo__categoryPickerOption${checked ? " todo__categoryPickerOption--selected" : ""}">
    <input data-type="categoryOption" type="checkbox" value="${escapeAttr(category)}"${checked ? " checked" : ""}${!checked && maxReached ? " disabled" : ""}>
    <span>${escapeHtml(this.getCategoryLabel(category))}</span>
</label>`;
        }).join("");
        return `<div class="todo__categoryPicker" data-type="categoryPicker" data-category-target="${target}">
    <button class="todo__categoryPickerButton" data-type="toggleCategoryPicker" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeAttr(`${this.lang("todoCategory")}：${label}`)}">
        <svg><use xlink:href="#iconTags"></use></svg>
        <span>${escapeHtml(label)}</span>
        <svg class="todo__categoryPickerChevron"><use xlink:href="#iconDown"></use></svg>
    </button>
    <div class="todo__categoryPickerMenu fn__none" role="menu">${options}</div>
</div>`;
    }

    private closeCategoryPickers(except?: HTMLElement) {
        this.element.querySelectorAll<HTMLElement>(".todo__categoryPicker").forEach((picker) => {
            if (picker === except) {
                return;
            }
            picker.querySelector('[data-type="toggleCategoryPicker"]')?.setAttribute("aria-expanded", "false");
            picker.querySelector(".todo__categoryPickerMenu")?.classList.add("fn__none");
        });
    }

    private toggleCategoryPicker(button: HTMLElement) {
        const picker = button.closest(".todo__categoryPicker") as HTMLElement;
        if (!picker) {
            return;
        }
        const menu = picker.querySelector(".todo__categoryPickerMenu") as HTMLElement;
        if (!menu) {
            return;
        }
        const expanded = button.getAttribute("aria-expanded") === "true";
        this.closeCategoryPickers(expanded ? undefined : picker);
        button.setAttribute("aria-expanded", expanded ? "false" : "true");
        menu.classList.toggle("fn__none", expanded);
        if (expanded) {
            return;
        }
        menu.classList.remove("todo__categoryPickerMenu--above");
        menu.style.removeProperty("max-height");
        const viewport = picker.closest(".todo__scroll") || document.documentElement;
        const viewportRect = viewport.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const spaceAbove = buttonRect.top - viewportRect.top;
        const spaceBelow = viewportRect.bottom - buttonRect.bottom;
        const openAbove = spaceBelow < menu.offsetHeight + 4 && spaceAbove > spaceBelow;
        menu.classList.toggle("todo__categoryPickerMenu--above", openAbove);
        const availableSpace = openAbove ? spaceAbove : spaceBelow;
        menu.style.maxHeight = `${Math.max(72, Math.min(244, Math.floor(availableSpace - 8)))}px`;
    }

    private updateCategoryPicker(picker: HTMLElement, categories: string[]) {
        const selected = this.cleanItemCategories(categories);
        const maxReached = selected.length >= 2;
        picker.querySelectorAll<HTMLInputElement>('[data-type="categoryOption"]').forEach((option) => {
            const checked = selected.includes(option.value);
            option.checked = checked;
            option.disabled = !checked && maxReached;
            option.closest(".todo__categoryPickerOption")?.classList.toggle("todo__categoryPickerOption--selected", checked);
        });
        const label = this.getCategoryPickerLabel(selected);
        const button = picker.querySelector('[data-type="toggleCategoryPicker"]') as HTMLButtonElement;
        button.querySelector("span").textContent = label;
        button.setAttribute("aria-label", `${this.lang("todoCategory")}：${label}`);
    }

    private updateCategoryPickerSelection(target: HTMLInputElement) {
        const picker = target.closest(".todo__categoryPicker") as HTMLElement;
        if (!picker) {
            return;
        }
        const categories = this.cleanItemCategories(Array.from(
            picker.querySelectorAll<HTMLInputElement>('[data-type="categoryOption"]:checked')).map(option => option.value));
        if (picker.dataset.categoryTarget === "new") {
            this.draftCategories = [categories[0] || "", categories[1] || ""];
            this.updateCategoryPicker(picker, categories);
            return;
        }
        const id = picker.closest("[data-id]")?.getAttribute("data-id");
        if (id) {
            this.updateItem(id, {categories});
        }
    }

    private getCategoryLabel(category: string) {
        const systemCategory = SYSTEM_CATEGORIES.find(item => item.id === category);
        return systemCategory ? this.lang(systemCategory.lang) : category;
    }

    private renderProjectOptions(selected: string) {
        return [`<option value="">${escapeHtml(this.lang("todoNoProject"))}</option>`, ...getTodoProjectHierarchy(this.getProjects()).map(project =>
            `<option value="${escapeAttr(project.project)}"${project.project === selected ? " selected" : ""}>${escapeHtml(`${project.parentProject ? "↳ " : ""}${this.getProjectLabel(project.project)}`)}</option>`),
        ].join("");
    }

    private syncCodexProjectTitles() {
        (fetchPost as (url: string, body: object, callback: (response: {code: number; data: ITodoCodexProject[]}) => void) => void)("/api/system/getCodexProjects", {}, (response) => {
            if (response.code !== 0 || !Array.isArray(response.data)) {
                return;
            }
            const codexProjects = response.data.filter((project): project is ITodoCodexProject =>
                project && typeof project.id === "string" && typeof project.name === "string" &&
                Array.isArray(project.rootNames));
            this.data = this.getStorage();
            const synced = getTodoCodexProjectSync(this.getProjects(), this.data.projectLabels,
                this.data.projectCodexIDs, codexProjects);
            const projectLabels = {...synced.projectLabels, ...this.data.projectLabelOverrides};
            const labelsChanged = JSON.stringify(projectLabels) !== JSON.stringify(this.data.projectLabels);
            const idsChanged = JSON.stringify(synced.projectCodexIDs) !== JSON.stringify(this.data.projectCodexIDs);
            if (!labelsChanged && !idsChanged) {
                return;
            }
            this.data.projectLabels = projectLabels;
            this.data.projectCodexIDs = synced.projectCodexIDs;
            this.save(false);
            this.renderPreservingScroll();
        });
    }

    private bindEvents() {
        this.element.addEventListener("click", (event: MouseEvent) => {
            if (!this.mobile) {
                setPanelFocus(this.element);
            }
            const target = event.target as HTMLElement;
            const actionElement = target.closest("[data-type]") as HTMLElement;
            if (!actionElement || !this.element.contains(actionElement)) {
                this.closeCategoryPickers();
                return;
            }
            const type = actionElement.getAttribute("data-type");
            if (type === "min") {
                getDockByType("todo").toggleModel("todo", false, true);
                event.preventDefault();
                return;
            }
            if (type === "toggleCategoryPicker") {
                this.toggleCategoryPicker(actionElement);
                event.preventDefault();
                return;
            }
            if (type === "switchTaxonomy") {
                this.taxonomy = actionElement.getAttribute("data-taxonomy") as TTodoTaxonomy;
                this.addingCategory = false;
                this.render();
                event.preventDefault();
                return;
            }
            if (type === "filter") {
                this.filter = this.getNextFilter(actionElement.getAttribute("data-filter") as TTodoFilter);
                this.render();
                event.preventDefault();
                return;
            }
            if (type === "toggleGroup") {
                const expanded = actionElement.getAttribute("aria-expanded") === "true";
                actionElement.setAttribute("aria-expanded", expanded ? "false" : "true");
                actionElement.nextElementSibling?.classList.toggle("fn__none", expanded);
                event.preventDefault();
                return;
            }
            if (type === "toggleStatisticsCategory") {
                const category = actionElement.getAttribute("data-category") || "";
                const expanded = actionElement.getAttribute("aria-expanded") === "true";
                if (expanded) {
                    this.expandedStatisticsCategories.delete(category);
                } else {
                    this.expandedStatisticsCategories.add(category);
                }
                actionElement.setAttribute("aria-expanded", expanded ? "false" : "true");
                actionElement.closest(".todo__statsSection")?.querySelector(".todo__statsDetails")
                    ?.classList.toggle("fn__none", expanded);
                this.updateStatisticsToggleAllButton();
                event.preventDefault();
                return;
            }
            if (type === "toggleStatisticsProject") {
                const project = actionElement.getAttribute("data-project") || "";
                const expanded = actionElement.getAttribute("aria-expanded") === "true";
                if (expanded) {
                    this.expandedStatisticsProjects.delete(project);
                } else {
                    this.expandedStatisticsProjects.add(project);
                }
                actionElement.setAttribute("aria-expanded", expanded ? "false" : "true");
                actionElement.closest(".todo__statsSection")?.querySelector(".todo__statsDetails")
                    ?.classList.toggle("fn__none", expanded);
                this.updateStatisticsToggleAllButton();
                event.preventDefault();
                return;
            }
            if (type === "toggleStatisticsProjectGroup") {
                const project = actionElement.getAttribute("data-project") || "";
                const expanded = actionElement.getAttribute("aria-expanded") === "true";
                if (expanded) {
                    this.expandedStatisticsProjectGroups.delete(project);
                } else {
                    this.expandedStatisticsProjectGroups.add(project);
                }
                actionElement.setAttribute("aria-expanded", expanded ? "false" : "true");
                actionElement.closest(".todo__statsSection")
                    ?.classList.toggle("todo__statsSection--groupCollapsed", expanded);
                this.element.querySelectorAll(`[data-parent-project="${CSS.escape(project)}"]`).forEach((element) => {
                    element.classList.toggle("fn__none", expanded);
                });
                this.updateStatisticsToggleAllButton();
                event.preventDefault();
                return;
            }
            if (type === "toggleStatisticsCategoryGroup") {
                const category = actionElement.getAttribute("data-category") || "";
                const expanded = actionElement.getAttribute("aria-expanded") === "true";
                if (expanded) {
                    this.expandedStatisticsCategoryGroups.delete(category);
                } else {
                    this.expandedStatisticsCategoryGroups.add(category);
                }
                actionElement.setAttribute("aria-expanded", expanded ? "false" : "true");
                actionElement.closest(".todo__statsSection")?.classList.toggle("todo__statsSection--groupCollapsed", expanded);
                this.element.querySelectorAll(`[data-parent-category="${CSS.escape(category)}"]`).forEach((element) => {
                    element.classList.toggle("fn__none", expanded);
                });
                this.updateStatisticsToggleAllButton();
                event.preventDefault();
                return;
            }
            if (type === "toggleAllStatistics") {
                this.toggleAllStatistics();
                event.preventDefault();
                return;
            }
            if (type === "addCategory") {
                this.addingCategory = true;
                this.render();
                (this.element.querySelector('[data-type="newTaxonomyInput"]') as HTMLInputElement)?.focus();
                event.preventDefault();
                return;
            }
            if (type === "deleteCategory") {
                const category = actionElement.getAttribute("data-category");
                confirmDialog(window.siyuan.languages.deleteOpConfirm,
                    `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(this.getCategoryLabel(category))}</b>?`, () => {
                        this.deleteCategory(category);
                    }, undefined, true);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (type === "deleteProject") {
                const project = actionElement.getAttribute("data-project");
                confirmDialog(window.siyuan.languages.deleteOpConfirm,
                    `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(this.getProjectLabel(project))}</b>?`, () => {
                        this.deleteProject(project);
                    }, undefined, true);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (type === "addTodo") {
                this.addItem();
                event.preventDefault();
                return;
            }
            if (type === "toggleMobileQuick") {
                this.captureMobileDraft();
                this.mobileQuickExpanded = !this.mobileQuickExpanded;
                actionElement.setAttribute("aria-expanded", this.mobileQuickExpanded.toString());
                this.element.querySelector(".todo__mobileQuickMeta")?.classList.toggle("fn__none", !this.mobileQuickExpanded);
                event.preventDefault();
                return;
            }
            if (!type || !["addSubtask", "toggle", "delete", "restore", "toggleMobileDetails"].includes(type)) {
                return;
            }
            const itemElement = actionElement.closest("[data-id]") as HTMLElement;
            if (!itemElement) {
                return;
            }
            const id = itemElement.getAttribute("data-id");
            if (type === "toggleMobileDetails") {
                const expanded = !this.expandedMobileItems.has(id);
                if (expanded) {
                    this.expandedMobileItems.add(id);
                } else {
                    this.expandedMobileItems.delete(id);
                }
                itemElement.classList.toggle("todo__mobileItem--expanded", expanded);
                itemElement.querySelector<HTMLElement>(".todo__mobileMeta")?.toggleAttribute("hidden", !expanded);
                actionElement.setAttribute("aria-expanded", expanded.toString());
            } else if (type === "addSubtask") {
                this.addingSubtaskFor = id;
                this.renderMain();
                (this.element.querySelector(`[data-type="newSubtask"][data-parent-id="${CSS.escape(id)}"]`) as
                    HTMLInputElement)?.focus();
            } else if (type === "toggle") {
                const completed = !this.getItem(id)?.completed;
                this.updateItem(id, {completed, completedAt: completed ? Date.now() : undefined});
            } else if (type === "delete") {
                if (this.filter === "trash") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm,
                        window.siyuan.languages.confirmDelete, () => {
                            this.updateItem(id, {purgedAt: Date.now()});
                        }, undefined, true);
                } else {
                    this.updateItem(id, {deletedAt: Date.now()});
                }
            } else if (type === "restore") {
                this.updateItem(id, {deletedAt: undefined});
            }
            event.preventDefault();
        });

        this.element.addEventListener("change", (event: Event) => {
            const target = event.target as HTMLInputElement | HTMLSelectElement;
            const type = target.getAttribute("data-type");
            if (type === "statisticsDatePreset") {
                this.statisticsDatePreset = target.value as TTodoStatisticsDatePreset;
                if (this.statisticsDatePreset !== "custom") {
                    const range = getTodoStatisticsPresetRange(this.statisticsDatePreset, this.getToday());
                    this.statisticsStartDate = range.start;
                    this.statisticsEndDate = range.end;
                    this.renderMain();
                }
            } else if (type === "statisticsStartDate" || type === "statisticsEndDate") {
                this.statisticsDatePreset = "custom";
                if (type === "statisticsStartDate") {
                    this.statisticsStartDate = target.value;
                    if (this.statisticsEndDate && this.statisticsStartDate > this.statisticsEndDate) {
                        this.statisticsEndDate = this.statisticsStartDate;
                    }
                } else {
                    this.statisticsEndDate = target.value;
                    if (this.statisticsStartDate && this.statisticsEndDate < this.statisticsStartDate) {
                        this.statisticsStartDate = this.statisticsEndDate;
                    }
                }
                this.renderMain();
            } else if (type === "categoryOption") {
                this.updateCategoryPickerSelection(target as HTMLInputElement);
            } else if (type === "newProject") {
                this.draftProject = this.cleanProject(target.value);
            } else if (type === "newDue") {
                this.draftDue = target.value;
            } else if (type === "newPriority") {
                this.draftPriority = this.cleanPriority(target.value);
                this.updatePriorityClass(target, this.draftPriority);
            } else if (type === "priority") {
                const id = target.closest("[data-id]")?.getAttribute("data-id");
                if (id) {
                    this.updateItem(id, {priority: this.cleanPriority(target.value)});
                }
            } else if (type === "project") {
                const id = target.closest("[data-id]")?.getAttribute("data-id");
                if (id) {
                    this.updateItem(id, {project: this.cleanProject(target.value)});
                }
            } else if (type === "due" || type === "title") {
                const id = target.closest("[data-id]")?.getAttribute("data-id");
                if (id) {
                    this.updateItem(id, {[type]: target.value} as Partial<ITodoItem>);
                }
            }
        });

        this.element.addEventListener("input", (event: Event) => {
            const target = event.target as HTMLInputElement;
            const type = target.getAttribute("data-type");
            if (type === "search") {
                this.search = target.value.trim().toLowerCase();
                this.renderMain();
            } else if (type === "newTodo") {
                this.draftTitle = target.value;
            }
        });

        this.element.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }
            const target = event.target as HTMLInputElement;
            const type = target.getAttribute("data-type");
            const isEnter = event.key === "Enter" || event.key === "Return";
            if (type === "drag" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                const itemElement = target.closest("[data-id]") as HTMLElement;
                const targetElement = this.getAdjacentDragTarget(itemElement, event.key === "ArrowDown");
                if (targetElement) {
                    const id = itemElement.getAttribute("data-id");
                    this.reorderItem(id, targetElement.getAttribute("data-id"), event.key === "ArrowDown");
                    (this.element.querySelector(`[data-id="${CSS.escape(id)}"] [data-type="drag"]`) as
                        HTMLElement)?.focus();
                }
                event.preventDefault();
                return;
            }
            if (type === "newSubtask") {
                if (isEnter) {
                    this.addSubtask(target.getAttribute("data-parent-id"), target.value);
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.addingSubtaskFor = "";
                    this.renderMain();
                    event.preventDefault();
                }
                return;
            }
            if (type === "newTaxonomyInput") {
                if (isEnter) {
                    const name = target.value.trim();
                    if (name) {
                        if (this.taxonomy === "tags") {
                            this.addCategory(name, false);
                        } else {
                            this.addProject(name, false);
                        }
                    }
                    this.addingCategory = false;
                    this.render();
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.addingCategory = false;
                    this.render();
                    event.preventDefault();
                }
                return;
            }
            if (!isEnter) {
                return;
            }
            if (type === "newTodo") {
                this.addItem();
                event.preventDefault();
            } else if (type === "title") {
                target.blur();
            }
        });

        this.element.addEventListener("focusout", (event: Event) => {
            const target = event.target as HTMLInputElement;
            const type = target.getAttribute("data-type");
            if (type === "newSubtask" && this.addingSubtaskFor) {
                this.addingSubtaskFor = "";
                this.renderMain();
            } else if (type === "newTaxonomyInput" && this.addingCategory) {
                const name = target.value.trim();
                if (name) {
                    if (this.taxonomy === "tags") {
                        this.addCategory(name, false);
                    } else {
                        this.addProject(name, false);
                    }
                }
                this.addingCategory = false;
                this.render();
            }
            setTimeout(() => {
                if (this.pendingStorageRender && !this.hasEditableFocus()) {
                    this.pendingStorageRender = false;
                    this.renderPreservingScroll();
                }
            });
        });

        this.element.addEventListener("pointerdown", (event: PointerEvent) => {
            const dragElement = (event.target as HTMLElement).closest('[data-type="drag"]') as HTMLElement;
            const itemElement = dragElement?.closest("[data-id]") as HTMLElement;
            const id = itemElement?.getAttribute("data-id");
            if (!id || event.button !== 0) {
                return;
            }
            event.preventDefault();
            this.draggingItemID = id;
            this.dragHandleElement = dragElement;
            this.dragPointerID = event.pointerId;
            dragElement.setPointerCapture(event.pointerId);
            itemElement.classList.add("todo__item--dragging");
            this.createDragGhost(itemElement, event.clientX, event.clientY);
            event.stopPropagation();
        });

        this.element.addEventListener("pointermove", (event: PointerEvent) => {
            if (!this.draggingItemID || event.pointerId !== this.dragPointerID) {
                return;
            }
            event.preventDefault();
            this.positionDragGhost(event.clientX, event.clientY);
            const targetElement = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement)
                ?.closest(".todo__item") as HTMLElement;
            const position = this.getDragTargetPosition(targetElement, event.clientY);
            if (!position) {
                this.clearDragTarget();
                stopScrollAnimation();
                return;
            }
            this.setDragTarget(targetElement, position);
            event.stopPropagation();
            const scrollElement = this.element.querySelector(".todo__scroll");
            if (scrollElement) {
                dragOverScroll(event, scrollElement.getBoundingClientRect(), scrollElement);
            }
        });

        this.element.addEventListener("pointerup", (event: PointerEvent) => {
            if (!this.draggingItemID || event.pointerId !== this.dragPointerID) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const sourceID = this.draggingItemID;
            const targetID = this.dragTargetItemID;
            const position = this.dragTargetPosition;
            this.clearDragState();
            if (targetID) {
                if (position === "inside") {
                    this.nestItem(sourceID, targetID);
                } else {
                    this.reorderItem(sourceID, targetID, position === "after");
                }
            }
        });

        this.element.addEventListener("pointercancel", () => this.clearDragState());
    }

    private hasEditableFocus() {
        const activeElement = document.activeElement;
        return activeElement && this.element.contains(activeElement) &&
            activeElement.matches("input, select, textarea, [contenteditable=\"true\"]");
    }

    private renderPreservingScroll() {
        const scrollTop = this.element.querySelector(".todo__scroll")?.scrollTop || 0;
        const sidebarScrollTop = this.element.querySelector(".todo__sidebar")?.scrollTop || 0;
        this.render();
        const scrollElement = this.element.querySelector(".todo__scroll");
        const sidebarElement = this.element.querySelector(".todo__sidebar");
        if (scrollElement) {
            scrollElement.scrollTop = scrollTop;
        }
        if (sidebarElement) {
            sidebarElement.scrollTop = sidebarScrollTop;
        }
    }

    private fillMissingOrders(items: ITodoItem[]) {
        const groups = new Map<string, ITodoItem[]>();
        items.filter(item => !item.purgedAt).forEach((item) => {
            const key = item.parentId || "";
            const siblings = groups.get(key) || [];
            siblings.push(item);
            groups.set(key, siblings);
        });
        groups.forEach((siblings, parentId) => {
            const missing = siblings.filter(item => !Number.isFinite(item.order));
            if (missing.length === 0) {
                return;
            }
            missing.sort((a, b) => this.compareLegacyItems(a, b, Boolean(parentId)));
            const ordered = siblings.filter(item => Number.isFinite(item.order));
            if (ordered.length === 0) {
                missing.forEach((item, index) => {
                    item.order = index;
                });
                return;
            }
            const firstOrder = Math.min(...ordered.map(item => item.order ?? 0));
            missing.forEach((item, index) => {
                item.order = firstOrder - missing.length + index;
            });
        });
    }

    private compareLegacyItems(a: ITodoItem, b: ITodoItem, isSubtask: boolean) {
        if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
        }
        if (isSubtask) {
            return a.createdAt - b.createdAt;
        }
        if (!a.completed && !a.deletedAt && !b.deletedAt && a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        if (a.due !== b.due) {
            return (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31");
        }
        return b.createdAt - a.createdAt;
    }

    private getAdjacentDragTarget(itemElement: HTMLElement, next: boolean) {
        if (!itemElement) {
            return;
        }
        const item = this.getItem(itemElement.getAttribute("data-id"));
        const candidates = Array.from(itemElement.closest(".todo__list")?.querySelectorAll(".todo__item") || []) as
            HTMLElement[];
        const index = candidates.indexOf(itemElement);
        const step = next ? 1 : -1;
        for (let i = index + step; i >= 0 && i < candidates.length; i += step) {
            const candidate = this.getItem(candidates[i].getAttribute("data-id"));
            if ((candidate?.parentId || "") === (item?.parentId || "")) {
                return candidates[i];
            }
        }
    }

    private createDragGhost(itemElement: HTMLElement, clientX: number, clientY: number) {
        const ghostElement = document.createElement("ul");
        ghostElement.className = "todo__list todo__dragGhost";
        ghostElement.style.width = `${itemElement.getBoundingClientRect().width}px`;
        const cloneElement = itemElement.cloneNode(true) as HTMLElement;
        cloneElement.classList.remove("todo__item--dragging");
        ghostElement.append(cloneElement);
        document.body.append(ghostElement);
        this.dragGhostElement = ghostElement;
        this.positionDragGhost(clientX, clientY);
    }

    private positionDragGhost(clientX: number, clientY: number) {
        if (!this.dragGhostElement) {
            return;
        }
        this.dragGhostElement.style.left = `${clientX + 12}px`;
        this.dragGhostElement.style.top = `${clientY + 12}px`;
    }

    private getDragTargetPosition(targetElement: HTMLElement, clientY: number) {
        if (!targetElement) {
            return;
        }
        const rect = targetElement.getBoundingClientRect();
        const ratio = (clientY - rect.top) / rect.height;
        const preferredPosition = ratio < .25 ? "before" : ratio > .75 ? "after" : "inside";
        if (this.canDropOn(targetElement, preferredPosition)) {
            return preferredPosition;
        }
        const fallbackPosition = ratio < .5 ? "before" : "after";
        return this.canDropOn(targetElement, fallbackPosition) ? fallbackPosition : undefined;
    }

    private canDropOn(targetElement: HTMLElement, position: "before" | "inside" | "after") {
        if (!targetElement) {
            return false;
        }
        const sourceElement = this.element.querySelector(`[data-id="${CSS.escape(this.draggingItemID)}"]`) as HTMLElement;
        const targetID = targetElement.getAttribute("data-id");
        if (!sourceElement || !targetID || targetID === this.draggingItemID ||
            sourceElement.closest(".todo__list") !== targetElement.closest(".todo__list")) {
            return false;
        }
        const sourceItem = this.getItem(this.draggingItemID);
        const targetItem = this.getItem(targetID);
        if (!sourceItem || !targetItem) {
            return false;
        }
        if (position === "inside") {
            return !targetItem.parentId && sourceItem.parentId !== targetItem.id;
        }
        return getTodoReorderState(sourceItem.parentId, targetItem.parentId).allowed;
    }

    private setDragTarget(targetElement: HTMLElement, position: "before" | "inside" | "after") {
        const targetID = targetElement.getAttribute("data-id");
        if (this.dragTargetItemID === targetID && this.dragTargetPosition === position) {
            return;
        }
        this.clearDragTarget();
        this.dragTargetItemID = targetID;
        this.dragTargetPosition = position;
        targetElement.classList.add(`todo__item--drag-${position}`);
    }

    private clearDragTarget() {
        this.element.querySelectorAll(".todo__item--drag-before, .todo__item--drag-inside, .todo__item--drag-after")
            .forEach(item => {
                item.classList.remove("todo__item--drag-before", "todo__item--drag-inside", "todo__item--drag-after");
            });
        this.dragTargetItemID = "";
        this.dragTargetPosition = "";
    }

    private clearDragState() {
        stopScrollAnimation();
        this.clearDragTarget();
        if (typeof this.dragPointerID === "number" && this.dragHandleElement?.hasPointerCapture(this.dragPointerID)) {
            this.dragHandleElement.releasePointerCapture(this.dragPointerID);
        }
        this.element.querySelector(".todo__item--dragging")?.classList.remove("todo__item--dragging");
        this.dragGhostElement?.remove();
        this.dragGhostElement = undefined;
        this.dragHandleElement = undefined;
        this.dragPointerID = undefined;
        this.draggingItemID = "";
    }

    private reorderItem(sourceID: string, targetID: string, insertAfter: boolean) {
        const source = this.getItem(sourceID);
        const target = this.getItem(targetID);
        if (!source || !target) {
            return;
        }
        const reorderState = getTodoReorderState(source.parentId, target.parentId);
        if (!reorderState.allowed) {
            return;
        }
        const now = Date.now();
        if (reorderState.promoted) {
            source.parentId = reorderState.parentId;
            source.updatedAt = now;
        }
        const siblings = this.data.items.filter(item => !item.purgedAt &&
            (item.parentId || "") === (reorderState.parentId || "")).sort((a, b) =>
            ((a.order ?? 0) - (b.order ?? 0)) || this.compareLegacyItems(a, b, Boolean(source.parentId)));
        const previousOrder = siblings.map(item => item.id).join(",");
        const sourceIndex = siblings.findIndex(item => item.id === sourceID);
        if (sourceIndex < 0) {
            return;
        }
        siblings.splice(sourceIndex, 1);
        const targetIndex = siblings.findIndex(item => item.id === targetID);
        siblings.splice(targetIndex + (insertAfter ? 1 : 0), 0, source);
        if (!reorderState.promoted && previousOrder === siblings.map(item => item.id).join(",")) {
            return;
        }
        siblings.forEach((item, index) => {
            if (item.order !== index || reorderState.promoted && item.id === sourceID) {
                item.order = index;
                item.orderUpdatedAt = now;
            }
        });
        const scrollTop = this.element.querySelector(".todo__scroll")?.scrollTop || 0;
        this.save();
        const scrollElement = this.element.querySelector(".todo__scroll");
        if (scrollElement) {
            scrollElement.scrollTop = scrollTop;
        }
    }

    private nestItem(sourceID: string, targetID: string) {
        const source = this.getItem(sourceID);
        const target = this.getItem(targetID);
        if (!source || !target || source.id === target.id || target.parentId || source.parentId === target.id) {
            return;
        }
        const sourceChildren = this.data.items.filter(item => item.parentId === source.id).sort((a, b) =>
            ((a.order ?? 0) - (b.order ?? 0)) || this.compareLegacyItems(a, b, true));
        const movingItems = source.parentId ? [source] : [source, ...sourceChildren];
        const targetChildren = this.getChildren(target.id).filter(item => !movingItems.includes(item));
        let nextOrder = targetChildren.length > 0 ? Math.max(...targetChildren.map(item => item.order ?? 0)) + 1 : 0;
        const now = Date.now();
        movingItems.forEach((item) => {
            item.parentId = target.id;
            item.project = target.project;
            item.order = nextOrder++;
            item.orderUpdatedAt = now;
            item.updatedAt = now;
            this.applyAutomaticProjectCategory(item);
        });
        const scrollTop = this.element.querySelector(".todo__scroll")?.scrollTop || 0;
        this.save();
        const scrollElement = this.element.querySelector(".todo__scroll");
        if (scrollElement) {
            scrollElement.scrollTop = scrollTop;
        }
    }

    private addCategory(name: string, repaint = true) {
        const category = this.cleanCategory(name);
        if (!this.data.categories.includes(category)) {
            const now = Date.now();
            this.data.categories.push(category);
            this.data.categoryUpdatedAt[category] = now;
            delete this.data.deletedCategories[category];
            this.save(repaint);
        }
    }

    private deleteCategory(name: string) {
        const now = Date.now();
        this.data.categories = this.data.categories.filter(category => category !== name);
        this.data.deletedCategories[name] = now;
        this.data.items.forEach(item => {
            const categories = this.getItemCategories(item).filter(category => category !== name);
            if (categories.length !== item.categories.length) {
                item.categories = categories;
                item.category = categories[0] || "";
                item.updatedAt = now;
            }
        });
        this.draftCategories = this.draftCategories.map(category => category === name ? "" : category) as [string, string];
        if (this.getContentFilter() === `category:${name}`) {
            this.filter = this.isCompletedFilter() ? "completed" : "all";
        }
        this.save();
    }

    private addProject(name: string, repaint = true) {
        const project = this.cleanProject(name);
        if (project && !this.data.projects.includes(project)) {
            const now = Date.now();
            this.data.projects.push(project);
            this.data.projectUpdatedAt[project] = now;
            delete this.data.deletedProjects[project];
            this.save(repaint);
        }
    }

    private deleteProject(name: string) {
        const project = this.cleanProject(name);
        if (!project) {
            return;
        }
        const now = Date.now();
        this.data.projects = this.data.projects.filter(item => item !== project);
        this.data.deletedProjects[project] = now;
        delete this.data.projectLabels[project];
        delete this.data.projectCodexIDs[project];
        this.data.items.forEach(item => {
            if (item.project === project) {
                item.project = "";
                item.updatedAt = now;
            }
        });
        if (this.draftProject === project) {
            this.draftProject = "";
        }
        if (this.getContentFilter() === `project:${project}`) {
            this.filter = this.isCompletedFilter() ? "completed" : "all";
        }
        this.save();
    }

    private addItem() {
        const inputElement = this.element.querySelector('[data-type="newTodo"]') as HTMLInputElement;
        const title = inputElement.value.trim();
        if (!title) {
            return;
        }
        const now = Date.now();
        const categories = this.cleanItemCategories(this.draftCategories);
        const project = this.cleanProject(this.draftProject);
        categories.forEach(category => this.addCategory(category, false));
        if (project) {
            this.addProject(project, false);
        }
        const item: ITodoItem = {
            id: `${now}-${Math.random().toString(36).substring(2, 8)}`,
            title,
            category: categories[0] || "",
            categories,
            project,
            due: this.draftDue || this.getDefaultDue(),
            priority: this.draftPriority,
            completed: false,
            order: this.getFirstOrder(),
            orderUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
        };
        this.applyAutomaticProjectCategory(item);
        this.data.items.unshift(item);
        inputElement.value = "";
        this.draftTitle = "";
        this.draftDue = "";
        this.draftPriority = 0;
        this.draftCategories = ["", ""];
        this.draftProject = "";
        this.save();
    }

    private addSubtask(parentId: string, value: string) {
        const parent = this.getItem(parentId);
        const title = value.trim();
        if (!parent || parent.parentId || !title) {
            return;
        }
        const now = Date.now();
        const item: ITodoItem = {
            id: `${now}-${Math.random().toString(36).substring(2, 8)}`,
            parentId,
            title,
            category: parent.category,
            categories: [...parent.categories],
            project: parent.project,
            due: parent.due,
            priority: parent.priority,
            completed: false,
            order: this.getFirstOrder(parentId),
            orderUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
        };
        this.applyAutomaticProjectCategory(item);
        this.data.items.push(item);
        this.addingSubtaskFor = "";
        this.save();
    }

    private updateItem(id: string, patch: Partial<ITodoItem>, repaint = true) {
        let item = this.getItem(id);
        if (!item) {
            return;
        }
        const scrollTop = this.element.querySelector(".todo__scroll")?.scrollTop || 0;
        const now = Date.now();
        const previousDeletedAt = item.deletedAt;
        if (Object.prototype.hasOwnProperty.call(patch, "categories")) {
            const categories = this.cleanItemCategories(patch.categories, patch.category);
            patch = {...patch, category: categories[0] || "", categories};
        }
        if (Object.prototype.hasOwnProperty.call(patch, "project")) {
            patch = {...patch, project: this.cleanProject(patch.project)};
            if (patch.project) {
                this.addProject(patch.project, false);
                item = this.getItem(id);
                if (!item) {
                    return;
                }
            }
        }
        Object.assign(item, patch, {updatedAt: now});
        const children = item.parentId ? [] : this.getChildren(item.id);
        this.applyAutomaticProjectCategory(item);
        if (Object.prototype.hasOwnProperty.call(patch, "project")) {
            children.forEach((child) => {
                child.project = item.project;
                child.updatedAt = now;
                this.applyAutomaticProjectCategory(child);
            });
        }
        if (patch.completed === true) {
            children.forEach((child) => {
                child.completed = true;
                child.completedAt = patch.completedAt || now;
                child.updatedAt = now;
            });
        } else if (patch.completed === false && item.parentId) {
            const parent = this.getItem(item.parentId);
            if (parent?.completed) {
                parent.completed = false;
                parent.completedAt = undefined;
                parent.updatedAt = now;
            }
        }
        if (Object.prototype.hasOwnProperty.call(patch, "deletedAt")) {
            children.forEach((child) => {
                if (patch.deletedAt || child.deletedAt === previousDeletedAt) {
                    child.deletedAt = patch.deletedAt;
                    child.updatedAt = now;
                }
            });
        }
        if (patch.purgedAt) {
            children.forEach((child) => {
                child.purgedAt = patch.purgedAt;
                child.updatedAt = now;
            });
        }
        this.save(repaint);
        const scrollElement = this.element.querySelector(".todo__scroll");
        if (repaint && scrollElement) {
            scrollElement.scrollTop = scrollTop;
        }
    }

    private getItem(id: string) {
        return this.data.items.find(item => item.id === id);
    }

    private getChildren(parentId: string) {
        return this.data.items.filter(item => item.parentId === parentId && !item.purgedAt);
    }

    private getFirstOrder(parentId = "") {
        const orders = this.data.items.filter(item => !item.purgedAt && (item.parentId || "") === parentId)
            .map(item => item.order).filter((order): order is number => Number.isFinite(order));
        return orders.length > 0 ? Math.min(...orders) - 1 : 0;
    }

    private save(repaint = true) {
        window.siyuan.storage[Constants.LOCAL_TODO] = this.data;
        setStorageVal(Constants.LOCAL_TODO, this.data);
        if (repaint) {
            this.render();
        }
    }

    public refreshFromStorage() {
        if (this.hasEditableFocus()) {
            this.pendingStorageRender = true;
            return;
        }
        this.data = this.getStorage();
        this.pendingStorageRender = false;
        this.renderPreservingScroll();
    }

    public deactivate() {
        this.captureMobileDraft();
        this.closeCategoryPickers();
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && this.element.contains(activeElement)) {
            activeElement.blur();
        }
    }

    private captureMobileDraft() {
        if (!this.mobile) {
            return;
        }
        this.draftTitle = (this.element.querySelector('[data-type="newTodo"]') as HTMLInputElement)?.value ||
            this.draftTitle;
        this.draftDue = (this.element.querySelector('[data-type="newDue"]') as HTMLInputElement)?.value || this.draftDue;
        this.draftPriority = this.cleanPriority((this.element.querySelector('[data-type="newPriority"]') as
            HTMLSelectElement)?.value ?? this.draftPriority);
    }

    private render() {
        if (this.mobile) {
            this.renderMobile();
            return;
        }
        const dockHeaderHTML = this.center ? "" : `<div class="block__icons">
    <div class="block__logo fn__flex-1">${this.lang("todo")}</div>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href="#iconMin"></use></svg></span>
</div>`;
        this.element.innerHTML = `${dockHeaderHTML}
<div class="todo__body">
    <aside class="todo__sidebar">
        <label class="todo__search b3-form__icon">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <input class="b3-text-field b3-text-field--text" data-type="search" value="${escapeAttr(this.search)}" placeholder="${escapeAttr(this.lang("todoSearch"))}">
        </label>
        ${this.renderNav()}
    </aside>
    <main class="todo__main"></main>
</div>`;
        this.renderMain();
    }

    private renderMobile() {
        const counts = this.getCounts();
        const filters: Array<{filter: TTodoFilter, label: string, count: number}> = [
            {filter: "today", label: this.lang("todoToday"), count: counts.today},
            {filter: "week", label: this.lang("todoWeek"), count: counts.week},
            {filter: "all", label: this.lang("todoAll"), count: counts.all},
            {filter: "completed", label: this.lang("todoCompleted"), count: counts.completed},
            {filter: "trash", label: this.lang("todoTrash"), count: counts.trash},
        ];
        const filterHTML = filters.map(item => `<button class="todo__mobileFilter${this.isActiveFilter(item.filter) ? " todo__mobileFilter--active" : ""}" data-type="filter" data-filter="${item.filter}" type="button" aria-pressed="${this.isActiveFilter(item.filter)}">
    <span>${escapeHtml(item.label)}</span>
    <span class="todo__mobileFilterCount">${item.count}</span>
</button>`).join("");
        this.element.innerHTML = `<div class="todo__mobile">
    <nav class="todo__mobileFilters" aria-label="${escapeAttr(this.lang("todo"))}">${filterHTML}</nav>
    <main class="todo__main todo__mobileMain"></main>
</div>`;
        this.renderMain();
    }

    private renderNav() {
        const counts = this.getCounts();
        const navItems: Array<{filter: TTodoFilter, icon: string, label: string, count: number}> = [
            {filter: "today", icon: "iconCalendar", label: this.lang("todoToday"), count: counts.today},
            {filter: "week", icon: "iconCalendar", label: this.lang("todoWeek"), count: counts.week},
            {filter: "lastWeek", icon: "iconCalendar", label: this.lang("todoLastWeek"), count: counts.lastWeek},
            {filter: "completed", icon: "iconCheck", label: this.lang("todoCompleted"), count: counts.completed},
            {filter: "statistics", icon: "iconGraph", label: this.lang("todoStatistics"), count: -1},
        ];
        const navHTML = navItems.map(item => this.renderNavItem(item.filter, item.icon, item.label, item.count)).join("");
        const categoryHTML = this.renderNavItem("all", "iconFilter", this.lang("todoAll"), counts.all) +
            getTodoCategoryHierarchy(this.getCategories()).map(categoryItem => {
                const category = categoryItem.category;
                const filter = `category:${category}`;
                return this.renderNavItem(filter as TTodoFilter, category ? "iconTags" : "iconInbox",
                    category ? this.getCategoryLabel(category) : this.lang("todoUncategorized"),
                    counts.categories[category] || 0, Boolean(category), category,
                    Boolean(categoryItem.parentCategory), categoryItem.hasChildren);
            }).join("");
        const projectHTML = this.renderNavItem("project:" as TTodoFilter, "iconInbox", this.lang("todoNoProject"),
            counts.projects[""] || 0) + getTodoProjectHierarchy(this.getProjects()).map(projectItem => {
            const project = projectItem.project;
            const filter = `project:${project}`;
            return this.renderNavItem(filter as TTodoFilter, "iconFolder", this.getProjectLabel(project), counts.projects[project] || 0,
                true, project, Boolean(projectItem.parentProject), projectItem.hasChildren, "projects");
        }).join("");
        const taxonomyLabel = this.taxonomy === "tags" ? this.lang("todoTag") : this.lang("todoProject");
        const categoryHeadHTML = this.addingCategory
            ? `<div class="todo__categoryInput"><input class="b3-text-field" data-type="newTaxonomyInput" placeholder="${escapeAttr(this.taxonomy === "tags" ? this.lang("todoCategoryName") : this.lang("todoProjectName"))}"></div>`
            : `<div class="todo__categoryHead">
    <span>${this.lang("todoTagProject")}</span>
    <div class="todo__taxonomyTabs" role="tablist" aria-label="${escapeAttr(this.lang("todoTagProject"))}">
        <button class="todo__taxonomyTab${this.taxonomy === "tags" ? " todo__taxonomyTab--active" : ""}" data-type="switchTaxonomy" data-taxonomy="tags" type="button" role="tab" aria-selected="${this.taxonomy === "tags"}">${this.lang("todoTag")}</button>
        <button class="todo__taxonomyTab${this.taxonomy === "projects" ? " todo__taxonomyTab--active" : ""}" data-type="switchTaxonomy" data-taxonomy="projects" type="button" role="tab" aria-selected="${this.taxonomy === "projects"}">${this.lang("todoProject")}</button>
    </div>
    <button class="block__icon block__icon--show ariaLabel" data-type="addCategory" data-position="north" aria-label="${window.siyuan.languages.addAttr}"><svg><use xlink:href="#iconAdd"></use></svg></button>
</div>`;
        return `<ul class="todo__nav">${navHTML}</ul>
${categoryHeadHTML}
<ul class="todo__nav todo__nav--category" aria-label="${escapeAttr(taxonomyLabel)}">${this.taxonomy === "tags" ? categoryHTML : projectHTML}</ul>
<ul class="todo__nav todo__nav--trash">${this.renderNavItem("trash", "iconTrashcan", this.lang("todoTrash"), counts.trash)}</ul>`;
    }

    private renderNavItem(filter: TTodoFilter, icon: string, label: string, count: number,
                          deletable = false, category = "", subcategory = false, categoryParent = false,
                          taxonomy: TTodoTaxonomy = "tags") {
        return `<li class="todo__navItem${this.isActiveFilter(filter) ? " todo__navItem--active" : ""}${subcategory ? " todo__navItem--subcategory" : ""}${categoryParent ? " todo__navItem--categoryParent" : ""}" data-type="filter" data-filter="${escapeAttr(filter)}">
    <svg><use xlink:href="#${icon}"></use></svg>
    <span>${escapeHtml(label)}</span>
    ${deletable ? `<button class="todo__categoryDelete block__icon ariaLabel" data-type="${taxonomy === "tags" ? "deleteCategory" : "deleteProject"}" data-${taxonomy === "tags" ? "category" : "project"}="${escapeAttr(category)}" data-position="north" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>` : ""}
    <span class="counter"${count < 0 ? " style=\"display:none\"" : ""}>${count < 0 ? "" : count}</span>
</li>`;
    }

    private renderMain() {
        if (this.mobile) {
            this.renderMobileMain();
            return;
        }
        const mainElement = this.element.querySelector(".todo__main");
        if (!mainElement) {
            return;
        }
        if (this.filter === "statistics") {
            mainElement.innerHTML = `<div class="todo__header">
    <h2>${escapeHtml(this.getFilterTitle())}</h2>
</div>
<div class="todo__scroll">${this.renderStatistics()}</div>`;
            return;
        }
        const items = this.getVisibleItems();
        let listHTML: string;
        if (this.filter === "week" || this.filter === "lastWeek") {
            listHTML = this.renderWeekGroups(items);
        } else if (this.isCompletedFilter()) {
            listHTML = this.renderCompletedGroups(items);
        } else if (this.filter === "today") {
            const inProgressItems = items.filter(item => !this.isRootCompleted(item));
            const completedItems = items.filter(item => this.isRootCompleted(item));
            listHTML = `<div class="todo__groupTitle" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.lang("todoInProgress")}</span>
    <span>${inProgressItems.length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${inProgressItems.length > 0 ? this.renderItems(inProgressItems) : this.renderEmpty()}</ul>${completedItems.length > 0 ? `
<div class="todo__divider"></div>
<div class="todo__groupTitle todo__groupTitle--completed" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.lang("todoCompleted")}</span>
    <span>${completedItems.length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${this.renderItems(completedItems)}</ul>` : ""}`;
        } else {
            listHTML = `<div class="todo__groupTitle" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.filter === "trash" ? this.lang("todoTrash") : this.lang("todoInProgress")}</span>
    <span>${items.length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${items.length > 0 ? this.renderItems(items) : this.renderEmpty()}</ul>`;
        }
        mainElement.innerHTML = `<div class="todo__header">
    <h2>${escapeHtml(this.getFilterTitle())}</h2>
</div>
<div class="todo__quick">
    <svg><use xlink:href="#iconAdd"></use></svg>
    <input class="b3-text-field b3-text-field--text" data-type="newTodo" placeholder="${escapeAttr(this.lang("todoAddPlaceholder"))}">
    <div class="todo__quickFields" aria-label="${escapeAttr(this.lang("todo"))}">
        <label class="todo__quickMeta todo__quickMeta--date">
            <input class="b3-text-field" data-type="newDue" type="date" value="${this.getDefaultDue()}" aria-label="${this.lang("todoDueDate")}">
        </label>
        <label class="todo__quickMeta todo__quickMeta--project">
            <svg><use xlink:href="#iconFolder"></use></svg>
            <select class="b3-select" data-type="newProject" aria-label="${this.lang("todoProject")}">${this.renderProjectOptions(this.draftProject)}</select>
        </label>
        <label class="todo__quickMeta todo__quickMeta--category">
            ${this.renderCategoryPicker(this.draftCategories, "new")}
        </label>
        <label class="todo__quickMeta todo__quickMeta--priority">
            <svg><use xlink:href="#iconSort"></use></svg>
            <select class="b3-select todo__priority todo__priority--quick todo__priority--p0" data-type="newPriority" aria-label="${this.lang("todoPriority")}">${this.renderPriorityOptions(0)}</select>
        </label>
    </div>
</div>
<div class="todo__scroll">${listHTML}</div>`;
    }

    private renderMobileMain() {
        const mainElement = this.element.querySelector(".todo__main");
        if (!mainElement) {
            return;
        }
        const items = this.getVisibleItems();
        mainElement.innerHTML = `<div class="todo__mobileHeading">
    <div>
        <h2>${escapeHtml(this.getFilterTitle())}</h2>
        <span>${items.length} ${this.lang("todoItems")}</span>
    </div>
</div>
<div class="todo__mobileQuick">
    <div class="todo__mobileQuickTitle">
        <input class="b3-text-field b3-text-field--text" data-type="newTodo" name="todo-title" autocomplete="off" value="${escapeAttr(this.draftTitle)}" placeholder="${escapeAttr(this.lang("todoAddPlaceholder"))}">
        <button class="todo__mobileQuickOptions" data-type="toggleMobileQuick" type="button" aria-expanded="${this.mobileQuickExpanded}" aria-label="${escapeAttr(window.siyuan.languages.more)}">
            <svg aria-hidden="true"><use xlink:href="#iconSettings"></use></svg>
        </button>
        <button class="todo__mobileAdd" data-type="addTodo" type="button" aria-label="${escapeAttr(this.lang("todoAddPlaceholder"))}">
            <svg aria-hidden="true"><use xlink:href="#iconAdd"></use></svg>
        </button>
    </div>
    <div class="todo__mobileQuickMeta${this.mobileQuickExpanded ? "" : " fn__none"}" aria-label="${escapeAttr(this.lang("todo"))}">
        <label class="todo__mobileQuickField todo__mobileQuickField--date">
            <svg aria-hidden="true"><use xlink:href="#iconCalendar"></use></svg>
            <input class="b3-text-field" data-type="newDue" name="todo-due" autocomplete="off" type="date" value="${escapeAttr(this.draftDue || this.getDefaultDue())}" aria-label="${this.lang("todoDueDate")}">
        </label>
        <label class="todo__mobileQuickField todo__mobileQuickField--project">
            <svg aria-hidden="true"><use xlink:href="#iconFolder"></use></svg>
            <select class="b3-select" data-type="newProject" name="todo-project" autocomplete="off" aria-label="${this.lang("todoProject")}">${this.renderProjectOptions(this.draftProject)}</select>
        </label>
        <label class="todo__mobileQuickField todo__mobileQuickField--priority">
            <svg aria-hidden="true"><use xlink:href="#iconSort"></use></svg>
            <select class="b3-select todo__priority todo__priority--quick todo__priority--p${this.draftPriority}" data-type="newPriority" name="todo-priority" autocomplete="off" aria-label="${this.lang("todoPriority")}">${this.renderPriorityOptions(this.draftPriority)}</select>
        </label>
    </div>
</div>
<div class="todo__scroll todo__mobileScroll">
    <ul class="todo__list todo__mobileList">${items.length > 0 ? this.renderItems(items) : this.renderEmpty()}</ul>
</div>`;
    }

    private renderStatistics() {
        const statistics = this.getStatistics();
        const allExpanded = this.isStatisticsAllExpanded(statistics);
        const toggleAllLabel = this.lang(allExpanded ? "foldAll" : "expandAll");
        const toolbar = `<div class="todo__statsToolbar">
    <label class="todo__statsDateRange">
        <svg><use xlink:href="#iconCalendar"></use></svg>
        <select class="b3-select todo__statsDatePreset" data-type="statisticsDatePreset" aria-label="${this.lang("date")}">
            <option value="all"${this.statisticsDatePreset === "all" ? " selected" : ""}>${this.lang("all")}</option>
            <option value="week"${this.statisticsDatePreset === "week" ? " selected" : ""}>${this.lang("todoWeek")}</option>
            <option value="lastWeek"${this.statisticsDatePreset === "lastWeek" ? " selected" : ""}>${this.lang("todoLastWeek")}</option>
            <option value="custom"${this.statisticsDatePreset === "custom" ? " selected" : ""}>${this.lang("custom")}</option>
        </select>
        <input class="b3-text-field" data-type="statisticsStartDate" type="date" value="${escapeAttr(this.statisticsStartDate)}"${this.statisticsEndDate ? ` max="${escapeAttr(this.statisticsEndDate)}"` : ""} aria-label="${this.lang("date")}">
        <i aria-hidden="true">–</i>
        <input class="b3-text-field" data-type="statisticsEndDate" type="date" value="${escapeAttr(this.statisticsEndDate)}"${this.statisticsStartDate ? ` min="${escapeAttr(this.statisticsStartDate)}"` : ""} aria-label="${this.lang("endDate")}">
    </label>
    <button class="b3-button b3-button--outline todo__statsToggleAll" data-type="toggleAllStatistics" type="button"${statistics.categories.length === 0 && statistics.projects.length === 0 ? " disabled" : ""} aria-label="${escapeAttr(toggleAllLabel)}">
        <svg><use xlink:href="#${allExpanded ? "iconContract" : "iconExpand"}"></use></svg>
        <span>${toggleAllLabel}</span>
    </button>
</div>`;
        const summary = `<dl class="todo__statsSummary">
    <div><dt>${this.lang("todoTotal")}</dt><dd>${statistics.total} <span>${this.lang("todoItems")}</span></dd></div>
    <div><dt>${this.lang("todoInProgress")}</dt><dd>${statistics.inProgress} <span>${this.lang("todoItems")}</span></dd></div>
    <div><dt>${this.lang("todoCompleted")}</dt><dd>${statistics.completed} <span>${this.lang("todoItems")}</span></dd></div>
    <div><dt>${this.lang("todoCompletionRate")}</dt><dd>${statistics.completionRate}%</dd></div>
</dl>`;
        if (statistics.categories.length === 0 && statistics.projects.length === 0) {
            return `${toolbar}${summary}<ul class="todo__list todo__statsEmpty">${this.renderEmpty()}</ul>`;
        }
        const categoryRows = statistics.categories.map((category) => {
            const label = category.category ? this.getCategoryLabel(category.category) : this.lang("todoUncategorized");
            const width = category.total / statistics.maxCategoryTotal * 100;
            const completedWidth = category.completed / category.total * 100;
            const inProgressWidth = 100 - completedWidth;
            const expanded = isTodoStatisticsRowExpanded(category, this.expandedStatisticsCategories,
                this.expandedStatisticsCategoryGroups);
            const parentExpanded = !category.parentCategory ||
                this.expandedStatisticsCategoryGroups.has(category.parentCategory);
            const toggleType = category.hasChildren ? "toggleStatisticsCategoryGroup" : "toggleStatisticsCategory";
            const ariaLabel = `${label}, ${this.lang("todoTotal")} ${category.total} ${this.lang("todoItems")}, ` +
                `${this.lang("todoCompleted")} ${category.completed} ${this.lang("todoItems")}, ` +
                `${this.lang("todoInProgress")} ${category.inProgress} ${this.lang("todoItems")}, ` +
                `${this.lang("todoCompletionRate")} ${category.completionRate}%`;
            const completedItems = category.completedItems.length > 0
                ? `<ul class="todo__statsCompletedList">${category.completedItems.map(item => {
                    const completedDate = getTodoStatisticsDate(item);
                    return `<li${item.parentId ? " class=\"todo__statsCompletedItem--subtask\"" : ""}>
    <svg><use xlink:href="#iconCheck"></use></svg>
    <span>${escapeHtml(item.title)}</span>
    <time datetime="${completedDate}">${this.formatDisplayDate(completedDate)}</time>
</li>`;
                }).join("")}</ul>`
                : `<div class="todo__statsDetailsEmpty">
    <svg><use xlink:href="#iconCheck"></use></svg>
    <span>${this.lang("todoNoTasks")}</span>
</div>`;
            const details = category.hasChildren ? "" : `<div class="todo__statsDetails${expanded ? "" : " fn__none"}">
    <div class="todo__statsDetailsHead">
        <span>${this.lang("todoCompleted")}</span>
        <span>${category.completedItems.length} ${this.lang("todoItems")}</span>
    </div>
    ${completedItems}
</div>`;
            return `<article class="todo__statsSection${category.parentCategory ? " todo__statsSection--subcategory" : ""}${category.hasChildren ? " todo__statsSection--categoryParent" : ""}${category.hasChildren && !expanded ? " todo__statsSection--groupCollapsed" : ""}${parentExpanded ? "" : " fn__none"}" data-category="${escapeAttr(category.category)}"${category.parentCategory ? ` data-parent-category="${escapeAttr(category.parentCategory)}"` : ""}>
<button class="todo__statsRow" data-type="${toggleType}" data-category="${escapeAttr(category.category)}" type="button" aria-expanded="${expanded}" aria-label="${escapeAttr(ariaLabel)}">
    <svg class="todo__statsChevron"><use xlink:href="#iconDown"></use></svg>
    <div class="todo__statsCategory">
        <span>${escapeHtml(label)}</span>
        <span>${category.completionRate}%</span>
    </div>
    <div class="todo__statsTrack" role="img" aria-label="${escapeAttr(ariaLabel)}">
        <div class="todo__statsBar" style="width: ${width}%">
            <span class="todo__statsBarCompleted" style="width: ${completedWidth}%"></span>
            <span class="todo__statsBarInProgress" style="width: ${inProgressWidth}%"></span>
        </div>
    </div>
    <div class="todo__statsCounts">
        <span><i class="todo__statsDot todo__statsDot--completed"></i>${this.lang("todoCompleted")} ${category.completed}</span>
        <span><i class="todo__statsDot"></i>${this.lang("todoInProgress")} ${category.inProgress}</span>
        <strong>${category.total}</strong>
    </div>
</button>
${details}
</article>`;
        }).join("");
        const projectRows = statistics.projects.map(project => this.renderProjectStatisticsRow(project,
            statistics.maxProjectTotal)).join("");
        return `${toolbar}${summary}${statistics.projects.length > 0 ? `<section class="todo__statsCategories">
    <h3>${this.lang("todoProject")}</h3>
    ${projectRows}
</section>` : ""}<section class="todo__statsCategories">
    <h3>${this.lang("todoTag")}</h3>
    ${categoryRows}
</section>`;
    }

    private renderProjectStatisticsRow(project: ITodoStatisticsEntry, maxTotal: number) {
        const label = project.category ? this.getProjectLabel(project.category) : this.lang("todoNoProject");
        const width = project.total / maxTotal * 100;
        const completedWidth = project.completed / project.total * 100;
        const inProgressWidth = 100 - completedWidth;
        const expanded = isTodoStatisticsRowExpanded(project, this.expandedStatisticsProjects,
            this.expandedStatisticsProjectGroups);
        const parentExpanded = !project.parentCategory ||
            this.expandedStatisticsProjectGroups.has(project.parentCategory);
        const toggleType = project.hasChildren ? "toggleStatisticsProjectGroup" : "toggleStatisticsProject";
        const ariaLabel = `${label}, ${this.lang("todoTotal")} ${project.total} ${this.lang("todoItems")}, ` +
            `${this.lang("todoCompleted")} ${project.completed} ${this.lang("todoItems")}, ` +
            `${this.lang("todoInProgress")} ${project.inProgress} ${this.lang("todoItems")}, ` +
            `${this.lang("todoCompletionRate")} ${project.completionRate}%`;
        const completedItems = project.completedItems.length > 0
            ? `<ul class="todo__statsCompletedList">${project.completedItems.map(item => {
                const completedDate = getTodoStatisticsDate(item);
                return `<li${item.parentId ? " class=\"todo__statsCompletedItem--subtask\"" : ""}>
    <svg><use xlink:href="#iconCheck"></use></svg>
    <span>${escapeHtml(item.title)}</span>
    <time datetime="${completedDate}">${this.formatDisplayDate(completedDate)}</time>
</li>`;
            }).join("")}</ul>`
            : `<div class="todo__statsDetailsEmpty">
    <svg><use xlink:href="#iconCheck"></use></svg>
    <span>${this.lang("todoNoTasks")}</span>
</div>`;
        const details = project.hasChildren ? "" : `<div class="todo__statsDetails${expanded ? "" : " fn__none"}">
    <div class="todo__statsDetailsHead">
        <span>${this.lang("todoCompleted")}</span>
        <span>${project.completedItems.length} ${this.lang("todoItems")}</span>
    </div>
    ${completedItems}
</div>`;
        return `<article class="todo__statsSection${project.parentCategory ? " todo__statsSection--subcategory" : ""}${project.hasChildren ? " todo__statsSection--categoryParent" : ""}${project.hasChildren && !expanded ? " todo__statsSection--groupCollapsed" : ""}${parentExpanded ? "" : " fn__none"}" data-project="${escapeAttr(project.category)}"${project.parentCategory ? ` data-parent-project="${escapeAttr(project.parentCategory)}"` : ""}>
<button class="todo__statsRow" data-type="${toggleType}" data-project="${escapeAttr(project.category)}" type="button" aria-expanded="${expanded}" aria-label="${escapeAttr(ariaLabel)}">
    <svg class="todo__statsChevron"><use xlink:href="#iconDown"></use></svg>
    <div class="todo__statsCategory">
        <span>${escapeHtml(label)}</span>
        <span>${project.completionRate}%</span>
    </div>
    <div class="todo__statsTrack" role="img" aria-label="${escapeAttr(ariaLabel)}">
        <div class="todo__statsBar" style="width: ${width}%">
            <span class="todo__statsBarCompleted" style="width: ${completedWidth}%"></span>
            <span class="todo__statsBarInProgress" style="width: ${inProgressWidth}%"></span>
        </div>
    </div>
    <div class="todo__statsCounts">
        <span><i class="todo__statsDot todo__statsDot--completed"></i>${this.lang("todoCompleted")} ${project.completed}</span>
        <span><i class="todo__statsDot"></i>${this.lang("todoInProgress")} ${project.inProgress}</span>
        <strong>${project.total}</strong>
    </div>
</button>
${details}
</article>`;
    }

    private toggleAllStatistics() {
        const statistics = this.getStatistics();
        const categories = statistics.categories;
        const projects = statistics.projects;
        const allExpanded = this.isStatisticsAllExpanded(statistics);
        categories.forEach((category) => {
            if (allExpanded) {
                if (category.hasChildren) {
                    this.expandedStatisticsCategoryGroups.delete(category.category);
                } else {
                    this.expandedStatisticsCategories.delete(category.category);
                }
            } else {
                if (category.hasChildren) {
                    this.expandedStatisticsCategoryGroups.add(category.category);
                } else {
                    this.expandedStatisticsCategories.add(category.category);
                }
            }
        });
        projects.forEach((project) => {
            if (allExpanded) {
                if (project.hasChildren) {
                    this.expandedStatisticsProjectGroups.delete(project.category);
                } else {
                    this.expandedStatisticsProjects.delete(project.category);
                }
            } else {
                if (project.hasChildren) {
                    this.expandedStatisticsProjectGroups.add(project.category);
                } else {
                    this.expandedStatisticsProjects.add(project.category);
                }
            }
        });
        this.element.querySelectorAll('[data-type="toggleStatisticsCategory"]').forEach((element) => {
            element.setAttribute("aria-expanded", allExpanded ? "false" : "true");
            element.closest(".todo__statsSection")?.querySelector(".todo__statsDetails")
                ?.classList.toggle("fn__none", allExpanded);
        });
        this.element.querySelectorAll('[data-type="toggleStatisticsCategoryGroup"]').forEach((element) => {
            const category = element.getAttribute("data-category") || "";
            element.setAttribute("aria-expanded", allExpanded ? "false" : "true");
            element.closest(".todo__statsSection")?.classList.toggle("todo__statsSection--groupCollapsed", allExpanded);
            this.element.querySelectorAll(`[data-parent-category="${CSS.escape(category)}"]`).forEach((section) => {
                section.classList.toggle("fn__none", allExpanded);
            });
        });
        this.element.querySelectorAll('[data-type="toggleStatisticsProject"]').forEach((element) => {
            element.setAttribute("aria-expanded", allExpanded ? "false" : "true");
            element.closest(".todo__statsSection")?.querySelector(".todo__statsDetails")
                ?.classList.toggle("fn__none", allExpanded);
        });
        this.element.querySelectorAll('[data-type="toggleStatisticsProjectGroup"]').forEach((element) => {
            const project = element.getAttribute("data-project") || "";
            element.setAttribute("aria-expanded", allExpanded ? "false" : "true");
            element.closest(".todo__statsSection")
                ?.classList.toggle("todo__statsSection--groupCollapsed", allExpanded);
            this.element.querySelectorAll(`[data-parent-project="${CSS.escape(project)}"]`).forEach((section) => {
                section.classList.toggle("fn__none", allExpanded);
            });
        });
        this.updateStatisticsToggleAllButton();
    }

    private isStatisticsAllExpanded(statistics: ReturnType<Todo["getStatistics"]>) {
        const categoriesExpanded = statistics.categories.length === 0 ||
            areTodoStatisticsRowsExpanded(statistics.categories, this.expandedStatisticsCategories,
                this.expandedStatisticsCategoryGroups);
        const projectsExpanded = statistics.projects.length === 0 ||
            areTodoStatisticsRowsExpanded(statistics.projects, this.expandedStatisticsProjects,
                this.expandedStatisticsProjectGroups);
        return statistics.categories.length + statistics.projects.length > 0 && categoriesExpanded && projectsExpanded;
    }

    private updateStatisticsToggleAllButton() {
        const allExpanded = this.isStatisticsAllExpanded(this.getStatistics());
        const button = this.element.querySelector('[data-type="toggleAllStatistics"]');
        if (!button) {
            return;
        }
        const label = this.lang(allExpanded ? "foldAll" : "expandAll");
        button.setAttribute("aria-label", label);
        button.querySelector("span").textContent = label;
        button.querySelector("use").setAttribute("xlink:href", `#${allExpanded ? "iconContract" : "iconExpand"}`);
    }

    private renderWeekGroups(items: ITodoItem[]) {
        const inProgressItems = items.filter(item => !this.isRootCompleted(item));
        const completedItems = items.filter(item => this.isRootCompleted(item));
        return `<div class="todo__groupTitle" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.lang("todoInProgress")}</span>
    <span>${inProgressItems.length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${inProgressItems.length > 0 ? this.renderItems(inProgressItems) : this.renderEmpty()}</ul>${completedItems.length > 0 ? `
<div class="todo__divider"></div>
<div class="todo__groupTitle todo__groupTitle--completed" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.lang("todoCompleted")}</span>
    <span>${completedItems.length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${this.renderItems(completedItems)}</ul>` : ""}`;
    }

    private renderCompletedGroups(items: ITodoItem[]) {
        if (items.length === 0) {
            return `<div class="todo__groupTitle" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${this.lang("todoCompleted")}</span>
    <span>0 ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${this.renderEmpty()}</ul>`;
        }
        // 按年-月分组
        const groups: Record<string, ITodoItem[]> = {};
        items.forEach(item => {
            const dateStr = this.formatDate(new Date(item.completedAt || item.updatedAt));
            const date = new Date(`${dateStr}T00:00:00`);
            const yearMonth = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
            if (!groups[yearMonth]) {
                groups[yearMonth] = [];
            }
            groups[yearMonth].push(item);
        });
        // 按时间倒序排列
        const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
        let html = "";
        sortedKeys.forEach(yearMonth => {
            const [year, month] = yearMonth.split("-");
            const label = new Intl.DateTimeFormat(navigator.language, {
                year: "numeric",
                month: "long",
            }).format(new Date(Number(year), Number(month) - 1, 1));
            html += `<div class="todo__groupTitle" data-type="toggleGroup" aria-expanded="true">
    <svg><use xlink:href="#iconDown"></use></svg>
    <span>${label}</span>
    <span>${groups[yearMonth].length} ${this.lang("todoItems")}</span>
</div>
<ul class="todo__list">${this.renderItems(groups[yearMonth])}</ul>`;
        });
        return html;
    }

    private renderItem(item: ITodoItem) {
        if (this.mobile) {
            return this.renderMobileItem(item);
        }
        const overdue = item.due && item.due < this.getToday() && !item.completed && !item.deletedAt;
        const subtaskClass = item.parentId ? " todo__item--subtask" : "";
        return `<li class="todo__item${item.completed ? " todo__item--completed" : ""}${subtaskClass}" data-id="${escapeAttr(item.id)}">
    <button class="todo__drag" data-type="drag" type="button" aria-label="${window.siyuan.languages.move}">
        <svg><use xlink:href="#iconDrag"></use></svg>
    </button>
    <button class="todo__check ariaLabel" data-type="toggle" data-position="north" aria-label="${this.lang("todoToggle")}">
        <svg><use xlink:href="#${item.completed ? "iconCheck" : "iconUncheck"}"></use></svg>
    </button>
    <input class="todo__title" data-type="title" value="${escapeAttr(item.title)}">
    <select class="b3-select todo__priority todo__priority--p${item.priority}" data-type="priority" aria-label="${this.lang("todoPriority")}">${this.renderPriorityOptions(item.priority)}</select>
    <select class="b3-select todo__project" data-type="project" aria-label="${this.lang("todoProject")}"${item.parentId ? " disabled" : ""}>${this.renderProjectOptions(item.project)}</select>
    ${this.renderCategoryPicker(item.categories, "item")}
    <input class="todo__date${overdue ? " todo__date--overdue" : ""}" data-type="due" type="date" value="${escapeAttr(item.due)}" aria-label="${this.lang("todoDueDate")}">
    ${item.deletedAt ? `<button class="todo__restore block__icon block__icon--show ariaLabel" data-type="restore" data-position="north" aria-label="${this.lang("todoRestore")}"><svg><use xlink:href="#iconRefresh"></use></svg></button>` : ""}
    ${!item.parentId && !item.deletedAt ? `<button class="todo__addSubtask block__icon block__icon--show ariaLabel" data-type="addSubtask" data-position="north" aria-label="${this.lang("todoAddSubtask")}"><svg><use xlink:href="#iconAdd"></use></svg></button>` : ""}
    <button class="todo__delete block__icon block__icon--show ariaLabel" data-type="delete" data-position="north" aria-label="${item.deletedAt ? this.lang("todoDeleteForever") : window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
</li>`;
    }

    private renderMobileItem(item: ITodoItem) {
        const overdue = item.due && item.due < this.getToday() && !item.completed && !item.deletedAt;
        const subtaskClass = item.parentId ? " todo__mobileItem--subtask" : "";
        const statusClass = item.completed ? " todo__mobileItem--completed" : "";
        const expanded = this.expandedMobileItems.has(item.id);
        const summary = [item.priority > 0 ? `P${item.priority}` : "", item.project ? this.getProjectLabel(item.project) : "",
            item.due].filter(Boolean).join(" · ") || window.siyuan.languages.more;
        return `<li class="todo__mobileItem${statusClass}${subtaskClass}${expanded ? " todo__mobileItem--expanded" : ""}" data-id="${escapeAttr(item.id)}">
    <button class="todo__mobileCheck" data-type="toggle" type="button" aria-label="${this.lang("todoToggle")}">
        <svg aria-hidden="true"><use xlink:href="#${item.completed ? "iconCheck" : "iconUncheck"}"></use></svg>
    </button>
    <div class="todo__mobileItemBody">
        <input class="todo__mobileTitle" data-type="title" name="todo-title-${escapeAttr(item.id)}" autocomplete="off" value="${escapeAttr(item.title)}" aria-label="${escapeAttr(item.title)}">
        <div class="todo__mobileSummary${overdue ? " todo__mobileSummary--overdue" : ""}">${escapeHtml(summary)}</div>
        <div class="todo__mobileMeta"${expanded ? "" : " hidden"}>
            <label class="todo__mobileMetaField todo__mobileMetaField--priority">
                <svg aria-hidden="true"><use xlink:href="#iconSort"></use></svg>
                <select class="b3-select todo__priority todo__priority--p${item.priority}" data-type="priority" name="todo-priority-${escapeAttr(item.id)}" autocomplete="off" aria-label="${this.lang("todoPriority")}">${this.renderPriorityOptions(item.priority)}</select>
            </label>
            <label class="todo__mobileMetaField todo__mobileMetaField--project">
                <svg aria-hidden="true"><use xlink:href="#iconFolder"></use></svg>
                <select class="b3-select" data-type="project" name="todo-project-${escapeAttr(item.id)}" autocomplete="off" aria-label="${this.lang("todoProject")}"${item.parentId ? " disabled" : ""}>${this.renderProjectOptions(item.project)}</select>
            </label>
            <div class="todo__mobileMetaField todo__mobileMetaField--category">
                ${this.renderCategoryPicker(item.categories, "item")}
            </div>
            <label class="todo__mobileMetaField todo__mobileMetaField--date${overdue ? " todo__mobileMetaField--overdue" : ""}">
                <svg aria-hidden="true"><use xlink:href="#iconCalendar"></use></svg>
                <input data-type="due" name="todo-due-${escapeAttr(item.id)}" autocomplete="off" type="date" value="${escapeAttr(item.due)}" aria-label="${this.lang("todoDueDate")}">
            </label>
        </div>
    </div>
    <div class="todo__mobileActions">
        <button class="todo__mobileAction todo__mobileAction--details" data-type="toggleMobileDetails" type="button" aria-expanded="${expanded}" aria-label="${escapeAttr(window.siyuan.languages.more)}"><svg aria-hidden="true"><use xlink:href="#iconMore"></use></svg></button>
        ${item.deletedAt ? `<button class="todo__mobileAction" data-type="restore" type="button" aria-label="${this.lang("todoRestore")}"><svg aria-hidden="true"><use xlink:href="#iconRefresh"></use></svg></button>` : ""}
        ${!item.parentId && !item.deletedAt ? `<button class="todo__mobileAction" data-type="addSubtask" type="button" aria-label="${this.lang("todoAddSubtask")}"><svg aria-hidden="true"><use xlink:href="#iconAdd"></use></svg></button>` : ""}
        <button class="todo__mobileAction todo__mobileAction--danger" data-type="delete" type="button" aria-label="${item.deletedAt ? this.lang("todoDeleteForever") : window.siyuan.languages.delete}"><svg aria-hidden="true"><use xlink:href="#iconTrashcan"></use></svg></button>
    </div>
</li>`;
    }

    private renderItems(items: ITodoItem[]) {
        return items.map(item => `${this.renderItem(item)}${this.addingSubtaskFor === item.id
            ? this.renderSubtaskComposer(item.id) : ""}`).join("");
    }

    private renderSubtaskComposer(parentId: string) {
        return `<li class="todo__subtaskComposer">
    <svg><use xlink:href="#iconAdd"></use></svg>
    <input class="b3-text-field" data-type="newSubtask" data-parent-id="${escapeAttr(parentId)}" name="todo-subtask-${escapeAttr(parentId)}" autocomplete="off" placeholder="${escapeAttr(this.lang("todoAddSubtask"))}" aria-label="${this.lang("todoAddSubtask")}">
</li>`;
    }

    private isRootCompleted(item: ITodoItem) {
        return (item.parentId ? this.getItem(item.parentId) : item)?.completed || false;
    }

    private renderPriorityOptions(selected: number) {
        return TODO_PRIORITIES.map(priority =>
            `<option value="${priority}"${priority === selected ? " selected" : ""}>P${priority}</option>`).join("");
    }

    private updatePriorityClass(element: Element, priority: number) {
        TODO_PRIORITIES.forEach(value => element.classList.remove(`todo__priority--p${value}`));
        element.classList.add(`todo__priority--p${priority}`);
    }

    private renderEmpty() {
        return `<li class="todo__empty">
    <svg><use xlink:href="#iconCheck"></use></svg>
    <span>${this.lang("todoNoTasks")}</span>
</li>`;
    }

    private getVisibleItems() {
        const filter = this.getContentFilter();
        const completedOnly = this.isCompletedFilter();
        const today = this.getToday();
        const weekRange = getMondayBasedWeekRange(today, filter === "lastWeek" ? -1 : 0);
        const categories = this.getCategories();
        const candidates = this.data.items.filter(item => !item.purgedAt &&
            (filter === "trash" ? Boolean(item.deletedAt) : !item.deletedAt));
        const candidateById = new Map(candidates.map(item => [item.id, item]));
        const childrenByParent = new Map<string, ITodoItem[]>();
        const roots: ITodoItem[] = [];
        candidates.forEach((item) => {
            if (item.parentId && candidateById.has(item.parentId)) {
                const children = childrenByParent.get(item.parentId) || [];
                children.push(item);
                childrenByParent.set(item.parentId, children);
            } else {
                roots.push(item);
            }
        });
        const matchesFilter = (item: ITodoItem) => {
            const categoryLabel = this.getItemCategoryLabel(item);
            const projectLabel = this.getItemProjectLabel(item);
            if (this.search && !`${item.title} ${categoryLabel} ${projectLabel}`.toLowerCase().includes(this.search)) {
                return false;
            }
            if (filter === "trash") {
                return true;
            }
            if (completedOnly) {
                if (!item.completed) {
                    return false;
                }
                if (filter === "completed") {
                    return true;
                }
            }
            if (filter === "today") {
                // 已完成的事项只显示当日完成的
                if (item.completed) {
                    const completedDate = this.formatDate(new Date(item.completedAt || item.updatedAt));
                    return completedDate === today;
                }
                return Boolean(item.due && item.due <= today);
            }
            if (filter === "week" || filter === "lastWeek") {
                if (item.completed) {
                    const completedDate = this.formatDate(new Date(item.completedAt || item.updatedAt));
                    return completedDate >= weekRange.start && completedDate <= weekRange.end;
                }
                return Boolean(item.due && item.due >= weekRange.start && item.due <= weekRange.end);
            }
            if (item.completed && !completedOnly) {
                return false;
            }
            if (filter.startsWith("category:")) {
                return isTodoCategoryMatch(this.getItemCategories(item), filter.substring("category:".length),
                    categories);
            }
            if (filter.startsWith("project:")) {
                return isTodoProjectMatch(this.getItemProject(item), filter.substring("project:".length),
                    this.getProjects());
            }
            return true;
        };
        const visibleItems: ITodoItem[] = [];
        this.sortTodoItems(roots).forEach((root) => {
            const children = this.sortSubtasks(childrenByParent.get(root.id) || []);
            const matchingChildren = children.filter(matchesFilter);
            const rootMatches = matchesFilter(root);
            if (!rootMatches && matchingChildren.length === 0) {
                return;
            }
            visibleItems.push(root);
            if (rootMatches && !this.search && !completedOnly) {
                visibleItems.push(...children);
            } else {
                visibleItems.push(...matchingChildren);
            }
        });
        return visibleItems;
    }

    private sortTodoItems(items: ITodoItem[]) {
        return [...items].sort((a, b) =>
            ((a.order ?? 0) - (b.order ?? 0)) || this.compareLegacyItems(a, b, false));
    }

    private sortSubtasks(items: ITodoItem[]) {
        return [...items].sort((a, b) =>
            ((a.order ?? 0) - (b.order ?? 0)) || this.compareLegacyItems(a, b, true));
    }

    private getCounts() {
        const today = this.getToday();
        const weekRange = getMondayBasedWeekRange(today);
        const lastWeekRange = getMondayBasedWeekRange(today, -1);
        const categories = this.getCategories();
        const completedOnly = this.isCompletedFilter();
        const counts = {
            today: 0,
            week: 0,
            lastWeek: 0,
            completed: 0,
            all: 0,
            trash: 0,
            categories: {} as Record<string, number>,
            projects: {} as Record<string, number>,
        };
        categories.forEach(category => {
            counts.categories[category] = 0;
        });
        this.getProjects(true).forEach(project => {
            counts.projects[project] = 0;
        });
        const categoryHierarchy = getTodoCategoryHierarchy(categories);
        const projectHierarchy = getTodoProjectHierarchy(this.getProjects());
        this.data.items.forEach(item => {
            if (item.purgedAt) {
                return;
            }
            if (item.deletedAt) {
                counts.trash++;
                return;
            }
            if (item.completed) {
                counts.completed++;
                if (!completedOnly) {
                    return;
                }
            } else {
                counts.all++;
                if (item.due && item.due <= today) {
                    counts.today++;
                }
                if (item.due && item.due >= weekRange.start && item.due <= weekRange.end) {
                    counts.week++;
                }
                if (item.due && item.due >= lastWeekRange.start && item.due <= lastWeekRange.end) {
                    counts.lastWeek++;
                }
            }
            const itemCategories = this.getItemCategories(item);
            const matchedCategories = new Set(itemCategories.length > 0 ? itemCategories : [""]);
            matchedCategories.forEach(category => {
                counts.categories[category] = (counts.categories[category] || 0) + 1;
            });
            const matchedParents = new Set<string>();
            categoryHierarchy.forEach((categoryItem) => {
                if (categoryItem.parentCategory && matchedCategories.has(categoryItem.category) &&
                    !matchedCategories.has(categoryItem.parentCategory)) {
                    matchedParents.add(categoryItem.parentCategory);
                }
            });
            matchedParents.forEach(category => {
                counts.categories[category] = (counts.categories[category] || 0) + 1;
            });
            const project = this.getItemProject(item);
            counts.projects[project] = (counts.projects[project] || 0) + 1;
            const matchedProjectParents = new Set<string>();
            projectHierarchy.forEach((projectItem) => {
                if (projectItem.parentProject === undefined || projectItem.project !== project) {
                    return;
                }
                matchedProjectParents.add(projectItem.parentProject);
            });
            matchedProjectParents.forEach(parentProject => {
                counts.projects[parentProject] = (counts.projects[parentProject] || 0) + 1;
            });
        });
        return counts;
    }

    private getStatistics() {
        const categories = new Map<string, ITodoStatisticsEntry>();
        const projects = new Map<string, ITodoStatisticsEntry>();
        const addStatistic = (statistics: Map<string, ITodoStatisticsEntry>, name: string, item: ITodoItem) => {
            const statistic: ITodoStatisticsEntry = statistics.get(name) || {
                category: name,
                total: 0,
                completed: 0,
                inProgress: 0,
                completionRate: 0,
                completedItems: [],
                itemIds: [],
                completedItemIds: [],
                hasChildren: false,
            };
            statistic.total++;
            statistic.itemIds.push(item.id);
            if (item.completed) {
                statistic.completed++;
                statistic.completedItems.push(item);
                statistic.completedItemIds.push(item.id);
            } else {
                statistic.inProgress++;
            }
            statistics.set(name, statistic);
        };
        let total = 0;
        let completed = 0;
        this.data.items.forEach((item) => {
            if (item.purgedAt || item.deletedAt) {
                return;
            }
            const categoryLabel = this.getItemCategoryLabel(item);
            const projectLabel = this.getItemProjectLabel(item);
            if (this.search && !`${item.title} ${categoryLabel} ${projectLabel}`.toLowerCase().includes(this.search)) {
                return;
            }
            if (!isTodoWithinStatisticsRange(item, this.statisticsStartDate, this.statisticsEndDate)) {
                return;
            }
            total++;
            if (item.completed) {
                completed++;
            }
            const itemCategories = this.getItemCategories(item);
            (itemCategories.length > 0 ? itemCategories : [""]).forEach(categoryName =>
                addStatistic(categories, categoryName, item));
            addStatistic(projects, this.getItemProject(item), item);
        });
        const categoryStatistics: ITodoStatisticsEntry[] = [...categories.values()].map((category) => ({
            ...category,
            completionRate: Math.round(category.completed / category.total * 100),
        }));
        const hierarchicalCategoryStatistics = getTodoStatisticsCategoryHierarchy(categoryStatistics, this.getCategories())
            .map(category => ({
                ...category,
                completedItems: [...category.completedItems].sort((a, b) =>
                    (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt)),
            }));
        const projectStatistics = [...projects.values()].map((project) => ({
            ...project,
            completionRate: Math.round(project.completed / project.total * 100),
            completedItems: [...project.completedItems].sort((a, b) =>
                (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt)),
        }));
        const hierarchicalProjectStatistics = getTodoStatisticsProjectHierarchy(projectStatistics, this.getProjects(true));
        return {
            total,
            completed,
            inProgress: total - completed,
            completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
            maxCategoryTotal: Math.max(...hierarchicalCategoryStatistics.map(category => category.total), 1),
            maxProjectTotal: Math.max(...hierarchicalProjectStatistics.map(project => project.total), 1),
            projects: hierarchicalProjectStatistics,
            categories: hierarchicalCategoryStatistics,
        };
    }

    private getCategories() {
        const categories = [...this.data.categories];
        this.data.items.forEach(item => {
            this.getItemCategories(item).forEach((category) => {
                if (!item.purgedAt && !categories.includes(category) &&
                    (this.data.categoryUpdatedAt[category] || 0) >= (this.data.deletedCategories[category] || 0)) {
                    categories.push(category);
                }
            });
        });
        if (!categories.includes("")) {
            categories.unshift("");
        }
        return categories;
    }

    private getProjects(includeEmpty = false) {
        const projects = [...this.data.projects];
        this.data.items.forEach(item => {
            const project = this.getItemProject(item);
            if (project && !item.purgedAt && !projects.includes(project) &&
                (this.data.projectUpdatedAt[project] || 0) >= (this.data.deletedProjects[project] || 0)) {
                projects.push(project);
            }
        });
        if (projects.some(project => isTodoSiyuanProject(project) &&
            project.toLowerCase() !== TODO_SIYUAN_PARENT_PROJECT) && !projects.some(project =>
            project.toLowerCase() === TODO_SIYUAN_PARENT_PROJECT)) {
            projects.push(TODO_SIYUAN_PARENT_PROJECT);
        }
        return includeEmpty ? ["", ...projects.filter(Boolean)] : projects.filter(Boolean);
    }

    private getFilterTitle() {
        const filter = this.getContentFilter();
        if (this.isCompletedFilter()) {
            if (filter === "completed") {
                return this.lang("todoCompleted");
            }
            if (filter.startsWith("category:")) {
                const category = filter.substring("category:".length);
                return `${this.lang("todoCompleted")} · ${category ? this.getCategoryLabel(category) : this.lang("todoUncategorized")}`;
            }
            if (filter.startsWith("project:")) {
                const project = filter.substring("project:".length);
                return `${this.lang("todoCompleted")} · ${project ? this.getProjectLabel(project) : this.lang("todoNoProject")}`;
            }
        }
        if (filter === "today") {
            return `${this.lang("todoToday")} (${this.formatDisplayDate(this.getToday())})`;
        }
        if (filter === "week" || filter === "lastWeek") {
            const formatter = new Intl.DateTimeFormat(navigator.language, {month: "numeric", day: "numeric"});
            const range = getMondayBasedWeekRange(this.getToday(), filter === "lastWeek" ? -1 : 0);
            const start = formatter.format(new Date(`${range.start}T00:00:00`));
            const end = formatter.format(new Date(`${range.end}T00:00:00`));
            return `${this.lang(filter === "lastWeek" ? "todoLastWeek" : "todoWeek")} ${start} – ${end}`;
        }
        if (filter === "completed") {
            return this.lang("todoCompleted");
        }
        if (filter === "trash") {
            return this.lang("todoTrash");
        }
        if (filter === "statistics") {
            return this.lang("todoStatistics");
        }
        if (filter.startsWith("category:")) {
            const category = filter.substring("category:".length);
            return category ? this.getCategoryLabel(category) : this.lang("todoUncategorized");
        }
        if (filter.startsWith("project:")) {
            const project = filter.substring("project:".length);
            return project ? this.getProjectLabel(project) : this.lang("todoNoProject");
        }
        return this.lang("todoAll");
    }

    private getDefaultDue() {
        return getTodoDefaultDue(this.getContentFilter(), this.getToday());
    }

    private getNextFilter(filter: TTodoFilter) {
        if (this.isCompletedFilter() && (filter.startsWith("category:") || filter.startsWith("project:"))) {
            return `completed:${filter}` as TTodoFilter;
        }
        return filter;
    }

    private getContentFilter() {
        return this.filter.startsWith("completed:")
            ? this.filter.substring("completed:".length) as TTodoFilter
            : this.filter;
    }

    private isCompletedFilter() {
        return this.filter === "completed" || this.filter.startsWith("completed:");
    }

    private isActiveFilter(filter: TTodoFilter) {
        return this.filter === filter || (filter === "completed" && this.isCompletedFilter()) ||
            (this.isCompletedFilter() && this.getContentFilter() === filter);
    }

    private getToday() {
        const date = new Date();
        return this.formatDate(date);
    }

    private formatDate(date: Date) {
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${date.getFullYear()}-${month}-${day}`;
    }

    private formatDisplayDate(dateString: string) {
        return new Intl.DateTimeFormat(navigator.language, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(`${dateString}T00:00:00`));
    }
}
