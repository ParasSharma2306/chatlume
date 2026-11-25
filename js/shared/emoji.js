/**
 * ============================================================================
 * Emoji counting
 * ============================================================================
 * Feeds the "Most used" grid in the analytics drawer and Wrapped graphic.
 * ============================================================================
 */

/**
 * Whole emoji, not code points: flags (a regional-indicator pair), tag flags,
 * skin tones and ZWJ sequences each count once. Matching single code points
 * used to list "🏽" and "🇮" as emojis of their own.
 */
const EMOJI_PATTERN = /\p{Regional_Indicator}{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;

/** Symbols that are pictographic by the standard but not emojis in a chat. */
const TEXT_SYMBOL = /^[©®™]$/u;

/** A lone "❤" renders as a black glyph; U+FE0F asks for the colour emoji. */
export function toEmojiPresentation(value) {
    return /^\p{Extended_Pictographic}$/u.test(value) && !/\p{Emoji_Presentation}/u.test(value) ? `${value}\uFE0F` : value;
}

/** Adds every emoji in `text` to the `stats` tally (emoji → count). */
export function countEmojis(text, stats) {
    const emojis = text.match(EMOJI_PATTERN);
    if (emojis) {
        emojis.forEach((match) => {
            if (TEXT_SYMBOL.test(match)) return;
            const emoji = toEmojiPresentation(match);
            stats[emoji] = (stats[emoji] || 0) + 1;
        });
    }
}
