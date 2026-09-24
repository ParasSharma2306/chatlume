# ChatLume

> A browser-based viewer for WhatsApp and Instagram chat exports.

> [💖 Sponsor this project](https://github.com/sponsors/ParasSharma2306)

<a href="https://www.producthunt.com/products/chatlume?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-chatlume" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1228472&theme=light&t=1787313528828" alt="ChatLume - Shed light on your chats. | Product Hunt" width="250" height="54" /></a>

![Stars](https://img.shields.io/github/stars/ParasSharma2306/chatlume?style=flat-square)
![Forks](https://img.shields.io/github/forks/ParasSharma2306/chatlume?style=flat-square)
![License](https://img.shields.io/github/license/ParasSharma2306/chatlume?style=flat-square)
![Version](https://img.shields.io/badge/version-v1.7.0-blue?style=flat-square)

---

## The Story

ChatLume started as a favor for my girlfriend. She wanted to look back through some old WhatsApp chats, but the export WhatsApp actually gives you is a raw `.txt` wall of text: readable if you squint, but nothing like what the conversation actually looked like. I wanted her to see it the way it happened, so I built a small viewer to do just that.

It turned out better than I expected, so I cleaned it up and put it online. It now handles WhatsApp and Instagram exports, runs entirely in the browser, and can save any chat back out as a standalone HTML file. I built and keep improving it with help from Claude Code and Gemini's Antigravity CLI.

---

## Live

🔗 [chatlume.app](https://chatlume.app)

---

## Features

### Viewing
| Feature | Details |
|---------|---------|
| WhatsApp viewer | Renders `_chat.txt` or `.zip` exports as a real WhatsApp-style chat UI, with sent/received bubbles, grouped messages, sticky date headers and system messages |
| Instagram viewer | Reads Instagram "Download Your Data" JSON archives; pick a conversation from the thread list, filter threads by name, and see reactions, shares, unsent markers and media |
| Media from ZIP | Images, stickers, videos, voice notes (with waveform and duration), documents, contacts and archives are read straight out of the ZIP — nothing is extracted to disk |
| Lazy media | Attachments are decoded only when they scroll into view and released again off-screen, so multi-GB exports stay light on memory |
| Media viewer | Tap any attachment for a full-screen viewer with download |
| Missing attachment cards | Attachments referenced in the chat but absent from the export are shown as clear placeholders instead of broken images |
| Large exports | ZIPs over 1 GB are streamed with the browser's native decompression, so the file is never loaded into memory in full |
| Virtualised list | Only a sliding window of messages is rendered, so 100k-message chats scroll smoothly |
| Rich text | WhatsApp-style **bold**, _italic_, ~strikethrough~, monospace and clickable links |
| Call markers | Missed and completed voice/video calls render as call cards |

### Finding things
| Feature | Details |
|---------|---------|
| Search | Live search across senders, text and attachment names with a match counter and up/down navigation |
| Go to Date | Jump to any day in the chat from the header menu |
| Jump to bottom | One tap back to the latest message |
| Keyboard driven | `Ctrl+F` or `/` to search, `Esc` to close overlays, `Enter` to load |

### Insights
| Feature | Details |
|---------|---------|
| Analytics drawer | Total messages, media count, top emojis, and per-sender share of the conversation |
| ChatLume Wrapped | A shareable summary graphic — messages, words, media, peak hour, top emojis and top contributors — downloadable as a PNG |

### Personalisation
| Feature | Details |
|---------|---------|
| Display name | Tell ChatLume which participant is you so your messages sit on the right |
| Profile picture | Set a local avatar for the header and profile drawer |
| Settings | Time format (original/12h/24h), seconds, time brackets, date format and separator, date brackets, sender names, read ticks, rich text |
| Dark & light themes | Remembered between visits |

### Keeping and sharing
| Feature | Details |
|---------|---------|
| HTML export | Save any chat as a standalone `.html` file — text only, media referenced by filename, opens offline anywhere |
| Persistent Storage (Beta) | Optional and **off by default**: keep imported exports on your device so you don't have to pick the file again after closing ChatLume. Copies the original export into the browser's private storage, chunked and off the main thread, with progress, cancel and quota checks. Manage or delete stored chats from Settings. WhatsApp viewer only for now. |
| Drag & drop | Drop a file anywhere on the page, or use the file picker |
| Installable PWA | Add to your home screen or dock; opens on the ChatLume homepage and works fully offline thanks to a service-worker cache |

### Principles
| Feature | Details |
|---------|---------|
| 100% private | Files are processed in your browser. Nothing is uploaded, ever. |
| No account needed | Open the page, drop a file, done |
| No dependencies | Vanilla HTML, CSS and JavaScript; zip.js is the only runtime library |
| Open source | MIT licensed, self-hostable, forkable |

---

## Privacy

- All parsing happens in the browser via JavaScript
- Your chat files never leave your device
- No server receives any chat content
- No analytics on chat data, no logging
- Nothing is stored between visits unless you turn on **Persistent Storage (Beta)** in Settings, which keeps a copy of the export in the browser's private storage on your own device (deletable any time from Settings)
- Even self-hosted: no backend, no database. It's all static files

Full details: [Privacy Policy](https://chatlume.app/privacy.html)

---

## Persistent Storage (Beta)

Turn it on under **Settings → Persistent Storage**. From then on each export you open is copied into the browser's Origin Private File System (the original ZIP, byte for byte — media is never extracted), with a small metadata record in IndexedDB. On your next visit the chat is listed under **Saved on this device** and the last one you opened is restored automatically.

- Off by default; turning it off never deletes stored chats — deletion is always explicit and confirmed
- Large copies run in a Web Worker in 16 MB chunks with a progress card and a Cancel button
- Space is checked before copying; interrupted copies are cleaned up on the next launch
- Needs a current browser and HTTPS (Chrome/Edge 102+, Firefox 111+, Safari 15.2+); on other browsers the toggle is disabled and importing works as usual
- On iOS, a Home Screen install and a Safari tab keep separate storage, and Safari may evict data from sites you haven't visited in a while — install ChatLume to the Home Screen for the most reliable experience

---

## Browser support

Chrome 80+, Firefox 79+ and Safari 16.4+ get the full experience, including streaming of exports over 1 GB. Older browsers still work with a 1 GB file-size limit and a banner saying so.

---

## Supported Formats

### WhatsApp
- `_chat.txt` (exported without media)
- `.zip` archive (media read directly from inside the .zip via lazy decompression; referenced by filename if exported without media)
- Android and iOS exports in any device language: `/`, `.` and `-` dates, `:` or `.` times, 12/24-hour clocks, day/month/year in any order, localized digits (Persian, Arabic-Indic, Devanagari, …), and calendar eras (`AP` Solar Hijri, `BE` Buddhist) — converted so date search and alternate date formats stay correct
- If detection gets an export wrong, **Settings → Export Dates** lets you pin the date order and calendar
- Not yet supported: fr-CA `07 h 05 min` times, Vietnamese time-first lines, Japanese-era years (`R6/1/1`); Islamic (AH) dates display but aren't converted; Thai two-digit years need Calendar → Buddhist

### Instagram
- `messages_X.json` from Instagram's "Download Your Data" archive (JSON format, not HTML)
- Drop the `.zip` directly or the individual JSON file

---

## HTML Export

- Exports the full conversation as a self-contained `.html` file
- No external dependencies, opens offline in any browser
- Styled to match the viewer (WhatsApp or Instagram theme)
- **Media is not embedded**: images, videos, voice notes appear as placeholder cards showing the original filename (e.g. 🖼️ `IMG-20240115-WA0012.jpg`). This keeps exports lightweight and fast.
- To view media: reference the filename in your original export folder
- Footer on every export: generated by ChatLume + support notice

---

## Self-Hosting

### Option 1: Run locally on your PC

No installation required beyond having Node.js (or Python) available.

```bash
git clone https://github.com/parassharma2306/chatlume.git
cd chatlume
```

Then serve it with any static file server:

```bash
# Using Node.js (npx, no install needed)
npx serve .

# Or using Python
python3 -m http.server 8080
```

Open http://localhost:3000 (or :8080 for Python) in your browser. Done.

No database. No environment variables. No build step.

> Persistent Storage (Beta) needs a secure context. It works on `localhost` and over HTTPS; on a plain-HTTP server the toggle is disabled and everything else works as normal.

---

### Option 2: Host on a VPS

Tested on Ubuntu 22.04+ with Nginx. Assumes you have SSH access to your server.

**1. SSH into your server**
```bash
ssh user@your-server-ip
```

**2. Install Nginx if you haven't**
```bash
sudo apt update && sudo apt install nginx -y
```

**3. Clone the repo**
```bash
cd /var/www
sudo git clone https://github.com/parassharma2306/chatlume.git
sudo chown -R $USER:$USER /var/www/chatlume
```

**4. Configure Nginx**

Create a new site config:
```bash
sudo nano /etc/nginx/sites-available/chatlume
```

Paste this:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    root /var/www/chatlume;
    index index.html;

    location / {
        try_files $uri $uri/ $uri.html =404;
    }
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/chatlume /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Your site is now live on port 80 at your server IP.

---

### Option 3: VPS + Custom Domain + SSL

Continuing from Option 2.

**1. Point your domain to your server**

In your domain registrar or DNS provider (Cloudflare, Namecheap, etc.), add an A record:

```
Type: A
Name: @ (or your subdomain, e.g. chatlume)
Value: your-server-ip
TTL: Auto
```

If using a subdomain like `chatlume.yourdomain.com`:

```
Type: A
Name: chatlume
Value: your-server-ip
```

Wait for DNS to propagate (a few minutes to an hour).

**2. Install Certbot for free SSL**
```bash
sudo apt install certbot python3-certbot-nginx -y
```

**3. Issue the SSL certificate**
```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Follow the prompts. Certbot will automatically update your Nginx config for HTTPS and set up auto-renewal.

**4. Verify**
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Visit https://your-domain.com. You should see ChatLume over HTTPS with a valid certificate.

**5. Automated Deployment (CI/CD)**

We have set up a GitHub Actions workflow to automatically deploy changes when pushed to the `main` branch. 

To use this, add the following Repository Secrets in your GitHub repository (`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`):

*   `VPS_HOST`: Your VPS IP address or hostname.
*   `VPS_USERNAME`: The SSH username (e.g., `root`, `ubuntu`).
*   `VPS_PASSWORD`: The SSH password for that user.
*   `VPS_PORT`: The SSH port (usually `22`, optional).

Ensure the deployment script path (`/path/to/your/app/directory/ChatLume`) in `.github/workflows/deploy.yml` matches where you cloned the repo on your VPS.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework) |
| Parsing | Browser-native JS; [zip.js](https://github.com/gildas-lormeau/zip.js) for ZIP reading |
| Storage (optional) | Origin Private File System + IndexedDB, all on-device |
| Hosting | Nginx on a VPS |
| Deployment | git pull (no build step) |

---

## Contributing

PRs are welcome. The codebase is plain HTML/CSS/JS: no build tools, no bundler, just files.

- Issues: open on GitHub
- PRs: open against `main`
- If you're adding a feature, keep it consistent with the existing no-dependency, browser-only philosophy

**Thanks** to [@namipsg](https://github.com/namipsg) for identifying the calendar-era timestamps, dotted-time locales and RTL attachment-name issues in [#7](https://github.com/ParasSharma2306/chatlume/pull/7); the fixes in v1.6.1 were reimplemented on the current codebase from that report.

### Code layout

No bundler: every file under `js/` is served as-is as an ES module. The two viewers are entry points that wire DOM events to small, single-purpose modules:

```
js/
├── script.js              WhatsApp viewer entry point (boot + event wiring)
├── instagram.js           Instagram viewer entry point
├── whatsapp/              WhatsApp viewer
│   ├── state.js           shared mutable state + constants
│   ├── session.js         open / parse / close a chat
│   ├── parser.js          line-by-line parsing pipeline (drives whatsapp-parser.js)
│   ├── media.js           attachment matching, lazy loading, media viewer
│   ├── render.js          the virtualised message list + export data
│   ├── search.js          in-chat search
│   ├── date-jump.js       "Go to Date"
│   ├── format.js          time / date display per Settings
│   ├── settings-store.js  load / save settings, sync the controls
│   ├── settings-ui.js     react to a setting change
│   ├── persistence.js     Persistent Storage (Beta), viewer side
│   ├── wrapped.js         ChatLume Wrapped graphic
│   ├── stats.js           analytics drawer binding
│   ├── file-picker.js     picker, drop target, window-wide drop overlay
│   └── ui.js              drawers, sheets, toast, loading overlay
├── instagram/             Instagram viewer (same shape: state, session, parser,
│                          threads, media, render, search, ui, mojibake)
├── shared/                utilities both viewers use
│   ├── dom.js             $, escaping, small predicates
│   ├── text.js            links, *bold* _italic_ ~strike~, search highlight
│   ├── media-types.js     file name → kind / MIME, formatBytes
│   ├── media-urls.js      blob-URL lifecycle for ZIP-backed media
│   ├── lazy-media.js      IntersectionObserver hydration
│   ├── media-modal.js     full-screen media viewer
│   ├── virtual-list.js    render window, scroll anchoring, jump-to-latest pill
│   ├── stats-panel.js     analytics drawer markup + animation
│   ├── drop-zone.js       drag-and-drop intake
│   ├── theme.js, toast.js, splash.js, compat.js, history.js,
│   │   colors.js, emoji.js, safe-storage.js
├── whatsapp-parser.js     timestamp / header / attachment parsing (pure, tested)
├── settings.js            settings schema + validation (pure, tested)
├── storage.js             OPFS + IndexedDB layer for Persistent Storage
├── storage-worker.js      chunked copy off the main thread
├── export.js              standalone HTML export
├── support.js             sponsor card
├── site.js, sponsors.js   static-page chrome (classic scripts, not modules)
```

Dependencies point one way: entry → viewer modules → `shared/` → nothing. The only place a lower layer needs to call up (persistent storage reopening a chat) is done by passing callbacks into `initPersistentStorage()` rather than by a circular import.

### Tests

The pure modules (`js/whatsapp-parser.js`, `js/settings.js`, `js/shared/*`, `js/whatsapp/format.js`, `js/instagram/parser.js`, `js/instagram/mojibake.js`) are covered by Node's built-in test runner — no install step:

```bash
npm test          # node --test tests/
npm run check     # node --check on every script under js/ and sw.js
```

Tests import app modules through `tests/versioned.mjs`, which appends the current release token so they always load the same module instances the app does.

### Releasing

Every local script, module and stylesheet URL carries a `?v=<version>` token. It is the cache key: a page from one release can only load that release's files, so an update can never pair a new `script.js` with an old `storage.js`. One command stamps the version everywhere (HTML, `import` specifiers, the storage worker URL, the service worker's precache list, version labels):

```bash
npm run bump -- 1.6.2
npm test          # tests/release-version.test.mjs fails if any token disagrees
```

The service worker installs the new release in the background and *waits*; open pages show a "ChatLume was updated — Reload" prompt instead of being switched underneath. Versioned assets never need a CDN purge — a new release uses new URLs.

---

## License

MIT. Built by [Paras Sharma](https://parassharma.com)

## Sponsors

A special thank you to everyone who supported ChatLume through [GitHub Sponsors](https://github.com/sponsors/ParasSharma2306). Sponsors also appear on the [sponsors page](https://chatlume.app/sponsors.html), which reads from [`sponsors.json`](sponsors.json).

| Sponsor | Amount |
| --- | ---: |
| [nicolevdw](https://github.com/nicolevdw) | $30 |
| [DikshitaBiswas](https://github.com/DikshitaBiswas) | $5 |
| [loochooncheng-netizen](https://github.com/loochooncheng-netizen) | $5 |
