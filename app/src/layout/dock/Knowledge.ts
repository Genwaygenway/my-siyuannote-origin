import {App} from "../../index";
import {Tab} from "../Tab";
import {Files} from "./Files";

export class Knowledge extends Files {
    constructor(app: App, tab: Tab) {
        super({app, tab, dockType: "knowledge"});
        tab.panelElement.classList.add("sy__knowledge");

        const logoElement = tab.panelElement.querySelector(".block__logo");
        if (logoElement) {
            logoElement.textContent = window.siyuan.languages.knowledge;
        }
    }
}
