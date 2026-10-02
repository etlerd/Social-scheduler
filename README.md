# Social Scheduler

Self-hosted scheduler for Instagram and YouTube. One composer, calendar, media library and publishing queue. Responsive web app, installable to a phone home screen (PWA).

## What it publishes

| Platform | Content types | How |
|---|---|---|
| Instagram | Feed photo, Carousel (2–10 photos/videos), Reel, Story (photo or video) | Instagram API with Instagram Login. Optional first comment, Reel cover image or frame offset, share-to-feed. |
| YouTube | Video, Short, scheduled Live event | YouTube Data API v3. Title, description, tags, visibility, category, made-for-kids, synthetic-content disclosure, playlist, custom thumbnail, notify subscribers. |

One post can go to several accounts at once, each with its own content type and settings. The composer checks each platform's limits (aspect ratios, durations, file sizes, JPEG-only for Instagram, caption/hashtag/title limits) as you type, and shows a mock preview per destination.

**What the APIs can't do.** Instagram's API doesn't publish to personal accounts, add music, tag products, or post multi-frame stories in one call. YouTube's API can't create Community posts or Premieres. Those aren't in the app.

## How scheduling works

- **Instagram** has no native scheduling API. The app's built-in worker publishes at the scheduled time, so **the server must be running then**.
- **YouTube** public videos/Shorts scheduled 10+ minutes ahead upload immediately as private with `publishAt`; YouTube flips them public on time, even if this server is offline. Unlisted/private posts upload at the scheduled time. Live events are created right away.
- Transient failures (network, 5xx, rate limits) retry 3 times with backoff. Instagram media containers and YouTube resumable upload sessions are saved, so a retry or a server restart resumes rather than double-posting. A restart during a non-resumable step marks the post failed with a "check before retrying" note instead of risking a duplicate.
- Uploaded files are deleted from the server once every post that uses them has published (for YouTube, once the upload is handed to YouTube's scheduler). Files still needed by a draft, scheduled or failed post are kept, as are library uploads no post has used. Posts keep their history; duplicating one asks you to re-upload the media. Set `KEEP_PUBLISHED_MEDIA=true` to keep everything.
- Expired or revoked tokens flag the account for reconnect. Instagram's 60-day tokens refresh automatically.

## Run it

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # set APP_PASSWORD and SECRET_KEY at minimum
npm run build
npm start                    # http://localhost:3000
```

Try it without API credentials: set `ENABLE_DEMO_ACCOUNTS=true`, then add demo accounts on the Accounts page. They run the whole pipeline without calling any API. A caption containing `#fail` simulates a platform error.

## Connect Instagram

1. Account must be **Business or Creator** (Instagram app → Settings → Account type).
2. [Meta for Developers](https://developers.facebook.com/apps) → create an app (Business type) → add the **Instagram** product → *API setup with Instagram login*.
3. Permissions: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` (the last is only for first comments).
4. Business login settings → OAuth redirect URI: `https://YOUR_DOMAIN/api/oauth/instagram/callback`.
5. Put the **Instagram app ID/secret** (not the Facebook app ID) in `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
6. While the app is in development mode, only Instagram accounts added as testers (App roles) can connect. Publishing for anyone else requires Meta app review.

Instagram **downloads media from your server**, so `PUBLIC_URL` must be a public HTTPS address. `localhost` won't work for real Instagram posts. Uploaded files are served at `/media/<random-name>` without auth; names are 128-bit random.

Limit: 100 API-published posts per account per 24 h.

## Connect YouTube

1. [Google Cloud Console](https://console.cloud.google.com) → new project → enable **YouTube Data API v3**.
2. OAuth consent screen: External; add scopes `youtube.upload` and `youtube`; add yourself as a test user.
3. Credentials → OAuth client ID → *Web application* → redirect URI `https://YOUR_DOMAIN/api/oauth/youtube/callback`.
4. Put the client ID/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Things that will bite:
- **Unverified API projects can only upload private videos.** YouTube locks uploads from projects created after July 2020 to private until the project passes Google's [API audit](https://support.google.com/youtube/contact/yt_api_form). The app logs a warning when this happens.
- **Quota:** the default 10,000 units/day covers only a handful of uploads (an upload costs ~1,600). Quota failures are reported, not retried; they reset at midnight Pacific.
- Custom thumbnails require a phone-verified channel. Live events require live streaming enabled on the channel.
- In "Testing" mode, Google refresh tokens expire after 7 days. Publish the consent screen to avoid weekly reconnects.

## Deploy

Needs a host with a **persistent process and persistent disk** (SQLite database and media files live in `DATA_DIR`): a VPS, Fly.io with a volume, Railway, Render with a disk, a home server behind a tunnel. Serverless platforms (Vercel, Netlify) don't fit: no persistent disk, no long-running worker.

Behind a reverse proxy, allow large request bodies (e.g. nginx `client_max_body_size 2g;`) and long timeouts for video uploads.

For hosts that sleep when idle, set `CRON_SECRET` and hit `GET /api/cron` with `Authorization: Bearer <CRON_SECRET>` every minute to run due posts.

## Mobile

The layout switches to a bottom tab bar on phones. Upload uses the native picker (camera roll or camera). In Safari use Share → *Add to Home Screen*; in Chrome, *Install app*. Non-JPEG images (PNG, WebP, HEIC where the browser can decode it) convert to JPEG in the browser before upload, since Instagram accepts only JPEG.

## Development

```bash
npm run dev          # dev server
npm test             # unit tests: rules, post lifecycle, Instagram/YouTube clients against mocked HTTP
npm run lint         # typecheck
npm run build && e2e/run.sh [screenshotDir]   # browser smoke test on desktop + iPhone viewport (needs ffmpeg for fixtures)
```

Layout: `src/lib/rules.ts` holds platform limits, shared by the composer and the API. `src/lib/providers/` has the API clients. `src/lib/worker.ts` is the scheduler, started from `src/instrumentation.ts`. `src/components/` has the UI.

Security: single-user password login (signed cookie). OAuth tokens are encrypted at rest with AES-256-GCM, keyed from `SECRET_KEY`. Back up `DATA_DIR`. Losing `SECRET_KEY` means reconnecting every account.
