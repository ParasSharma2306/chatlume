/**
 * ============================================================================
 * Message reactions
 * ============================================================================
 * Normalising and grouping the reactions Instagram exports with a message
 * (`reactions: [{ reaction, actor, timestamp }]`). Pure — no DOM, no names
 * resolved here; callers pass the Anonymize view's `name` in. Shared by the
 * Instagram viewer and the HTML export, and covered by tests/reactions.test.mjs.
 *
 * WhatsApp's chat export carries no reactions, so nothing here applies to it.
 * ============================================================================
 */
import { toEmojiPresentation } from "./emoji.js?v=1.10.1";

/**
 * Characters that change how an emoji is drawn but not which emoji it is:
 * variation selectors (❤ vs ❤️), zero-width spaces and joiners at the edges,
 * direction marks, word joiners, BOMs and soft hyphens. The zero-width JOINER
 * (U+200D) is kept inside a sequence — it is what makes 👨‍👩‍👧 one emoji.
 */
const PRESENTATION_MARKS = /[︀-️\u{E0100}-\u{E01EF}​‌‎‏‪-‮⁠-⁤⁦-⁩﻿­]/gu;
const EDGE_JOINERS = /^‍+|‍+$/g;

/** A reaction longer than this (it is meant to be one emoji) is cut for display. */
export const MAX_REACTION_GRAPHEMES = 4;

/** Who reacted, when the export doesn't say. */
export const UNKNOWN_ACTOR = "Someone";

/**
 * The grouping key for a reaction: NFC, no presentation marks, no spaces.
 * "❤" and "❤️" (and "❤︎") share one key; 👍 and 👍🏽 stay apart, as do
 * different ZWJ sequences. Not a string, or nothing left → "".
 */
export function reactionKey(value) {
    if (typeof value !== "string") return "";
    return value.normalize("NFC").replace(PRESENTATION_MARKS, "").replace(/\s+/gu, "").replace(EDGE_JOINERS, "");
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** First `limit` user-perceived characters of `value` (code points without Intl.Segmenter). */
function firstGraphemes(value, limit) {
    if (segmenter) {
        const parts = [];
        for (const { segment } of segmenter.segment(value)) {
            parts.push(segment);
            if (parts.length > limit) break;
        }
        return parts.length > limit ? `${parts.slice(0, limit).join("")}…` : value;
    }
    const points = [...value];
    return points.length > limit ? `${points.slice(0, limit).join("")}…` : value;
}

/**
 * How a key is shown: the colour-emoji form ("❤" → "❤️"), and never more
 * than a few characters, whatever the export put in the field.
 */
export function displayReaction(key) {
    return toEmojiPresentation(firstGraphemes(String(key || ""), MAX_REACTION_GRAPHEMES));
}

/**
 * Cleans a message's raw reactions. Instagram keeps one reaction per person
 * per message, so when an export lists someone twice (a changed reaction, or
 * a duplicate) only their latest counts — by timestamp, then list order.
 * Entries without an actor can't be matched up and are each kept.
 *
 * @param {Array}  list  [{ reaction, actor, timestamp }] — text already repaired.
 * @returns {Array<{ reaction: string, actor: string, ts: number }>}  `reaction` is the key.
 */
export function normalizeReactions(list) {
    if (!Array.isArray(list)) return [];
    const kept = [];
    const byActor = new Map();
    list.forEach((entry, order) => {
        if (!entry || typeof entry !== "object") return;
        const reaction = reactionKey(entry.reaction);
        if (!reaction) return;
        const actor = typeof entry.actor === "string" ? entry.actor.trim() : "";
        const timestamp = Number(entry.timestamp ?? entry.timestamp_ms);
        const record = { reaction, actor, ts: Number.isFinite(timestamp) ? timestamp : 0, order };
        if (!actor) {
            kept.push(record);
            return;
        }
        const previous = byActor.get(actor);
        if (previous && previous.ts > record.ts) return;
        if (previous) kept.splice(kept.indexOf(previous), 1);
        byActor.set(actor, record);
        kept.push(record);
    });
    return kept.sort((a, b) => a.order - b.order).map(({ reaction, actor, ts }) => ({ reaction, actor, ts }));
}

/**
 * Pills for a message: one group per emoji, most-used first (ties keep the
 * order they first appeared in).
 *
 * @param {Array}    reactions  normalizeReactions output (or anything with
 *                              { reaction, actor }; keys are re-derived).
 * @param {Function} [nameFor]  actor → the name shown (display.name).
 * @returns {Array<{ key: string, emoji: string, count: number, actors: string[] }>}
 */
export function groupReactions(reactions, nameFor = (actor) => actor) {
    const groups = new Map();
    (Array.isArray(reactions) ? reactions : []).forEach((entry, index) => {
        const key = reactionKey(entry?.reaction);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key, emoji: displayReaction(key), count: 0, actors: [], first: index });
        const group = groups.get(key);
        group.count += 1;
        const actor = typeof entry.actor === "string" && entry.actor.trim() ? nameFor(entry.actor.trim()) : "";
        group.actors.push(actor || UNKNOWN_ACTOR);
    });
    return [...groups.values()]
        .sort((a, b) => b.count - a.count || a.first - b.first)
        .map(({ key, emoji, count, actors }) => ({ key, emoji, count, actors }));
}

/**
 * "❤️ 3 reactions: Person A, Person B and Person C" — for aria-labels and
 * the export's tooltips. Long lists end "and 12 more".
 */
export function describeReactionGroup(group, { limit = 5 } = {}) {
    const shown = group.actors.slice(0, limit);
    const rest = group.actors.length - shown.length;
    let who = shown.join(", ");
    if (rest > 0) who += ` and ${rest} more`;
    else if (shown.length > 1) who = `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
    return `${group.emoji} ${group.count} ${group.count === 1 ? "reaction" : "reactions"}: ${who}`;
}
