/**
 * ============================================================================
 * Confirmation sheet
 * ============================================================================
 * Native confirm() blocks the page and looks nothing like the app, so both
 * viewers ask through a sheet bound by element-id prefix:
 * `<prefix>`, `<prefix>-title`, `<prefix>-body`, `<prefix>-cancel`, `<prefix>-apply`.
 * ============================================================================
 */
import { $ } from "./dom.js?v=1.8.7";
import { pushOverlayState } from "./history.js?v=1.8.7";

export function createConfirmSheet(prefix, overlayId) {
    let resolver = null;

    /** Resolves true when the user confirms, false on cancel / Back / Escape. */
    function ask({ title, body, confirmLabel = "Delete" }) {
        const sheet = $(prefix);
        if (!sheet) return Promise.resolve(false);

        settle(false);
        const titleEl = $(`${prefix}-title`);
        const bodyEl = $(`${prefix}-body`);
        const applyEl = $(`${prefix}-apply`);
        if (titleEl) titleEl.textContent = title;
        if (bodyEl) bodyEl.textContent = body;
        if (applyEl) applyEl.textContent = confirmLabel;

        sheet.hidden = false;
        requestAnimationFrame(() => {
            sheet.classList.add("open");
            $(`${prefix}-cancel`)?.focus({ preventScroll: true });
        });
        pushOverlayState(overlayId);

        return new Promise((resolve) => {
            resolver = resolve;
        });
    }

    function settle(result, { fromHistory = false } = {}) {
        const sheet = $(prefix);
        if (!sheet || sheet.hidden || !sheet.classList.contains("open")) return;

        sheet.classList.remove("open");
        window.setTimeout(() => {
            if (!sheet.classList.contains("open")) sheet.hidden = true;
        }, 160);

        const resolve = resolver;
        resolver = null;
        resolve?.(result);

        if (!fromHistory && history.state?.overlay === overlayId) history.back();
    }

    return { ask, settle };
}
