# FIELDWRX site

One-page site for FIELDWRX, plain HTML, CSS and JavaScript with one Vercel server function.

- `index.html` is the whole site.
- `media/` holds the Table Mountain day and night photos.
- `api/scan.js` is the "Scan your week" function. It sends a visitor's task list to Claude (Haiku) and returns a first read.

## Settings in Vercel

- `ANTHROPIC_API_KEY` is required.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` are added automatically when you connect **Upstash for Redis** from the Vercel Marketplace (free tier). They power the limit of 3 scans per visitor per hour.
- `SCAN_DAILY_CAP` is optional: the total scans a day across all visitors, 300 by default.

If the Anthropic key or credit runs out, the site falls back to a simple on-page read, so the section never breaks.

## Before launch

- Remove the Live/Day/Night preview switch in the hero.
- Remove `<meta name="robots" content="noindex,nofollow">` from `index.html`.
- Add fieldwrx.co.za under Project → Settings → Domains, then update the DNS at domains.co.za.
