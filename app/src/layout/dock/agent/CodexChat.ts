import {App} from "../../../index";
import {Tab} from "../../Tab";
import {Model} from "../../Model";
import {getLute} from "../../../protyle/render/setLute";
import {escapeHtml} from "../../../util/escape";
import {postRender} from "./AgentMessageRenderer";
import {getDockByType} from "../../tabUtil";
import {setPanelFocus} from "../../util";
import {setStorageVal, updateHotkeyAfterTip} from "../../../protyle/util/compatibility";
import {getAllEditor} from "../../getAll";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {Constants} from "../../../constants";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const STORAGE_PREFIX = "siyuan-codex-chat-v2:";
const LEGACY_STORAGE_PREFIX = "siyuan-codex-chat-v1:";
const MAX_CONVERSATIONS = 50;
const MAX_STORAGE_CHARACTERS = 4_000_000;
const DEFAULT_SETTINGS: CodexSettings = {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    permission: "siyuan-write",
};

type ConnectionState = "connecting" | "connected" | "failed";
type CodexPermission = "read-only" | "siyuan-write";
type CodexReasoningEffort = "" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type CodexSettingKind = "model" | "reasoning" | "permission";

type CodexSettings = {
    model: string;
    reasoningEffort: CodexReasoningEffort;
    permission: CodexPermission;
};

type CodexMessage = {
    role: "user" | "assistant";
    content: string;
    createdAt: number;
};

type CodexConversation = {
    id: string;
    title: string;
    titleEdited: boolean;
    threadId: string;
    messages: CodexMessage[];
    settings: CodexSettings;
    activeSettings?: CodexSettings;
    createdAt: number;
    updatedAt: number;
};

type CodexConversationStorage = {
    activeConversationId: string;
    conversations: CodexConversation[];
};

type MCPTool = {
    name: string;
    description?: string;
};

type MCPResponse = {
    result?: {
        content?: Array<{type: string; text?: string}>;
        structuredContent?: {
            threadId?: string;
            content?: string;
        };
        isError?: boolean;
        tools?: MCPTool[];
    };
    error?: {
        message?: string;
    };
};

export class CodexChat extends Model {
    private readonly mobile: boolean;
    private messagesElement: HTMLElement;
    private composerElement: HTMLElement;
    private textareaElement: HTMLTextAreaElement;
    private sendElement: HTMLButtonElement;
    private newSessionElement: HTMLButtonElement;
    private historyButtonElement: HTMLElement;
    private historyElement: HTMLElement;
    private historyListElement: HTMLElement;
    private historySearchElement: HTMLInputElement;
    private historyCloseElement: HTMLButtonElement;
    private historyNewSessionElement: HTMLButtonElement;
    private modelButtonElement: HTMLButtonElement;
    private permissionButtonElement: HTMLButtonElement;
    private modelValueElement: HTMLElement;
    private reasoningValueElement: HTMLElement;
    private permissionValueElement: HTMLElement;
    private statusElement: HTMLElement;
    private statusTextElement: HTMLElement;
    private menuElement?: HTMLElement;
    private menuAnchorElement?: HTMLElement;
    private lute: Lute;
    private storageKey: string;
    private legacyStorageKey: string;
    private conversations: CodexConversation[] = [];
    private activeConversationId = "";
    private messages: CodexMessage[] = [];
    private threadId = "";
    private mcpSessionId = "";
    private mcpRequestId = 1;
    private startToolName = "";
    private replyToolName = "";
    private persistentResumeConversationIds = new Set<string>();
    private connectionState: ConnectionState = "connecting";
    private connectPromise?: Promise<void>;
    private isBusy = false;
    private isHistoryOpen = false;
    private isStorageWritePending = false;
    private pendingStorageValue?: CodexConversationStorage;
    private settings: CodexSettings = {...DEFAULT_SETTINGS};
    private activeSettings?: CodexSettings;

    constructor(app: App, tab: Tab, options: {mobile?: boolean} = {}) {
        super({app});
        this.parent = tab;
        this.mobile = options.mobile === true;
        this.lute = getLute({
            emojiSite: "/emojis",
            emojis: {},
        });
        this.storageKey = STORAGE_PREFIX + window.siyuan.config.system.workspaceDir;
        this.legacyStorageKey = LEGACY_STORAGE_PREFIX + window.siyuan.config.system.workspaceDir;
        this.initUI();
        this.restoreConversation();
        this.bindEvents();
        void this.loadCodexLanguages();
        void this.connectCodex();
    }

    private initUI() {
        const panel = this.parent.panelElement;
        const L = window.siyuan.languages;
        panel.classList.add("fn__flex-column", "sy__codexChat");
        if (this.mobile) {
            panel.classList.add("sy__codexChat--mobile");
        } else {
            panel.classList.add("file-tree", "dockPanel");
        }
        const controlsHTML = this.mobile
            ? '<div class="codex-chat__mobile-controls">' +
            '<button class="codex-chat__status ariaLabel" data-position="south" type="button">' +
            '<span class="codex-chat__status-dot" aria-hidden="true"></span>' +
            '<span class="codex-chat__status-text">' + escapeHtml(L.mcpStatusConnecting) + "</span>" +
            "</button>" +
            '<span class="fn__flex-1"></span>' +
            '<button data-type="history" class="codex-chat__mobile-history ariaLabel" data-position="north" type="button" aria-label="' +
            escapeHtml(L.agentCatHistory) + '" aria-expanded="false">' +
            '<svg aria-hidden="true"><use xlink:href="#iconHistory"></use></svg>' +
            "</button>" +
            "</div>"
            : '<div class="block__icons fn__hidescrollbar">' +
            '<div class="block__logo fn__flex-1 codex-chat__title">Codex</div>' +
            '<button class="codex-chat__status ariaLabel" data-position="south" type="button">' +
            '<span class="codex-chat__status-dot"></span>' +
            '<span class="codex-chat__status-text">' + escapeHtml(L.mcpStatusConnecting) + "</span>" +
            "</button>" +
            '<span class="fn__space"></span>' +
            '<button data-type="history" class="block__icon ariaLabel" data-position="north" type="button" aria-label="' +
            escapeHtml(L.agentCatHistory) + '" aria-expanded="false">' +
            '<svg><use xlink:href="#iconHistory"></use></svg>' +
            "</button>" +
            '<span class="fn__space"></span>' +
            '<span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="' +
            escapeHtml(L.min + updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)) + '">' +
            '<svg><use xlink:href="#iconMin"></use></svg>' +
            "</span>" +
            "</div>";
        panel.innerHTML = '<div class="codex-chat' + (this.mobile ? " codex-chat--mobile" : "") +
            ' fn__flex-column fn__flex-1">' + controlsHTML +
            '<section class="codex-chat__history fn__none fn__flex-column" aria-label="' +
            escapeHtml(L.agentCatHistory) + '">' +
            '<div class="codex-chat__history-toolbar">' +
            '<div class="codex-chat__history-heading">' +
            '<svg><use xlink:href="#iconHistory"></use></svg>' +
            "<span>" + escapeHtml(L.agentCatHistory) + "</span>" +
            "</div>" +
            '<span class="fn__flex-1"></span>' +
            '<button class="codex-chat__history-new" data-type="history-new-session" type="button">' +
            '<svg><use xlink:href="#iconAdd"></use></svg>' +
            "<span>" + escapeHtml(L.agentNewSession) + "</span>" +
            "</button>" +
            '<button class="codex-chat__history-close ariaLabel" data-position="north" data-type="history-close" type="button" aria-label="' +
            escapeHtml(L.close) + '">' +
            '<svg><use xlink:href="#iconClose"></use></svg>' +
            "</button>" +
            "</div>" +
            '<label class="codex-chat__history-search">' +
            '<svg><use xlink:href="#iconSearch"></use></svg>' +
            '<input type="search" name="codex-history-search" placeholder="' + escapeHtml(L.search) + '" autocomplete="off">' +
            "</label>" +
            '<div class="codex-chat__history-list fn__flex-1"></div>' +
            "</section>" +
            '<div class="codex-chat__messages fn__flex-1"></div>' +
            '<div class="codex-chat__composer">' +
            '<textarea class="codex-chat__input" name="codex-message" rows="1" autocomplete="off" placeholder="' +
            escapeHtml(L.codexInputPlaceholder) + '"></textarea>' +
            '<div class="codex-chat__composer-bar">' +
            '<button class="codex-chat__composer-action b3-tooltips b3-tooltips__n" data-type="new-session" type="button" aria-label="' +
            escapeHtml(L.agentNewSession) + '">' +
            '<svg><use xlink:href="#iconAdd"></use></svg>' +
            "</button>" +
            '<button class="codex-chat__permission" data-type="permission-menu" type="button" aria-haspopup="menu" aria-expanded="false">' +
            '<svg><use xlink:href="#iconLock"></use></svg>' +
            '<span class="codex-chat__permission-value"></span>' +
            "</button>" +
            '<span class="fn__flex-1"></span>' +
            '<button class="codex-chat__model" data-type="model-menu" type="button" aria-haspopup="menu" aria-expanded="false">' +
            '<svg class="codex-chat__model-mark"><use xlink:href="#iconPlugZap"></use></svg>' +
            '<span class="codex-chat__model-value"></span>' +
            '<span class="codex-chat__reasoning-value"></span>' +
            '<svg class="codex-chat__model-chevron"><use xlink:href="#iconDown"></use></svg>' +
            "</button>" +
            '<button class="codex-chat__send b3-tooltips b3-tooltips__n" type="button" aria-label="' +
            escapeHtml(L.agentSend) + '">' +
            '<svg><use xlink:href="#iconUp"></use></svg>' +
            "</button>" +
            "</div>" +
            "</div>" +
            "</div>";

        this.messagesElement = panel.querySelector(".codex-chat__messages") as HTMLElement;
        this.composerElement = panel.querySelector(".codex-chat__composer") as HTMLElement;
        this.textareaElement = panel.querySelector(".codex-chat__input") as HTMLTextAreaElement;
        this.sendElement = panel.querySelector(".codex-chat__send") as HTMLButtonElement;
        this.newSessionElement = panel.querySelector('[data-type="new-session"]') as HTMLButtonElement;
        this.historyButtonElement = panel.querySelector('[data-type="history"]') as HTMLElement;
        this.historyElement = panel.querySelector(".codex-chat__history") as HTMLElement;
        this.historyListElement = panel.querySelector(".codex-chat__history-list") as HTMLElement;
        this.historySearchElement = panel.querySelector(".codex-chat__history-search input") as HTMLInputElement;
        this.historyCloseElement = panel.querySelector('[data-type="history-close"]') as HTMLButtonElement;
        this.historyNewSessionElement = panel.querySelector('[data-type="history-new-session"]') as HTMLButtonElement;
        this.modelButtonElement = panel.querySelector('[data-type="model-menu"]') as HTMLButtonElement;
        this.permissionButtonElement = panel.querySelector('[data-type="permission-menu"]') as HTMLButtonElement;
        this.modelValueElement = panel.querySelector(".codex-chat__model-value") as HTMLElement;
        this.reasoningValueElement = panel.querySelector(".codex-chat__reasoning-value") as HTMLElement;
        this.permissionValueElement = panel.querySelector(".codex-chat__permission-value") as HTMLElement;
        this.statusElement = panel.querySelector(".codex-chat__status") as HTMLElement;
        this.statusTextElement = panel.querySelector(".codex-chat__status-text") as HTMLElement;
    }

    private bindEvents() {
        this.sendElement.addEventListener("click", () => {
            void this.sendCurrentMessage();
        });
        this.textareaElement.addEventListener("input", () => {
            this.resizeTextarea();
            this.updateComposerState();
        });
        this.textareaElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing || event.shiftKey || event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            void this.sendCurrentMessage();
        });
        this.newSessionElement.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            this.createNewSession();
        });
        this.historyButtonElement.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            this.setHistoryOpen(!this.isHistoryOpen);
        });
        this.historyCloseElement.addEventListener("click", () => {
            this.setHistoryOpen(false);
            this.textareaElement.focus();
        });
        this.historyNewSessionElement.addEventListener("click", () => {
            this.createNewSession();
        });
        this.historySearchElement.addEventListener("input", () => {
            this.renderHistoryList();
        });
        this.historyListElement.addEventListener("click", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const item = target.closest("[data-conversation-id]") as HTMLElement;
            if (!item) {
                return;
            }
            const conversationId = item.getAttribute("data-conversation-id") || "";
            const action = target.closest("[data-history-action]") as HTMLElement;
            if (action?.getAttribute("data-history-action") === "more") {
                event.stopPropagation();
                this.openConversationMenu(action, conversationId);
                return;
            }
            if (!target.closest("input, button")) {
                this.switchConversation(conversationId);
            }
        });
        this.historyListElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            const target = event.target as HTMLElement;
            if (target.matches("[data-conversation-id]")) {
                event.preventDefault();
                this.switchConversation(target.getAttribute("data-conversation-id") || "");
            }
        });
        this.modelButtonElement.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            this.openSettingsMenu();
        });
        this.permissionButtonElement.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            this.openPermissionMenu();
        });
        this.statusElement.addEventListener("click", () => {
            if (this.connectionState === "failed") {
                void this.connectCodex();
            }
        });
        this.parent.panelElement.addEventListener("click", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!this.mobile) {
                setPanelFocus(this.parent.panelElement);
                const icon = target.closest(".block__icon") as HTMLElement;
                if (icon?.getAttribute("data-type") === "min") {
                    event.stopPropagation();
                    getDockByType("codexChat").toggleModel("codexChat", false, true);
                    return;
                }
            }
            if (!this.isHistoryOpen &&
                !target.closest(".codex-chat__message, .block__icons, .codex-chat__mobile-controls, button")) {
                this.textareaElement.focus();
            }
        });
    }

    private getWorkspaceName() {
        const normalized = window.siyuan.config.system.workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
        return normalized.split("/").pop() || window.siyuan.languages.workspace;
    }

    private normalizeSettings(value?: Partial<CodexSettings>): CodexSettings {
        const permission = value?.permission === "read-only" ? "read-only" : "siyuan-write";
        return {
            model: typeof value?.model === "string" ? value.model : DEFAULT_SETTINGS.model,
            reasoningEffort: this.normalizeReasoningEffort(value?.reasoningEffort),
            permission,
        };
    }

    private normalizeReasoningEffort(value?: string): CodexReasoningEffort {
        if (typeof value !== "string") {
            return DEFAULT_SETTINGS.reasoningEffort;
        }
        return ["", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)
            ? value as CodexReasoningEffort
            : DEFAULT_SETTINGS.reasoningEffort;
    }

    private createConversationId() {
        return typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    private deriveConversationTitle(messages: CodexMessage[]) {
        const firstPrompt = messages.find((message) => message.role === "user")?.content || "";
        const title = firstPrompt.replace(/\s+/g, " ").trim();
        return title ? title.slice(0, 60) : window.siyuan.languages.agentNewSession;
    }

    private normalizeConversation(value: Partial<CodexConversation>): CodexConversation {
        const messages = Array.isArray(value.messages)
            ? value.messages.filter((message) =>
                (message.role === "user" || message.role === "assistant") &&
                typeof message.content === "string").slice(-100)
            : [];
        const threadId = typeof value.threadId === "string" ? value.threadId : "";
        const createdAt = typeof value.createdAt === "number"
            ? value.createdAt
            : messages[0]?.createdAt || Date.now();
        const updatedAt = typeof value.updatedAt === "number"
            ? value.updatedAt
            : messages[messages.length - 1]?.createdAt || createdAt;
        return {
            id: typeof value.id === "string" && value.id ? value.id : this.createConversationId(),
            title: typeof value.title === "string" && value.title.trim()
                ? value.title.trim()
                : this.deriveConversationTitle(messages),
            titleEdited: value.titleEdited === true,
            threadId,
            messages,
            settings: this.normalizeSettings(value.settings),
            activeSettings: threadId
                ? this.normalizeSettings(value.activeSettings || {
                    model: "",
                    reasoningEffort: "",
                    permission: "read-only",
                })
                : undefined,
            createdAt,
            updatedAt,
        };
    }

    private createConversation(settings = this.settings): CodexConversation {
        const now = Date.now();
        return {
            id: this.createConversationId(),
            title: window.siyuan.languages.agentNewSession,
            titleEdited: false,
            threadId: "",
            messages: [],
            settings: {...settings},
            activeSettings: undefined,
            createdAt: now,
            updatedAt: now,
        };
    }

    private applyConversation(conversation: CodexConversation) {
        this.activeConversationId = conversation.id;
        this.threadId = conversation.threadId;
        this.messages = conversation.messages.slice(-100);
        this.settings = this.normalizeSettings(conversation.settings);
        this.activeSettings = conversation.activeSettings
            ? this.normalizeSettings(conversation.activeSettings)
            : undefined;
    }

    private restoreConversation() {
        let restored = false;
        const persistentStorage = window.siyuan.storage?.[Constants.LOCAL_CODEX_CHAT];
        try {
            const stored = (typeof persistentStorage === "string"
                ? JSON.parse(persistentStorage)
                : persistentStorage || {}) as {
                activeConversationId?: string;
                conversations?: Array<Partial<CodexConversation>>;
            };
            if (Array.isArray(stored.conversations) && stored.conversations.length > 0) {
                this.conversations = stored.conversations.map((conversation) =>
                    this.normalizeConversation(conversation));
                const activeConversation = this.conversations.find((conversation) =>
                    conversation.id === stored.activeConversationId) ||
                    this.conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                this.applyConversation(activeConversation);
                restored = true;
            }
        } catch (error) {
            restored = false;
        }
        if (!restored) {
            try {
                const stored = JSON.parse(localStorage.getItem(this.storageKey) || "{}") as {
                    activeConversationId?: string;
                    conversations?: Array<Partial<CodexConversation>>;
                };
                if (Array.isArray(stored.conversations) && stored.conversations.length > 0) {
                    this.conversations = stored.conversations.map((conversation) =>
                        this.normalizeConversation(conversation));
                    const activeConversation = this.conversations.find((conversation) =>
                        conversation.id === stored.activeConversationId) ||
                        this.conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                    this.applyConversation(activeConversation);
                    restored = true;
                    this.persistConversations();
                }
            } catch (error) {
                restored = false;
            }
        }
        if (!restored) {
            try {
                const legacy = JSON.parse(localStorage.getItem(this.legacyStorageKey) || "{}") as {
                    threadId?: string;
                    messages?: CodexMessage[];
                    settings?: CodexSettings;
                    activeSettings?: CodexSettings;
                };
                const conversation = this.normalizeConversation({
                    threadId: legacy.threadId || "",
                    messages: Array.isArray(legacy.messages) ? legacy.messages : [],
                    settings: legacy.settings,
                    activeSettings: legacy.activeSettings,
                });
                this.conversations = [conversation];
                this.applyConversation(conversation);
            } catch (error) {
                const conversation = this.createConversation({...DEFAULT_SETTINGS});
                this.conversations = [conversation];
                this.applyConversation(conversation);
            }
            this.persistConversations();
        }
        this.updateSettingsUI();
        this.renderConversation();
    }

    private getCurrentConversationSnapshot(touch: boolean) {
        const existing = this.conversations.find((conversation) =>
            conversation.id === this.activeConversationId);
        const titleEdited = existing?.titleEdited === true;
        return {
            id: this.activeConversationId || this.createConversationId(),
            title: titleEdited
                ? existing.title
                : this.deriveConversationTitle(this.messages),
            titleEdited,
            threadId: this.threadId,
            messages: this.messages.slice(-100),
            settings: {...this.settings},
            activeSettings: this.activeSettings ? {...this.activeSettings} : undefined,
            createdAt: existing?.createdAt || this.messages[0]?.createdAt || Date.now(),
            updatedAt: touch ? Date.now() : existing?.updatedAt || Date.now(),
        } satisfies CodexConversation;
    }

    private saveConversation(touch = true) {
        const conversation = this.getCurrentConversationSnapshot(touch);
        this.activeConversationId = conversation.id;
        const index = this.conversations.findIndex((item) => item.id === conversation.id);
        if (index === -1) {
            this.conversations.push(conversation);
        } else {
            this.conversations[index] = conversation;
        }
        this.persistConversations();
    }

    private persistConversations() {
        const activeConversation = this.conversations.find((conversation) =>
            conversation.id === this.activeConversationId);
        const conversations = this.conversations
            .filter((conversation) =>
                conversation.id === this.activeConversationId ||
                conversation.messages.length > 0 ||
                Boolean(conversation.threadId))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_CONVERSATIONS);
        if (activeConversation && !conversations.some((conversation) =>
            conversation.id === activeConversation.id)) {
            conversations[conversations.length - 1] = activeConversation;
        }
        let serialized = JSON.stringify({
            activeConversationId: this.activeConversationId,
            conversations,
        });
        while (serialized.length > MAX_STORAGE_CHARACTERS && conversations.length > 1) {
            let removableIndex = conversations.length - 1;
            while (removableIndex >= 0 &&
                conversations[removableIndex].id === this.activeConversationId) {
                removableIndex--;
            }
            if (removableIndex === -1) {
                break;
            }
            conversations.splice(removableIndex, 1);
            serialized = JSON.stringify({
                activeConversationId: this.activeConversationId,
                conversations,
            });
        }
        this.conversations = conversations;
        const storageValue = {
            activeConversationId: this.activeConversationId,
            conversations,
        };
        this.queueStorageWrite(storageValue);
        try {
            localStorage.setItem(this.storageKey, serialized);
        } catch (error) {
            // 浏览器存储空间不足时保留内存中的会话，避免中断当前对话。
        }
        if (this.isHistoryOpen) {
            this.renderHistoryList();
        }
    }

    private queueStorageWrite(storageValue: CodexConversationStorage) {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return;
        }
        this.pendingStorageValue = storageValue;
        if (this.isStorageWritePending) {
            return;
        }
        this.flushStorageWrite();
    }

    private flushStorageWrite() {
        const storageValue = this.pendingStorageValue;
        if (!storageValue) {
            this.isStorageWritePending = false;
            return;
        }
        this.pendingStorageValue = undefined;
        this.isStorageWritePending = true;
        setStorageVal(Constants.LOCAL_CODEX_CHAT, storageValue, () => {
            this.isStorageWritePending = false;
            if (this.pendingStorageValue) {
                this.flushStorageWrite();
            }
        });
    }

    private renderConversation() {
        this.messagesElement.innerHTML = "";
        if (this.messages.length === 0) {
            this.renderWelcome();
            return;
        }
        this.messages.forEach((message) => {
            this.appendMessageElement(message);
        });
        this.scrollToBottom(false);
    }

    private renderWelcome() {
        const L = window.siyuan.languages;
        const settings = this.getEffectiveSettings();
        this.messagesElement.innerHTML = '<div class="codex-chat__welcome">' +
            '<div class="codex-chat__welcome-mark">' +
            '<svg><use xlink:href="#iconTerminal"></use></svg>' +
            "</div>" +
            '<div class="codex-chat__welcome-title">Codex</div>' +
            '<div class="codex-chat__welcome-greeting">' + escapeHtml(L.agentWelcomeGreeting) + "</div>" +
            '<div class="codex-chat__welcome-scope">' +
            escapeHtml(this.getWorkspaceName()) + " · " + escapeHtml(this.getPermissionLabel(settings.permission)) +
            "</div>" +
            "</div>";
    }

    private setHistoryOpen(open: boolean) {
        if (this.isBusy && open) {
            return;
        }
        this.closeMenu();
        this.isHistoryOpen = open;
        this.historyElement.classList.toggle("fn__none", !open);
        this.messagesElement.classList.toggle("fn__none", open);
        this.composerElement.classList.toggle("fn__none", open);
        this.historyButtonElement.classList.toggle("block__icon--active", open);
        this.historyButtonElement.classList.toggle("codex-chat__mobile-history--active", this.mobile && open);
        this.historyButtonElement.setAttribute("aria-expanded", open.toString());
        if (open) {
            this.renderHistoryList();
            requestAnimationFrame(() => {
                this.historySearchElement.focus();
            });
        }
    }

    private getHistoryDateLabel(timestamp: number) {
        const date = new Date(timestamp);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);
        const dayDifference = Math.round((target.getTime() - today.getTime()) / 86400000);
        if (dayDifference === 0 || dayDifference === -1) {
            return new Intl.RelativeTimeFormat(undefined, {numeric: "auto"}).format(dayDifference, "day");
        }
        return new Intl.DateTimeFormat(undefined, {
            year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
            month: "long",
            day: "numeric",
        }).format(date);
    }

    private getHistoryTimeLabel(timestamp: number) {
        return new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(timestamp));
    }

    private renderHistoryList() {
        const L = window.siyuan.languages;
        const query = this.historySearchElement.value.trim().toLocaleLowerCase();
        const conversations = this.conversations
            .filter((conversation) => conversation.messages.length > 0 || Boolean(conversation.threadId))
            .filter((conversation) => {
                if (!query) {
                    return true;
                }
                return (conversation.title + " " +
                    conversation.messages.map((message) => message.content).join(" "))
                    .toLocaleLowerCase().includes(query);
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
        if (conversations.length === 0) {
            this.historyListElement.innerHTML = '<div class="codex-chat__history-empty">' +
                '<svg><use xlink:href="#iconHistory"></use></svg>' +
                "<span>" + escapeHtml(L.emptyContent) + "</span>" +
                "</div>";
            return;
        }
        let lastDateLabel = "";
        this.historyListElement.innerHTML = conversations.map((conversation) => {
            const dateLabel = this.getHistoryDateLabel(conversation.updatedAt);
            const group = dateLabel === lastDateLabel
                ? ""
                : '<div class="codex-chat__history-date">' + escapeHtml(dateLabel) + "</div>";
            lastDateLabel = dateLabel;
            const isActive = conversation.id === this.activeConversationId;
            return group +
                '<div class="codex-chat__history-item' + (isActive ? " codex-chat__history-item--active" : "") +
                '" data-conversation-id="' + escapeHtml(conversation.id) + '" role="button" tabindex="0" aria-current="' +
                (isActive ? "true" : "false") + '">' +
                '<span class="codex-chat__history-indicator"></span>' +
                '<div class="codex-chat__history-copy">' +
                '<span class="codex-chat__history-title">' + escapeHtml(conversation.title) + "</span>" +
                '<span class="codex-chat__history-time">' +
                escapeHtml(this.getHistoryTimeLabel(conversation.updatedAt)) + "</span>" +
                "</div>" +
                '<button class="codex-chat__history-more" data-history-action="more" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="' +
                escapeHtml(L.more) + '">' +
                '<svg><use xlink:href="#iconMore"></use></svg>' +
                "</button>" +
                "</div>";
        }).join("");
    }

    private switchConversation(conversationId: string) {
        if (this.isBusy) {
            return;
        }
        const conversation = this.conversations.find((item) => item.id === conversationId);
        if (!conversation) {
            return;
        }
        if (conversationId !== this.activeConversationId) {
            this.saveConversation(false);
            this.applyConversation(conversation);
            this.updateSettingsUI();
            this.renderConversation();
            this.persistConversations();
        }
        this.setHistoryOpen(false);
        this.textareaElement.focus();
    }

    private openConversationMenu(anchor: HTMLElement, conversationId: string) {
        if (this.menuElement?.getAttribute("data-conversation-id") === conversationId) {
            this.closeMenu();
            return;
        }
        const L = window.siyuan.languages;
        const menu = this.createMenu(anchor, "conversation");
        menu.setAttribute("data-conversation-id", conversationId);
        const panel = document.createElement("div");
        panel.className = "codex-chat__menu-panel codex-chat__menu-panel--actions";
        panel.setAttribute("role", "menu");
        panel.innerHTML = '<button class="codex-chat__menu-action" data-action="rename" type="button" role="menuitem">' +
            '<svg><use xlink:href="#iconEdit"></use></svg>' +
            "<span>" + escapeHtml(L.rename) + "</span>" +
            "</button>" +
            '<button class="codex-chat__menu-action codex-chat__menu-action--delete" data-action="delete" type="button" role="menuitem">' +
            '<svg><use xlink:href="#iconTrashcan"></use></svg>' +
            "<span>" + escapeHtml(L.delete) + "</span>" +
            "</button>";
        panel.addEventListener("click", (event: MouseEvent) => {
            const action = (event.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
            this.closeMenu();
            if (action === "rename") {
                this.startConversationRename(conversationId);
            } else if (action === "delete") {
                this.confirmConversationDelete(conversationId);
            }
        });
        menu.appendChild(panel);
    }

    private startConversationRename(conversationId: string) {
        const conversation = this.conversations.find((item) => item.id === conversationId);
        const item = this.historyListElement.querySelector(
            '[data-conversation-id="' + CSS.escape(conversationId) + '"]') as HTMLElement;
        const titleElement = item?.querySelector(".codex-chat__history-title") as HTMLElement;
        if (!conversation || !titleElement) {
            return;
        }
        const input = document.createElement("input");
        input.className = "codex-chat__history-rename";
        input.value = conversation.title;
        titleElement.replaceWith(input);
        let committed = false;
        const commit = (save: boolean) => {
            if (committed) {
                return;
            }
            committed = true;
            if (save) {
                const title = input.value.replace(/\s+/g, " ").trim().slice(0, 60);
                conversation.title = title || this.deriveConversationTitle(conversation.messages);
                conversation.titleEdited = Boolean(title);
                conversation.updatedAt = Date.now();
                this.persistConversations();
            } else {
                this.renderHistoryList();
            }
        };
        input.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commit(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                commit(false);
            }
        });
        input.addEventListener("blur", () => {
            commit(true);
        });
        input.focus();
        input.select();
    }

    private confirmConversationDelete(conversationId: string) {
        const conversation = this.conversations.find((item) => item.id === conversationId);
        if (!conversation) {
            return;
        }
        confirmDialog(
            window.siyuan.languages.deleteOpConfirm,
            window.siyuan.languages.confirmDelete + " <b>" + escapeHtml(conversation.title) + "</b>",
            () => {
                this.deleteConversation(conversationId);
            },
            undefined,
            true,
        );
    }

    private deleteConversation(conversationId: string) {
        const isActive = conversationId === this.activeConversationId;
        this.persistentResumeConversationIds.delete(conversationId);
        this.conversations = this.conversations.filter((conversation) =>
            conversation.id !== conversationId);
        if (isActive) {
            const nextConversation = this.conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0] ||
                this.createConversation(this.settings);
            if (!this.conversations.includes(nextConversation)) {
                this.conversations.push(nextConversation);
            }
            this.applyConversation(nextConversation);
            this.updateSettingsUI();
            this.renderConversation();
        }
        this.persistConversations();
        this.renderHistoryList();
    }

    private appendMessage(message: CodexMessage) {
        if (this.messagesElement.querySelector(".codex-chat__welcome")) {
            this.messagesElement.innerHTML = "";
        }
        this.messages.push(message);
        this.appendMessageElement(message);
        this.saveConversation();
        this.scrollToBottom(true);
    }

    private appendMessageElement(message: CodexMessage) {
        const element = document.createElement("div");
        element.className = "codex-chat__message codex-chat__message--" + message.role;
        const body = document.createElement("div");
        body.className = "codex-chat__message-body";
        if (message.role === "assistant") {
            body.classList.add("b3-typography");
            body.innerHTML = this.lute.ProtylePreviewStr("", message.content) || escapeHtml(message.content);
        } else {
            body.innerHTML = escapeHtml(message.content).replace(/\n/g, "<br>");
        }
        element.appendChild(body);
        this.messagesElement.appendChild(element);
        if (message.role === "assistant") {
            postRender(body, this.app);
        }
    }

    private appendLoading() {
        const element = document.createElement("div");
        element.className = "codex-chat__message codex-chat__message--loading";
        element.innerHTML = '<span class="codex-chat__loading-mark">' +
            '<svg><use xlink:href="#iconTerminal"></use></svg>' +
            "</span><span>" + escapeHtml(window.siyuan.languages.loading) + "</span>";
        this.messagesElement.appendChild(element);
        this.scrollToBottom(true);
        return element;
    }

    private appendError(message: string, prompt: string) {
        const L = window.siyuan.languages;
        const element = document.createElement("div");
        element.className = "codex-chat__message codex-chat__message--error";
        element.innerHTML = '<div class="codex-chat__error-text">' + escapeHtml(message) + "</div>" +
            '<button class="b3-button b3-button--outline" type="button">' +
            '<svg><use xlink:href="#iconRefresh"></use></svg>' + escapeHtml(L.retry) +
            "</button>";
        const retryElement = element.querySelector("button") as HTMLButtonElement;
        retryElement.addEventListener("click", () => {
            element.remove();
            void this.runPrompt(prompt);
        });
        this.messagesElement.appendChild(element);
        this.scrollToBottom(true);
    }

    private connectCodex() {
        if (this.connectPromise) {
            return this.connectPromise;
        }
        this.connectPromise = this.connectCodexInternal().finally(() => {
            this.connectPromise = undefined;
        });
        return this.connectPromise;
    }

    private async connectCodexInternal() {
        this.setConnectionState("connecting");
        try {
            const response = await fetch("/api/ai/mcpStatus", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: "{}",
            });
            const payload = await response.json() as {
                code: number;
                data?: Array<{name: string; status: string}>;
            };
            const server = payload.data?.find((item) => item.name.toLowerCase().indexOf("codex") !== -1);
            if (!server || server.status !== "connected") {
                throw new Error(window.siyuan.languages.mcpStatusFailed);
            }
            await this.initializeMCPSession(server.name);
            this.setConnectionState("connected");
        } catch (error) {
            this.setConnectionState("failed");
        }
    }

    private async initializeMCPSession(serverName: string) {
        if (this.mcpSessionId && this.startToolName && this.replyToolName) {
            return;
        }
        const response = await fetch("/mcp", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: this.mcpRequestId++,
                method: "initialize",
                params: {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: {name: "siyuan-codex-chat", version: "1"},
                },
            }),
        });
        if (!response.ok) {
            throw new Error(window.siyuan.languages.mcpStatusFailed);
        }
        this.mcpSessionId = response.headers.get("Mcp-Session-Id") || "";
        if (!this.mcpSessionId) {
            throw new Error(window.siyuan.languages.mcpStatusFailed);
        }
        const toolsResponse = await this.requestMCP("tools/list", {});
        const tools = toolsResponse.result?.tools || [];
        const prefix = "mcp_" + serverName.replace(/[^A-Za-z0-9_-]/g, "_") + "_";
        this.startToolName = tools.find((tool) => tool.name === prefix + "codex")?.name || "";
        this.replyToolName = tools.find((tool) => tool.name === prefix + "codex-reply")?.name || "";
        if (!this.startToolName || !this.replyToolName) {
            throw new Error(window.siyuan.languages.mcpStatusFailed);
        }
    }

    private async requestMCP(method: string, params: Record<string, unknown>) {
        const response = await fetch("/mcp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Mcp-Session-Id": this.mcpSessionId,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: this.mcpRequestId++,
                method,
                params,
            }),
        });
        if (!response.ok) {
            throw new Error(window.siyuan.languages._kernel[28]);
        }
        const payload = await response.json() as MCPResponse;
        if (payload.error) {
            throw new Error(payload.error.message || window.siyuan.languages._kernel[28]);
        }
        return payload;
    }

    private isMissingCodexSession(content: string) {
        return content.toLowerCase().includes("session not found");
    }

    private async resumeCodexThread(prompt: string, settings: CodexSettings) {
        const response = await fetch("/api/ai/resumeCodex", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                threadId: this.threadId,
                prompt,
                model: settings.model,
                reasoningEffort: settings.reasoningEffort,
                permission: settings.permission,
            }),
        });
        if (!response.ok) {
            throw new Error(window.siyuan.languages._kernel[28]);
        }
        const payload = await response.json() as {
            code: number;
            msg?: string;
            data?: {
                threadId?: string;
                content?: string;
            };
        };
        if (payload.code !== 0 || !payload.data?.content) {
            throw new Error(payload.msg || window.siyuan.languages._kernel[28]);
        }
        return {
            threadId: payload.data.threadId || this.threadId,
            content: payload.data.content,
        };
    }

    private async sendCurrentMessage() {
        const prompt = this.textareaElement.value.trim();
        if (!prompt || this.isBusy || this.connectionState !== "connected") {
            return;
        }
        this.textareaElement.value = "";
        this.resizeTextarea();
        this.appendMessage({
            role: "user",
            content: prompt,
            createdAt: Date.now(),
        });
        await this.runPrompt(prompt);
    }

    private async runPrompt(prompt: string) {
        if (this.isBusy) {
            return;
        }
        this.setBusy(true);
        const loadingElement = this.appendLoading();
        try {
            const isReply = Boolean(this.threadId);
            if (!isReply) {
                this.activeSettings = {...this.settings};
                this.saveConversation();
                this.updateSettingsUI();
            }
            const settings = this.getEffectiveSettings();
            const codexPrompt = this.buildPrompt(prompt);
            const argumentsValue: Record<string, unknown> = isReply ? {
                threadId: this.threadId,
                prompt: codexPrompt,
            } : {
                prompt: codexPrompt,
                cwd: settings.permission === "siyuan-write"
                    ? window.siyuan.config.system.workspaceDir + "/temp"
                    : window.siyuan.config.system.workspaceDir,
                "approval-policy": "never",
                sandbox: settings.permission === "siyuan-write" ? "workspace-write" : "read-only",
                "developer-instructions": this.buildDeveloperInstructions(settings.permission),
            };
            if (settings.model) {
                argumentsValue.model = settings.model;
            }
            const config: Record<string, unknown> = {};
            if (settings.reasoningEffort) {
                config.model_reasoning_effort = settings.reasoningEffort;
            }
            if (settings.permission === "siyuan-write") {
                config["sandbox_workspace_write.network_access"] = true;
            }
            if (Object.keys(config).length > 0) {
                argumentsValue.config = config;
            }
            let result: MCPResponse["result"];
            if (isReply && this.persistentResumeConversationIds.has(this.activeConversationId)) {
                result = {
                    structuredContent: await this.resumeCodexThread(codexPrompt, settings),
                };
            } else {
                const response = await this.requestMCP("tools/call", {
                    name: isReply ? this.replyToolName : this.startToolName,
                    arguments: argumentsValue,
                });
                result = response.result;
                const mcpContent = result?.structuredContent?.content ||
                    (result?.content || []).filter((item) => item.type === "text")
                        .map((item) => item.text || "").join("\n");
                if (isReply && result?.isError && this.isMissingCodexSession(mcpContent)) {
                    this.persistentResumeConversationIds.add(this.activeConversationId);
                    result = {
                        structuredContent: await this.resumeCodexThread(codexPrompt, settings),
                    };
                }
            }
            const content = result?.structuredContent?.content ||
                (result?.content || []).filter((item) => item.type === "text").map((item) => item.text || "").join("\n");
            if (result?.isError || !content) {
                throw new Error(content || window.siyuan.languages._kernel[28]);
            }
            if (result.structuredContent?.threadId) {
                this.threadId = result.structuredContent.threadId;
            }
            loadingElement.remove();
            this.appendMessage({
                role: "assistant",
                content,
                createdAt: Date.now(),
            });
        } catch (error) {
            loadingElement.remove();
            this.appendError((error as Error).message || window.siyuan.languages._kernel[28], prompt);
        } finally {
            this.setBusy(false);
        }
    }

    private getEffectiveSettings() {
        return this.threadId && this.activeSettings ? this.activeSettings : this.settings;
    }

    private getPermissionLabel(permission: CodexPermission) {
        return permission === "siyuan-write"
            ? window.siyuan.languages.codexPermissionWrite
            : window.siyuan.languages.editReadonly;
    }

    private getModelLabel(model: string) {
        if (model === "gpt-5.6-sol") {
            return "5.6 Sol";
        }
        if (model === "gpt-5.6-terra") {
            return "5.6 Terra";
        }
        return model || window.siyuan.languages.defaultModel;
    }

    private getReasoningLabel(reasoningEffort: CodexReasoningEffort) {
        const L = window.siyuan.languages;
        const labels: Record<CodexReasoningEffort, string> = {
            "": L.reasoningEffortDefault,
            low: L.reasoningEffortLow,
            medium: L.reasoningEffortMedium,
            high: L.reasoningEffortHigh,
            xhigh: L.reasoningEffortXHigh || L.reasoningEffortHigh,
            max: L.reasoningEffortMax || L.reasoningEffortHigh,
            ultra: L.reasoningEffortUltra || L.reasoningEffortHigh,
        };
        return labels[reasoningEffort];
    }

    private async loadCodexLanguages() {
        const L = window.siyuan.languages;
        if (L.reasoningEffortXHigh && L.reasoningEffortMax && L.reasoningEffortUltra) {
            return;
        }
        try {
            const response = await fetch("/appearance/langs/" + window.siyuan.config.appearance.lang +
                ".json?codex=" + Date.now(), {cache: "no-store"});
            if (!response.ok) {
                return;
            }
            const languages = await response.json() as typeof window.siyuan.languages;
            L.reasoningEffortXHigh = languages.reasoningEffortXHigh;
            L.reasoningEffortMax = languages.reasoningEffortMax;
            L.reasoningEffortUltra = languages.reasoningEffortUltra;
            this.updateSettingsUI();
        } catch (error) {
            // 语言文件加载失败时保留已有的通用思考强度文案。
        }
    }

    private openSettingsMenu() {
        if (this.menuElement?.getAttribute("data-anchor") === "settings") {
            this.closeMenu();
            return;
        }
        const L = window.siyuan.languages;
        const menu = this.createMenu(this.modelButtonElement, "settings");
        const main = document.createElement("div");
        main.className = "codex-chat__menu-panel codex-chat__menu-panel--main";
        main.setAttribute("role", "menu");
        main.innerHTML = this.getMenuRowHTML("model", L.apiModel, this.getModelLabel(this.settings.model)) +
            this.getMenuRowHTML("reasoning", L.reasoningEffortTooltip,
                this.getReasoningLabel(this.settings.reasoningEffort)) +
            this.getMenuRowHTML("permission", L.codexPermission, this.getPermissionLabel(this.settings.permission)) +
            (this.threadId
                ? '<div class="codex-chat__menu-hint">' + escapeHtml(L.codexSettingsNextSession) + "</div>"
                : "");
        main.addEventListener("click", (event: MouseEvent) => {
            const row = (event.target as HTMLElement).closest("[data-setting]") as HTMLButtonElement;
            if (!row) {
                return;
            }
            const kind = row.getAttribute("data-setting") as CodexSettingKind;
            main.querySelectorAll("[data-setting]").forEach((element) => {
                element.classList.toggle("codex-chat__menu-row--active", element === row);
            });
            this.openChoicePanel(menu, kind);
        });
        menu.appendChild(main);
        this.modelButtonElement.setAttribute("aria-expanded", "true");
    }

    private openPermissionMenu() {
        if (this.menuElement?.getAttribute("data-anchor") === "permission") {
            this.closeMenu();
            return;
        }
        const menu = this.createMenu(this.permissionButtonElement, "permission");
        this.openChoicePanel(menu, "permission");
        this.permissionButtonElement.setAttribute("aria-expanded", "true");
    }

    private createMenu(anchor: HTMLElement, anchorName: string) {
        this.closeMenu();
        const menu = document.createElement("div");
        menu.className = "codex-chat__menu";
        menu.setAttribute("data-anchor", anchorName);
        document.body.appendChild(menu);
        this.menuElement = menu;
        this.menuAnchorElement = anchor;
        anchor.setAttribute("aria-expanded", "true");
        requestAnimationFrame(() => {
            const anchorRect = anchor.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const left = Math.min(
                window.innerWidth - menuRect.width - 8,
                Math.max(8, anchorRect.right - menuRect.width),
            );
            let top = anchorRect.bottom + 8;
            if (top + menuRect.height > window.innerHeight - 8) {
                top = Math.max(8, anchorRect.top - menuRect.height - 8);
            }
            menu.style.left = left + "px";
            menu.style.top = top + "px";
            menu.classList.add("codex-chat__menu--open");
        });
        document.addEventListener("pointerdown", this.handleMenuDismiss);
        document.addEventListener("keydown", this.handleMenuKeydown);
        window.addEventListener("resize", this.closeMenu);
        return menu;
    }

    private getMenuRowHTML(kind: CodexSettingKind, label: string, value: string) {
        return '<button class="codex-chat__menu-row" data-setting="' + kind + '" type="button" role="menuitem">' +
            '<span class="codex-chat__menu-label">' + escapeHtml(label) + "</span>" +
            '<span class="codex-chat__menu-value">' + escapeHtml(value) + "</span>" +
            '<svg><use xlink:href="#iconRight"></use></svg>' +
            "</button>";
    }

    private openChoicePanel(menu: HTMLElement, kind: CodexSettingKind) {
        menu.querySelector(".codex-chat__menu-panel--choices")?.remove();
        const panel = document.createElement("div");
        panel.className = "codex-chat__menu-panel codex-chat__menu-panel--choices";
        panel.setAttribute("role", "menu");
        const choices = this.getSettingChoices(kind);
        const currentValue = kind === "model"
            ? this.settings.model
            : kind === "reasoning" ? this.settings.reasoningEffort : this.settings.permission;
        choices.forEach((choice) => {
            const button = document.createElement("button");
            button.className = "codex-chat__menu-choice";
            button.type = "button";
            button.setAttribute("role", "menuitemradio");
            button.setAttribute("aria-checked", (choice.value === currentValue).toString());
            button.innerHTML = '<span class="codex-chat__menu-choice-label">' + escapeHtml(choice.label) + "</span>" +
                (choice.value === currentValue
                    ? '<svg><use xlink:href="#iconSelect"></use></svg>'
                    : "");
            button.addEventListener("click", () => {
                this.applySetting(kind, choice.value);
            });
            panel.appendChild(button);
        });
        menu.insertBefore(panel, menu.firstChild);
    }

    private getSettingChoices(kind: CodexSettingKind) {
        const L = window.siyuan.languages;
        if (kind === "model") {
            return [
                {value: "", label: L.defaultModel},
                {value: "gpt-5.6-sol", label: "5.6 Sol"},
                {value: "gpt-5.6-terra", label: "5.6 Terra"},
            ];
        }
        if (kind === "reasoning") {
            const efforts: CodexReasoningEffort[] = ["", "low", "medium", "high", "xhigh", "max", "ultra"];
            return efforts.map((value) => ({value, label: this.getReasoningLabel(value)}));
        }
        return [
            {value: "read-only", label: L.editReadonly},
            {value: "siyuan-write", label: L.codexPermissionWrite},
        ];
    }

    private applySetting(kind: CodexSettingKind, value: string) {
        if (kind === "model") {
            this.settings.model = value;
        } else if (kind === "reasoning") {
            this.settings.reasoningEffort = this.normalizeReasoningEffort(value);
        } else {
            this.settings.permission = value === "read-only" ? "read-only" : "siyuan-write";
        }
        this.saveConversation();
        this.updateSettingsUI();
        if (!this.threadId) {
            this.renderConversation();
        }
        this.closeMenu();
    }

    private handleMenuDismiss = (event: PointerEvent) => {
        const target = event.target as Node;
        if (!this.menuElement?.contains(target) &&
            !this.modelButtonElement.contains(target) &&
            !this.permissionButtonElement.contains(target)) {
            this.closeMenu();
        }
    };

    private handleMenuKeydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            this.closeMenu();
            this.textareaElement.focus();
        }
    };

    private closeMenu = () => {
        this.menuElement?.remove();
        this.menuElement = undefined;
        this.menuAnchorElement?.setAttribute("aria-expanded", "false");
        this.menuAnchorElement = undefined;
        this.modelButtonElement?.setAttribute("aria-expanded", "false");
        this.permissionButtonElement?.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", this.handleMenuDismiss);
        document.removeEventListener("keydown", this.handleMenuKeydown);
        window.removeEventListener("resize", this.closeMenu);
    };

    private buildPrompt(prompt: string) {
        const context = this.getEditorContext();
        if (!context) {
            return prompt;
        }
        return "<siyuan-context>\n" + JSON.stringify(context) + "\n</siyuan-context>\n\n" + prompt;
    }

    private getEditorContext() {
        const mobileEditor = this.mobile ? window.siyuan.mobile?.editor : undefined;
        const editors = mobileEditor?.protyle?.block?.rootID
            ? [mobileEditor]
            : getAllEditor().filter((editor) =>
                editor?.protyle?.block?.rootID &&
                !editor.protyle.element.classList.contains("fn__none") &&
                editor.protyle.element.closest(".layout__center"));
        if (editors.length === 0) {
            return undefined;
        }
        const editor = mobileEditor?.protyle?.block?.rootID ? mobileEditor : editors.find((item) =>
            item.protyle.model?.parent?.headElement?.classList.contains("item--focus")) || editors[0];
        const selectedBlockIDs: string[] = [];
        editor.protyle.wysiwyg?.element?.querySelectorAll("[data-node-id].protyle-wysiwyg--select")
            .forEach((element) => {
                const id = element.getAttribute("data-node-id");
                if (id) {
                    selectedBlockIDs.push(id);
                }
            });
        return {
            workspace: window.siyuan.config.system.workspaceDir,
            activeDocumentID: editor.protyle.block.rootID,
            activeDocumentTitle: editor.protyle.title?.editElement?.textContent?.trim() || "",
            focusedBlockID: editor.protyle.block.id || "",
            selectedBlockIDs,
            notebookID: editor.protyle.notebookId || "",
        };
    }

    private buildDeveloperInstructions(permission: CodexPermission) {
        const common = [
            "You are embedded in SiYuan. Reply in the user's language.",
            "A <siyuan-context> block may contain the active document, focused block, selected blocks, and notebook IDs.",
            "Never edit .sy files, SQLite databases, workspace configuration, or indexes directly.",
        ];
        if (permission === "read-only") {
            return common.concat([
                "Treat all SiYuan data as read-only.",
                "Do not send HTTP requests that create, update, move, rename, delete, roll back, clean, or sync data.",
            ]).join(" ");
        }
        return common.concat([
            "You may modify SiYuan only through its HTTP API at http://127.0.0.1:6806.",
            "Use POST requests with Content-Type application/json and verify that every response has code 0.",
            "Useful read APIs include /api/notebook/lsNotebooks, /api/query/sql, /api/block/getBlockKramdown, and /api/block/getChildBlocks.",
            "Useful write APIs include /api/filetree/createDocWithMd, /api/filetree/renameDocByID, /api/block/updateBlock, /api/block/insertBlock, /api/block/appendBlock, and /api/attr/setBlockAttrs.",
            "For API details, consult /Users/genway/ProjectSummary/siyuan-note/docs/API.md when it is available.",
            "Before deleting, clearing, rolling back, cleaning, syncing, removing a notebook, or substantially overwriting content, explain the exact target and ask for explicit confirmation in chat. Do not execute the destructive action in the same turn.",
            "After a change, verify the API result and summarize exactly what changed.",
        ]).join(" ");
    }

    private createNewSession() {
        if (this.isBusy) {
            return;
        }
        this.saveConversation(false);
        this.conversations = this.conversations.filter((conversation) =>
            conversation.id !== this.activeConversationId ||
            conversation.messages.length > 0 ||
            Boolean(conversation.threadId));
        const conversation = this.createConversation(this.settings);
        this.conversations.unshift(conversation);
        this.applyConversation(conversation);
        this.persistConversations();
        this.historySearchElement.value = "";
        this.setHistoryOpen(false);
        this.updateSettingsUI();
        this.renderWelcome();
        this.textareaElement.focus();
    }

    private setBusy(busy: boolean) {
        this.isBusy = busy;
        this.textareaElement.disabled = busy || this.connectionState !== "connected";
        this.newSessionElement.disabled = busy;
        this.historyNewSessionElement.disabled = busy;
        this.historyButtonElement.classList.toggle("codex-chat__control--disabled", busy);
        this.modelButtonElement.disabled = busy;
        this.permissionButtonElement.disabled = busy;
        if (busy) {
            this.closeMenu();
            this.setHistoryOpen(false);
        }
        this.updateComposerState();
    }

    private setConnectionState(state: ConnectionState) {
        const L = window.siyuan.languages;
        this.connectionState = state;
        this.statusElement.setAttribute("data-state", state);
        this.statusTextElement.textContent = state === "connected"
            ? L.mcpStatusConnected
            : state === "connecting" ? L.mcpStatusConnecting : L.mcpStatusFailed;
        this.textareaElement.disabled = state !== "connected" || this.isBusy;
        this.updateComposerState();
    }

    private updateComposerState() {
        this.sendElement.disabled = this.isBusy || this.connectionState !== "connected" ||
            this.textareaElement.value.trim().length === 0;
    }

    private updateSettingsUI() {
        const settings = this.getEffectiveSettings();
        this.modelValueElement.textContent = this.getModelLabel(settings.model);
        this.reasoningValueElement.textContent = this.getReasoningLabel(settings.reasoningEffort);
        this.permissionValueElement.textContent = this.getPermissionLabel(settings.permission);
        const permissionUse = this.permissionButtonElement.querySelector("use") as SVGUseElement;
        permissionUse.setAttribute("xlink:href",
            settings.permission === "siyuan-write" ? "#iconTriangleAlert" : "#iconLock");
        this.permissionButtonElement.setAttribute("data-permission", settings.permission);
    }

    private resizeTextarea() {
        this.textareaElement.style.height = "auto";
        this.textareaElement.style.height = Math.min(this.textareaElement.scrollHeight, 160) + "px";
    }

    private scrollToBottom(smooth: boolean) {
        requestAnimationFrame(() => {
            this.messagesElement.scrollTo({
                top: this.messagesElement.scrollHeight,
                behavior: smooth ? "smooth" : "auto",
            });
        });
    }

    public handleMobileBack(): boolean {
        if (this.menuElement) {
            this.closeMenu();
            return true;
        }
        if (this.isHistoryOpen) {
            this.setHistoryOpen(false);
            return true;
        }
        return false;
    }

    public deactivate() {
        this.closeMenu();
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && this.parent.panelElement.contains(activeElement)) {
            activeElement.blur();
        }
        this.textareaElement.blur();
    }

    public destroy() {
        this.closeMenu();
        if (!this.mcpSessionId) {
            return;
        }
        void fetch("/mcp", {
            method: "DELETE",
            headers: {"Mcp-Session-Id": this.mcpSessionId},
            keepalive: true,
        });
        this.mcpSessionId = "";
    }
}
