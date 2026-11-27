/**
 * ============================================================================
 * Media classification
 * ============================================================================
 * Maps an attachment's file name to the kind of card the viewer renders for
 * it (image, sticker, video, audio, document, archive, contact) and the MIME
 * type handed to the Blob that backs it. Pure functions — covered by
 * tests/shared.test.mjs.
 * ============================================================================
 */

/** Known voice-note / music extensions, checked before any MIME lookup. */
export const AUDIO_EXTENSIONS = new Set(["opus", "ogg", "oga", "mp3", "m4a", "aac", "wav", "flac", "wma", "amr"]);

const MIME_BY_EXTENSION = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    m4v: "video/x-m4v",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/ogg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    aac: "audio/aac",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    vcf: "text/vcard",
    zip: "application/zip"
};

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"];
const ARCHIVE_EXTENSIONS = ["zip", "rar", "7z"];
const CONTACT_EXTENSIONS = ["vcf"];

/** Best-guess MIME type for an extension; octet-stream when unknown. */
export function inferMimeType(ext) {
    return MIME_BY_EXTENSION[ext] || "application/octet-stream";
}

/**
 * The audio MIME type for a file that is known to be audio whatever its
 * extension says. Voice notes often come in a video container (.mp4, .3gp,
 * .webm); handed to the browser as video/mp4 they'd get a video player.
 */
export function audioMimeFor(ext) {
    if (AUDIO_EXTENSIONS.has(ext)) return MIME_BY_EXTENSION[ext] || `audio/${ext}`;
    return { mp4: "audio/mp4", m4v: "audio/mp4", "3gp": "audio/3gpp", "3gpp": "audio/3gpp", webm: "audio/webm", mov: "audio/mp4" }[ext] || "audio/mp4";
}

/**
 * WhatsApp's own names for audio: Android "PTT-20240101-WA0001" (voice note)
 * and "AUD-…" (audio file), iOS "00000012-AUDIO-2024-01-01-10-00-00". These
 * stay audio even when the container is .mp4 / .3gp / .webm.
 */
const WHATSAPP_AUDIO_NAME = /^(?:(?:PTT|AUD)-\d{8}-WA\d+|\d+-AUDIO-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.[a-z0-9]+$/i;

/**
 * @param {string}  fileName
 * @param {Object}  [options]
 * @param {string}  [options.mimeType]   Known MIME type, if the source has one.
 * @param {boolean} [options.stickers]   Treat .webp / "STK-" files as stickers
 *                                       (WhatsApp does; Instagram photos can be
 *                                       .webp and must stay images).
 * @param {string}  [options.hint]       What the source says the file is
 *                                       ("audio" for Instagram's `audio_files`).
 *                                       An audio hint wins over a video or
 *                                       unknown extension.
 * @returns {{ kind: string, mime: string, ext: string }}
 */
export function detectMediaType(fileName, { mimeType = "", stickers = true, hint = "" } = {}) {
    const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";

    // Explicit audio guard: known voice-note extensions are always audio,
    // regardless of MIME (e.g. m4a → audio/mp4 must never be treated as video).
    if (AUDIO_EXTENSIONS.has(ext)) {
        return { kind: "audio", mime: audioMimeFor(ext), ext };
    }

    const mime = mimeType || inferMimeType(ext);

    // The message says it's audio (Instagram voice notes are .mp4 in
    // `audio_files`), or the name is one WhatsApp only gives audio.
    if ((hint === "audio" || WHATSAPP_AUDIO_NAME.test(String(fileName || ""))) && !mime.startsWith("image/")) {
        return { kind: "audio", mime: mime.startsWith("audio/") ? mime : audioMimeFor(ext), ext };
    }

    if (mime.startsWith("image/")) {
        const isSticker = stickers && (/^sticker|webp$/i.test(ext) || /^stk-/i.test(fileName));
        return { kind: isSticker ? "sticker" : "image", mime, ext };
    }
    if (mime.startsWith("video/")) {
        return { kind: "video", mime, ext };
    }
    if (mime.startsWith("audio/")) {
        return { kind: "audio", mime, ext };
    }
    if (DOCUMENT_EXTENSIONS.includes(ext)) {
        return { kind: "document", mime, ext };
    }
    if (ARCHIVE_EXTENSIONS.includes(ext)) {
        return { kind: "archive", mime, ext };
    }
    if (CONTACT_EXTENSIONS.includes(ext)) {
        return { kind: "contact", mime, ext };
    }
    return { kind: "document", mime, ext };
}

const KIND_LABELS = {
    image: "Image",
    sticker: "Sticker",
    video: "Video",
    audio: "Audio",
    document: "Document",
    archive: "Archive",
    contact: "Contact"
};

/** Human label for a media kind, used in cards and the media viewer. */
export function labelForMediaKind(kind) {
    return KIND_LABELS[kind] || "File";
}

/** "1.5 MB", "12 KB", … Empty string for 0 so callers can supply a fallback. */
export function formatBytes(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Last path segment of a ZIP entry name. */
export function baseName(filePath) {
    return String(filePath || "").split("/").pop() || "";
}
