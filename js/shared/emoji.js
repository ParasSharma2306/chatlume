/**
 * ============================================================================
 * Emoji counting
 * ============================================================================
 * Feeds the "Most used" grid in the analytics drawer and Wrapped graphic.
 * ============================================================================
 */

const EMOJI_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

/** Adds every emoji in `text` to the `stats` tally (emoji → count). */
export function countEmojis(text, stats) {
    const emojis = text.match(EMOJI_PATTERN);
    if (emojis) {
        emojis.forEach((emoji) => {
            stats[emoji] = (stats[emoji] || 0) + 1;
        });
    }
}
