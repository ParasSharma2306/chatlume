/**
 * ============================================================================
 * Instagram media
 * ============================================================================
 * Lazy loading, the full-screen media viewer and downloads for attachments
 * read out of the export ZIP. The store itself is built in parser.js.
 * ============================================================================
 */
import { createLazyMediaLoader } from "../shared/lazy-media.js?v=1.7.3";
import { createMediaModal } from "../shared/media-modal.js?v=1.7.3";
import {
    clearMediaStore,
    downloadMediaItem,
    ensureMediaUrl as ensureUrl,
    releaseMediaUrlIfUnused
} from "../shared/media-urls.js?v=1.7.3";
import { igState } from "./state.js?v=1.7.3";
import { showToast } from "./ui.js?v=1.7.3";

export const ensureMediaUrl = (media) => ensureUrl(igState, media);

export const lazyMedia = createLazyMediaLoader({
    rootId: "ig-viewport",
    getMedia: (id) => igState.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    onDetached: (media) => releaseMediaUrlIfUnused(igState, media)
});

export const mediaModal = createMediaModal({
    state: igState,
    ids: { modal: "ig-media-modal", body: "ig-media-modal-body", subtitle: "ig-media-modal-subtitle", download: "ig-media-download-link" },
    overlayId: "igmedia",
    getMedia: (id) => igState.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    subtitleFor: (media) => media.name,
    documentNoteFor: () => "This file type can't be previewed in the browser.",
    onClosed: (media) => releaseMediaUrlIfUnused(igState, media)
});

export const openMediaModal = mediaModal.open;
export const closeMediaModal = mediaModal.close;

export async function downloadMedia(id) {
    const media = igState.mediaStore.get(id);
    if (!media) return;
    try {
        await downloadMediaItem(igState, media);
    } catch {
        showToast("Unable to download media", "error");
    }
}

/**
 * Closes the open ZIP and releases every blob decoded out of it. A second
 * ZIP in the same session used to leave the previous reader open and every
 * decoded attachment resident, so re-picking a file grew memory without
 * bound and held a lock on the old blob.
 */
export function cleanupZip() {
    clearMediaStore(igState);
    igState.zipEntries = [];
    if (igState.zipReader) {
        igState.zipReader.close().catch(() => {});
        igState.zipReader = null;
    }
    lazyMedia.disconnect();
    closeMediaModal();
}

/** Media list clicks: "Download" buttons and anything that opens the viewer. */
export async function handleMessageListClick(event) {
    const download = event.target.closest("[data-download-media]");
    if (download) {
        await downloadMedia(download.dataset.downloadMedia);
        return;
    }
    const open = event.target.closest("[data-open-media]");
    if (open) await openMediaModal(open.dataset.openMedia);
}
