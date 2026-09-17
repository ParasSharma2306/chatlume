/**
 * ============================================================================
 * Browser capability checks
 * ============================================================================
 * Exports over 1 GB are only safe to open when the browser can stream ZIP
 * entries (DecompressionStream + WritableStream + TextDecoderStream). Older
 * browsers still work, but with a hard file-size cap and a banner saying so.
 * ============================================================================
 */

export const SUPPORTS_STREAMING =
    typeof DecompressionStream !== "undefined" &&
    typeof WritableStream !== "undefined" &&
    typeof TextDecoderStream !== "undefined";

/** 1 GB cap for browsers without the streaming APIs. */
export const COMPAT_FILE_SIZE_LIMIT = 1 * 1024 * 1024 * 1024;

const BROWSER_HINT = "Use Chrome 80+, Firefox 79+, or Safari 16.4+";

/** Shown when a picked or dropped file is over the cap. */
export const COMPAT_LIMIT_MESSAGE =
    `File exceeds the 1 GB limit for your browser. ${BROWSER_HINT} for larger files.`;

/** Shown when the user tries to *load* a file that is over the cap. */
export function fileTooLargeMessage(file) {
    return `File is too large for your browser (${(file.size / 1073741824).toFixed(1)} GB). ${BROWSER_HINT} for files over 1 GB.`;
}

/** True when this browser cannot open `file` without streaming support. */
export function exceedsCompatLimit(file) {
    return !SUPPORTS_STREAMING && file.size > COMPAT_FILE_SIZE_LIMIT;
}

/** Inserts the limited-support banner under the app nav on old browsers. */
export function showCompatBannerIfNeeded() {
    if (SUPPORTS_STREAMING) return;
    const nav = document.querySelector("nav.app-nav");
    const banner = document.createElement("div");
    banner.id = "compat-banner";
    banner.setAttribute("role", "alert");
    banner.style.cssText = "background:#7c5c00;color:#fef3c7;padding:8px 16px;font-size:13px;text-align:center;position:sticky;top:0;z-index:999;line-height:1.5";
    banner.textContent = `⚠️ Your browser has limited support. Files over 1 GB may not load. Please use Chrome 80+, Firefox 79+, or Safari 16.4+.`;
    if (nav?.parentNode) {
        nav.parentNode.insertBefore(banner, nav.nextSibling);
    } else {
        document.body.prepend(banner);
    }
}
