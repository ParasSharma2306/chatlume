/**
 * ============================================================================
 * WhatsApp chat parsing pipeline
 * ============================================================================
 * Turns the lines of a `_chat.txt` into `state.messages`: day markers,
 * system events and messages (with their attachments and analytics tallies).
 *
 * Header recognition — dates, times, senders in every locale — lives in
 * js/whatsapp-parser.js and is unit-tested. This module drives it line by
 * line, once from an in-memory string (plain .txt) and once from a streamed
 * ZIP entry (never holding the whole chat text in memory), and assembles
 * the message objects the renderer consumes.
 * ============================================================================
 */
import {
    extractAttachmentTokens,
    extractTimePart,
    hourOf,
    looksLikeTimestampLine,
    normalizeLine,
    parseHeaderLine,
    parseTimestamp,
    stripInvisible
} from "../whatsapp-parser.js?v=1.7.0";
import { countEmojis } from "../shared/emoji.js?v=1.7.0";
import { tailRange } from "../shared/virtual-list.js?v=1.7.0";
import { MAX_RENDERED_ITEMS, state } from "./state.js?v=1.7.0";
import { reinferDateOrder } from "./format.js?v=1.7.0";
import { createMissingMediaItem, resolveAttachment } from "./media.js?v=1.7.0";
import { generateStats } from "./stats.js?v=1.7.0";
import { updateLoadingCopy } from "./ui.js?v=1.7.0";

/** Lines between progress updates / main-thread yields. */
const PROGRESS_EVERY_LINES = 2000;

/** "You" is how some exports label the account owner. */
export function isMeSender(sender) {
    return sender.toLowerCase() === state.myName.toLowerCase() || sender === "You";
}

function extractHour(rawTime) {
    return hourOf(parseTimestamp(rawTime)?.time);
}

/** "<Media omitted>" and its localised / typed variants. */
const OMITTED_MEDIA_PATTERNS = [
    /^<media omitted>$/i,
    /^<medien ausgeschlossen>$/i,
    /^(image|video|audio|sticker|document|contact card|gif) omitted$/i
];

/** A line that is nothing but a file name (no `<attached:>` wrapper). */
function looksLikeStandaloneAttachment(text) {
    const value = (text || "").trim();
    if (!value || /\s{2,}/.test(value)) return false;
    if (/^(https?:\/\/)/i.test(value)) return false;
    return /^[^\n]+\.(jpg|jpeg|png|webp|gif|mp4|mov|avi|m4v|mp3|m4a|opus|ogg|oga|aac|wav|pdf|docx?|xlsx?|pptx?|vcf|zip|webm|heic|heif)$/i.test(value);
}

function cleanupMessageText(text, isContinuation = false) {
    const clean = stripInvisible(text);
    return isContinuation ? clean : clean.trim();
}

/**
 * Splits a message body into its text and the attachments it references.
 * Continuation lines keep their leading whitespace (it may be intentional).
 */
export function parseMessageContent(content, isContinuation = false) {
    let text = content || "";
    if (!isContinuation) {
        text = text.trim();
    }

    const mediaItems = [];

    if (OMITTED_MEDIA_PATTERNS.some((pattern) => pattern.test(text.trim()))) {
        mediaItems.push(createMissingMediaItem("Media omitted"));
        return { text: "", mediaItems };
    }

    const attachments = extractAttachmentTokens(text);
    attachments.forEach((attachment) => {
        const mediaItem = resolveAttachment(attachment.fileName);
        mediaItems.push(mediaItem);
        text = text.replace(attachment.raw, "");
    });

    if (!mediaItems.length && looksLikeStandaloneAttachment(text.trim())) {
        mediaItems.push(resolveAttachment(text.trim()));
        text = "";
    }

    return { text: cleanupMessageText(text, isContinuation), mediaItems };
}

/** Builds a message entry and updates the analytics tallies for it. */
function createMessageEntry(index, rawTime, sender, rawContent, timestamp = null) {
    const message = {
        type: "msg",
        id: `msg-${index}`,
        rawTime,
        time: timestamp ? timestamp.time.raw : extractTimePart(rawTime),
        sender,
        isMe: isMeSender(sender),
        text: "",
        mediaItems: []
    };

    const parsed = parseMessageContent(rawContent);
    message.text = parsed.text;
    message.mediaItems = parsed.mediaItems;

    state.senderStats[sender] = (state.senderStats[sender] || 0) + 1;
    const hour = timestamp ? hourOf(timestamp.time) : extractHour(rawTime);
    state.hourlyStats[hour] += 1;
    countEmojis(rawContent, state.emojiStats);

    state.messageOnlyCount += 1;
    state.mediaCount += parsed.mediaItems.length;
    state.mediaMissingCount += parsed.mediaItems.filter((item) => item.status === "missing").length;

    return message;
}

/** A line without a header belongs to the message above it. */
function appendContinuation(message, line) {
    const parsed = parseMessageContent(line, true);
    message.text = message.text !== "" ? `${message.text}\n${parsed.text}` : parsed.text;

    countEmojis(line, state.emojiStats);

    if (parsed.mediaItems.length) {
        message.mediaItems.push(...parsed.mediaItems);
        state.mediaCount += parsed.mediaItems.length;
        state.mediaMissingCount += parsed.mediaItems.filter((item) => item.status === "missing").length;
    }
}

/**
 * Stateful line consumer. Feed it every line of the export in order, then
 * call `finalize()` to publish the result into `state`.
 */
function createChatLineProcessor() {
    let lastDate = "";
    let lastMessage = null;
    let lineIndex = 0;
    // Lines that started like a timestamp but were not recognised. Only read
    // when nothing parsed, to tell "not an export" from "unknown date format".
    let unrecognizedHeaders = 0;
    let unrecognizedSample = "";

    function pushDateMarker(dateStr) {
        if (dateStr && dateStr !== lastDate) {
            state.messages.push({ type: "date", content: dateStr, rawDate: dateStr, id: `date-${lineIndex}` });
            lastDate = dateStr;
        }
    }

    function processLine(originalLine) {
        // Header recognition lives in js/whatsapp-parser.js. The sender split
        // is unchanged: a message needs a colon and a sender of at most four
        // words, otherwise the line is a system event.
        const header = parseHeaderLine(originalLine);

        if (header?.kind === "message") {
            const { rawTime, sender, content: rawContent, timestamp } = header;
            pushDateMarker(timestamp.dateLabel);
            const message = createMessageEntry(lineIndex, rawTime, sender, rawContent, timestamp);
            state.messages.push(message);
            lastMessage = message;
            lineIndex++;
            return;
        }

        if (header?.kind === "system") {
            const { rawTime, content, timestamp } = header;
            pushDateMarker(timestamp.dateLabel);
            if (content) {
                state.messages.push({ type: "system", id: `sys-${lineIndex}`, rawTime, time: timestamp.time.raw, content });
                lastMessage = null;
            }
            lineIndex++;
            return;
        }

        const line = normalizeLine(originalLine);
        if (lastMessage && lastMessage.type === "msg") {
            appendContinuation(lastMessage, line);
        } else if (!state.messageOnlyCount && looksLikeTimestampLine(line)) {
            unrecognizedHeaders += 1;
            if (!unrecognizedSample) unrecognizedSample = line.trim().slice(0, 80);
        }
        lineIndex++;
    }

    function finalize() {
        state.filteredMessages = state.messages;
        state.parseDiagnostics = { unrecognizedHeaders, unrecognizedSample };
        reinferDateOrder();
        state.renderRange = tailRange(state.filteredMessages.length, MAX_RENDERED_ITEMS);
        generateStats();
    }

    return { processLine, finalize, getLineIndex: () => lineIndex };
}

/** Parses a chat held in memory (plain .txt exports). Yields periodically. */
export async function parseChatData(text) {
    const { processLine, finalize, getLineIndex } = createChatLineProcessor();
    let start = 0;
    let nextYieldAt = PROGRESS_EVERY_LINES;
    const newlineRegex = /\r?\n/g;

    while (true) {
        const match = newlineRegex.exec(text);
        const end = match ? match.index : text.length;
        processLine(text.slice(start, end));
        const lineIndex = getLineIndex();

        if (lineIndex >= nextYieldAt) {
            const pct = text.length ? Math.round((end / text.length) * 100) : 100;
            updateLoadingCopy(`Parsing messages... ${pct}% (${lineIndex.toLocaleString()} lines)`);
            nextYieldAt = lineIndex + PROGRESS_EVERY_LINES;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        if (!match) break;
        start = newlineRegex.lastIndex;
    }

    finalize();
}

/**
 * Parses the chat entry straight out of the ZIP as it decompresses.
 *
 * MEMORY NOTE: With BlobReader + streaming WritableStream, peak RAM usage for
 * a 5GB ZIP is approximately equal to: decompression buffer (~a few MB) +
 * current chunk in JS (~few KB) + accumulated message objects (varies by chat
 * size). The ZIP itself is never buffered. Practical limit is RAM available
 * for message objects, not file size.
 *
 * @param {Object} entry  zip.js entry for the chat .txt
 * @param {number} gen    load generation; a newer load aborts this one
 */
export async function parseChatDataFromEntry(entry, gen) {
    const { processLine, finalize, getLineIndex } = createChatLineProcessor();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";
    let bytesLoaded = 0;
    const totalBytes = entry.uncompressedSize || 1;
    let nextYieldAt = PROGRESS_EVERY_LINES;
    let parseSucceeded = false;

    try {
        await entry.getData(new WritableStream({
            write(chunk) {
                if (state.loadGeneration !== gen) {
                    throw new DOMException("Load superseded by a newer file selection", "AbortError");
                }
                bytesLoaded += chunk.length;
                lineBuffer += decoder.decode(chunk, { stream: true });
                const parts = lineBuffer.split("\n");
                lineBuffer = parts.pop();
                for (const rawLine of parts) {
                    processLine(rawLine);
                }
                const lineIndex = getLineIndex();
                if (lineIndex >= nextYieldAt) {
                    const pct = Math.round((bytesLoaded / totalBytes) * 100);
                    updateLoadingCopy(`Parsing messages... ${pct}% (${lineIndex.toLocaleString()} lines)`);
                    nextYieldAt = lineIndex + PROGRESS_EVERY_LINES;
                    return new Promise((resolve) => setTimeout(resolve, 0));
                }
            },
            close() {
                const tail = lineBuffer + decoder.decode();
                if (tail) processLine(tail);
            }
        }));

        finalize();
        parseSucceeded = true;
    } catch (err) {
        console.error("[CL] parseChatDataFromEntry error:", err.name, err.message, err.stack);
        throw err;
    } finally {
        if (!parseSucceeded && state.zipReader) {
            state.zipReader.close().catch(() => {});
            state.zipReader = null;
        }
    }
}
