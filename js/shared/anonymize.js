/**
 * ============================================================================
 * Anonymize (share) mode
 * ============================================================================
 * Replaces participant names with "Person A", "Person B", … and masks phone
 * numbers, email addresses and @handles in text, so a chat can be shown or
 * exported without identifying anyone. One anonymizer is built per chat from
 * every name the chat contains — senders, reaction actors, names in group
 * events — so the same person gets the same placeholder everywhere: bubbles,
 * system lines, reactions, the gallery, analytics and the HTML export.
 *
 * Matching rules (documented in the UI as "review before sharing"):
 *   - full names match regardless of case ("alice smith" → Person A); names
 *     shorter than four letters match only as written, so "Al" never eats "al"
 *   - first/last name parts match as written ("Alice"), so ordinary words like
 *     "will" or "grace" are left alone; a part two people share becomes [name]
 *   - phone numbers (7–15 digits) and emails become [phone] / [email]; a
 *     number that belongs to a phone-number participant becomes their alias
 *
 * No lookbehind anywhere: Safari < 16.4 can't parse it (see shared/text.js).
 * Pure functions apart from the sessionStorage preference — covered by
 * tests/anonymize.test.mjs.
 * ============================================================================
 */

export const ANONYMIZE_STORAGE_KEY = "chatlume-anonymize";
export const EMAIL_PLACEHOLDER = "[email]";
export const PHONE_PLACEHOLDER = "[phone]";
export const HANDLE_PLACEHOLDER = "[user]";
export const SHARED_NAME_PLACEHOLDER = "[name]";
export const GROUP_NAME_PLACEHOLDER = "[group name]";

/** Labels that already identify nobody, so they are shown as they are. */
const KEEP_NAMES = new Set(["You"]);

/** Name parts too generic to mask on their own ("Mom Cell", "Dr Who"). */
const PART_STOP_WORDS = new Set([
    "the", "and", "von", "van", "der", "den", "del", "della", "dos", "das", "bin", "binti", "ibn", "abu",
    "mrs", "miss", "sir", "madam", "mom", "mum", "dad", "bro", "sis", "aunty", "auntie", "uncle",
    "work", "home", "office", "new", "old", "official", "group", "family", "team", "jr", "sr"
]);

const WORD_CHARS = "\\p{L}\\p{N}\\p{M}_";
// File names use "_" as a separator ("Alice_Smith_CV.pdf"), so it isn't a word char there.
const FILE_WORD_CHARS = "\\p{L}\\p{N}\\p{M}";
// Bounded (RFC 5321 limits) so a long "a+a+a+…" run can't make matching quadratic.
const EMAIL_SOURCE = "[\\p{L}\\p{N}._%+\\-]{1,64}@[\\p{L}\\p{N}\\-]{1,63}(?:\\.[\\p{L}\\p{N}\\-]{1,63}){1,8}";
const HANDLE_SOURCE = "@[\\p{L}\\p{N}._]{2,30}(?![\\p{L}\\p{N}_])";
// Deliberately loose; looksLikePhone() decides what is actually a number.
const PHONE_SOURCE = "\\+?\\(?\\d(?:[\\d\\u00A0\\u202F ().\\-]*\\d)?";

/** "Person A" … "Person Z", "Person AA", "Person AB", … */
export function aliasForIndex(index) {
    let n = Math.max(0, Math.floor(index));
    let letters = "";
    do {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `Person ${letters}`;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const letterCount = (value) => (String(value).match(/[\p{L}\p{N}]/gu) || []).length;
const digitsOf = (value) => String(value).replace(/\D/g, "");

/** A participant whose name is a phone number ("+91 98765 43210"). */
function isPhoneName(name) {
    return !/\p{L}/u.test(name) && digitsOf(name).length >= 7;
}

/** WhatsApp's own attachment names ("IMG-20240101-WA0001.jpg") identify nobody. */
const WHATSAPP_MEDIA_NAME = /^(?:IMG|VID|AUD|PTT|DOC|STK)-\d{8}-WA\d+(?:\.[a-z0-9]{1,5})?$/i;

const DATE_PREFIX = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})/;
const TIME_RANGE = /^\d{1,2}[.:]\d{2}(?:\s*[-–]\s*\d{1,2}[.:]\d{2})?$/;
const COMPACT_DATE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;

/**
 * Whether a run of digits and separators is a phone number rather than a
 * date, a time, a zero-padded counter (WhatsApp's "00000012-PHOTO-…") or an
 * id too long to be a number anyone dials.
 */
export function looksLikePhone(candidate) {
    const text = String(candidate || "").trim();
    const digits = digitsOf(text);
    if (digits.length < 7 || digits.length > 15) return false;
    if (/^0{3,}/.test(digits)) return false;
    if (COMPACT_DATE.test(text)) return false;
    if (TIME_RANGE.test(text)) return false;
    const afterDate = text.replace(/^\(/, "").replace(DATE_PREFIX, "");
    if (afterDate !== text.replace(/^\(/, "") && digitsOf(afterDate).length < 7) return false;
    return true;
}

// ── Names in WhatsApp group events ──────────────────────────────────────────

const QUOTED = /["“”«»]([^"“”«»]{1,120})["“”«»]/g;
const SECURITY_CODE_PATTERNS = [
    /^Your security code with (.+?) changed\b/i,
    /^(.+?)'s security code changed\b/i
];
/** Verb phrases that follow the actor in English group-event lines. */
const EVENT_VERBS = [
    " created group", " created this group", " created the group", " added ", " removed ", " left",
    " joined", " changed ", " deleted ", " turned ", " pinned ", " unpinned ", " is now an admin",
    " is no longer an admin", " started ", " requested to join", " reset ", " was added", " was removed",
    " made ", " invited ", " updated ", " allowed ", " blocked ", " unblocked ", " ended ", " revoked ",
    " approved ", " rejected ", " has joined", " has left", " set "
];
/** Events whose object is a list of people ("added Bob, Carol and Dave"). */
const OBJECT_VERBS = new Set([" added ", " removed ", " invited ", " made ", " blocked ", " unblocked ", " approved ", " rejected "]);
const NOT_A_NAME = /^(?:you|your|you're|this|the|messages|disappearing|everyone|all|admins?|someone|a|an|group)\b/i;

function validEventName(value) {
    const name = String(value || "").trim().replace(/^["“']+|["”']+$/g, "").trim();
    if (!name || name.length > 60 || !letterCount(name)) return "";
    if (name.split(/\s+/).length > 6) return "";
    if (NOT_A_NAME.test(name) && !isPhoneName(name)) return "";
    return name;
}

/** Index of the earliest verb phrase, matched at a word end. */
function findEventVerb(text) {
    let best = null;
    for (const verb of EVENT_VERBS) {
        let from = 0;
        for (;;) {
            const at = text.indexOf(verb, from);
            if (at <= 0) break;
            const next = text.charAt(at + verb.length);
            if (verb.endsWith(" ") || !next || /[\s.,!:;]/.test(next)) {
                if (!best || at < best.at) best = { at, verb };
                break;
            }
            from = at + 1;
        }
    }
    return best;
}

/**
 * Names mentioned in an English WhatsApp group event — "Alice added Bob and
 * Carol", "Bob left", "Your security code with Dave changed" — so people who
 * never sent a message are still anonymized. Other languages fall back to the
 * participant names the text pass already knows.
 *
 * @returns {{ names: string[], subjects: string[] }}
 */
export function extractSystemNames(text) {
    const line = String(text || "").trim();
    const names = [];
    const subjects = [];
    if (!line) return { names, subjects };

    if (/\b(?:created group|subject|group name|group's name)\b/i.test(line)) {
        for (const match of line.matchAll(QUOTED)) {
            if (match[1].trim()) subjects.push(match[1].trim());
        }
    }

    for (const pattern of SECURITY_CODE_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
            const name = validEventName(match[1]);
            if (name) names.push(name);
            return { names, subjects };
        }
    }

    const found = findEventVerb(line);
    if (!found) return { names, subjects };
    const actor = validEventName(line.slice(0, found.at));
    if (actor) names.push(actor);

    if (OBJECT_VERBS.has(found.verb)) {
        const rest = line.slice(found.at + found.verb.length)
            .replace(/\s+(?:to|from) (?:the|this) (?:group|community)\b.*$/i, "")
            .replace(/\s+(?:as )?(?:an? )?(?:group )?admins?\b.*$/i, "")
            .replace(/[.!]+$/, "");
        rest.split(/\s*,\s*|\s+and\s+|\s*&\s*/).forEach((part) => {
            const name = validEventName(part);
            if (name) names.push(name);
        });
    }
    return { names, subjects };
}

/**
 * Every name a chat shows, in order of first appearance, plus group subjects.
 *
 * @param {Array}  messages       Parsed items ({ type, sender, reactions, content }).
 * @param {Object} [options]
 * @param {string[]} [options.participants]  Known members who may never have spoken.
 * @param {string}   [options.title]         Chat title; a group's title is a subject.
 */
export function collectChatNames(messages, { participants = [], title = "" } = {}) {
    const names = new Set();
    const subjects = new Set();
    const add = (value) => {
        const name = String(value ?? "").trim();
        if (name && !KEEP_NAMES.has(name)) names.add(name);
    };

    for (const item of messages || []) {
        if (!item) continue;
        if (item.type === "msg") {
            add(item.sender);
            (item.reactions || []).forEach((reaction) => add(reaction?.actor));
        } else if (item.type === "system") {
            const found = extractSystemNames(item.content);
            found.names.forEach(add);
            found.subjects.forEach((subject) => subjects.add(subject));
        }
    }
    (participants || []).forEach(add);

    const cleanTitle = String(title || "").trim();
    const lowerNames = new Set([...names].map((name) => name.toLowerCase()));
    if (cleanTitle && !lowerNames.has(cleanTitle.toLowerCase()) && names.size > 2) subjects.add(cleanTitle);
    return { names: [...names], subjects: [...subjects] };
}

// ── The anonymizer ──────────────────────────────────────────────────────────

/** Bounded memo: a 50k-message chat repeats few strings, but never grow forever. */
function memo(limit = 100000) {
    const map = new Map();
    return {
        get: (key) => map.get(key),
        set(key, value) {
            if (map.size >= limit) map.clear();
            map.set(key, value);
        },
        clear: () => map.clear()
    };
}

/**
 * @param {Object}   options
 * @param {string[]} options.names     Real names, in the order aliases are handed out.
 * @param {string[]} [options.subjects] Group names, masked as [group name].
 */
export function createAnonymizer({ names = [], subjects = [] } = {}) {
    const aliases = new Map();        // real name → alias
    const reverse = new Map();        // alias → real name
    const phoneAliases = new Map();   // digits → alias, for phone-number participants
    const realLower = new Set();
    let nextIndex = 0;
    let dirty = true;
    let textPattern = null;
    let filePattern = null;
    const textCache = memo();
    const fileCache = memo(20000);

    names.forEach((name) => realLower.add(String(name).trim().toLowerCase()));

    function nextAlias() {
        // A participant literally called "Person B" must not collide with an alias.
        let alias;
        do alias = aliasForIndex(nextIndex++);
        while (realLower.has(alias.toLowerCase()) || reverse.has(alias));
        return alias;
    }

    function register(name) {
        if (aliases.has(name)) return aliases.get(name);
        const alias = nextAlias();
        aliases.set(name, alias);
        reverse.set(alias, name);
        realLower.add(name.toLowerCase());
        if (isPhoneName(name)) phoneAliases.set(digitsOf(name), alias);
        dirty = true;
        return alias;
    }

    names.forEach((name) => {
        const clean = String(name ?? "").trim();
        if (clean && !KEEP_NAMES.has(clean)) register(clean);
    });
    const subjectList = [...new Set(subjects.map((subject) => String(subject || "").trim()).filter((subject) => letterCount(subject) >= 3))];

    // term (lower-cased) → [{ text, replacement, caseSensitive }]
    let termIndex = new Map();

    function addTerm(text, replacement, caseSensitive) {
        const key = text.toLowerCase();
        const entries = termIndex.get(key) || [];
        if (entries.some((entry) => entry.text === text)) return;
        entries.push({ text, replacement, caseSensitive });
        termIndex.set(key, entries);
    }

    function rebuild() {
        termIndex = new Map();
        // Full names first: they outrank any part that happens to match them.
        aliases.forEach((alias, name) => addTerm(name, alias, letterCount(name) < 4));

        const partOwners = new Map();
        aliases.forEach((alias, name) => {
            const parts = name.split(/\s+/).map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
            if (parts.length < 2) return;
            parts.forEach((part) => {
                if (letterCount(part) < 3 || !/\p{L}/u.test(part) || PART_STOP_WORDS.has(part.toLowerCase())) return;
                if (!partOwners.has(part)) partOwners.set(part, new Set());
                partOwners.get(part).add(alias);
            });
        });
        partOwners.forEach((owners, part) => {
            if ((termIndex.get(part.toLowerCase()) || []).some((entry) => entry.text === part)) return;
            addTerm(part, owners.size === 1 ? [...owners][0] : SHARED_NAME_PLACEHOLDER, true);
        });

        subjectList.forEach((subject) => {
            if (!termIndex.has(subject.toLowerCase())) addTerm(subject, GROUP_NAME_PLACEHOLDER, false);
        });

        const alternation = [...termIndex.values()]
            .map((entries) => entries[0].text)
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join("|") || "(?!)";
        const build = (word) => new RegExp(
            `(^|[^${word}])(?:(${EMAIL_SOURCE})|(@?)(${alternation})(?![${word}])|(${HANDLE_SOURCE})|(${PHONE_SOURCE}))`,
            "giu"
        );
        textPattern = build(WORD_CHARS);
        filePattern = build(FILE_WORD_CHARS);
        textCache.clear();
        fileCache.clear();
        dirty = false;
    }

    function lookupTerm(text) {
        const entries = termIndex.get(text.toLowerCase());
        if (!entries) return null;
        const exact = entries.find((entry) => entry.text === text);
        if (exact) return exact.replacement;
        const loose = entries.find((entry) => !entry.caseSensitive);
        return loose ? loose.replacement : null;
    }

    function aliasForDigits(digits) {
        if (phoneAliases.has(digits)) return phoneAliases.get(digits);
        // "98765 43210" in a message, "+91 98765 43210" as the sender.
        for (const [known, alias] of phoneAliases) {
            const shorter = known.length < digits.length ? known : digits;
            const longer = shorter === known ? digits : known;
            if (shorter.length >= 8 && longer.endsWith(shorter)) return alias;
        }
        return "";
    }

    function maskPhone(candidate) {
        if (!looksLikePhone(candidate)) return null;
        const masked = aliasForDigits(digitsOf(candidate)) || PHONE_PLACEHOLDER;
        // Keep an opening bracket the number didn't close: "(555 123 4567" → "([phone]".
        return candidate.startsWith("(") && !candidate.includes(")") ? `(${masked}` : masked;
    }

    function maskHandle(handle) {
        const trailing = handle.match(/[._]+$/)?.[0] || "";
        const body = handle.slice(1, handle.length - trailing.length);
        if (/^\d+$/.test(body) && looksLikePhone(body)) {
            return `@${aliasForDigits(body) || PHONE_PLACEHOLDER}${trailing}`;
        }
        const alias = lookupTerm(body) || lookupTerm(body.replace(/[._]+/g, " "));
        return `@${alias || HANDLE_PLACEHOLDER}${trailing}`;
    }

    function replacer(whole, edge, email, at, name, handle, phone) {
        if (email) return edge + EMAIL_PLACEHOLDER;
        if (name) {
            const replacement = lookupTerm(name);
            return replacement == null ? whole : edge + at + replacement;
        }
        if (handle) return edge + maskHandle(handle);
        if (phone) {
            const masked = maskPhone(phone);
            return masked == null ? whole : edge + masked;
        }
        return whole;
    }

    function mask(value, cache, getPattern) {
        if (value == null || value === "") return value;
        const source = String(value);
        if (dirty) rebuild();
        const hit = cache.get(source);
        if (hit !== undefined) return hit;
        const masked = source.replace(getPattern(), replacer);
        cache.set(source, masked);
        return masked;
    }

    const text = (value) => mask(value, textCache, () => textPattern);

    return {
        /** Placeholder for a participant; an unseen name gets the next free letter. */
        name(value) {
            if (value == null) return value;
            const raw = String(value);
            const clean = raw.trim();
            if (!clean || KEEP_NAMES.has(clean)) return raw;
            return aliases.get(clean) || register(clean);
        },
        /** Message text, system lines, captions, link text. */
        text,
        /** Attachment names, where "_" separates words. */
        fileName: (value) => (WHATSAPP_MEDIA_NAME.test(String(value ?? "")) ? value : mask(value, fileCache, () => filePattern)),
        /**
         * A chat title: a one-to-one chat named after the other person shows
         * their alias; anything else becomes a neutral label.
         */
        title(value) {
            const clean = String(value || "").trim();
            if (!clean) return "Chat";
            const exact = aliases.get(clean)
                || [...aliases].find(([name]) => name.toLowerCase() === clean.toLowerCase())?.[1];
            if (exact) return exact;
            if (aliases.size > 2) return "Group chat";
            const masked = text(clean);
            return masked !== clean ? masked : "Chat";
        },
        /** The real name behind an alias (for controls whose value is an alias). */
        realName: (alias) => reverse.get(alias) ?? alias,
        get size() { return aliases.size; }
    };
}

// ── Viewer binding ──────────────────────────────────────────────────────────

/** Session-scoped: survives a reload (Persistent Storage reopens the chat) but not a new visit. */
export function readAnonymizePreference() {
    try {
        return sessionStorage.getItem(ANONYMIZE_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeAnonymizePreference(on) {
    try {
        if (on) sessionStorage.setItem(ANONYMIZE_STORAGE_KEY, "1");
        else sessionStorage.removeItem(ANONYMIZE_STORAGE_KEY);
    } catch {
        // Private mode: the toggle still works for this page.
    }
}

/**
 * What every renderer calls: identity functions while the mode is off, the
 * current chat's anonymizer while it is on. The anonymizer is rebuilt when
 * the chat changes (a new messages array, or one that grew during a parse).
 *
 * @param {Function} getSource  () => ({ messages, participants?, title? })
 */
export function createAnonymizeView(getSource) {
    let enabled = readAnonymizePreference();
    let key = [];
    let instance = null;

    function current() {
        const source = getSource() || {};
        const nextKey = [source.messages, source.messages?.length, source.title, source.participants, source.participants?.length];
        if (!instance || nextKey.some((part, index) => part !== key[index])) {
            key = nextKey;
            instance = createAnonymizer(collectChatNames(source.messages || [], {
                participants: source.participants || [],
                title: source.title || ""
            }));
        }
        return instance;
    }

    return {
        isOn: () => enabled,
        setOn(on) {
            enabled = Boolean(on);
            writeAnonymizePreference(enabled);
        },
        name: (value) => (enabled ? current().name(value) : value),
        text: (value) => (enabled ? current().text(value) : value),
        fileName: (value) => (enabled ? current().fileName(value) : value),
        title: (value) => (enabled ? current().title(value) : value),
        realName: (value) => (enabled ? current().realName(value) : value)
    };
}
