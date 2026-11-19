# FIELDWRX site

The fieldwrx.co.za website: plain HTML, CSS and JavaScript, hosted on Vercel. Every push to `main` deploys to production, so changes go to a branch preview first.

- `index.html` is the home page and `about.html` the About page.
- `film/` is the short animated film embedded on the home page.
- `api/contact.js` sends booking requests by email through Resend.
- `api/scan.js` runs "What's in your way", a first read by Claude (Haiku) of what a visitor lists.
- `vendor/` holds third-party scripts, served from our own site.
- `vercel.json` sets the security headers, including the Content Security Policy. A new outside script, font or service must be added there, or browsers will block it.

## Settings in Vercel

- `ANTHROPIC_API_KEY`: for the scanner.
- `RESEND_API_KEY` and `CONTACT_TO`: for the booking form. `CONTACT_FROM` is optional.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: added by the Upstash for Redis integration. They power the per-visitor limits on both forms.
- `SCAN_DAILY_CAP`: optional, total scans a day across all visitors (300 by default).

If the scanner can't reach Claude, the page falls back to a simple on-page read, so the section never breaks.
