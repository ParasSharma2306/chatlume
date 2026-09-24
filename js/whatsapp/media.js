/**
 * ============================================================================
 * WhatsApp attachments
 * ============================================================================
 * Builds the media store from the ZIP's entries, matches the file names a
 * chat references against it, and owns the two media widgets — the lazy
 * loader that decodes attachments as they scroll into view and the
 * full-screen media viewer.
 *
 * Matching is name-based: WhatsApp writes `<attached: IMG-….jpg>` (or a
 * bare file name) in the chat and ships the file alongside. Both sides are
 * normalised with the same key (see attachmentLookupKey) so RTL marks,
 * NFC/NFD spellings and case never keep a file from being found.
 * ============================================================================
 */
import { attachmentLookupKey } from "../whatsapp-parser.js?v=1.7.1";
import { baseName, detectMediaType, formatBytes, labelForMediaKind } from "../shared/media-types.js?v=1.7.1";
import { createLazyMediaLoader } from "../shared/lazy-media.js?v=1.7.1";
import { createMediaModal } from "../shared/media-modal.js?v=1.7.1";
import {
    clearMediaStore,
    downloadMediaItem,
    ensureMediaUrl as ensureUrl,
    releaseMediaUrlIfUnused
} from "../shared/media-urls.js?v=1.7.1";
import { state } from "./state.js?v=1.7.1";
import { showToast } from "./ui.js?v=1.7.1";

/** Decodes an attachment (once) and returns its blob URL. */
export const ensureMediaUrl = (media) => ensureUrl(state, media);

export const lazyMedia = createLazyMediaLoader({
    rootId: "viewport",
    getMedia: (id) => state.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    onDetached: (media) => releaseMediaUrlIfUnused(state, media)
});

export const mediaModal = createMediaModal({
    state,
    ids: { modal: "media-modal", body: "media-modal-body", subtitle: "media-modal-subtitle", download: "media-download-link" },
    overlayId: "media",
    getMedia: (id) => state.mediaStore.get(id),
    ensureUrl: ensureMediaUrl,
    subtitleFor: (media) => `${labelForMediaKind(media.kind)} • ${media.name}`,
    documentNoteFor: (media) => `${labelForMediaKind(media.kind)}${media.size ? ` • ${formatBytes(media.size)}` : ""}`,
    onClosed: (media) => releaseMediaUrlIfUnused(state, media)
});

export const openMediaModal = mediaModal.open;
export const closeMediaModal = mediaModal.close;

// Applied to both the ZIP entry names and the names referenced in the chat,
// so the two sides always meet on equal terms (see attachmentLookupKey).
export function normalizeLookupKey(value) {
    return attachmentLookupKey(value);
}

/** "attached_IMG.jpg" / "file-IMG.jpg" → "IMG.jpg". */
export function stripAttachmentPrefix(value) {
    return String(value || "")
        .replace(/^attached[_\s-]*/i, "")
        .replace(/^file[_\s-]*/i, "")
        .trim();
}

/**
 * Registers every non-chat ZIP entry as a media record, indexed under each
 * spelling the chat might use for it.
 *
 * @param {Array<{ name: string, path: string, entry: Object, size: number }>} attachments
 */
export function buildMediaStore(attachments) {
    attachments.forEach((attachment, index) => {
        const fileName = attachment.name;
        const mediaType = detectMediaType(fileName);
        const id = `media-${index}-${normalizeLookupKey(fileName)}`;

        const media = {
            id,
            name: fileName,
            path: attachment.path,
            kind: mediaType.kind,
            mime: mediaType.mime,
            ext: mediaType.ext,
            size: attachment.size || 0,
            entry: attachment.entry || null,
            url: "",
            loadingPromise: null,
            hasLoaded: false
        };

        state.mediaStore.set(id, media);

        const keys = new Set([
            normalizeLookupKey(fileName),
            normalizeLookupKey(attachment.path),
            normalizeLookupKey(stripAttachmentPrefix(fileName))
        ]);

        keys.forEach((key) => {
            if (key && !state.mediaLookup.has(key)) {
                state.mediaLookup.set(key, media);
            }
        });
    });
}

/** Finds the media record a chat line refers to, trying looser keys in turn. */
export function findMediaByName(fileName) {
    const candidates = [
        normalizeLookupKey(fileName),
        normalizeLookupKey(stripAttachmentPrefix(fileName)),
        normalizeLookupKey(baseName(fileName))
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (state.mediaLookup.has(candidate)) {
            return state.mediaLookup.get(candidate);
        }
    }

    return null;
}

/** The media item stored on a message for a referenced file name. */
export function resolveAttachment(fileName) {
    const media = findMediaByName(fileName);
    if (!media) {
        return createMissingMediaItem(fileName);
    }

    return {
        id: media.id,
        status: "available",
        name: media.name,
        kind: media.kind,
        mime: media.mime,
        size: media.size,
        url: media.url
    };
}

/** Placeholder for an attachment the chat mentions but the export lacks. */
export function createMissingMediaItem(fileName) {
    return {
        id: `missing-${normalizeLookupKey(fileName)}-${Math.random().toString(36).slice(2, 8)}`,
        status: "missing",
        name: fileName,
        kind: "missing",
        mime: "",
        size: 0,
        url: ""
    };
}

export async function downloadMedia(mediaId) {
    const media = state.mediaStore.get(mediaId);
    if (!media) return;

    try {
        await downloadMediaItem(state, media);
    } catch (error) {
        console.error(error);
        showToast("Unable to download media", "error");
    }
}

/** Forgets every attachment, closes the ZIP and the media viewer. */
export function cleanupMediaStore() {
    clearMediaStore(state);
    if (state.zipReader) {
        state.zipReader.close().catch(() => {});
        state.zipReader = null;
    }
    lazyMedia.disconnect();
    closeMediaModal();
}

/** Media list clicks: "Download" buttons and anything that opens the viewer. */
export async function handleMessageListClick(event) {
    const downloadTrigger = event.target.closest("[data-download-media]");
    if (downloadTrigger) {
        await downloadMedia(downloadTrigger.dataset.downloadMedia);
        return;
    }

    const mediaTrigger = event.target.closest("[data-open-media]");
    if (mediaTrigger) {
        await openMediaModal(mediaTrigger.dataset.openMedia);
    }
}
