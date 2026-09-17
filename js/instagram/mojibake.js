/**
 * ============================================================================
 * Mojibake repair
 * ============================================================================
 * Instagram exports encode UTF-8 text as latin1 byte values, so "café"
 * arrives as "cafÃ©" and every emoji as a run of Latin-1 characters.
 * Re-decoding those bytes as UTF-8 restores the original text.
 *
 * This must only run on strings that ARE mojibaked. Blindly masking every
 * code unit with & 0xff destroys real Unicode, and decoding bytes that
 * aren't valid UTF-8 replaces them with U+FFFD — so a correctly-encoded
 * "café" would come back as "caf<?>". Three guards keep that from
 * happening:
 *   1. any code point above U+00FF means the string is already real Unicode
 *   2. pure ASCII is byte-identical either way, so there is nothing to fix
 *   3. fatal decoding throws on invalid UTF-8, which means it was never mojibaked
 *
 * Pure function — covered by tests/instagram.test.mjs.
 * ============================================================================
 */

const UTF8_DECODER = typeof TextDecoder !== "undefined"
    ? new TextDecoder("utf-8", { fatal: true })
    : null;

export function fixMojibake(str) {
    if (!str || !UTF8_DECODER) return str;

    let hasHighByte = false;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code > 0xff) return str;
        if (code >= 0x80) hasHighByte = true;
    }
    if (!hasHighByte) return str;

    try {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
        return UTF8_DECODER.decode(bytes);
    } catch {
        return str;
    }
}
