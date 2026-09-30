import {Constants} from "../../constants";
import {closeModel, closePanel} from "./closePanel";
import {getCurrentEditor, openMobileFileById} from "../editor";
import {validateName} from "../../editor/rename";
import {getEventName} from "../../protyle/util/compatibility";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {renderSnippet} from "../../config/util/snippets";
import {setEmpty} from "./setEmpty";
import {getOpenNotebookCount, parseUriInfo} from "../../util/pathName";
import {popMenu} from "../menu";
import {MobileFiles} from "../dock/MobileFiles";
import {activeBlur, initKeyboardToolbar} from "./keyboardToolbar";
import {syncGuide} from "../../sync/syncGuide";
import {App} from "../../index";
import {MobileCustomFeatures} from "../dock/MobileCustomFeatures";
import {setTitle} from "../../util/processTitle";

let customFeatures: MobileCustomFeatures;

export const initFramework = (app: App) => {
    setInlineStyle();
    renderSnippet();
    initKeyboardToolbar();
    const openWorkspace = () => {
        activeBlur();
        closePanel();
        customFeatures ||= new MobileCustomFeatures(app);
        customFeatures.openHub();
    };
    // 保留文档树模型，供新建文档和消息更新使用。
    window.siyuan.mobile.docks.file = new MobileFiles(app);
    document.getElementById("sidebar").classList.add("fn__none");
    document.getElementById("toolbarFile").addEventListener("click", () => {
        if (getCurrentEditor()?.protyle.toolbar.isMultiSelectMode()) {
            return;
        }
        openWorkspace();
    });
    // 用 touchstart 会导致键盘不收起
    document.getElementById("toolbarMore").addEventListener("click", () => {
        popMenu();
    });
    document.getElementById("toolbarSync").addEventListener(getEventName(), () => {
        syncGuide(app);
    });
    document.getElementById("modelClose").addEventListener("click", () => {
        closeModel();
    });
    initEditorName();
    if (getOpenNotebookCount() > 0) {
        if (window.JSAndroid && window.openFileByURL(window.JSAndroid.getBlockURL())) {
            return;
        }
        const info = parseUriInfo();
        if (info.id) {
            openMobileFileById(app, info.id,
                info.focus ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
            return;
        }
    }
    setEmpty(app);
    openWorkspace();
};

const initEditorName = () => {
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    inputElement.setAttribute("placeholder", window.siyuan.languages._kernel[16]);
    inputElement.addEventListener("blur", () => {
        if (inputElement.getAttribute("readonly") === "readonly") {
            return;
        }
        if (!validateName(inputElement.value)) {
            inputElement.value = inputElement.value.substring(0, Constants.SIZE_TITLE);
            return false;
        }

        fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobile.editor.protyle.notebookId,
            path: window.siyuan.mobile.editor.protyle.path,
            title: inputElement.value,
        });
        setTitle(inputElement.value);
    });
};
