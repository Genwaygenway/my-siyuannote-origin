import {activeBlur} from "./keyboardToolbar";
import {Constants} from "../../constants";

const hideModel = () => {
    const modelElement = document.getElementById("model");
    modelElement.dispatchEvent(new CustomEvent("siyuan-model-hide"));
    modelElement.classList.remove("mobile-workspace");
    document.getElementById("modelMain").classList.remove("fn__flex-column", "mobile-workspace__main");
    modelElement.style.transform = "";
};

export const closePanel = () => {
    document.getElementById("menu").style.transform = "";
    document.getElementById("sidebar").style.transform = "";
    hideModel();
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    setTimeout(() => {
        maskElement.classList.add("fn__none");
    }, Constants.TIMEOUT_TRANSITION);
    maskElement.style.opacity = "";
    window.siyuan.menus.menu.remove();
};

export const closeModel = () => {
    activeBlur();
    hideModel();
};
