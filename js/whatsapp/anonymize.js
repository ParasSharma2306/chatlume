/**
 * ============================================================================
 * WhatsApp anonymize view
 * ============================================================================
 * `display` is what every WhatsApp renderer passes names and text through:
 * the identity while Anonymize is off, the open chat's anonymizer (see
 * shared/anonymize.js) while it is on. Kept free of render imports so any
 * module — render, search, filter, export — can use it without a cycle.
 * ============================================================================
 */
import { $ } from "../shared/dom.js?v=1.10.1";
import { createAnonymizeView } from "../shared/anonymize.js?v=1.10.1";
import { state } from "./state.js?v=1.10.1";

export const display = createAnonymizeView(() => ({
    messages: state.messages,
    title: state.chatTitle
}));

/** The chat title as shown in the header, sidebar, export and Wrapped. */
export const shownTitle = () => display.title(state.chatTitle || "Chat History");

/** Menu toggle, banner and body flag follow the mode and whether a chat is open. */
export function syncAnonymizeControls() {
    const on = display.isOn();
    $("anonymize-toggle")?.setAttribute("aria-pressed", String(on));
    const banner = $("anonymize-banner");
    if (banner) banner.hidden = !(on && state.messageOnlyCount > 0);
    document.body.classList.toggle("is-anonymized", on);
}
