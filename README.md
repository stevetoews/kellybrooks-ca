# Kelly Brooks — Static Site

Frozen static rebuild of [kellybrooks.ca](https://kellybrooks.ca), converted from WordPress to Astro.
The artist is retired; content will not change.

## Stack

- [Astro 5](https://astro.build) — static output, zero server
- Tailwind CSS v3
- Cheerio (scraper only, not a runtime dependency)

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Opens at <http://localhost:4321>

## Build

```bash
pnpm build
```

Output goes to `dist/`. No adapter, no server-side code.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in the Vercel dashboard — Vercel auto-detects Astro.
3. No `vercel.json` needed; Vercel's Astro preset handles static output.

Or deploy directly from the CLI:

```bash
vercel --prod
```

## Re-scraping

Content is baked into `src/content/` and `public/images/`. You should never need to re-scrape,
but if you do:

```bash
node scripts/scrape.mjs   # fetch all pages + download images
node scripts/fixup.mjs    # extract content from #content selector
node scripts/fixup2.mjs   # UTF-8 fix + clean HTML + download inline images
pnpm build
```

## Project structure

```
src/
  content/
    paintings/   *.md  — frontmatter: title, image, size, media, order, date
    shows/       *.md  — frontmatter: title, date, image
    blog/        *.md  — frontmatter: title, date, image
  data/pages/    *.json — scraped HTML for one-off pages (bio, contact, etc.)
  layouts/       Layout.astro
  pages/         Astro routes (index, [slug], bio/, blog/, shows/, contact)
public/
  images/        All downloaded painting + blog images (37 files, ~13 MB)
```

## Statistics

| Item | Count |
|------|-------|
| Pages built | 38 |
| Images | 37 files |
| Image total | ~13 MB |
| Failed fetches | 0 |
