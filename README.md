# ChatLume

> View your WhatsApp and Instagram chats privately — your files never leave your device.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Live at **[chatlume.parassharma.in](https://chatlume.parassharma.in)**

---

## Features

- **WhatsApp chat viewer** — upload `.txt` or `.zip` exports and browse them in a familiar bubble UI with search, date jump, and inline media
- **Instagram DM viewer** — upload Instagram's JSON export and view your DMs the same way
- **WhatsApp Wrapped** — full analytics dashboard: message counts, sender splits, top emojis, hourly activity, and a downloadable summary card
- **Instagram Wrapped** — same analytics suite for your Instagram DM exports
- **Shareable stats card** — generate and download a visual summary of any chat (Pro)
- **Freemium model** — the last 500 messages are free for everyone; Pro unlocks the full unlimited history
- **JWT authentication** — secure httpOnly cookie sessions, 7-day expiry
- **Pro subscription** — ₹149/month (~$1.80 USD) via Dodo Payments; cancel anytime
- **100% private** — all chat parsing happens in the browser; no file content ever reaches the server

---

## Privacy

This is the most important section.

**Your chat files are never uploaded.** Parsing happens entirely in the browser using the File API and JavaScript. When you load a `.txt` or `.zip` export, it stays on your device — the server receives nothing from it.

What we store on our servers:

| Data | Stored |
|------|--------|
| Your chat messages | ❌ Never |
| Media / attachments | ❌ Never |
| Analytics / stats | ❌ Never |
| Your email address | ✅ Required for accounts |
| Your password | ✅ bcrypt hash only (never plaintext) |
| Subscription status | ✅ `free` or `pro` |

Even on the Pro plan, nothing changes about where your chat data lives. Payments are handled entirely by Dodo Payments — we never see your card or UPI details.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Server | Express 5 |
| Database | MongoDB (via Mongoose) |
| Auth | JWT in httpOnly cookies |
| Payments | Dodo Payments (webhooks + checkout sessions) |
| Frontend | Vanilla JS — no framework, no build step |
| PWA | Service worker + Web App Manifest |

---

## Self-Hosting

### Prerequisites

- Node.js 18+
- MongoDB (local instance or [MongoDB Atlas](https://www.mongodb.com/atlas) free tier)
- A [Dodo Payments](https://dodopayments.com) account if you want the payments feature

### 1. Clone the repo

```bash
git clone https://github.com/ParasSharma2306/chatlume
cd chatlume
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in all values (see the reference table below).

### 4. Run locally

```bash
npm start
```

Visit [http://localhost:3000](http://localhost:3000).

For development with auto-restart:

```bash
npm run dev   # requires nodemon: npm i -g nodemon
```

### 5. Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Port to listen on. Defaults to `3000`. |
| `MONGODB_URI` | Yes | MongoDB connection string. Use `mongodb://127.0.0.1:27017/chatlume` for a local instance or your Atlas URI. |
| `JWT_SECRET` | Yes | Long random string used to sign JWT tokens. Generate one with `openssl rand -hex 64`. |
| `JWT_EXPIRES_IN` | No | JWT lifetime. Defaults to `7d`. |
| `APP_URL` | Yes | Full public URL of your deployment, e.g. `https://chatlume.parassharma.in`. Used to build the Dodo checkout return URL. |
| `DODO_API_KEY` | Payments only | API key from the Dodo Payments dashboard. |
| `DODO_WEBHOOK_SECRET` | Payments only | Webhook signing secret from the Dodo dashboard. Used to verify that incoming webhook calls are genuine. |
| `DODO_PRODUCT_ID` | Payments only | The product/plan ID for your Pro subscription in Dodo. |

### 6. Setting up Dodo Payments (optional)

If you want the Pro subscription flow:

1. Create an account at [dodopayments.com](https://dodopayments.com).
2. Create a product with a monthly recurring price of your choosing.
3. Copy the product ID into `DODO_PRODUCT_ID`.
4. Generate an API key and copy it into `DODO_API_KEY`.
5. In the Dodo dashboard, register a webhook pointing to `https://your-domain.com/api/payments/webhook`.
6. Copy the generated webhook secret into `DODO_WEBHOOK_SECRET`.

Without these values the app runs fine — the upgrade button will error, but all free features work normally.

### 7. Deploying to Railway (recommended)

[Railway](https://railway.app) offers a generous free tier and zero-config Node.js deploys.

1. Push your repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select your forked repository. Railway auto-detects `npm start`.
4. Add all environment variables in the **Variables** tab.
5. Add a custom domain in **Settings → Domains**.
6. Railway auto-deploys on every push to your default branch.

For MongoDB, add a **MongoDB** plugin inside Railway or use a free [Atlas](https://www.mongodb.com/atlas) cluster and paste the connection string into `MONGODB_URI`.

---

## Project Structure

```
chatlume/
├── routes/
│   ├── auth.js          # signup, login, logout, /api/auth/me
│   └── payments.js      # checkout session, webhook handler, subscription status
├── middleware/
│   └── auth.js          # verifyToken middleware (JWT from cookie)
├── models/
│   └── User.js          # Mongoose schema: email, passwordHash, subscription
├── public/
│   ├── viewer.html      # WhatsApp chat viewer
│   ├── instagram-viewer.html
│   ├── analyzer.html    # WhatsApp Wrapped
│   ├── instagram-analyzer.html
│   ├── wrapped.html
│   ├── account.html     # Account & subscription management
│   ├── pricing.html
│   ├── login.html
│   ├── signup.html
│   └── ...              # How-to guides, privacy policy
├── js/
│   ├── script.js        # WhatsApp parser + viewer logic
│   ├── instagram.js     # Instagram DM parser + viewer logic
│   └── auth.js          # Shared auth state + nav injection
├── css/
│   └── style.css
├── assets/              # Icons and favicon
├── server.js            # Express app entry point
├── sw.js                # Service worker (PWA)
├── manifest.json
└── .env.example
```

---

## Migration Note

> ⚠️ ChatLume migrated from a fully static site to a dynamic Express + MongoDB backend. The static version has been sunset. All features now require the Node.js server — you can no longer just open `index.html` directly in a browser.

The privacy model has **not** changed. Chat data still never leaves the browser. The backend exists solely for user accounts and subscriptions.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

**Paras Sharma**
- Website: [parassharma.in](https://parassharma.in)
- GitHub: [@ParasSharma2306](https://github.com/ParasSharma2306)
