/**
 * ============================================================================
 * Instagram anonymize view
 * ============================================================================
 * `display` is what every Instagram renderer passes names and text through:
 * the identity while Anonymize is off, the open thread's anonymizer (see
 * shared/anonymize.js) while it is on. Thread participants and reaction
 * actors are included, so someone who only ever reacted still gets a
 * placeholder. Free of render imports so any module can use it.
 * ============================================================================
 */
import { $ } from "../shared/dom.js?v=1.10.0";
import { createAnonymizeView } from "../shared/anonymize.js?v=1.10.0";
import { igState } from "./state.js?v=1.10.0";

export const display = createAnonymizeView(() => ({
    messages: igState.messages,
    participants: igState.participants,
    title: igState.chatTitle
}));

/** The thread title as shown in the header, sidebar, export and Wrapped. */
export const shownTitle = () => display.title(igState.chatTitle || "Instagram DMs");

/** Menu toggle, banner and body flag follow the mode and whether a thread is open. */
export function syncAnonymizeControls() {
    const on = display.isOn();
    $("ig-anonymize-toggle")?.setAttribute("aria-pressed", String(on));
    const banner = $("ig-anonymize-banner");
    if (banner) banner.hidden = !(on && igState.messageOnlyCount > 0);
    document.body.classList.toggle("is-anonymized", on);
}
