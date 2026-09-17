/**
 * ============================================================================
 * Blob URL lifecycle for ZIP-backed media
 * ============================================================================
 * Attachments are never extracted up front. Each media record keeps a zip.js
 * entry and gets a blob URL only when it scrolls into view; the URL is
 * revoked again once it leaves the render window. Every decoded photo and
 * video otherwise stayed resident for the life of the tab, so a long chat
 * grew until the browser killed it. Re-entering the window re-decodes the
 * entry from the ZIP, which is cheap next to holding it all in memory.
 *
 * All functions take the viewer `state`, which must carry:
 *   mediaStore   Map<id, media>     media = { id, entry, mime, url, loadingPromise, hasLoaded, size? }
 *   mediaLookup  Map<key, media>
 *   mediaUrls    Set<string>        every live blob URL, for bulk revocation
 *   activeMediaId                   media open in the full-screen viewer
 *   renderRange / filteredMessages  the virtual window (see virtual-list.js)
 * ============================================================================
 */
import { BlobWriter } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";

/** Decodes the entry (once) and returns its blob URL. */
export async function ensureMediaUrl(state, media) {
    if (!media) {
        throw new Error("Media not found");
    }
    if (media.url) {
        return media.url;
    }
    if (media.loadingPromise) {
        return media.loadingPromise;
    }
    if (!media.entry) {
        throw new Error("Media source is unavailable");
    }

    media.loadingPromise = media.entry
        .getData(new BlobWriter(media.mime || "application/octet-stream"))
        .then((blob) => {
            media.size = media.size || blob.size;
            const objectUrl = URL.createObjectURL(blob);
            media.url = objectUrl;
            state.mediaUrls.add(objectUrl);
            return objectUrl;
        })
        .finally(() => {
            media.loadingPromise = null;
        });

    return media.loadingPromise;
}

export function releaseMediaUrl(state, media) {
    if (!media?.url) return;
    URL.revokeObjectURL(media.url);
    state.mediaUrls.delete(media.url);
    media.url = "";
    media.hasLoaded = false;
}

/** Whether any message inside the current render window shows this media. */
export function isMediaInRenderRange(state, mediaId) {
    for (let index = state.renderRange.start; index < state.renderRange.end; index += 1) {
        const item = state.filteredMessages[index];
        if (item?.type === "msg" && (item.mediaItems || []).some((mediaItem) => mediaItem.id === mediaId)) {
            return true;
        }
    }
    return false;
}

/** Revokes a blob URL unless it is on screen or open in the media viewer. */
export function releaseMediaUrlIfUnused(state, media) {
    if (!media || media.id === state.activeMediaId || isMediaInRenderRange(state, media.id)) return;
    releaseMediaUrl(state, media);
}

/** Revokes every blob URL that is neither in the render window nor open. */
export function releaseOffscreenMediaUrls(state) {
    const visibleMediaIds = new Set();
    for (let index = state.renderRange.start; index < state.renderRange.end; index += 1) {
        const item = state.filteredMessages[index];
        if (item?.type !== "msg") continue;
        (item.mediaItems || []).forEach((mediaItem) => {
            if (mediaItem.status === "available") {
                visibleMediaIds.add(mediaItem.id);
            }
        });
    }

    state.mediaStore.forEach((media) => {
        if (media.id !== state.activeMediaId && !visibleMediaIds.has(media.id)) {
            releaseMediaUrl(state, media);
        }
    });
}

/** Drops every blob URL and forgets the media records. Closes nothing else. */
export function clearMediaStore(state) {
    state.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    state.mediaUrls.clear();
    state.mediaStore.clear();
    state.mediaLookup.clear();
}

/** Triggers a browser download of one media item. */
export async function downloadMediaItem(state, media) {
    const url = await ensureMediaUrl(state, media);
    const link = document.createElement("a");
    link.href = url;
    link.download = media.name;
    link.click();
    // Downloading an off-screen attachment otherwise kept its blob resident
    // for the rest of the session; the render window never claims it back.
    window.setTimeout(() => releaseMediaUrlIfUnused(state, media), 1000);
}
