/**
 * ============================================================================
 * Toast notifications
 * ============================================================================
 * One toast element per page; the factory binds to it by id so each viewer
 * gets a `showToast(message, tone)` with its own timer.
 *
 * Tones: "success" (default), "error", "warn", "info" — mapped to `is-*`
 * classes in the stylesheet.
 * ============================================================================
 */
import { $ } from "./dom.js?v=1.7.3";

/** Errors carry more text than a confirmation, so give them longer to read. */
const TOAST_MS = { default: 2200, error: 4200 };

export function createToast(elementId) {
    let timer = null;

    return function showToast(message, tone = "success") {
        const toast = $(elementId);
        if (!toast) return;

        toast.innerText = message;
        toast.classList.remove("is-error", "is-warn", "is-info");
        if (tone !== "success") {
            toast.classList.add(`is-${tone}`);
        }
        toast.classList.add("show");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            toast.classList.remove("show");
        }, tone === "error" ? TOAST_MS.error : TOAST_MS.default);
    };
}
