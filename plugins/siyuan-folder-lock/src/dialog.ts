// 安全锁对话框

import {Dialog, showMessage} from "siyuan";
import {validateNewPassword} from "./password";

export type IUnlockChoice = { type: "password"; password: string } | { type: "recovery" };

function protectUnlockDialog(dialog: Dialog): void {
    dialog.element.classList.add("fld-lock-dialog--privacy");
    const backdrop = dialog.element.querySelector(".b3-dialog") as HTMLElement | null;
    if (backdrop) {
        backdrop.style.backgroundColor = "var(--b3-theme-background)";
    }
}

function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    })[character]!);
}

export function showSetPasswordDialog(i18n: any): Promise<string | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: string | null) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const dialog = new Dialog({
            title: i18n.setPassword,
            content: `<div class="b3-dialog__content" style="padding: 24px;">
    <div class="fld-lock__field">
        <label class="fld-lock__label">${i18n.password}</label>
        <input class="b3-text-field fld-lock__input" type="password" id="fld-lock-password" autocomplete="new-password">
    </div>
    <div class="fld-lock__field">
        <label class="fld-lock__label">${i18n.confirmPassword}</label>
        <input class="b3-text-field fld-lock__input" type="password" id="fld-lock-confirm" autocomplete="new-password">
    </div>
    <div class="fld-lock__hint">${i18n.setPasswordHint}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" id="fld-lock-confirm-btn">${i18n.confirm}</button>
</div>`,
            width: "440px",
            destroyCallback: () => finish(null),
        });
        const passwordInput = dialog.element.querySelector("#fld-lock-password") as HTMLInputElement;
        const confirmInput = dialog.element.querySelector("#fld-lock-confirm") as HTMLInputElement;
        const confirmBtn = dialog.element.querySelector("#fld-lock-confirm-btn") as HTMLElement;
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLElement;

        const onConfirm = () => {
            const validationError = validateNewPassword(passwordInput.value, confirmInput.value);
            if (validationError === "required") {
                showMessage(i18n.passwordRequired);
                return;
            }
            if (validationError === "mismatch") {
                showMessage(i18n.passwordMismatch);
                return;
            }
            finish(passwordInput.value);
            dialog.destroy();
        };

        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", () => {
            finish(null);
            dialog.destroy();
        });
        passwordInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                confirmInput.focus();
            }
        });
        confirmInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                onConfirm();
            }
        });
        passwordInput.focus();
    });
}

export function showUnlockDialog(i18n: any, targetName: string): Promise<IUnlockChoice | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: IUnlockChoice | null) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const dialog = new Dialog({
            title: `${i18n.unlock} - ${escapeHTML(targetName)}`,
            content: `<div class="b3-dialog__content" style="padding: 24px;">
    <div class="fld-lock__field">
        <label class="fld-lock__label">${i18n.enterPassword}</label>
        <input class="b3-text-field fld-lock__input" type="password" id="fld-lock-password" autocomplete="current-password" autofocus>
    </div>
    <div class="fld-lock__forgot">
        <button type="button" class="fld-lock__link" id="fld-lock-recovery">${i18n.useRecoveryCode}</button>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" id="fld-lock-confirm-btn">${i18n.unlock}</button>
</div>`,
            width: "440px",
            destroyCallback: () => finish(null),
        });
        protectUnlockDialog(dialog);
        const passwordInput = dialog.element.querySelector("#fld-lock-password") as HTMLInputElement;
        const confirmBtn = dialog.element.querySelector("#fld-lock-confirm-btn") as HTMLElement;
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLElement;
        const recoveryLink = dialog.element.querySelector("#fld-lock-recovery") as HTMLButtonElement;

        const onConfirm = () => {
            if (!passwordInput.value) {
                showMessage(i18n.passwordRequired);
                return;
            }
            finish({type: "password", password: passwordInput.value});
            dialog.destroy();
        };

        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", () => {
            finish(null);
            dialog.destroy();
        });
        recoveryLink.addEventListener("click", (event: Event) => {
            event.preventDefault();
            finish({type: "recovery"});
            dialog.destroy();
        });
        passwordInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                onConfirm();
            }
        });
        passwordInput.focus();
    });
}

export function showRecoveryDialog(i18n: any): Promise<string | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: string | null) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const dialog = new Dialog({
            title: i18n.recoveryUnlockTitle,
            content: `<div class="b3-dialog__content" style="padding: 24px;">
    <div class="fld-lock__field">
        <label class="fld-lock__label">${i18n.recoveryCode}</label>
        <input class="b3-text-field fld-lock__input" type="text" id="fld-lock-recovery" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off">
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" id="fld-lock-confirm-btn">${i18n.unlock}</button>
</div>`,
            width: "440px",
            destroyCallback: () => finish(null),
        });
        protectUnlockDialog(dialog);
        const recoveryInput = dialog.element.querySelector("#fld-lock-recovery") as HTMLInputElement;
        const confirmBtn = dialog.element.querySelector("#fld-lock-confirm-btn") as HTMLElement;
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLElement;

        const onConfirm = () => {
            const recoveryCode = recoveryInput.value.trim();
            if (!recoveryCode) {
                showMessage(i18n.recoveryCodeRequired);
                return;
            }
            finish(recoveryCode);
            dialog.destroy();
        };

        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", () => {
            finish(null);
            dialog.destroy();
        });
        recoveryInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                onConfirm();
            }
        });
        recoveryInput.focus();
    });
}

export function showRecoveryCodeDialog(i18n: any, code: string): Promise<void> {
    return new Promise((resolve) => {
        const dialog = new Dialog({
            title: i18n.recoveryCodeTitle,
            content: `<div class="b3-dialog__content" style="padding: 24px;">
    <div class="fld-lock__recovery-hint">${i18n.recoveryCodeHint}</div>
    <div class="fld-lock__recovery-code" id="fld-lock-code">${code}</div>
    <div class="fld-lock__recovery-actions">
        <button class="b3-button b3-button--outline" id="fld-lock-copy">${i18n.copyCode}</button>
    </div>
    <label class="fld-lock__recovery-confirm">
        <input type="checkbox" id="fld-lock-saved"> ${i18n.recoveryCodeSaved}
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--text" id="fld-lock-done" disabled>${i18n.done}</button>
</div>`,
            width: "480px",
            disableClose: true,
            hideCloseIcon: true,
        });
        const copyBtn = dialog.element.querySelector("#fld-lock-copy") as HTMLElement;
        const savedInput = dialog.element.querySelector("#fld-lock-saved") as HTMLInputElement;
        const doneBtn = dialog.element.querySelector("#fld-lock-done") as HTMLButtonElement;

        copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(code).then(() => showMessage(i18n.copied));
        });
        savedInput.addEventListener("change", () => {
            doneBtn.disabled = !savedInput.checked;
        });
        doneBtn.addEventListener("click", () => {
            dialog.destroy();
            resolve();
        });
    });
}

export function showRemoveLockDialog(i18n: any): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const dialog = new Dialog({
            title: i18n.removeLock,
            content: `<div class="b3-dialog__content" style="padding: 24px;">
    <div class="fld-lock__hint">${i18n.removeLockConfirm}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--warning" id="fld-lock-remove-btn">${i18n.removeLock}</button>
</div>`,
            width: "440px",
            destroyCallback: () => finish(false),
        });
        const removeBtn = dialog.element.querySelector("#fld-lock-remove-btn") as HTMLElement;
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLElement;
        removeBtn.addEventListener("click", () => {
            finish(true);
            dialog.destroy();
        });
        cancelBtn.addEventListener("click", () => {
            finish(false);
            dialog.destroy();
        });
    });
}
