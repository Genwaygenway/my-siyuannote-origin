export type NewPasswordValidationError = "required" | "mismatch";

export function validateNewPassword(password: string, confirmation: string): NewPasswordValidationError | null {
    if (!password) {
        return "required";
    }
    if (password !== confirmation) {
        return "mismatch";
    }
    return null;
}
