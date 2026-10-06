/**
 * ============================================================================
 * Instagram export parsing
 * ============================================================================
 * Reads the "Download Your Data" JSON archive: finds conversation folders,
 * indexes their media files, and turns `message_N.json` records into the
 * message objects the renderer consumes. Pure where possible — the folder
 * and message helpers are covered by tests/instagram.test.mjs.
 * ============================================================================
 */
import { countEmojis } from "../shared/emoji.js?v=1.8.4";
import { baseName, detectMediaType } from "../shared/media-types.js?v=1.8.4";
import { tailRange } from "../shared/virtual-list.js?v=1.8.4";
import { fixMojibake } from "./mojibake.js?v=1.8.4";
import { formatDateLabel, formatMessageTime } from "./format.js?v=1.8.4";
import { IG_MAX_RENDERED, igState } from "./state.js?v=1.8.4";

// ── Thread discovery ────────────────────────────────────────────────────────

/**
 * Groups `messages/inbox/<folder>/message_N.json` entries by folder.
 * @returns {Array<{ folder: string, files: Object[] }>}
 */
export function findThreads(entries) {
    const map = new Map();
    entries.forEach((entry) => {
        if (entry.directory) return;
        const m = entry.filename.match(/messages\/inbox\/([^/]+)\/(message_\d+\.json)$/i);
        if (!m) return;
        const folder = m[1];
        if (!map.has(folder)) map.set(folder, { folder, files: [] });
        map.get(folder).files.push(entry);
    });
    return Array.from(map.values());
}

/** Returns parsed JSON for a thread part, or null for a malformed/empty part. */
export function parseMessageFile(text) {
    try {
        const data = JSON.parse(String(text || ""));
        return data && typeof data === "object" && !Array.isArray(data) ? data : null;
    } catch {
        return null;
    }
}

/** "jane_doe_1234567890" → "jane doe": drops Instagram's numeric suffix. */
export function folderLabel(folder) {
    return folder.replace(/_[a-z0-9]{6,}$/i, "").replace(/_/g, " ").trim() || folder;
}

/** message_1.json, message_2.json, … in numeric order. */
export function sortMessageFiles(files) {
    const number = (entry) => parseInt(entry.filename.match(/message_(\d+)\.json$/i)?.[1] || "0", 10);
    return [...files].sort((a, b) => number(a) - number(b));
}

/** Returns valid messages in chronological order, with stable ties. */
export function sortMessagesChronologically(messages) {
    return messages
        .filter((message) => message && typeof message === "object")
        .map((message, index) => ({ message, index, ts: Number(message.timestamp_ms) || 0 }))
        .sort((a, b) => a.ts - b.ts || a.index - b.index)
        .map(({ message }) => message);
}

/** Up to two initials for the avatar circle. */
export function initialsFor(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Media store ─────────────────────────────────────────────────────────────

/** Lookup key for a media URI or ZIP path. */
export function normalizeKey(path) {
    return String(path || "").trim().toLowerCase().replace(/\\/g, "/");
}

/** Registers every non-JSON entry in the ZIP as a media record. */
export function buildMediaStore(entries) {
    let index = 0;
    entries.forEach((entry) => {
        if (entry.directory || entry.filename.toLowerCase().endsWith(".json")) return;

        const name = baseName(entry.filename);
        // Instagram photos can be .webp; they must stay images, not stickers.
        const mediaType = detectMediaType(name, { stickers: false });
        const id = `igm-${index++}-${normalizeKey(entry.filename).slice(-20)}`;
        const media = {
            id,
            name,
            path: entry.filename,
            kind: mediaType.kind,
            mime: mediaType.mime,
            entry,
            url: "",
            loadingPromise: null,
            hasLoaded: false
        };

        igState.mediaStore.set(id, media);
        [normalizeKey(entry.filename), normalizeKey(name)].forEach((key) => {
            if (key && !igState.mediaLookup.has(key)) igState.mediaLookup.set(key, media);
        });
    });
}

/** Finds the record for a message's media URI, trying looser keys in turn. */
export function findMedia(uri) {
    if (!uri) return null;
    const candidates = [
        normalizeKey(uri),
        normalizeKey(baseName(uri)),
        normalizeKey(uri.replace(/^[^/]*\/[^/]*\/[^/]*\/[^/]*\//, "")) // strip 4 leading path segments
    ].filter(Boolean);

    for (const key of candidates) {
        const media = igState.mediaLookup.get(key);
        if (media) return media;
    }
    return null;
}

// ── Messages ────────────────────────────────────────────────────────────────

/** "10:42 PM" in the browser's locale. */
export function formatTime(date) {
    return formatMessageTime(date.getTime(), igState.settings);
}

/**
 * Converts Instagram's raw message records (oldest first) into
 * `igState.messages`, inserting a day marker whenever the date changes, and
 * updates the analytics tallies.
 */
export function parseMessages(rawMessages) {
    if (!Array.isArray(rawMessages)) rawMessages = [];
    let lastDateStr = "";
    let idx = 0;

    rawMessages.forEach((raw) => {
        if (!raw || typeof raw !== "object") return;
        const parsedTimestamp = Number(raw.timestamp_ms);
        const ts = Number.isFinite(parsedTimestamp) && parsedTimestamp >= 0 ? parsedTimestamp : 0;
        const date = new Date(ts);
        const dateStr = formatDateLabel(ts, igState.settings);

        const sender = fixMojibake(String(raw.sender_name || "Unknown"));
        const isMe = sender.toLowerCase() === igState.myName.toLowerCase();
        const content = typeof raw.content === "string" && raw.content ? fixMojibake(raw.content) : "";
        const shareLink = raw.share?.link || null;
        const shareText = raw.share?.share_text ? fixMojibake(raw.share.share_text) : null;
        const reactions = (Array.isArray(raw.reactions) ? raw.reactions : []).map((r) => ({
            reaction: fixMojibake(String(r?.reaction || "")),
            actor: fixMojibake(String(r?.actor || ""))
        })).filter((reaction) => reaction.reaction);

        const mediaItems = [];
        const addMediaItem = (uri, kindHint) => {
            const media = findMedia(uri);
            const name = baseName(uri || kindHint);
            if (media) {
                mediaItems.push({ id: media.id, status: "available", name: media.name, kind: media.kind, mime: media.mime });
            } else {
                mediaItems.push({ id: `igmiss-${idx}-${mediaItems.length}`, status: "missing", name, kind: kindHint });
            }
        };

        (Array.isArray(raw.photos) ? raw.photos : []).forEach((p) => addMediaItem(p?.uri, "image"));
        (Array.isArray(raw.videos) ? raw.videos : []).forEach((v) => addMediaItem(v?.uri, "video"));
        (Array.isArray(raw.audio_files) ? raw.audio_files : []).forEach((a) => addMediaItem(a?.uri, "audio"));
        (Array.isArray(raw.gifs) ? raw.gifs : []).forEach((g) => addMediaItem(g?.uri, "image"));
        if (raw.sticker?.uri) addMediaItem(raw.sticker.uri, "sticker");
        (Array.isArray(raw.files) ? raw.files : []).forEach((file) => {
            const uri = typeof file === "string" ? file : file?.uri || file?.file_name || "";
            if (uri) addMediaItem(uri, detectMediaType(baseName(uri), { stickers: false }).kind);
        });

        // Skip truly empty/unsupported messages (no text, media, share, or reactions)
        if (!content.trim() && !mediaItems.length && !shareLink && !reactions.length) {
            idx++;
            return;
        }

        if (dateStr !== lastDateStr) {
            igState.messages.push({ type: "date", id: `igd-${idx}`, content: dateStr, ts });
            lastDateStr = dateStr;
        }

        igState.senderStats[sender] = (igState.senderStats[sender] || 0) + 1;
        igState.hourlyStats[date.getHours()] += 1;
        if (content) countEmojis(content, igState.emojiStats);
        igState.messageOnlyCount++;
        igState.mediaCount += mediaItems.length;
        igState.mediaMissingCount += mediaItems.filter((item) => item.status === "missing").length;

        igState.messages.push({
            type: "msg",
            id: `igmsg-${idx}`,
            ts,
            time: formatTime(date),
            sender,
            isMe,
            text: content,
            mediaItems,
            reactions,
            shareLink,
            shareText
        });

        idx++;
    });

    igState.filteredMessages = igState.messages;
    igState.renderRange = tailRange(igState.filteredMessages.length, IG_MAX_RENDERED);
}
