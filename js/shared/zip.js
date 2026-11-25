/**
 * ============================================================================
 * zip.js loader
 * ============================================================================
 * Loads the ZIP library on demand, so neither viewer's boot depends on the CDN
 * (a static import that failed left the splash screen up forever). The version
 * is pinned: the service worker caches this exact URL for offline use.
 * ============================================================================
 */
export const ZIP_JS_URL = "https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.25.0/+esm";

let zipPromise = null;

export function loadZip() {
    if (!zipPromise) {
        zipPromise = import(ZIP_JS_URL)
            .then((api) => {
                api.configure({ useDecompressionStream: typeof DecompressionStream !== "undefined" });
                return api;
            })
            .catch((error) => {
                zipPromise = null; // allow a retry once the network is back
                console.error(error);
                throw new Error("The ZIP reader couldn't be loaded. Check your connection and try again.");
            });
    }
    return zipPromise;
}
