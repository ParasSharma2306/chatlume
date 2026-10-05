/**
 * Facebook Messenger HTML export parser.
 * Discovery, timestamp handling and DOM selectors are kept isolated here so
 * the undocumented export markup can be revised without changing rendering.
 */
import { baseName, detectMediaType } from "../shared/media-types.js?v=1.9.0-beta1";

const MESSAGE_FILE = /(^|\/)message_(\d+)\.html$/i;
const OLD_BLOCK = "div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder";
const NEW_BLOCK = "._a6-g";
const ATTACHMENT_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "mp4", "mov", "avi", "m4v", "webm",
    "opus", "ogg", "oga", "mp3", "m4a", "aac", "wav", "flac", "wma", "amr", "pdf", "doc", "docx",
    "xls", "xlsx", "ppt", "pptx", "txt", "vcf", "zip", "rar", "7z"
]);

export function findThreads(entries) {
    const threads = new Map();
    for (const entry of entries || []) {
        if (entry.directory) continue;
        const filename = String(entry.filename || "").replace(/\\/g, "/");
        const match = filename.match(MESSAGE_FILE);
        if (!match) continue;
        const folder = filename.slice(0, filename.lastIndexOf("/"));
        if (!folder) continue;
        if (!threads.has(folder)) threads.set(folder, { folder, files: [] });
        threads.get(folder).files.push(entry);
    }
    return [...threads.values()].map((thread) => ({
        ...thread,
        files: sortMessageFiles(thread.files)
    })).sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: "base" }));
}

export function sortMessageFiles(files) {
    const number = (entry) => Number(String(entry.filename).replace(/\\/g, "/").match(/message_(\d+)\.html$/i)?.[1] || 0);
    return [...files].sort((a, b) => number(a) - number(b) || String(a.filename).localeCompare(String(b.filename)));
}

export function folderLabel(folder) {
    const name = String(folder || "").split(/[\\/]/).filter(Boolean).pop() || "Facebook Messenger conversation";
    return name.replace(/_\d{5,}$/, "").replace(/[_-]+/g, " ").trim() || name;
}

/**
 * Parse observed wall-clock strings without inventing an offset. `ts` is null
 * because these formats provide no timezone; `sortKey` is a deterministic
 * local-calendar comparison key and never represents UTC. Numeric slash dates
 * follow the observed MM/DD/YYYY example; this locale assumption is surfaced
 * in the viewer because the HTML timestamp itself does not declare a locale.
 */
export function parseMessengerTimestamp(rawValue) {
    const rawTime = String(rawValue || "").trim();
    if (!rawTime) return { rawTime, ts: null, dateKey: "", time: "", sortKey: "" };
    let parts = null;
    let match = rawTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (match) {
        parts = { year: +match[3], month: +match[1], day: +match[2], hour: +match[4], minute: +match[5], ampm: match[6] };
    } else {
        match = rawTime.match(/^(?:(\d{1,2})\s+([A-Za-z]+)|(\w+)\s+(\d{1,2})),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
        if (match) {
            const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
            const monthWord = (match[2] || match[3] || "").slice(0, 3).toLowerCase();
            parts = {
                year: +match[5], month: months[monthWord], day: +(match[1] || match[4]),
                hour: +match[6], minute: +match[7], ampm: match[8]
            };
        }
    }
    if (!parts || !Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) {
        return { rawTime, ts: null, dateKey: "", time: "", sortKey: "" };
    }
    let { year, month, day, hour, minute } = parts;
    if (parts.ampm) {
        const pm = parts.ampm.toUpperCase() === "PM";
        if (hour < 1 || hour > 12) return { rawTime, ts: null, dateKey: "", time: "", sortKey: "" };
        hour = (hour % 12) + (pm ? 12 : 0);
    }
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1] || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return { rawTime, ts: null, dateKey: "", time: "", sortKey: "" };
    }
    const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { rawTime, ts: null, dateKey, time, sortKey: `${dateKey}T${time}` };
}

export function formatDateLabel(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Convert HTML line breaks and block boundaries into readable plain text. */
export function nodeText(node) {
    if (!node) return "";
    const walk = (current) => {
        if (current.nodeType === 3) return current.nodeValue || "";
        if (current.nodeType !== 1 && current.nodeType !== 9 && current.nodeType !== 11) return "";
        const tag = String(current.tagName || "").toLowerCase();
        if (tag === "br") return "\n";
        const block = /^(div|p|li|section|article)$/.test(tag);
        const content = [...(current.childNodes || [])].map(walk).join("");
        return block ? `\n${content}\n` : content;
    };
    return walk(node).replace(/\r/g, "").replace(/[\t\f\v ]+\n/g, "\n").replace(/\n[\t ]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function first(block, selectors) {
    for (const selector of selectors) {
        const node = block.querySelector(selector);
        if (node) return node;
    }
    return null;
}

export function messageBlocks(doc) {
    return [...doc.querySelectorAll(`${OLD_BLOCK}, ${NEW_BLOCK}`)];
}

function isLocalAttachmentRef(ref) {
    const value = String(ref || "").trim();
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return false;
    const path = value.split(/[?#]/, 1)[0];
    const extension = path.split("/").pop()?.split(".").pop()?.toLowerCase() || "";
    return ATTACHMENT_EXTENSIONS.has(extension) || /(?:^|\/)files?\//i.test(path);
}

export function extractMessageRecords(doc) {
    return messageBlocks(doc).map((block) => {
        const isOld = block.matches?.(OLD_BLOCK) || block.classList?.contains("_3-95");
        const senderNode = first(block, isOld
            ? ["._3-96._2pio._2lek._2lel"]
            : ["._2ph_._a6-h._a6-i", "._a6-h"]);
        const bodyNode = first(block, isOld ? ["._3-96._2let"] : ["._2ph_._a6-p", "._a6-p"]);
        const timeNode = first(block, isOld ? ["._3-94._2lem"] : ["._a72d"]);
        const refs = [];
        for (const node of block.querySelectorAll("[data-messenger-ref], a[href], img[src], video[src], audio[src], source[src]")) {
            const href = node.getAttribute("href");
            const src = node.getAttribute("src");
            const ref = node.getAttribute("data-messenger-ref") || href || src;
            if (isLocalAttachmentRef(ref)) refs.push({ ref, label: nodeText(node) || "", tag: String(node.tagName || "").toLowerCase() });
        }
        return {
            sender: nodeText(senderNode) || "Unknown",
            text: nodeText(bodyNode),
            rawTime: nodeText(timeNode),
            attachmentRefs: refs
        };
    });
}

/** Remove executable and resource-triggering markup before DOMParser sees it. */
export function inertHtml(html) {
    return String(html || "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<(?:iframe|frame|frameset|object|embed|applet|portal|link|style)\b[^>]*>[\s\S]*?<\/(?:iframe|frame|frameset|object|embed|applet|portal|link|style)\s*>/gi, "")
        .replace(/<(?:iframe|frame|frameset|object|embed|applet|portal|link)\b[^>]*\/?\s*>/gi, "")
        .replace(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi, (whole, tag, attributes) => {
            let attachmentRef = "";
            const safeAttributes = attributes
                .replace(/\s(?:src|href|poster|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi, (_attribute, doubleQuoted, singleQuoted, unquoted) => {
                    const candidate = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
                    if (!attachmentRef && isLocalAttachmentRef(candidate)) attachmentRef = candidate;
                    return "";
                })
                .replace(/\s(?:srcset|imagesrcset|lowsrc|dynsrc|style|background|srcdoc|data-messenger-ref)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
            const refAttribute = attachmentRef
                ? ` data-messenger-ref="${attachmentRef.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`
                : "";
            return `<${tag}${safeAttributes}${refAttribute}>`;
        });
}

export function parseHtmlDocument(html, DOMParserClass = globalThis.DOMParser) {
    if (!DOMParserClass) throw new Error("This browser does not support HTML parsing.");
    return new DOMParserClass().parseFromString(inertHtml(html), "text/html");
}

export function normalizeZipPath(path) {
    const parts = [];
    for (const item of String(path || "").replace(/\\/g, "/").split("/")) {
        if (!item || item === ".") continue;
        if (item === "..") { if (parts.length) parts.pop(); continue; }
        parts.push(item);
    }
    return parts.join("/");
}

export function resolveAttachmentRef(ref, htmlPath, entries) {
    let value = String(ref || "").trim().replace(/&amp;/g, "&");
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
    try { value = decodeURIComponent(value); } catch { /* keep literal path if malformed */ }
    const pathOnly = value.split(/[?#]/, 1)[0];
    const folder = String(htmlPath).replace(/\\/g, "/").slice(0, String(htmlPath).replace(/\\/g, "/").lastIndexOf("/"));
    const resolved = normalizeZipPath(pathOnly.startsWith("/") ? pathOnly.slice(1) : `${folder}/${pathOnly}`);
    const exact = entries.find((entry) => !entry.directory && normalizeZipPath(entry.filename) === resolved);
    if (exact) return exact;
    const base = baseName(pathOnly).toLowerCase();
    if (!base) return null;
    const sameName = entries.filter((entry) => !entry.directory && baseName(entry.filename).toLowerCase() === base);
    return sameName.length === 1 ? sameName[0] : null;
}

export function buildMediaRecord(entry, id) {
    const name = baseName(entry?.filename || id || "attachment");
    const type = detectMediaType(name, { stickers: false });
    return { id, name: name || "Attachment", path: entry.filename, kind: type.kind, mime: type.mime, entry, url: "", loadingPromise: null, hasLoaded: false };
}

/** Normalizes one conversation's extracted records and inserts date markers. */
export function normalizeMessages(records, { conversationKey, myName = "", entries = [], htmlPath = "" } = {}) {
    const sourced = records.map((record, ordinal) => ({ ...record, ordinal, parsed: parseMessengerTimestamp(record.rawTime) }));
    sourced.sort((a, b) => {
        if (a.parsed.sortKey && b.parsed.sortKey) return a.parsed.sortKey.localeCompare(b.parsed.sortKey) || a.ordinal - b.ordinal;
        if (a.parsed.sortKey) return -1;
        if (b.parsed.sortKey) return 1;
        return a.ordinal - b.ordinal;
    });
    const out = [];
    const store = new Map();
    const lookup = new Map();
    let lastDate = "";
    let mediaCount = 0;
    const threadId = encodeURIComponent(conversationKey || "conversation");
    sourced.forEach((record, index) => {
        const { parsed } = record;
        if (parsed.dateKey && parsed.dateKey !== lastDate) {
            out.push({ type: "date", id: `messenger-date-${threadId}-${parsed.dateKey}`, content: formatDateLabel(parsed.dateKey), ts: null });
            lastDate = parsed.dateKey;
        }
        const id = `messenger-msg-${threadId}-${record.sourcePart || 1}-${record.sourceIndex ?? record.ordinal}`;
        const mediaItems = [];
        for (const [refIndex, ref] of (record.attachmentRefs || []).entries()) {
            const entry = resolveAttachmentRef(ref.ref, record.htmlPath || htmlPath, entries);
            const missingName = baseName(ref.ref.split(/[?#]/, 1)[0]) || ref.label || "Attachment";
            if (!entry) {
                const type = detectMediaType(missingName, { stickers: false });
                mediaItems.push({ id: `${id}-missing-${refIndex}`, status: "missing", name: missingName, kind: type.kind, mime: type.mime });
                mediaCount++;
                continue;
            }
            let media = [...store.values()].find((item) => item.path === entry.filename);
            if (!media) {
                media = buildMediaRecord(entry, `messenger-media-${threadId}-${encodeURIComponent(normalizeZipPath(entry.filename))}`);
                store.set(media.id, media);
                lookup.set(normalizeZipPath(entry.filename).toLowerCase(), media);
            }
            mediaItems.push({ id: media.id, status: "available", name: media.name, kind: media.kind, mime: media.mime });
            mediaCount++;
        }
        const sender = String(record.sender || "Unknown").trim() || "Unknown";
        out.push({
            type: "msg", id, sender,
            isMe: Boolean(myName && sender.toLocaleLowerCase() === myName.toLocaleLowerCase()),
            text: String(record.text || ""), rawTime: parsed.rawTime, time: parsed.time || parsed.rawTime,
            ts: parsed.ts, mediaItems
        });
    });
    return { messages: out, mediaStore: store, mediaLookup: lookup, messageOnlyCount: sourced.length, mediaCount };
}
