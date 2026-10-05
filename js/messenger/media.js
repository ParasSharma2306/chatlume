/**
 * Messenger ZIP media lifecycle. All decoding is local and deferred until an
 * attachment approaches the viewport, using ChatLume's shared helpers.
 */
import { createLazyMediaLoader } from "../shared/lazy-media.js?v=1.9.0-beta1";
import { createMediaModal } from "../shared/media-modal.js?v=1.9.0-beta1";
import { clearMediaStore, downloadMediaItem, ensureMediaUrl as ensureUrl, releaseMediaUrlIfUnused } from "../shared/media-urls.js?v=1.9.0-beta1";
import { messengerState } from "./state.js?v=1.9.0-beta1";

export const ensureMediaUrl = (media) => ensureUrl(messengerState, media);
export const lazyMedia = createLazyMediaLoader({
    rootId: "messenger-viewport",
    getMedia: (id) => messengerState.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    onDetached: (media) => releaseMediaUrlIfUnused(messengerState, media)
});
export const mediaModal = createMediaModal({
    state: messengerState,
    ids: { modal: "messenger-media-modal", body: "messenger-media-modal-body", subtitle: "messenger-media-modal-subtitle", download: "messenger-media-download-link" },
    overlayId: "messenger-media",
    getMedia: (id) => messengerState.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    subtitleFor: (media) => media.name,
    documentNoteFor: () => "This file type can't be previewed in the browser.",
    onClosed: (media) => releaseMediaUrlIfUnused(messengerState, media)
});

export async function handleMediaClick(event) {
    const id = event.target.closest("[data-open-media]")?.dataset.openMedia;
    if (id) await mediaModal.open(id);
    const downloadId = event.target.closest("[data-download-media]")?.dataset.downloadMedia;
    if (downloadId) {
        const media = messengerState.mediaStore.get(downloadId);
        if (media) await downloadMediaItem(messengerState, media);
    }
}

export function cleanupMedia() {
    clearMediaStore(messengerState);
    lazyMedia.disconnect();
    mediaModal.close();
    messengerState.zipEntries = [];
    messengerState.zipReader?.close().catch(() => {});
    messengerState.zipReader = null;
}
