/**
 * ============================================================================
 * Light / dark theme
 * ============================================================================
 * Both viewers share one preference ("chatlume-theme" in localStorage, also
 * read by the static pages' site.js) and the same three effects: the
 * `light-theme` body class, the toggle button's icon, and the browser's
 * theme-color meta tag. Only the toggle button differs per page, so the
 * controller takes its icon selector.
 * ============================================================================
 */
import { q } from "./dom.js?v=1.7.3";
import { readStored, writeStored } from "./safe-storage.js?v=1.7.3";

export const THEME_STORAGE_KEY = "chatlume-theme";

/** Values for <meta name="theme-color"> so the browser chrome matches. */
const THEME_COLORS = { light: "#f0f2f5", dark: "#111b21" };

/**
 * @param {Object} options
 * @param {string} options.iconSelector  The <i> inside the theme toggle button.
 */
export function createThemeController({ iconSelector }) {
    let activeTheme = "dark";

    function syncButton() {
        const icon = q(iconSelector);
        const themeColor = q('meta[name="theme-color"]');
        if (icon) {
            icon.className = activeTheme === "light" ? "ph ph-sun-dim" : "ph ph-moon-stars";
        }
        if (themeColor) {
            themeColor.setAttribute("content", THEME_COLORS[activeTheme]);
        }
    }

    /** Applies the saved preference. Defaults to dark. */
    function applySaved() {
        activeTheme = readStored(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
        document.body.classList.toggle("light-theme", activeTheme === "light");
        syncButton();
    }

    function toggle() {
        document.body.classList.toggle("light-theme");
        activeTheme = document.body.classList.contains("light-theme") ? "light" : "dark";
        writeStored(THEME_STORAGE_KEY, activeTheme);
        syncButton();
    }

    return {
        applySaved,
        toggle,
        get current() { return activeTheme; }
    };
}
