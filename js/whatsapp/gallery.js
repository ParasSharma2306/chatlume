/**
 * ============================================================================
 * WhatsApp media gallery
 * ============================================================================
 * Binds the shared gallery (shared/gallery.js) to the WhatsApp viewer: its
 * messages, media store, lightbox, Anonymize view and "Jump to message".
 * ============================================================================
 */
import { createGallery } from "../shared/gallery.js?v=1.10.0";
import { formatBytes } from "../shared/media-types.js?v=1.10.0";
import { releaseMediaUrlIfUnused } from "../shared/media-urls.js?v=1.10.0";
import { state } from "./state.js?v=1.10.0";
import { display } from "./anonymize.js?v=1.10.0";
import { formatDateLabel, formatMessageTime } from "./format.js?v=1.10.0";
import { ensureMediaUrl, openMediaModal } from "./media.js?v=1.10.0";
import { jumpToMessage } from "./search.js?v=1.10.0";
import { showToast } from "./ui.js?v=1.10.0";

export const gallery = createGallery({
    prefix: "gallery",
    viewportId: "viewport",
    openerId: "menu-toggle",
    overlayId: "gallery",
    platform: "whatsapp",
    // As in WhatsApp itself: "Media, links and docs".
    tabs: ["media", "links", "docs"],
    title: "Media, links and docs",
    describeSize: formatBytes,
    state,
    display,
    getMessages: () => state.filteredMessages,
    isFiltered: () => state.selectedSenders.length > 0,
    getMedia: (id) => state.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    releaseIfUnused: (media) => releaseMediaUrlIfUnused(state, media),
    // WhatsApp messages carry a time of day; the date is the marker above them.
    describeWhen: (item) => [
        item.day ? formatDateLabel(item.day.rawDate || item.day.content) : "",
        formatMessageTime(item.message.rawTime || item.message.time)
    ].filter(Boolean).join(" "),
    openLightbox: openMediaModal,
    jumpToMessage: (messageId) => {
        if (!jumpToMessage(messageId, { flash: true, focus: true })) showToast("That message isn't in the current view", "warn");
    },
    notify: showToast,
    howToExportHref: "how-to-export.html"
});
