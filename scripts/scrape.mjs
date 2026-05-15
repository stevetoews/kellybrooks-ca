/**
 * One-time scraper: fetches kellybrooks.ca, downloads images, generates content files.
 * Run: node scripts/scrape.mjs
 */

import { load } from 'cheerio';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE_URL = 'https://kellybrooks.ca';

const PAINTING_SLUGS = [
  'camelia', 'bulb-quad', 'ghost', 'iris-pods', 'juicy-fruit', 'bend', 'bow',
  'choke', 'dip-and-twirl', 'farewell-my-friend', 'flow', 'hang-on',
  'hello-goodbye', 'hug', 'pod-cast', 'stretch', 'sixth-fig',
];

const BLOG_SLUGS = [
  'my-master-frame-maker', 'new-paint-brush-from-florence', 'the-show-is-up',
  'blustery-day', 'persimmon', '14-paintings', '260', 'naked-ladies',
  'bountiful', 'signs-of-life', '207', 'where-have-i-been', 'since-its-valentines-day',
];

const SHOW_SLUGS = ['force-of-nature', 'double-life'];

const STATIC_PAGES = [
  { key: 'bio', url: `${BASE_URL}/bio/` },
  { key: 'artists-statement', url: `${BASE_URL}/bio/artists-statement/` },
  { key: 'contact', url: `${BASE_URL}/contact/` },
  { key: 'shows', url: `${BASE_URL}/shows/` },
];

const failures = [];
let imageCount = 0;
let imageTotalBytes = 0;

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    console.log(`  GET ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      failures.push({ url, reason: `HTTP ${res.status}` });
      console.warn(`    ✗ HTTP ${res.status}`);
      return null;
    }
    return res.text();
  } catch (e) {
    failures.push({ url, reason: e.message });
    console.warn(`    ✗ ${e.message}`);
    return null;
  }
}

/** Strip WP -NNNxNNN resize suffix from image URLs */
function originalUrl(url) {
  return url.replace(/-\d+x\d+(\.[a-zA-Z]{2,5})$/, '$1');
}

/** Derive a safe local filename from a URL */
function imageFilename(url) {
  try {
    const u = new URL(url, BASE_URL);
    return path.basename(u.pathname).split('?')[0];
  } catch {
    return null;
  }
}

async function downloadImage(srcUrl, fallbackUrl) {
  const fname = imageFilename(srcUrl) || imageFilename(fallbackUrl);
  if (!fname) return null;

  const destPath = path.join(ROOT, 'public', 'images', fname);
  if (existsSync(destPath)) return fname; // already have it

  const urls = [...new Set([originalUrl(srcUrl), srcUrl, fallbackUrl].filter(Boolean))];

  for (const tryUrl of urls) {
    try {
      const res = await fetch(tryUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      await writeFile(destPath, Buffer.from(buf));
      imageCount++;
      imageTotalBytes += buf.byteLength;
      console.log(`    ↓ ${fname} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
      return fname;
    } catch {
      // try next
    }
  }

  failures.push({ url: srcUrl, reason: 'image download failed' });
  console.warn(`    ✗ image failed: ${fname}`);
  return null;
}

// ─── HTML cleaning ─────────────────────────────────────────────────────────────

const WP_JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  '.sharedaddy', '.jp-relatedposts', '.wpcf7', '.jetpack-sharing-buttons',
  '[id^="sharing_"]', '[class*="sd-button"]',
  '.wp-block-spacer', '.wp-block-separator',
  '.entry-meta', '.post-navigation', '.navigation',
  '#respond', '.comments-area',
  '.site-header', '.site-footer', '.sidebar', '.widget-area',
];

async function cleanContent($, $el) {
  WP_JUNK_SELECTORS.forEach(sel => $el.find(sel).remove());

  // Strip Gutenberg block comments (these appear as text nodes, cheerio keeps them)
  // We'll strip from the raw HTML after

  const imagePromises = [];

  $el.find('img').each((_, el) => {
    const $img = $(el);
    let src = $img.attr('src') || $img.attr('data-src') || '';

    // Drop tracking pixels, emoji, gravatar, staging
    if (!src || src.includes('gravatar.com') || src.includes('s.w.org') ||
        src.includes('/staging/') || src.length < 20) {
      $img.remove();
      return;
    }

    if (!src.startsWith('http')) {
      src = BASE_URL + (src.startsWith('/') ? '' : '/') + src;
    }

    const fallback = src;
    const orig = originalUrl(src);

    imagePromises.push(
      downloadImage(orig, fallback).then(fname => {
        if (fname) {
          $img.attr('src', `/images/${fname}`);
          $img.removeAttr('srcset').removeAttr('sizes')
              .removeAttr('data-src').removeAttr('data-large-file')
              .removeAttr('data-medium-file').removeAttr('data-recalc-dims');
          $img.attr('loading', 'lazy').attr('decoding', 'async');
        } else {
          $img.remove();
        }
      })
    );
  });

  await Promise.all(imagePromises);

  // Rewrite internal links
  $el.find('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.includes('/staging/')) { $a.attr('href', '#'); return; }
    if (href.startsWith(BASE_URL)) {
      let rel = href.slice(BASE_URL.length) || '/';
      // Remap bare blog slugs to /blog/[slug]/
      for (const slug of BLOG_SLUGS) {
        if (rel === `/${slug}` || rel === `/${slug}/`) {
          rel = `/blog/${slug}/`;
          break;
        }
      }
      $a.attr('href', rel);
    }
  });

  // Remove empty paragraphs left by WP
  $el.find('p').each((_, el) => {
    if (!$(el).text().trim() && !$(el).find('img').length) $(el).remove();
  });

  let html = $el.html() || '';
  // Strip Gutenberg block comments
  html = html.replace(/<!--\s*(\/?)wp:[^\-].*?-->/gs, '');
  // Strip leftover WP shortcodes
  html = html.replace(/\[[a-z_]+ [^\]]*\]/g, '');
  html = html.replace(/\[\/[a-z_]+\]/g, '');

  return html.trim();
}

function findContent($) {
  const candidates = [
    '.entry-content', '.post-content', 'article .content',
    '#content article', '.hentry', 'main article', 'article',
  ];
  for (const sel of candidates) {
    const $el = $(sel).first();
    if ($el.length && $el.text().trim().length > 30) return $el;
  }
  return null;
}

function extractMeta($) {
  return {
    title: $('h1.entry-title, h1.page-title, .entry-header h1').first().text().trim()
        || $('h1').first().text().trim(),
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    date: ($('meta[property="article:published_time"]').attr('content')
        || $('time[datetime]').first().attr('datetime') || '').split('T')[0],
  };
}

// ─── Per-type scrapers ─────────────────────────────────────────────────────────

async function scrapePainting(slug, order) {
  const html = await fetchPage(`${BASE_URL}/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const meta = extractMeta($);
  const title = meta.title || slug.replace(/-/g, ' ');

  // Featured image: OG > wp-post-image > first content img
  let imgSrc = meta.ogImage && !meta.ogImage.includes('/staging/') ? meta.ogImage : '';

  if (!imgSrc) {
    imgSrc = $('.wp-post-image, .post-thumbnail img, .attachment-full')
      .first().attr('src') || '';
  }

  if (!imgSrc) {
    const $c = findContent($);
    if ($c) imgSrc = $c.find('img').first().attr('src') || '';
  }

  let imageFile = '';
  if (imgSrc && !imgSrc.includes('/staging/')) {
    imageFile = await downloadImage(originalUrl(imgSrc), imgSrc) || '';
  }

  if (!imageFile) {
    failures.push({ url: `${BASE_URL}/${slug}/`, reason: 'no painting image found' });
  }

  // Size / media from content text
  const $c = findContent($);
  let size = '', media = '';
  if ($c) {
    const txt = $c.text();
    const sizeM = txt.match(/\d+["']?\s*x\s*\d+["']?\s*(inch(?:es)?|cm|")?/i);
    if (sizeM) size = sizeM[0].trim();
    const mediaM = txt.match(/(?:oil|acrylic|watercolou?r|gouache|pastel|graphite|encaustic|mixed media)\s+on\s+\w+(?:\s+\w+)?/i);
    if (mediaM) media = mediaM[0].trim();
  }

  const md = `---
title: ${JSON.stringify(title)}
image: ${JSON.stringify(imageFile ? `/images/${imageFile}` : '')}
${size ? `size: ${JSON.stringify(size)}` : ''}
${media ? `media: ${JSON.stringify(media)}` : ''}
order: ${order}
${meta.date ? `date: "${meta.date}"` : ''}
---
`;

  await writeFile(
    path.join(ROOT, 'src', 'content', 'paintings', `${slug}.md`),
    md, 'utf-8'
  );
  console.log(`  ✓ painting/${slug}`);
}

async function scrapeBlogPost(slug) {
  // WP blog posts can be at root or /blog/slug/
  let html = await fetchPage(`${BASE_URL}/${slug}/`);
  if (!html) html = await fetchPage(`${BASE_URL}/blog/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const meta = extractMeta($);
  const title = meta.title || slug.replace(/-/g, ' ');
  const date = meta.date || '2022-01-01';

  let imgSrc = meta.ogImage && !meta.ogImage.includes('/staging/') ? meta.ogImage : '';
  if (!imgSrc) {
    imgSrc = $('.wp-post-image, .post-thumbnail img').first().attr('src') || '';
  }

  let imageFile = '';
  if (imgSrc && !imgSrc.includes('/staging/')) {
    imageFile = await downloadImage(originalUrl(imgSrc), imgSrc) || '';
  }

  const $c = findContent($);
  let body = '';
  if ($c) {
    // Remove the featured image from body (it goes in frontmatter)
    $c.find('.wp-post-image, .post-thumbnail').closest('figure').remove();
    body = await cleanContent($, $c);
  }

  const md = `---
title: ${JSON.stringify(title)}
date: "${date}"
${imageFile ? `image: "/images/${imageFile}"` : ''}
---

${body}
`;

  await writeFile(
    path.join(ROOT, 'src', 'content', 'blog', `${slug}.md`),
    md, 'utf-8'
  );
  console.log(`  ✓ blog/${slug}`);
}

async function scrapeShow(slug) {
  const html = await fetchPage(`${BASE_URL}/shows/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const meta = extractMeta($);
  const title = meta.title || slug.replace(/-/g, ' ');

  let imgSrc = meta.ogImage && !meta.ogImage.includes('/staging/') ? meta.ogImage : '';
  if (!imgSrc) {
    imgSrc = $('.wp-post-image, .post-thumbnail img').first().attr('src') || '';
  }

  let imageFile = '';
  if (imgSrc && !imgSrc.includes('/staging/')) {
    imageFile = await downloadImage(originalUrl(imgSrc), imgSrc) || '';
  }

  const $c = findContent($);
  let body = '';
  if ($c) body = await cleanContent($, $c);

  const md = `---
title: ${JSON.stringify(title)}
${meta.date ? `date: "${meta.date}"` : ''}
${imageFile ? `image: "/images/${imageFile}"` : ''}
---

${body}
`;

  await writeFile(
    path.join(ROOT, 'src', 'content', 'shows', `${slug}.md`),
    md, 'utf-8'
  );
  console.log(`  ✓ show/${slug}`);
}

async function scrapeStaticPage({ key, url }) {
  const html = await fetchPage(url);
  if (!html) return;

  const $ = load(html);
  const meta = extractMeta($);
  const title = meta.title || key;

  const $c = findContent($);
  let body = '';
  if ($c) body = await cleanContent($, $c);

  await writeFile(
    path.join(ROOT, 'src', 'data', 'pages', `${key}.json`),
    JSON.stringify({ title, html: body }, null, 2),
    'utf-8'
  );
  console.log(`  ✓ page/${key}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function ensureDirs() {
  for (const d of ['public/images', 'src/content/paintings', 'src/content/shows',
                    'src/content/blog', 'src/data/pages']) {
    await mkdir(path.join(ROOT, d), { recursive: true });
  }
}

async function main() {
  console.log('=== Kelly Brooks Scraper ===\n');
  await ensureDirs();

  console.log('\n--- Paintings ---');
  for (let i = 0; i < PAINTING_SLUGS.length; i++) {
    await scrapePainting(PAINTING_SLUGS[i], i + 1);
  }

  console.log('\n--- Blog posts ---');
  for (const slug of BLOG_SLUGS) {
    await scrapeBlogPost(slug);
  }

  console.log('\n--- Shows ---');
  for (const slug of SHOW_SLUGS) {
    await scrapeShow(slug);
  }

  console.log('\n--- Static pages ---');
  for (const page of STATIC_PAGES) {
    await scrapeStaticPage(page);
  }

  const totalMB = (imageTotalBytes / 1024 / 1024).toFixed(2);
  console.log(`\n=== Done ===`);
  console.log(`Pages: ${PAINTING_SLUGS.length + BLOG_SLUGS.length + SHOW_SLUGS.length + STATIC_PAGES.length}`);
  console.log(`Images downloaded: ${imageCount} (${totalMB} MB)`);
  if (failures.length) {
    console.log(`\nFailed fetches (${failures.length}):`);
    failures.forEach(f => console.log(`  ✗ ${f.url}: ${f.reason}`));
  } else {
    console.log('No failures.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
