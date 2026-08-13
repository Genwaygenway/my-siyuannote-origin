import type {App} from "../index";
import {Constants} from "../constants";
import {ipcRenderer} from "electron";
import {flushWindowWorkspace} from "./workspace";
import {showMessage} from "../dialog/message";

export const unloadPlugins = async (app: App) => {
    for (const plugin of app.plugins) {
        try {
            await plugin.onunload();
        } catch (error) {
            console.error(error);
        }
        await plugin.kernel.destroy();
    }
};

let closing = false;
export const closeWindow = async (app: App) => {
    if (closing) {
        return;
    }
    closing = true;
    try {
        if (!await flushWindowWorkspace()) {
            showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
            return;
        }
        await unloadPlugins(app);
        ipcRenderer.send(Constants.SIYUAN_CMD, "destroy");
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
    } finally {
        closing = false;
    }
};
