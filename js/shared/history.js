/**
 * ============================================================================
 * Overlay history entries
 * ============================================================================
 * Every overlay (drawer, sheet, modal) pushes a history entry when it opens so
 * the hardware/browser Back button closes it instead of leaving the page.
 * Each viewer listens to `popstate` and closes whatever is open.
 * ============================================================================
 */

/** Pushes an entry for `overlayId` unless that overlay is already on top. */
export function pushOverlayState(overlayId) {
    if (history.state && history.state.overlay === overlayId) return;
    history.pushState({ overlay: overlayId }, "");
}

/**
 * The overlay the history entry we just landed on belongs to. Back only closes
 * what sits above it: closing everything also took down the drawer underneath
 * a modal, leaving that drawer's entry behind to swallow the next Back press.
 */
export const overlayOf = (popstateEvent) => popstateEvent.state?.overlay || "";

/**
 * Pops the overlay entry when an overlay is closed by a user gesture (rather
 * than by Back itself). Closing directly used to leave a dead entry that
 * swallowed the next Back press.
 */
export function popOverlayState() {
    if (history.state && history.state.overlay) history.back();
}
