/**
 * ============================================================================
 * Instagram media gallery
 * ============================================================================
 * Binds the shared gallery (shared/gallery.js) to the Instagram viewer: its
 * messages, media store, lightbox, Anonymize view and "Jump to message".
 * ============================================================================
 */
import { createGallery } from "../shared/gallery.js?v=1.10.0";
import { formatBytes } from "../shared/media-types.js?v=1.10.0";
import { releaseMediaUrlIfUnused } from "../shared/media-urls.js?v=1.10.0";
import { igState } from "./state.js?v=1.10.0";
import { display } from "./anonymize.js?v=1.10.0";
import { formatDateLabel, formatMessageTime } from "./format.js?v=1.10.0";
import { ensureMediaUrl, openMediaModal } from "./media.js?v=1.10.0";
import { jumpToMessage } from "./search.js?v=1.10.0";
import { showToast } from "./ui.js?v=1.10.0";

export const gallery = createGallery({
    prefix: "ig-gallery",
    viewportId: "ig-viewport",
    openerId: "ig-menu-toggle",
    overlayId: "ig-gallery",
    platform: "instagram",
    // No Links tab: almost every Instagram link is a shared reel or post, which
    // would bury the rest. Those stay in the chat as cards.
    tabs: ["media", "docs"],
    title: "Media and docs",
    describeSize: formatBytes,
    state: igState,
    display,
    getMessages: () => igState.filteredMessages,
    isFiltered: () => igState.selectedSenders.length > 0,
    getMedia: (id) => igState.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    releaseIfUnused: (media) => releaseMediaUrlIfUnused(igState, media),
    describeWhen: (item) => [
        formatDateLabel(item.message.ts, igState.settings),
        formatMessageTime(item.message.ts, igState.settings)
    ].filter(Boolean).join(" "),
    openLightbox: openMediaModal,
    jumpToMessage: (messageId) => {
        if (!jumpToMessage(messageId, { flash: true, focus: true })) showToast("That message isn't in the current view", "warn");
    },
    notify: showToast,
    howToExportHref: "how-to-export-instagram.html"
});
