# ChatLume

A private chat viewer for your WhatsApp and Instagram exports. Everything runs in your browser — your chats never touch a server.

**Live:** [chatlume.parassharma.in](https://chatlume.parassharma.in)

---

## Why this exists

I built ChatLume for my girlfriend. She wanted to reread old WhatsApp chats in something nicer than a wall of `.txt`, and see little stats — who texted more, which emojis showed up most, what time of day we talked. But she didn't want to upload years of private messages to some random website.

So I made the simplest thing that could work: a tool that opens your export *locally*. No uploads. No accounts. No tracking pixels following you around. The file you pick is read by your own browser and nothing leaves the tab.

People kept asking for it, so here it is.

## What it does

- **Opens WhatsApp exports** — both the plain `.txt` and the full `.zip` (with media)
- **Opens Instagram DMs** — the JSON-format export `.zip`
- **Looks like the real thing** — bubbles, dates, media, voice notes, reactions
- **Shows you stats** — message counts, top emojis, activity by hour, who said how much
- **Exports to HTML** — save a clean, self-contained copy of any chat (see below)
- **Stays private** — 100% in-browser, nothing uploaded, nothing stored
- **Works offline** — once loaded, you can pull the plug
- **Handles big files** — multi-GB zips stream through without eating your RAM

## HTML Export

Open a chat, then use the menu (⋮) → **Export HTML**. You get a single `.html` file you can open in any browser, email to yourself, or archive.

To keep it small and fast, **media isn't embedded** — each photo, video, voice note, or document shows up as a labelled card with its original filename (e.g. `IMG-20240115-WA0012.jpg`), so you can always find it back in your export folder. The exported file is themed to match the viewer (WhatsApp green, Instagram dark), has all its CSS inlined, and depends on nothing external.

## How to use it

1. Export your chat from WhatsApp (Chat → More → Export) or Instagram (Settings → Download your information → JSON)
2. Go to [chatlume.parassharma.in](https://chatlume.parassharma.in)
3. Drop the file in — or tap to pick it
4. View, search, and explore

[How-to guides](https://chatlume.parassharma.in/public/how-to-export.html) · [Privacy](https://chatlume.parassharma.in/privacy.html)

## How it works (the privacy bit)

Everything happens client-side using browser APIs. There is no backend that ever sees your data.

For zips, ChatLume uses [zip.js](https://gildas-lormeau.github.io/zip.js/) with a `BlobReader`, so the archive is never loaded into memory all at once:

1. Only the zip's directory is read on open — file data stays compressed on disk.
2. The chat text (`_chat.txt` / `message_N.json`) is decompressed on demand and streamed line-by-line into the parser. The full text string is never held in memory.
3. Media is loaded lazily — a photo is only decompressed into a temporary URL when it scrolls into view, and that URL is released when it scrolls away.

Peak memory for a multi-GB export is roughly: a few MB of decompression buffer + the parsed message objects. The zip itself is never buffered. The real ceiling is RAM for the message list, not file size.

## Browser support

| Browser | Minimum | Large files |
|---|---|---|
| Chrome / Edge | 80+ | ✅ |
| Firefox | 79+ | ✅ |
| Safari | 16.4+ | ✅ |
| Older | — | ⚠️ 1 GB cap + warning banner |

On browsers without `DecompressionStream` / `WritableStream`, ChatLume falls back to a compatibility mode capped at 1 GB.

## Tech

Plain HTML, CSS, and vanilla JavaScript. No frameworks, no build step. [zip.js](https://gildas-lormeau.github.io/zip.js/) for streaming zip parsing, a service worker for offline use. That's it.

## A note on support

ChatLume support is **temporarily paused** after the v1.2.2 update. The tool keeps working exactly as-is — nothing breaks, nothing expires. Support will resume; there's just no confirmed date yet.

## Support the project

ChatLume is free forever. If it saved you some hassle, you can [donate](https://chatlume.parassharma.in/donate.html). I built it in my spare time and every bit helps.

## Built by

[Paras Sharma](https://parassharma.com) · [GitHub](https://github.com/parassharma2306) · [Twitter](https://twitter.com/parassharma2306)

## License

MIT
