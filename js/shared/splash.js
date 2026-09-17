/**
 * ============================================================================
 * Splash loader
 * ============================================================================
 * The full-screen logo shown while the page boots. Fills its progress bar,
 * fades out, then removes itself from layout. Identical on both viewers.
 * ============================================================================
 */
import { $, q } from "./dom.js?v=1.6.2";

export function runSplashLoader() {
    const loader = $("loader");
    const bar = q(".fill");

    if (bar) {
        window.setTimeout(() => {
            bar.style.width = "100%";
        }, 100);
    }

    if (loader) {
        window.setTimeout(() => {
            loader.style.opacity = "0";
            window.setTimeout(() => {
                loader.style.display = "none";
            }, 500);
        }, 800);
    }
}
