import {escapeAttr, escapeHtml} from "../../util/escape";
import {Constants} from "../../constants";
import {Model} from "../Model";
import {Tab} from "../Tab";
import {Wnd} from "../Wnd";
import {Layout} from "../index";
import {App} from "../../index";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {setStorageVal, updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {getLunarDate, getDayDetail, getLunarFestivals, getSolarTerms} from "chinese-days";
import {bindSharedStorage} from "../../util/sharedStorage";
import {confirmDialog} from "../../dialog/confirmDialog";

/** 日历中展示的常用传统节日；键为农历库返回的名称，值为日历显示名称 */
const CALENDAR_FESTIVALS: Record<string, string> = {
    "元宵节": "元宵节",
    "端午节": "端午节",
    "乞巧节": "七夕节",
    "中秋节": "中秋节",
    "重阳节": "重阳节",
    "腊八节": "腊八节",
    "除夕": "除夕",
};

export interface ICalendarEntry {
    id: string;
    date: string;       // "YYYY-MM-DD"
    text: string;
    createdAt: number;
    updatedAt?: number;
    deletedAt?: number;
}

/** 某一天的农历/节假日/节气信息 */
interface IDayInfo {
    lunarText: string;      // 农历显示文本（初一→显示月份，其他→显示日）
    holiday: string;        // 法定节假日名称（如"春节"）
    festival: string;       // 传统节日名称（如"元宵"）
    solarTerm: string;      // 节气名称（如"小暑"）
    isHoliday: boolean;     // 是否为法定假日（含调休）
}

export class Calendar extends Model {
    private element: HTMLElement;
    private bodyElement: HTMLElement;
    private selectedDate: string;
    private viewYear: number;
    private viewMonth: number; // 0-based
    private center: boolean;
    private mobile: boolean;
    private pendingStorageRender = false;
    private draftEntries: Record<string, string> = {};
    /** 当年节气缓存：date → termName */
    private solarTermMap: Map<string, string> = new Map();

    constructor(app: App, tab: Tab, options: { center?: boolean; mobile?: boolean } = {}) {
        super({app});
        this.center = Boolean(options.center);
        this.mobile = Boolean(options.mobile);
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "sy__calendar");
        if (this.center) {
            this.element.classList.add("sy__calendar--center");
        } else if (!this.mobile) {
            this.element.classList.add("dockPanel");
        }
        if (this.mobile) {
            this.element.classList.add("sy__calendar--mobile");
        }

        const now = new Date();
        this.selectedDate = this.formatDate(now);
        this.viewYear = now.getFullYear();
        this.viewMonth = now.getMonth();
        this.buildSolarTermCache();

        this.element.innerHTML = this.mobile ? '<div class="cal__body cal__body--mobile fn__flex-1"></div>' : `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.calendarTitle}</div>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href="#iconMin"></use></svg></span>
</div>
<div class="cal__body fn__flex-1"></div>`;

        this.bodyElement = this.element.querySelector(".cal__body") as HTMLElement;

        if (!this.mobile) {
            // 头部按钮事件
            this.element.querySelector(".block__icons").addEventListener("click", (event: MouseEvent) => {
                const target = event.target as HTMLElement;
                const actionEl = target.closest("[data-type]") as HTMLElement;
                if (!actionEl) {
                    return;
                }
                if (actionEl.getAttribute("data-type") === "min") {
                    getDockByType("calendar").toggleModel("calendar", false, true);
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
        }

        // 内容区事件（只绑定一次，通过事件委托处理所有交互）
        this.bodyElement.addEventListener("click", (event: MouseEvent) => {
            this.handleBodyClick(event);
        });
        bindSharedStorage(this.element, (key) => {
            if (key === Constants.LOCAL_TODO) {
                if (this.hasEditableFocus()) {
                    this.pendingStorageRender = true;
                    return;
                }
                this.pendingStorageRender = false;
                this.renderBody();
            }
        });
        this.bodyElement.addEventListener("input", (event) => {
            const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-cal-input]");
            if (input) {
                this.draftEntries[input.dataset.calInput] = input.value;
            }
        });
        this.bodyElement.addEventListener("focusout", (event) => {
            const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-cal-input]");
            if (input) {
                this.draftEntries[input.dataset.calInput] = input.value;
            }
            setTimeout(() => {
                if (this.pendingStorageRender && !this.hasEditableFocus()) {
                    this.pendingStorageRender = false;
                    this.renderBody();
                }
            });
        });

        this.renderBody();
        if (!this.mobile) {
            setPanelFocus(this.element);
        }

        if (this.center) {
            this.closeEmptySiblingWnds();
        }
    }

    /** 布局恢复后中心区可能残留仅含空白开始页的分屏，延迟关闭让日历占满中心区域；有真实内容的分屏保留 */
    private closeEmptySiblingWnds() {
        setTimeout(() => {
            const wnds: Wnd[] = [];
            const collect = (layout: Layout | Wnd) => {
                (layout.children as Array<Wnd | Layout>).forEach((child) => {
                    if (child instanceof Wnd) {
                        wnds.push(child);
                    } else {
                        collect(child);
                    }
                });
            };
            collect(window.siyuan.layout.centerLayout);
            wnds.forEach(wnd => {
                const hasCalendar = wnd.children.some(tab => tab.model instanceof Calendar);
                if (hasCalendar) {
                    return;
                }
                // 空白开始页页签没有 headElement 与 model，全部页签均为空白时整个分屏才可关闭
                if (wnd.children.length > 0 && wnd.children.every(tab => !tab.headElement && !tab.model)) {
                    wnd.children.slice().forEach(tab => wnd.removeTab(tab.id, false, false));
                }
            });
        }, 300);
    }

    // ──────── 数据层 ────────

    private getAllEntries(): ICalendarEntry[] {
        const storage = window.siyuan.storage[Constants.LOCAL_TODO];
        return Array.isArray(storage?.calendarEntries) ? storage.calendarEntries : [];
    }

    private getEntries(): ICalendarEntry[] {
        return this.getAllEntries().filter((entry) => !entry.deletedAt);
    }

    private setEntries(entries: ICalendarEntry[]) {
        const storage = window.siyuan.storage[Constants.LOCAL_TODO] || {};
        storage.calendarEntries = entries;
        window.siyuan.storage[Constants.LOCAL_TODO] = storage;
        setStorageVal(Constants.LOCAL_TODO, storage);
    }

    private getEntriesForDate(date: string): ICalendarEntry[] {
        return this.getEntries().filter(e => e.date === date);
    }

    private addEntry(text: string, date: string) {
        const entries = this.getAllEntries();
        const now = Date.now();
        entries.push({
            id: `${now}-${Math.random().toString(36).substring(2, 8)}`,
            date,
            text,
            createdAt: now,
            updatedAt: now,
        });
        this.setEntries(entries);
        delete this.draftEntries[date];
        this.renderBody();
    }

    private deleteEntry(id: string) {
        const entries = this.getAllEntries();
        const entry = entries.find((item) => item.id === id);
        if (entry) {
            entry.deletedAt = Date.now();
            entry.updatedAt = entry.deletedAt;
        }
        this.setEntries(entries);
        this.renderBody();
    }

    private hasEditableFocus() {
        const activeElement = document.activeElement;
        return activeElement && this.element.contains(activeElement) &&
            activeElement.matches("input, select, textarea, [contenteditable=\"true\"]");
    }

    public refreshFromStorage() {
        if (!this.hasEditableFocus()) {
            this.pendingStorageRender = false;
            this.renderBody();
        }
    }

    public deactivate() {
        const input = this.bodyElement.querySelector<HTMLInputElement>("[data-cal-input]");
        if (input) {
            this.draftEntries[input.dataset.calInput] = input.value;
        }
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && this.element.contains(activeElement)) {
            activeElement.blur();
        }
    }

    // ──────── 农历/节假日/节气 ────────

    /** 构建当年节气缓存 */
    private buildSolarTermCache() {
        this.solarTermMap.clear();
        try {
            const terms = getSolarTerms(this.viewYear);
            terms.forEach(t => {
                // 只记录节气当天
                if (t.index === 1) {
                    this.solarTermMap.set(t.date, t.name);
                }
            });
        } catch {
            // 忽略异常年份
        }
    }

    /** 获取某一天的农历/节假日/节气信息 */
    private getDayInfo(dateStr: string): IDayInfo {
        const info: IDayInfo = {
            lunarText: "",
            holiday: "",
            festival: "",
            solarTerm: "",
            isHoliday: false,
        };
        try {
            // 农历
            const lunar = getLunarDate(dateStr);
            info.lunarText = lunar.lunarDay === 1 ? lunar.lunarMonCN : lunar.lunarDayCN;
        } catch {
            // 忽略
        }
        try {
            // 法定节假日（getDayDetail 返回 name 格式："Spring Festival,春节,4"）
            const detail = getDayDetail(dateStr);
            if (detail.name && detail.name.includes(",")) {
                const parts = detail.name.split(",");
                if (parts.length >= 2) {
                    info.holiday = parts[1]; // 中文名
                    info.isHoliday = !detail.work;
                }
            }
        } catch {
            // 忽略
        }
        try {
            // 仅显示常用传统节日，过滤民俗、宗教诞辰等条目
            const festivals = getLunarFestivals(dateStr);
            if (festivals.length > 0) {
                const festival = festivals[0].name.find(name => CALENDAR_FESTIVALS[name]);
                if (festival) {
                    info.festival = CALENDAR_FESTIVALS[festival];
                }
            }
        } catch {
            // 忽略
        }
        // 节气
        info.solarTerm = this.solarTermMap.get(dateStr) || "";
        return info;
    }

    // ──────── 渲染 ────────

    private renderBody() {
        this.bodyElement.innerHTML = this.mobile ? this.buildMobileHTML() : this.buildHTML();
        // 为每个格子内的输入框绑定回车事件
        this.bodyElement.querySelectorAll("[data-cal-input]").forEach((input: HTMLInputElement) => {
            input.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    const text = input.value.trim();
                    const date = input.getAttribute("data-cal-input");
                    if (text && date) {
                        this.addEntry(text, date);
                    }
                    event.preventDefault();
                }
            });
            // 点击输入框时不触发格子选中
            input.addEventListener("click", (event: MouseEvent) => {
                event.stopPropagation();
            });
        });
    }

    private buildHTML(): string {
        const L = window.siyuan.languages;
        const today = this.formatDate(new Date());

        // 侧栏：年份选择
        const yearNav = `<div class="cal__yearNav">
    <button class="cal__navBtn block__icon" data-type="calPrevYear"><svg><use xlink:href="#iconLeft"></use></svg></button>
    <span class="cal__yearLabel">${this.viewYear}</span>
    <button class="cal__navBtn block__icon" data-type="calNextYear"><svg><use xlink:href="#iconRight"></use></svg></button>
</div>`;

        // 侧栏：月份网格（3列 x 4行）
        let monthGrid = '<div class="cal__monthGrid">';
        for (let m = 0; m < 12; m++) {
            const monthName = new Intl.DateTimeFormat(navigator.language, {month: "short"})
                .format(new Date(this.viewYear, m, 1));
            const isActive = m === this.viewMonth;
            monthGrid += `<button class="cal__monthBtn${isActive ? " cal__monthBtn--active" : ""}" data-type="calMonth" data-month="${m}">${monthName}</button>`;
        }
        monthGrid += "</div>";

        // 侧栏：今天按钮
        const todayBtn = `<button class="cal__todayBtn b3-button b3-button--small b3-button--outline" data-type="calToday">${L.calendarToday}</button>`;

        // 主区域：月份标题
        const monthLabel = new Intl.DateTimeFormat(navigator.language, {year: "numeric", month: "long"})
            .format(new Date(this.viewYear, this.viewMonth, 1));

        // 星期标题行
        const weekdays = this.getWeekdayLabels();
        const weekdayHTML = weekdays.map(d => `<span class="cal__weekday">${d}</span>`).join("");

        // 构建日格
        const firstDay = new Date(this.viewYear, this.viewMonth, 1).getDay(); // 0=周日
        const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();

        // 日期格子
        let cellsHTML = "";
        // 上月补位
        const prevMonthDays = new Date(this.viewYear, this.viewMonth, 0).getDate();
        for (let i = firstDay - 1; i >= 0; i--) {
            const d = prevMonthDays - i;
            cellsHTML += `<div class="cal__cell cal__cell--other">
    <div class="cal__cellDate">${d}</div>
</div>`;
        }
        // 当月
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${this.viewYear}-${String(this.viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isToday = dateStr === today;
            const isSelected = dateStr === this.selectedDate;
            const dayEntries = this.getEntriesForDate(dateStr);
            const dayInfo = this.getDayInfo(dateStr);
            const cls = ["cal__cell",
                isToday ? "cal__cell--today" : "",
                isSelected ? "cal__cell--selected" : "",
                dayInfo.isHoliday ? "cal__cell--holiday" : "",
            ].filter(Boolean).join(" ");

            // 农历/节假日/节气行（优先级：法定假日 > 节气 > 传统节日 > 农历日）
            let lunarHTML = "";
            if (dayInfo.holiday) {
                lunarHTML = `<div class="cal__cellLunar cal__cellLunar--holiday">${escapeHtml(dayInfo.holiday)}</div>`;
            } else if (dayInfo.solarTerm) {
                lunarHTML = `<div class="cal__cellLunar cal__cellLunar--term">${escapeHtml(dayInfo.solarTerm)}</div>`;
            } else if (dayInfo.festival) {
                lunarHTML = `<div class="cal__cellLunar cal__cellLunar--festival">${escapeHtml(dayInfo.festival)}</div>`;
            } else if (dayInfo.lunarText) {
                lunarHTML = `<div class="cal__cellLunar">${escapeHtml(dayInfo.lunarText)}</div>`;
            }

            // 记录
            let entriesHTML = "";
            dayEntries.forEach(e => {
                entriesHTML += `<div class="cal__cellEntry" data-id="${escapeAttr(e.id)}">
    <span class="cal__cellEntryText">${escapeHtml(e.text)}</span>
    <button class="cal__cellEntryDel" data-type="calDeleteEntry" aria-label="${L.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
</div>`;
            });

            // 选中格子显示输入框
            const inputHTML = isSelected
                ? `<input class="cal__cellInput" data-cal-input="${dateStr}" value="${escapeAttr(this.draftEntries[dateStr] || "")}" placeholder="${escapeAttr(L.calendarAddPlaceholder)}">`
                : "";

            cellsHTML += `<div class="${cls}" data-date="${dateStr}">
    <div class="cal__cellDate">${d}</div>
    ${lunarHTML}
    <div class="cal__cellEntries">${entriesHTML}</div>
    ${inputHTML}
</div>`;
        }
        // 下月补位
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let d = 1; d <= remaining; d++) {
            cellsHTML += `<div class="cal__cell cal__cell--other">
    <div class="cal__cellDate">${d}</div>
</div>`;
        }

        return `<div class="cal">
    <div class="cal__sidebar">
        ${yearNav}
        ${monthGrid}
        ${todayBtn}
    </div>
    <div class="cal__main">
        <div class="cal__mainHeader">
            <span class="cal__monthLabel">${escapeHtml(monthLabel)}</span>
        </div>
        <div class="cal__gridHeader">${weekdayHTML}</div>
        <div class="cal__gridBody">${cellsHTML}</div>
    </div>
</div>`;
    }

    /** 手机端使用单月概览与选中日议程，避免把桌面侧栏和格内编辑压缩到窄屏。 */
    private buildMobileHTML(): string {
        const L = window.siyuan.languages;
        const today = this.formatDate(new Date());
        const monthDate = new Date(this.viewYear, this.viewMonth, 1);
        const monthLabel = new Intl.DateTimeFormat(navigator.language, {year: "numeric", month: "long"})
            .format(monthDate);
        const weekdays = this.getWeekdayLabels();
        const weekdayHTML = weekdays.map((day) => `<span class="cal-mobile__weekday">${escapeHtml(day)}</span>`).join("");
        const firstDay = monthDate.getDay();
        const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
        let cellsHTML = "";

        for (let i = 0; i < firstDay; i++) {
            cellsHTML += '<span class="cal-mobile__day cal-mobile__day--empty" aria-hidden="true"></span>';
        }
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${this.viewYear}-${String(this.viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === today;
            const isSelected = dateStr === this.selectedDate;
            const hasEntries = this.getEntriesForDate(dateStr).length > 0;
            const classes = [
                "cal-mobile__day",
                isToday ? "cal-mobile__day--today" : "",
                isSelected ? "cal-mobile__day--selected" : "",
                hasEntries ? "cal-mobile__day--has-entries" : "",
            ].filter(Boolean).join(" ");
            const dateLabel = new Intl.DateTimeFormat(navigator.language, {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
            }).format(new Date(this.viewYear, this.viewMonth, day));
            const eventDot = hasEntries
                ? '<span class="cal-mobile__event-dot" aria-hidden="true"></span>'
                : "";
            cellsHTML += `<button type="button" class="${classes}" data-date="${dateStr}" aria-label="${escapeAttr(dateLabel)}" aria-pressed="${isSelected}"${isToday ? ' aria-current="date"' : ""}>
    <span class="cal-mobile__day-number">${day}</span>
    ${eventDot}
</button>`;
        }

        const selected = new Date(`${this.selectedDate}T00:00:00`);
        const selectedLabel = new Intl.DateTimeFormat(navigator.language, {
            month: "long",
            day: "numeric",
            weekday: "long",
        }).format(selected);
        const dayInfo = this.getDayInfo(this.selectedDate);
        const metadata = [dayInfo.holiday, dayInfo.solarTerm, dayInfo.festival, dayInfo.lunarText]
            .filter((item, index, array) => item && array.indexOf(item) === index);
        const metadataHTML = metadata.length > 0
            ? `<div class="cal-mobile__summary-meta">${metadata.map((item) =>
                `<span class="cal-mobile__summary-tag">${escapeHtml(item)}</span>`).join("")}</div>`
            : "";
        const entries = this.getEntriesForDate(this.selectedDate);
        const agendaHTML = entries.length > 0
            ? `<ul class="cal-mobile__agenda-list">${entries.map((entry) => `<li class="cal-mobile__agenda-item" data-id="${escapeAttr(entry.id)}">
    <span class="cal-mobile__agenda-text">${escapeHtml(entry.text)}</span>
    <button type="button" class="cal-mobile__entry-delete" data-type="calDeleteEntry" aria-label="${escapeAttr(`${L.delete} ${entry.text}`)}">
        <svg aria-hidden="true"><use xlink:href="#iconTrashcan"></use></svg>
    </button>
</li>`).join("")}</ul>`
            : `<div class="cal-mobile__empty">${escapeHtml(L.calendarNoEntries)}</div>`;

        return `<div class="cal-mobile">
    <header class="cal-mobile__header">
        <button type="button" class="cal-mobile__month-button" data-type="calPrevMonth" aria-label="${escapeAttr(L.previous)}">
            <svg aria-hidden="true"><use xlink:href="#iconLeft"></use></svg>
        </button>
        <button type="button" class="cal-mobile__month-label" data-type="calToday" aria-label="${escapeAttr(L.calendarToday)}">${escapeHtml(monthLabel)}</button>
        <button type="button" class="cal-mobile__month-button" data-type="calNextMonth" aria-label="${escapeAttr(L.next)}">
            <svg aria-hidden="true"><use xlink:href="#iconRight"></use></svg>
        </button>
    </header>
    <div class="cal-mobile__weekdays" aria-hidden="true">${weekdayHTML}</div>
    <div class="cal-mobile__month" role="group" aria-label="${escapeAttr(monthLabel)}">${cellsHTML}</div>
    <section class="cal-mobile__detail" aria-labelledby="cal-mobile-selected-date">
        <div class="cal-mobile__summary">
            <h2 id="cal-mobile-selected-date" class="cal-mobile__summary-date">${escapeHtml(selectedLabel)}</h2>
            ${metadataHTML}
        </div>
        <div class="cal-mobile__agenda">${agendaHTML}</div>
        <div class="cal-mobile__composer">
            <input class="cal-mobile__composer-input b3-text-field" data-cal-input="${this.selectedDate}" name="calendar-entry" autocomplete="off" value="${escapeAttr(this.draftEntries[this.selectedDate] || "")}" aria-label="${escapeAttr(L.calendarAddPlaceholder)}" placeholder="${escapeAttr(L.calendarAddPlaceholder)}">
            <button type="button" class="cal-mobile__add-button b3-button" data-type="calAddEntry">
                <svg aria-hidden="true"><use xlink:href="#iconAdd"></use></svg>
                <span>${escapeHtml(L.save)}</span>
            </button>
        </div>
    </section>
</div>`;
    }

    // ──────── 事件 ────────

    private handleBodyClick(event: MouseEvent) {
        const target = event.target as HTMLElement;

        // 删除按钮
        const delBtn = target.closest('[data-type="calDeleteEntry"]') as HTMLElement;
        if (delBtn) {
            const entryEl = delBtn.closest("[data-id]") as HTMLElement;
            if (entryEl) {
                const id = entryEl.getAttribute("data-id");
                const entry = this.getEntries().find((item) => item.id === id);
                confirmDialog(window.siyuan.languages.deleteOpConfirm,
                    `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(entry?.text || "")}</b>?`, () => {
                        this.deleteEntry(id);
                    }, undefined, true);
            }
            event.stopPropagation();
            return;
        }

        // 导航按钮
        const actionEl = target.closest("[data-type]") as HTMLElement;
        if (actionEl) {
            const type = actionEl.getAttribute("data-type");
            if (type === "calAddEntry") {
                const input = this.bodyElement.querySelector("[data-cal-input]") as HTMLInputElement;
                const text = input?.value.trim();
                const date = input?.getAttribute("data-cal-input");
                if (text && date) {
                    this.addEntry(text, date);
                }
                return;
            }
            if (type === "calPrevMonth" || type === "calNextMonth") {
                this.moveMonth(type === "calPrevMonth" ? -1 : 1);
                return;
            }
            if (type === "calPrevYear") {
                this.viewYear--;
                this.buildSolarTermCache();
                this.renderBody();
                return;
            }
            if (type === "calNextYear") {
                this.viewYear++;
                this.buildSolarTermCache();
                this.renderBody();
                return;
            }
            if (type === "calMonth") {
                const m = parseInt(actionEl.getAttribute("data-month"));
                if (!isNaN(m)) {
                    this.viewMonth = m;
                    this.renderBody();
                }
                return;
            }
            if (type === "calToday") {
                const now = new Date();
                this.selectedDate = this.formatDate(now);
                this.viewYear = now.getFullYear();
                this.viewMonth = now.getMonth();
                this.buildSolarTermCache();
                this.renderBody();
                return;
            }
        }

        // 日期格子点击 → 选中并显示输入框
        const cellEl = target.closest(".cal__cell[data-date], .cal-mobile__day[data-date]") as HTMLElement;
        if (cellEl) {
            this.selectedDate = cellEl.getAttribute("data-date");
            this.renderBody();
            // 聚焦输入框
            if (!this.mobile) {
                const input = this.bodyElement.querySelector(`[data-cal-input="${this.selectedDate}"]`) as HTMLInputElement;
                if (input) {
                    input.focus();
                }
            }
        }
    }

    // ──────── 工具 ────────

    private getWeekdayLabels(): string[] {
        const formatter = new Intl.DateTimeFormat(navigator.language, {weekday: "short"});
        // 2024-01-07 是周日
        return Array.from({length: 7}, (_, i) => formatter.format(new Date(2024, 0, 7 + i)));
    }

    /** 切换手机端月份，并将选中日平移到目标月份中可用的日期。 */
    private moveMonth(offset: number) {
        const selectedDay = Number(this.selectedDate.slice(8, 10));
        const targetMonth = new Date(this.viewYear, this.viewMonth + offset, 1);
        this.viewYear = targetMonth.getFullYear();
        this.viewMonth = targetMonth.getMonth();
        const lastDay = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
        const day = Math.min(selectedDay, lastDay);
        this.selectedDate = this.formatDate(new Date(this.viewYear, this.viewMonth, day));
        this.buildSolarTermCache();
        this.renderBody();
    }

    private formatDate(date: Date): string {
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${date.getFullYear()}-${month}-${day}`;
    }
}
