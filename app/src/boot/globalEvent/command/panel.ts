import {getKeymapBindings, getKeymapItem} from "../../../util/keymapBindings";
import {Dialog} from "../../../dialog";
import type {App} from "../../../index";
import {upDownHint} from "../../../util/upDownHint";
import {setStorageVal, updateHotkeyTip} from "../../../protyle/util/compatibility";
import {isMobile} from "../../../util/functions";
import {Constants} from "../../../constants";
import {Editor} from "../../../editor";
/// #if MOBILE
import {getCurrentEditor} from "../../../mobile/editor";
import {popSearch} from "../../../mobile/menu/search";
/// #else
import {getActiveTab} from "../../../layout/tabUtil";
import {Custom} from "../../../layout/dock/Custom";
import {getAllModels} from "../../../layout/getAll";
import {Search} from "../../../search";
import {openSearch} from "../../../search/spread";
/// #endif
import {addEditorToDatabase, addFilesToDatabase} from "../../../protyle/render/av/addToDatabase";
import {hasClosestBlock, hasClosestByClassName, hasTopClosestByTag} from "../../../protyle/util/hasClosest";
import {onlyProtyleCommand} from "./protyle";
import {globalCommand} from "./global";
import {getDisplayName, getNotebookName, getTopPaths, movePathTo, moveToPath, pathPosix} from "../../../util/pathName";
import {hintMoveBlock} from "../../../protyle/hint/extend";
import {fetchSyncPost} from "../../../util/fetch";
import {focusByRange} from "../../../protyle/util/selection";
import {matchHotKey} from "../../../protyle/util/hotKey";
import {captureCommandContext} from "../../../command/context";
import {ensureCommandSystem, executeCommandById} from "../../../command/executor";
import {initializeEnglishCommandTranslations} from "../../../command/english";
import {
    COMMAND_PALETTE_HISTORY_KEY, createPaletteFocusLifecycle, queryCommandPalette, recordPaletteCommand,
} from "../../../command/paletteCore";
import type {ICommandContextSnapshot, ICommandDefinition} from "../../../command/types";
import {ensureInsertCommands} from "../../../command/insertCommands";
/// #if MOBILE
import {activeBlur} from "../../../mobile/util/keyboardToolbar";
/// #endif

const renderCommands = (listElement: HTMLElement, commands: ICommandDefinition[]) => {
    const fragment = document.createDocumentFragment();
    commands.forEach(command => {
        const itemElement = document.createElement("li");
        itemElement.className = "b3-list-item";
        itemElement.dataset.commandId = command.id;
        const textElement = document.createElement("span");
        textElement.className = "b3-list-item__text";
        textElement.textContent = command.label();
        const hotkey = command.keymapPath ?
            getKeymapBindings(getKeymapItem(window.siyuan.config.keymap, command.keymapPath)).map(key => updateHotkeyTip(key)).join(" / ") :
            updateHotkeyTip(command.hotkey?.() || "");
        itemElement.append(textElement);
        if (hotkey) {
            const hotkeyElement = document.createElement("span");
            hotkeyElement.className = "b3-list-item__meta";
            hotkeyElement.textContent = hotkey;
            itemElement.append(hotkeyElement);
        }
        fragment.append(itemElement);
    });
    listElement.replaceChildren(fragment);
    listElement.firstElementChild?.classList.add("b3-list-item--focus");
};

const executePaletteCommand = (app: App, commandId: string, context: ICommandContextSnapshot) => {
    void executeCommandById(app, commandId, context).then(result => {
        if (result.status === "executed") {
            const history = recordPaletteCommand(window.siyuan.storage[COMMAND_PALETTE_HISTORY_KEY], commandId);
            window.siyuan.storage[COMMAND_PALETTE_HISTORY_KEY] = history;
            setStorageVal(COMMAND_PALETTE_HISTORY_KEY, history);
        }
    }).catch(error => {
        console.error(`Unable to execute command "${commandId}":`, error);
    });
};

export const commandPanel = (app: App, options: {
    protyle?: IProtyle;
    range?: Range;
    restoreKeyboard?: () => void;
} = {}) => {
    const menu = window.siyuan.menus.menu;
    if (isMobile() && menu.element.getAttribute("data-name") === Constants.DIALOG_COMMANDPANEL) {
        menu.closeSheet();
        return;
    }
    const openCommandPanelDialog = window.siyuan.dialogs.find(item =>
        item.element.getAttribute("data-key") === Constants.DIALOG_COMMANDPANEL);
    if (openCommandPanelDialog) {
        openCommandPanelDialog.destroy();
        return;
    }
    const context = captureCommandContext({app, source: "commandPanel", protyle: options.protyle, range: options.range});
    const registry = ensureCommandSystem(app);
    ensureInsertCommands(app, isMobile());
    const restoreEditorKeyboard = isMobile() && Boolean(options.restoreKeyboard);
    const restoreFocusAfterCancel = !isMobile() ||
        (!restoreEditorKeyboard && document.body.classList.contains("mobile-keyboard--open"));
    const focusLifecycle = createPaletteFocusLifecycle(() => {
        if (context.range?.startContainer.isConnected) {
            focusByRange(context.range);
        }
    });
    const content = `<div class="fn__flex-column${isMobile() ? " mobile-command-panel" : ""}">
    <div class="b3-form__icon search__header" style="border-top: 0;border-bottom: 1px solid var(--b3-theme-surface-lighter);">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input spellcheck="false" class="b3-text-field b3-text-field--text" style="padding-left: 32px !important;">
    </div>
    <ul class="b3-list b3-list--background search__list" id="commands"></ul>
    <div class="search__tip${isMobile() ? " fn__none" : ""}">
        <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>${window.siyuan.languages.enterKey}/${window.siyuan.languages.click}</kbd> ${window.siyuan.languages.confirm}
        <kbd>Esc</kbd> ${window.siyuan.languages.close}
    </div>
</div>`;
    const onClose = () => {
        const canceled = focusLifecycle.restoreAfterCancel(restoreFocusAfterCancel);
        /// #if MOBILE
        if (canceled && !restoreFocusAfterCancel && !restoreEditorKeyboard) {
            activeBlur(true);
        }
        /// #endif
    };
    let dialog: {element: HTMLElement, destroy: () => void};
    menu.remove();
    if (isMobile()) {
        const element = document.createElement("div");
        element.innerHTML = content;
        element.className = "fn__flex-column fn__flex-1";
        menu.append(element);
        const itemsElement = menu.element.lastElementChild as HTMLElement;
        itemsElement.style.display = "flex";
        itemsElement.style.overflow = "hidden";
        menu.element.setAttribute("data-name", Constants.DIALOG_COMMANDPANEL);
        menu.removeCB = onClose;
        // 搜索框会立即接管输入焦点，按可见视口展示菜单。
        menu.fullscreen("bottom", options.restoreKeyboard, {preserveKeyboard: true});
        dialog = {element, destroy: () => menu.remove()};
    } else {
        const desktopDialog = new Dialog({
            width: "80vw",
            height: "70vh",
            title: window.siyuan.languages.commandPanel,
            content,
            disableAnimation: true,
            destroyCallback: onClose,
        });
        desktopDialog.element.setAttribute("data-key", Constants.DIALOG_COMMANDPANEL);
        dialog = desktopDialog;
    }
    const listElement = dialog.element.querySelector("#commands") as HTMLElement;
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.setAttribute("aria-label", window.siyuan.languages.commandPanel);
    if (isMobile()) {
        inputElement.placeholder = window.siyuan.languages.commandPanel;
    }
    const refresh = () => {
        renderCommands(listElement, queryCommandPalette(
            registry, context, inputElement.value, window.siyuan.storage[COMMAND_PALETTE_HISTORY_KEY],
        ));
    };
    refresh();
    inputElement.focus();

    const close = () => {
        if (isMobile()) {
            menu.closeSheet();
        } else {
            dialog.destroy();
        }
    };

    const run = (commandId: string, event?: Event) => {
        focusLifecycle.prepareCommand(() => event?.preventDefault());
        dialog.destroy();
        if (restoreEditorKeyboard) {
            options.restoreKeyboard?.();
        }
        executePaletteCommand(app, commandId, context);
    };

    listElement.addEventListener("click", (event: MouseEvent) => {
        const itemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
        const commandId = itemElement && itemElement.dataset.commandId;
        if (commandId) {
            run(commandId, event);
            event.stopPropagation();
        }
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.general.commandPanel, event)) {
            close();
            event.preventDefault();
            return;
        }
        upDownHint(listElement, event);
        if (event.key === "Enter") {
            const commandId = listElement.querySelector<HTMLElement>(".b3-list-item--focus")?.dataset.commandId;
            if (commandId) {
                run(commandId, event);
            } else {
                event.preventDefault();
                close();
            }
        } else if (event.key === "Escape") {
            close();
        }
    });
    inputElement.addEventListener("compositionend", refresh);
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (!event.isComposing) {
            event.stopPropagation();
            refresh();
        }
    });
    void initializeEnglishCommandTranslations(
        window.siyuan.config.appearance.lang,
        window.siyuan.languages as Record<string, string>,
        Constants.SIYUAN_VERSION,
    ).then(() => {
        if (dialog.element.isConnected) {
            refresh();
        }
    });
};

export const execByCommand = async (options: {
    command: string,
    app?: App,
    previousRange?: Range,
    protyle?: IProtyle,
    fileLiElements?: Element[]
}) => {
    if (globalCommand(options.command, options.app)) {
        return;
    }

    const isFileFocus = document.querySelector(".layout__tab--active")?.classList.contains("sy__file");

    let protyle = options.protyle;
    /// #if MOBILE
    if (!protyle) {
        protyle = getCurrentEditor().protyle;
        options.previousRange = protyle.toolbar.range;
    }
    /// #endif
    const range: Range = options.previousRange || (getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : document.createRange());
    let fileLiElements = options.fileLiElements;
    if (!isFileFocus && !protyle) {
        if (range) {
            window.siyuan.dialogs.find(item => {
                if (item.editors) {
                    Object.keys(item.editors).find(key => {
                        if (item.editors[key].protyle.element.contains(range.startContainer)) {
                            protyle = item.editors[key].protyle;
                            return true;
                        }
                    });
                    if (protyle) {
                        return true;
                    }
                }
            });
        }
        const activeTab = getActiveTab();
        if (!protyle && activeTab) {
            if (activeTab.model instanceof Editor) {
                protyle = activeTab.model.editor.protyle;
            } else if (activeTab.model instanceof Search) {
                if (activeTab.model.element.querySelector("#searchUnRefPanel").classList.contains("fn__none")) {
                    protyle = activeTab.model.editors.edit.protyle;
                } else {
                    protyle = activeTab.model.editors.unRefEdit.protyle;
                }
            } else if (activeTab.model instanceof Custom && activeTab.model.editors?.length > 0) {
                if (range) {
                    activeTab.model.editors.find(item => {
                        if (item.protyle.element.contains(range.startContainer)) {
                            protyle = item.protyle;
                            return true;
                        }
                    });
                }
            }
        } else if (!protyle) {
            if (!protyle && range) {
                window.siyuan.blockPanels.find(item => {
                    item.editors.find(editorItem => {
                        if (editorItem.protyle.element.contains(range.startContainer)) {
                            protyle = editorItem.protyle;
                            return true;
                        }
                    });
                    if (protyle) {
                        return true;
                    }
                });
            }
            const models = getAllModels();
            if (!protyle) {
                models.backlink.find(item => {
                    if (item.element.classList.contains("layout__tab--active")) {
                        if (range) {
                            item.editors.find(editor => {
                                if (editor.protyle.element.contains(range.startContainer)) {
                                    protyle = editor.protyle;
                                    return true;
                                }
                            });
                        }
                        if (!protyle && item.editors.length > 0) {
                            protyle = item.editors[0].protyle;
                        }
                        return true;
                    }
                });
            }
            if (!protyle) {
                models.editor.find(item => {
                    if (item.parent.headElement.classList.contains("item--focus")) {
                        protyle = item.editor.protyle;
                        return true;
                    }
                });
            }
        }
    }

    // only protyle
    if (!isFileFocus && protyle && onlyProtyleCommand({
        command: options.command,
        previousRange: range,
        protyle
    })) {
        return;
    }

    if (isFileFocus && !fileLiElements) {
        const files = getAllModels().files.find(item => item.element.contains(document.activeElement));
        fileLiElements = files ? Array.from(files.element.querySelectorAll(".b3-list-item--focus")) : [];
    }

    // 全局命令，在没有 protyle 和文件树没聚焦的情况下执行
    if ((!protyle && !isFileFocus) ||
        (isFileFocus && (!fileLiElements || fileLiElements.length === 0)) ||
        (isMobile() && !document.getElementById("empty").classList.contains("fn__none"))) {
        if (options.command === "replace") {
            /// #if MOBILE
            popSearch(options.app, {hasReplace: true, page: 1});
            /// #else
            openSearch({
                app: options.app,
                hotkey: Constants.DIALOG_REPLACE,
                key: range.toString()
            });
            /// #endif
        } else if (options.command === "search") {
            /// #if MOBILE
            popSearch(options.app, {hasReplace: false, page: 1});
            /// #else
            openSearch({
                app: options.app,
                hotkey: Constants.DIALOG_SEARCH,
                key: range.toString()
            });
            /// #endif
        }
        return;
    }

    // protyle and file tree
    switch (options.command) {
        case "replace":
            if (!isFileFocus) {
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: protyle.path.endsWith(".sy") ? protyle.path : protyle.path + ".sy"
                });
                popSearch(options.app, {
                    page: 1,
                    hasReplace: true,
                    hPath: pathPosix().join(getNotebookName(protyle.notebookId), response.data),
                    idPath: [pathPosix().join(protyle.notebookId, protyle.path)]
                });
                /// #else
                openSearch({
                    app: options.app,
                    hotkey: Constants.DIALOG_REPLACE,
                    key: range.toString(),
                    notebookId: protyle.notebookId,
                    searchPath: protyle.path
                });
                /// #endif
            } else {
                /// #if !MOBILE
                const topULElement = hasTopClosestByTag(fileLiElements[0], "UL");
                if (!topULElement) {
                    return false;
                }
                const notebookId = topULElement.getAttribute("data-url");
                const pathString = fileLiElements[0].getAttribute("data-path");
                const isFile = fileLiElements[0].getAttribute("data-type") === "navigation-file";
                if (isFile) {
                    openSearch({
                        app: options.app,
                        hotkey: Constants.DIALOG_REPLACE,
                        notebookId: notebookId,
                        searchPath: getDisplayName(pathString, false, true)
                    });
                } else {
                    openSearch({
                        app: options.app,
                        hotkey: Constants.DIALOG_REPLACE,
                        notebookId: notebookId,
                    });
                }
                /// #endif
            }
            break;
        case "search":
            if (!isFileFocus) {
                /// #if MOBILE
                const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: protyle.path.endsWith(".sy") ? protyle.path : protyle.path + ".sy"
                });
                popSearch(options.app, {
                    page: 1,
                    hasReplace: false,
                    hPath: pathPosix().join(getNotebookName(protyle.notebookId), response.data),
                    idPath: [pathPosix().join(protyle.notebookId, protyle.path)]
                });
                /// #else
                openSearch({
                    app: options.app,
                    hotkey: Constants.DIALOG_SEARCH,
                    key: range.toString(),
                    notebookId: protyle.notebookId,
                    searchPath: protyle.path
                });
                /// #endif
            } else {
                /// #if !MOBILE
                const topULElement = hasTopClosestByTag(fileLiElements[0], "UL");
                if (!topULElement) {
                    return false;
                }
                const notebookId = topULElement.getAttribute("data-url");
                const pathString = fileLiElements[0].getAttribute("data-path");
                const isFile = fileLiElements[0].getAttribute("data-type") === "navigation-file";
                if (isFile) {
                    openSearch({
                        app: options.app,
                        hotkey: Constants.DIALOG_SEARCH,
                        notebookId: notebookId,
                        searchPath: getDisplayName(pathString, false, true)
                    });
                } else {
                    openSearch({
                        app: options.app,
                        hotkey: Constants.DIALOG_SEARCH,
                        notebookId: notebookId,
                    });
                }
                /// #endif
            }
            break;
        case "addToDatabase":
            if (!isFileFocus) {
                addEditorToDatabase(protyle, range);
            } else {
                addFilesToDatabase(fileLiElements);
            }
            break;
        case "move":
            if (!isFileFocus) {
                const nodeElement = hasClosestBlock(range.startContainer);
                if (protyle.title?.editElement.contains(range.startContainer) || !nodeElement || window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_TITLE) {
                    movePathTo({
                        cb: (toPath, toNotebook) => {
                            moveToPath([protyle.path], toNotebook[0], toPath[0]);
                        },
                        paths: [protyle.path],
                        range,
                        flashcard: false,
                        rootIDs: [protyle.block.rootID]
                    });
                } else if (nodeElement && range && protyle.element.contains(range.startContainer)) {
                    let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                    if (selectElements.length === 0) {
                        selectElements = [nodeElement];
                    }
                    movePathTo({
                        cb: (toPath) => {
                            hintMoveBlock(toPath[0], selectElements, protyle);
                        },
                        flashcard: false,
                        rootIDs: [protyle.block.rootID]
                    });
                }
            } else {
                const paths = getTopPaths(fileLiElements);
                const rootIDs: string[] = [];
                fileLiElements.forEach(item => {
                    rootIDs.push(item.getAttribute("data-node-id"));
                });
                movePathTo({
                    cb: (toPath, toNotebook) => {
                        moveToPath(paths, toNotebook[0], toPath[0]);
                    },
                    paths,
                    rootIDs,
                    flashcard: false
                });
            }
            break;
    }
};
