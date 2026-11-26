# Changelog

All notable changes to ChatLume. Versions match the `?v=` release token (see `scripts/bump-version.mjs`).

## 1.9.0

### Added
- **Anonymize mode** in both viewers (header menu → *Anonymize names*). Replaces every participant with a consistent placeholder ("Person A", "Person B", …) and masks phone numbers, email addresses and @handles in message text.
  - Covers bubbles, system lines and group events (people added, removed, left, security-code notices), Instagram reaction actors, attachment names, the sender filter, the "You in this chat" select, analytics, Wrapped, saved-chat lists, the Instagram conversation picker, search and both HTML exports (`.html` and `.zip`, including attachment file names inside the ZIP and the download file name).
  - A banner shows while it is on, with a one-tap *Show names*. Switching is instant and fully reversible, with no reload; the choice lasts for the browser session, so a reload (or Persistent Storage reopening the last chat) stays anonymized.
  - Phone-number participants keep their alias wherever their number appears, including `@mentions`; a first or last name two people share becomes `[name]`; a group's name becomes `[group name]`; a participant literally called "Person B" never collides with an alias.
  - Matching is deliberately conservative: full names match in any case, single name parts only as written, so ordinary words ("will", "grace") are left alone. The banner asks you to review before sharing.

### Fixed (found while building and auditing the above)
- Search now matches what is on screen, so in Anonymize mode a hidden name can't be found (or probed for) by searching it, and "Person A" finds Person A's messages.
- An Instagram shared-post link whose URL had to be masked is shown as text instead of a broken link that could carry a name.
- Sender-filter checkboxes and the identity select no longer hold real names in their `value` attributes while anonymized.
- The media viewer, download links and "can't preview" cards use the displayed (masked) attachment name.
- WhatsApp's own generated attachment names (`IMG-20240101-WA0001.jpg`) are never mistaken for phone numbers.

### Tests
- `tests/anonymize.test.mjs`: aliases, collisions, case rules, emails/phones/handles, dates and counters that must not be masked, RTL/emoji names, HTML and regex metacharacters in names, pathological inputs (linear time), group-event name extraction, and end-to-end checks that run the real WhatsApp and Instagram parsers and the real HTML export with Anonymize on and assert no original name, number or email survives.
