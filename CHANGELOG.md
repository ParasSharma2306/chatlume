# Changelog

All notable changes to ChatLume. Versions match the `?v=` release token (see `scripts/bump-version.mjs`).

## 1.10.0

### Added
- **Media, links and docs** in both viewers (chat menu). A panel over the chat with tabs built only from messages already parsed — nothing is re-read from the export:
  - **Media** (photos and videos) in a grid. Tap opens a lightbox with previous / next buttons, ←/→ (Home/End) keys and swipe; Tab stays inside it and focus returns to the tile of the photo last shown.
  - **Links** (WhatsApp) open in a new tab (`rel="noopener noreferrer"`). Instagram has no Links tab: nearly every Instagram link is a shared reel or post, which would bury everything else, so those stay in the chat.
  - **Docs**: documents, contact cards and archives open in the viewer; voice notes and other audio play and pause inline, one at a time, with progress.
  - **Jump to message**: long-press (about 400ms; moving the finger cancels it, so scrolling never triggers it), right-click, or the Menu key / Shift+F10 opens a small menu. It closes the gallery, scrolls the chat to the message, briefly highlights it and moves focus to it.
  - The browser's own text selection, callout, link preview, context menu and drag ghost are suppressed on gallery items; scrolling and pinch-zoom still work.
  - Clear empty states: a WhatsApp `.txt` export explains that it was exported without media ("&lt;Media omitted&gt;") and links to the export guide; missing files are counted ("1 photo or video mentioned in the chat isn't in this export").
  - Accessible: proper `tablist` / `tab` / `tabpanel` roles with arrow-key navigation, the hidden chat is `inert` while the panel is open, Escape and Back close the topmost layer (menu → lightbox → gallery), and focus returns to where it came from.
  - Fast on huge chats: lists render 40–60 items a page and load more as you scroll; thumbnails decode only near the viewport and are released when they scroll far away; every blob URL the gallery uses is pinned while shown and revoked after (checked on 60,000-message WhatsApp and 50,000-message Instagram chats).
  - Respects Anonymize mode and the sender filter, and repaints in place when either changes.
- **Instagram reel and post cards.** A shared reel, post, IGTV video or story now shows as a cover card (kind, owner handle, caption, "Open on Instagram") instead of a bare link. The export contains no thumbnails, and fetching one from Instagram would send the chat's links off the device, so the cover is drawn locally.

### Fixed
- **Instagram voice notes were shown as videos.** They are `.mp4` files listed under `audio_files`; classification used only the extension. The message structure now wins (in the chat, the gallery, the media viewer and the HTML export), and WhatsApp's own audio names (`PTT-…`, `AUD-…`, iOS `…-AUDIO-…`) stay audio even in an `.mp4` / `.3gp` / `.webm` container. `.opus`, `.ogg` and `.m4a` voice notes were already audio and are now covered by tests.
- **Anonymize: a name inside a link broke the link.** Masking the whole message rewrote `https://example.com/u/Alice%20Smith` into `…/u/Person A`, and the link ended at the space. Links now keep their original target untouched; only the visible text is masked (percent-escapes and `_`-joined words are recognised). The Instagram shared-post link that 1.9.0 showed as plain text when masked is a working link again. The HTML export is unchanged: a link whose URL contains a hidden name is still written as text there, so a file meant for sharing never carries it.
- Lightbox opened from the chat now moves focus into the dialog and back out when closed.

### Tests
- `tests/gallery.test.mjs`: voice-note classification (Instagram `audio_files`, WhatsApp `PTT`/`AUD`/iOS names, `.opus`/`.ogg`/`.m4a`/`.mp4`), share-link kinds (with look-alike hosts), the gallery model (tabs, newest-first order, omitted/missing counts, link extraction and de-duplication, malformed input, 60,000 messages under 500ms), and masked links (href byte-identical, visible text masked, RTL names, injection attempts, identical output to the normal linkifier when nothing is masked, linear time on pathological input).

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
