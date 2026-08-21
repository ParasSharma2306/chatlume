# ChatLume

> A browser-based viewer for WhatsApp and Instagram chat exports.

> [💖 Sponsor this project](https://github.com/sponsors/ParasSharma2306)

<a href="https://www.producthunt.com/products/chatlume?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-chatlume" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1228472&theme=light&t=1787313528828" alt="ChatLume - Shed light on your chats. | Product Hunt" width="250" height="54" /></a>

![Stars](https://img.shields.io/github/stars/ParasSharma2306/chatlume?style=flat-square)
![Forks](https://img.shields.io/github/forks/ParasSharma2306/chatlume?style=flat-square)
![License](https://img.shields.io/github/license/ParasSharma2306/chatlume?style=flat-square)
![Version](https://img.shields.io/badge/version-v1.3.1-blue?style=flat-square)

---

## The Story

ChatLume started on February 10, 2026 — built for my girlfriend, who wanted to relive some old memories from her WhatsApp chats. The default export is a raw `.txt` wall of text, completely unreadable. I wanted her to actually see the conversation, the way it looked when it happened.

It turned out decent enough that I released it publicly. Now it handles WhatsApp and Instagram exports, works entirely in the browser, and exports chats as standalone HTML files. Along the way, I've taken help of Claude Code and Gemini/Antigravity CLI to build and refine this project.

---

## What's New in v1.3.1

- **Product Hunt**: ChatLume is live on Product Hunt — the badge is on the homepage, the sponsors page and in the app's info drawer.
- **Motion pass**: Scroll-reveals on the landing page, a sheen on the primary CTA, drawer content stagger, animated analytics (stat count-up, bars that grow from zero), and modal entrances. All of it collapses under `prefers-reduced-motion`.
- **Real empty states**: The viewers now explain themselves when there's nothing to show — idle placeholders with format hints, a full "no messages matched" panel for search, a dedicated state when an export parses but contains no messages, and empty analytics copy instead of a wall of zeroes.
- **Skeletons**: Shimmer placeholders for the sponsors grid, the homepage marquee, and the sidebar chat entry while an export parses.
- **Sponsors rebuilt**: Tiered cards (Gold / Silver / Supporter), a contribution summary, a real CTA section replacing the bare GitHub iframe, plus proper loading / empty / error-with-retry states. Sponsor fields are now HTML-escaped and `javascript:` URLs are rejected.
- **Theme everywhere**: The light/dark choice now applies to the landing, sponsors and guide pages too, and is applied before first paint so there's no flash.
- **Bug fixes**: See the list below.

### Fixed in v1.3.1

- The "try my other projects" dialog inserted a transparent full-screen backdrop 1.5s before revealing itself, silently swallowing every click in that window. It also had no Escape handler and re-appeared on every chat load.
- Sponsor names, messages and avatar URLs were interpolated into `innerHTML` unescaped.
- Toasts were always success-green — failures now render in red, warnings in amber.
- The Instagram toast was styled inline, so it could never pick up those tones.
- Instagram search with no results skipped the re-render, leaving stale highlights from the previous query on screen.
- Missing `<link rel="icon">` on every page but `privacy.html` — browsers were requesting a nonexistent `/favicon.ico`.
- `privacy.html` threw on every load from a leftover script referencing a removed `#yr` element.
- The service worker used `cache.addAll()`, so one missing asset failed the entire install and left no offline cache.
- The sponsors marquee's edge fades were painted with the wrong background variable, leaving visible seams; its scroll speed also ignored how many sponsors there were.
- The Instagram thread picker had no way to filter, which is unusable for exports with hundreds of conversations.

---

## What's New in v1.3.0

- **Sponsors Page Overhaul**: The sponsors page and carousel have been completely redesigned with improved spacing, better cards, avatar support, and graceful error handling. 
- **Dynamic Sponsors**: Sponsors are now loaded dynamically from a single `sponsors.json` source of truth. Adding a sponsor requires simply editing this file, and changes will be reflected in both the dedicated page and the landing page carousel.
- **UI & UX Polish**: Enhanced responsive layouts across devices, refined hover and active states for interactive elements, and resolved visual rough edges.
- **Bug Fixes**: Resolved various minor bugs including overflow issues, missing empty states, and console errors under specific edge cases.

---

## Live

🔗 [chatlume.parassharma.in](https://chatlume.parassharma.in)

---

## Features

| Feature | Details |
|---------|---------|
| WhatsApp viewer | Renders `_chat.txt` or `.zip` exports as a real chat UI |
| Instagram viewer | Renders Instagram JSON export archives |
| HTML Export | Save any chat as a standalone `.html` file — text only, media referenced by filename |
| 100% private | Files processed in your browser. Nothing is uploaded, ever. |
| No account needed | Open the page, drop a file, done. |
| Open source | MIT licensed, self-hostable, forkable |

---

## Privacy

- All parsing happens in the browser via JavaScript
- Your chat files never leave your device
- No server receives any chat content
- No analytics on chat data, no logging, no storage
- Even self-hosted: no backend, no database — it's all static files

---

## Supported Formats

### WhatsApp
- `_chat.txt` (exported without media)
- `.zip` archive (media read directly from inside the .zip via lazy decompression; referenced by filename if exported without media)

### Instagram
- `messages_X.json` from Instagram's "Download Your Data" archive (JSON format, not HTML)
- Drop the `.zip` directly or the individual JSON file

---

## HTML Export

- Exports the full conversation as a self-contained `.html` file
- No external dependencies — opens offline in any browser
- Styled to match the viewer (WhatsApp or Instagram theme)
- **Media is not embedded** — images, videos, voice notes appear as placeholder cards showing the original filename (e.g. 🖼️ `IMG-20240115-WA0012.jpg`). This keeps exports lightweight and fast.
- To view media: reference the filename in your original export folder
- Footer on every export: generated by ChatLume + support notice

---

## Self-Hosting

### Option 1 — Run locally on your PC

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

---

### Option 2 — Host on a VPS

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

### Option 3 — VPS + Custom Domain + SSL

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

Visit https://your-domain.com — you should see ChatLume over HTTPS with a valid certificate.

**5. Automated Deployment (CI/CD)**

We have set up a GitHub Actions workflow to automatically deploy changes when pushed to the `main` branch. 

To use this, add the following Repository Secrets in your GitHub repository (`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`):

*   `VPS_HOST`: Your VPS IP address or hostname.
*   `VPS_USERNAME`: The SSH username (e.g., `root`, `ubuntu`).
*   `VPS_PASSWORD`: The SSH password for that user.
*   `VPS_PORT`: The SSH port (usually `22`, optional).

Ensure the deployment script path (`/path/to/your/app/directory/ChatLume`) in `.github/workflows/deploy.yml` matches where you cloned the repo on your VPS.

---

## ⚠️ Support Notice

ChatLume support is temporarily paused after v1.3.1. The tool is fully stable and functional — this just means bug reports and feature requests won't be actively addressed for a while. Support will resume, but there's no confirmed date yet.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML, CSS, JavaScript — no framework |
| Parsing | Browser-native JS (no libraries) |
| Hosting | Nginx on a VPS |
| Deployment | git pull — no build step |

---

## Contributing

PRs are welcome. The codebase is plain HTML/CSS/JS — no build tools, no bundler, just files.

- Issues: open on GitHub
- PRs: open against `main`
- If you're adding a feature, keep it consistent with the existing no-dependency, browser-only philosophy

---

## License

MIT — built by [Paras Sharma](https://parassharma.com)

## Sponsors

A special thank you to everyone who supported ChatLume through GitHub Sponsors.

| Sponsor | Amount |
| --- | ---: |
| DikshitaBiswas | $5 |