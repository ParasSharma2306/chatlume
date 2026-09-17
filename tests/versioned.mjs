/**
 * Imports an app module under the current release token.
 *
 * App modules import each other as `./x.js?v=<version>`, and Node treats a
 * different query string as a different module instance. A test that imported
 * `state.js?v=1.6.1` by hand would silently stop sharing state with
 * `format.js` the moment the version was bumped — so tests go through here
 * and always match whatever `package.json` says.
 */
import { readFileSync } from "node:fs";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** @param {string} path  Relative to tests/, e.g. "../js/shared/text.js" */
export function versioned(path) {
    return import(new URL(`${path}?v=${VERSION}`, import.meta.url).href);
}
