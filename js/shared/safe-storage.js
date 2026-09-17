/**
 * ============================================================================
 * localStorage, guarded
 * ============================================================================
 * Safari's private mode and "block all cookies" make every localStorage
 * access throw. An unguarded read during boot once took out the rest of
 * DOMContentLoaded, which left the splash loader on screen forever — the app
 * looked hung. Every read and write in the app goes through these wrappers so
 * a missing store degrades to "nothing remembered" instead of a crash.
 * ============================================================================
 */

/** Returns the stored string, or null when storage is unavailable. */
export function readStored(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

/** Returns true when the value was written. */
export function writeStored(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

export function removeStored(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        // Nothing to forget.
    }
}
