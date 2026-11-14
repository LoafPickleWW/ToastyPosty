# 🍞🥒 Toasty Posty

**All the posts that are fit to toast.**

A free, open-source social media scheduler from [LoafPickle Worldwide](https://loafpickle.com). Connect **X, Bluesky, Reddit, Instagram and TikTok**, write once, check a proof for each platform, then post now or schedule it. Add a **Claude** or **OpenAI** key to get caption drafts, rewrites, alt text and AI images.

There's no sign-up, no database and no telemetry. Your accounts, keys, posts and media are saved **in your own browser**. The server is a stateless relay: it forwards each request to the network or AI provider and keeps nothing. Run it on your own computer or deploy it to Vercel.

---

## Run it on your computer

You need [Node.js 20+](https://nodejs.org).

```bash
git clone <this repo> toasty-posty
cd toasty-posty
npm install
npm start
```

Open **http://localhost:4848**. That's it.

- Change the port with `PORT=5000 npm start`.
- Scheduled posts go out while Toasty Posty is **open in a browser tab** (a background tab is fine). Anything that came due while it was closed goes out the moment you open it again.

## Deploy to Vercel

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new). No settings to change: `vercel.json` sets the build (`npm run build`), the output folder (`dist`) and the API function (`api/index.js`).
2. **Optional: lock it.** Add an `ACCESS_CODE` environment variable. Visitors then need the code before the app will relay anything, so strangers can't use your deployment. Their data still stays in their own browser.
3. **Optional: Instagram.** In the project, open **Storage → Create → Blob** and connect it. Instagram fetches photos from a public URL, so Toasty Posty puts each file in Blob right before posting and deletes it once Instagram has it. TikTok photo posts use it too.
4. **Optional: your domain.** Set `SITE_URL` (e.g. `https://toastyposty.com`) so share cards, canonical links and the sitemap use it. Otherwise the Vercel production domain is used.
5. **TikTok login:** register `https://<your-site>/oauth-tiktok` as the redirect URI in your TikTok app.

Limits on Vercel: each request can carry about 4MB, so big videos (TikTok, Reels) should be posted from a local install. Feed fetches and posts run inside a 60-second function limit.

## What's inside

| Page | What it does |
|---|---|
| **Compose** | Pick the accounts, write once, add photos or video. Each platform gets a live preview shaped like a slice of toast, with a toast icon that browns as you near the character limit. Your picked accounts load into a mint 1950s **toaster** as slices with each network's logo branded in. Turn the **browning dial** to choose when it posts, then pull the **lever**: the slices sink, the slots glow, and they pop back up toasted (or burnt, with the exact error). |
| **Video** | A studio that turns photos into a vertical video for TikTok and Reels. Pick one of 10 templates based on what's working in short-form right now: **Photo Dump** (beat-synced cuts with a zoom punch), **Soft Memories** (slow zooms, crossfades, warm grain), **Before & After** (slider wipe between pairs), **Countdown** (a "top 5" that counts down to #1), **Carousel Swipe**, **Collage Reveal**, **Polaroid Pile**, **Shop the Look** (a product card with name, brand and price on each photo, then a "shop it all" end card), **Vintage Reel** (film grade, sprockets, date stamp) and **Glitch Cut**. Add as many captions as you like with 12 fonts (including TikTok Sans), 7 styles (outline, TikTok box, subtitle, shadow, sticker, glow, plain), any colour, and animations like word-by-word and karaoke highlight. Drag captions on the video to move them, drag the corner to resize, and time each one to the whole video or to certain photos. Add a song, export a 1080p MP4 (WebM where a browser can't make MP4), then download it or drop it straight into a post (Shop the Look carries its product links along). Everything renders in your browser, and the project is saved there until you hit **Clear project**. |
| **Shop this post** | In Compose, add affiliate product links (LTK, ShopMy, Amazon or any store). Each platform gets them in the form that works there: clickable links on X, Bluesky and Reddit, and a "link in bio" or "comment KEYWORD" call to action on Instagram and TikTok, where caption links aren't clickable. An **#ad** disclosure goes at the top of the post, your **Amazon Associates tag** is added to Amazon links, typed prices are left off Amazon products (their rules), and TikTok posts get its commercial-content disclosure (Your brand / Branded content). Set your tag, shop link and disclosure wording in Settings. |
| **Queue** | The toast rack. Each day of the week is a slice that browns with how many posts it holds. Posts are grouped by day: Scheduled, Drafts, Posted, Failed. Failed posts show the platform's exact error, and **Retry failed** only re-sends to the accounts that failed. |
| **Feeds** | Columns side by side, from two kinds of sources. **From the web** (free, no keys): track a topic by keywords (searches Google News, Hacker News and Reddit at once), or follow any RSS/Atom link, a Medium writer, Substack, YouTube channel, subreddit, public Bluesky or Mastodon profile, GitHub releases, or Hacker News. **From your accounts**: your timelines, searches and subreddits. Any column can be filtered to posts that mention certain words, and matches are highlighted. Columns refresh every 5 minutes. Hit **Toast this** on any item to start a post about it, and with an AI key, **Write a post about this** drafts one in your voice with the link included. |
| **Accounts** | One card per network. Connect as many accounts as you like, and every card has a **How to get keys** guide. |
| **Settings** | AI keys, your writing voice, public media (Vercel Blob, or a tunnel when self-hosted), the theme (Butter, Burnt, or Auto), and **Download backup / Restore**. |

Platform logos come from [Simple Icons](https://simpleicons.org) (CC0) and are bundled locally. They're trademarks of their owners and are only used to identify each network.

## Getting API keys

The full step-by-step guides live inside the app (Accounts → **How to get keys**). The short version:

| Network | What you need | Difficulty | Notes |
|---|---|---|---|
| **Bluesky** | Handle + an **App Password** (Settings → Privacy and security → App passwords) | 🥒 | Images up to 4, under 1MB each (big photos are shrunk automatically). |
| **X / Twitter** | A developer app set to **Read and write**, then the API Key/Secret + Access Token/Secret | 🥒🥒🥒 | Posting works on the entry tiers. Reading timelines usually needs paid access. Images only for now. |
| **Reddit** | A **script** app at reddit.com/prefs/apps (client ID + secret) plus your username/password | 🥒🥒 | New apps may need Reddit's API access approval first. Text, link, and single-image posts. 2FA accounts are awkward; use a dedicated account. |
| **Instagram** | A **professional** IG account + a Meta app with *Instagram API with Instagram Login*, then generate a token | 🥒🥒🥒🥒 | Needs a **Public URL** (see below). Tokens last ~60 days; use **Refresh token** on the Accounts page. Video posts as Reels. |
| **TikTok** | A TikTok developer app with Login Kit + Content Posting API (Direct Post) + Display API | 🥒🥒🥒🥒🥒 | Unaudited apps can only post **privately** (Only me). OAuth needs an https redirect, so you need a stable Public URL. |

### Public media when self-hosting (Instagram & TikTok)

On Vercel, connect a Blob store and skip this. On your own computer, Instagram fetches your photo from a URL instead of accepting an upload, and TikTok only redirects logins to https. So these two need a public https address that reaches Toasty Posty. A free tunnel does the job:

```bash
cloudflared tunnel --url http://127.0.0.1:4848
```

Paste the `https://….trycloudflare.com` address into **Settings → Public URL**.

**Only the media you're posting (`/pub/*`, removed after posting) and the TikTok login page are reachable through the tunnel.** Every other request from a non-localhost hostname gets a 403. For TikTok, use a tunnel with a stable hostname (a named Cloudflare tunnel or an ngrok static domain) because the redirect URI has to be registered in advance.

## AI (optional, and locked until you add a key)

| Feature | Claude key | OpenAI key |
|---|---|---|
| Draft a version for every selected platform (from notes and/or the attached image) | ✅ | ✅ |
| Rewrite: shorter, add a hook, fix grammar, less salesy | ✅ | ✅ |
| Alt text from an image | ✅ | ✅ |
| Generate images | — | ✅ |

Without a key, the AI tools show a padlock and a link to add one. Claude defaults to `claude-opus-5-5`; you can pick Sonnet or Haiku in Settings. Add a **house voice** there too (how you write, words you'd never use) and every draft follows it.

## Where your data lives

- **In your browser** (IndexedDB): accounts, API keys, posts, feeds, settings and media. Another browser or device starts empty. **Settings → Download backup** saves everything (including keys, so keep the file private), and **Restore** loads it anywhere.
- **Not on the server.** `server/app.js` is stateless: each request carries what it needs, gets forwarded to the network or AI provider, and is forgotten. Nothing is logged or written to disk (except, when self-hosting, a temporary copy of media you're posting to Instagram).
- **Upgrading from the first version?** If `data/db.json` exists, the first browser you open imports it automatically, and the file is renamed so it isn't imported twice.

## SEO, share cards and icons

- `index.html` and `about.html` carry full meta tags, Open Graph + X/Twitter cards and JSON-LD (`SoftwareApplication`, `WebSite`, `Organization`, and an `FAQPage` on About).
- `/about` is a static page with the full story, so search engines and AI answer engines can read it without running JavaScript.
- `robots.txt` (AI crawlers explicitly welcome), `sitemap.xml`, `llms.txt` and `site.webmanifest` (installable app).
- Pages use a `%SITE_URL%` placeholder. `npm run build` fills it in for Vercel; `npm start` fills it in on the fly.
- The share image and icons are generated from `public/img/logo.svg` by `npm run brand`: `og.png` (1200×630), `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and a maskable icon. Edit the logo or the card in `scripts/brand.mjs` and re-run it.

## Project layout

```
api/index.js        Vercel entry: routes /api/* to the relay
server/
  app.js            The stateless relay (platforms, feeds, AI, public media)
  index.js          Local runner: serves the app + relay on localhost
  media-host.js     Public media for Instagram: Vercel Blob or a temp folder
  rss.js            RSS/Atom fetching + topic searches
  ai.js             Claude / OpenAI helpers
  platforms/        x.js · bluesky.js · reddit.js · instagram.js · tiktok.js
public/
  index.html        App shell + SEO metadata
  about.html        Crawlable About page + FAQ
  css/              toast.css (base) · toaster.css (Chrome & Crust identity) · studio.css (Video)
  js/
    db.js           IndexedDB storage
    local-api.js    The in-browser "kitchen": data, scheduling, publishing
    studio/         engine.js: video templates, captions and MP4 export (canvas + MediaRecorder)
    views/          compose · studio · rack · spread · pantry · settings
scripts/
  site.mjs          Vercel build: copy public/ to dist/ and fill in SITE_URL
  brand.mjs         Render share image + icons from the logo
```

No framework. Edit a file and refresh.

### Adding a network

Make `server/platforms/<name>.js` that exports `{ id, name, limits, fields, feedTypes, verify(), publish(), feed() }` (media arrives as `m.data` buffers, or `m.publicUrl` for networks that fetch by URL), register it in `server/platforms/index.js`, and add a guide in `public/js/guides.js`. The UI picks it up automatically.

## Known gaps / good first PRs

- Video upload for X and Bluesky
- Reddit galleries and flair picker
- Bluesky threads and link-card embeds
- Recurring posts and an evergreen queue
- Optional passphrase encryption for keys stored in the browser
- Server-side scheduling for people who want posts to go out with every tab closed

## License

MIT. Made with brine by LoafPickle Worldwide.
