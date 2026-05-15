/**
 * Patches missing content: painting size/media, show HTML, static page HTML.
 * Uses #content which is the correct selector for this WordPress theme.
 */

import { load } from 'cheerio';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE_URL = 'https://kellybrooks.ca';

const PAINTING_SLUGS = [
  'camelia','bulb-quad','ghost','iris-pods','juicy-fruit','bend','bow',
  'choke','dip-and-twirl','farewell-my-friend','flow','hang-on',
  'hello-goodbye','hug','pod-cast','stretch','sixth-fig',
];

const BLOG_SLUGS = [
  'my-master-frame-maker','new-paint-brush-from-florence','the-show-is-up',
  'blustery-day','persimmon','14-paintings','260','naked-ladies',
  'bountiful','signs-of-life','207','where-have-i-been','since-its-valentines-day',
];

const SHOW_SLUGS = ['force-of-nature','double-life'];

const STATIC_PAGES = [
  { key: 'bio', url: `${BASE_URL}/bio/` },
  { key: 'artists-statement', url: `${BASE_URL}/bio/artists-statement/` },
  { key: 'contact', url: `${BASE_URL}/contact/` },
  { key: 'shows', url: `${BASE_URL}/shows/` },
];

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) { console.warn(`  HTTP ${res.status}: ${url}`); return null; }
  return res.text();
}

/** Clean #content HTML: strip h1, scripts, WP nav, staging images, rewrite links */
function cleanHtml($, $el) {
  // Remove title (it's in frontmatter)
  $el.find('h1.entry-title, h1.page-title').remove();
  $el.find('script, style, noscript, iframe').remove();
  $el.find('.entry-meta, .post-navigation, .navigation, #respond, .sharedaddy, .jp-relatedposts').remove();

  // Fix img src: prefer data-large-file or src, skip staging
  $el.find('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('data-large-file') || $img.attr('src') || '';
    if (!src || src.includes('/staging/') || src.includes('gravatar') || src.includes('s.w.org')) {
      $img.remove();
      return;
    }
    // Already downloaded — just rewrite to /images/filename
    const fname = src.split('/').pop().split('?')[0].replace(/-\d+x\d+(\.[a-z]{2,5})$/, '$1');
    $img.attr('src', `/images/${fname}`);
    $img.removeAttr('srcset').removeAttr('sizes').removeAttr('data-src')
        .removeAttr('data-large-file').removeAttr('data-medium-file').removeAttr('data-recalc-dims');
    $img.attr('loading', 'lazy').attr('decoding', 'async');
  });

  // Rewrite internal hrefs
  $el.find('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.includes('/staging/')) { $a.attr('href', '#'); return; }
    if (href.startsWith(BASE_URL)) {
      let rel = href.slice(BASE_URL.length) || '/';
      // blog posts live at root in WP, remap to /blog/slug/
      for (const slug of BLOG_SLUGS) {
        if (rel === `/${slug}` || rel === `/${slug}/`) { rel = `/blog/${slug}/`; break; }
      }
      $a.attr('href', rel);
    }
  });

  let html = $el.html() || '';
  html = html.replace(/<!--\s*(\/?)wp:[^\-].*?-->/gs, '');
  html = html.replace(/\[[a-z_]+ [^\]]*\]/g, '').replace(/\[\/[a-z_]+\]/g, '');
  return html.trim();
}

// ── Paintings: extract size + media from #content text ──────────────────────

async function patchPainting(slug) {
  const mdPath = path.join(ROOT, 'src', 'content', 'paintings', `${slug}.md`);
  let existing = await readFile(mdPath, 'utf-8');

  // Already has size/media? Skip
  if (existing.includes('\nsize:') || existing.includes('\nmedia:')) return;

  const html = await get(`${BASE_URL}/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const $c = $('#content').first();
  if (!$c.length) return;

  const txt = $c.text();
  const sizeM = txt.match(/Size:\s*([^\n]+)/i);
  const mediaM = txt.match(/[Mm]edia:\s*([^\n]+)/i);

  if (!sizeM && !mediaM) return;

  const size = sizeM ? sizeM[1].trim() : '';
  const media = mediaM ? mediaM[1].trim() : '';

  // Inject into frontmatter after the image: line
  existing = existing.replace(
    /^(image: "[^"]*")$/m,
    `$1\n${size ? `size: ${JSON.stringify(size)}` : ''}\n${media ? `media: ${JSON.stringify(media)}` : ''}`
  );
  existing = existing.replace(/\n{3,}/g, '\n');

  await writeFile(mdPath, existing, 'utf-8');
  console.log(`  patched painting/${slug}: size="${size}" media="${media}"`);
}

// ── Shows: extract HTML body from #content ──────────────────────────────────

async function refetchShow(slug) {
  const html = await get(`${BASE_URL}/shows/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const title = $('h1').first().text().trim() || slug;
  const date = ($('meta[property="article:published_time"]').attr('content') || '').split('T')[0];
  const ogImg = $('meta[property="og:image"]').attr('content') || '';
  const imgFname = ogImg && !ogImg.includes('/staging/')
    ? ogImg.split('/').pop().replace(/-\d+x\d+(\.[a-z]{2,5})$/, '$1') : '';

  const $c = $('#content').first();
  $c.find('h1').first().remove();
  const body = $c.length ? cleanHtml($, $c) : '';

  const md = `---
title: ${JSON.stringify(title)}
${date ? `date: "${date}"` : ''}
${imgFname ? `image: "/images/${imgFname}"` : ''}
---

${body}
`;

  await writeFile(path.join(ROOT, 'src', 'content', 'shows', `${slug}.md`), md, 'utf-8');
  console.log(`  patched show/${slug}`);
}

// ── Blog posts: add HTML body from #content ──────────────────────────────────

async function patchBlogPost(slug) {
  const mdPath = path.join(ROOT, 'src', 'content', 'blog', `${slug}.md`);
  const existing = await readFile(mdPath, 'utf-8');

  // Already has body content? (more than just the frontmatter block)
  const bodyPart = existing.split(/^---\s*$/m).slice(2).join('---').trim();
  if (bodyPart.length > 50) return;

  const html = await get(`${BASE_URL}/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const $c = $('#content').first();
  if (!$c.length) return;
  $c.find('h1').first().remove();
  const body = cleanHtml($, $c);

  // Rebuild the md file keeping the same frontmatter
  const fmMatch = existing.match(/^(---[\s\S]*?---)/m);
  const frontmatter = fmMatch ? fmMatch[1] : existing.split('---\n')[0] + '---';

  const md = `${frontmatter}\n\n${body}\n`;
  await writeFile(mdPath, md, 'utf-8');
  console.log(`  patched blog/${slug}`);
}

// ── Static pages ────────────────────────────────────────────────────────────

async function refetchStaticPage({ key, url }) {
  const html = await get(url);
  if (!html) return;

  const $ = load(html);
  const $c = $('#content').first();
  const title = $('h1, h2.entry-title').first().text().trim() || key;
  $c.find('h1, h2.entry-title').first().remove();
  const body = $c.length ? cleanHtml($, $c) : '';

  await writeFile(
    path.join(ROOT, 'src', 'data', 'pages', `${key}.json`),
    JSON.stringify({ title, html: body }, null, 2), 'utf-8'
  );
  console.log(`  patched page/${key}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('=== Fixup pass ===');

console.log('\n-- Patching painting size/media --');
for (const s of PAINTING_SLUGS) await patchPainting(s);

console.log('\n-- Patching blog bodies --');
for (const s of BLOG_SLUGS) await patchBlogPost(s);

console.log('\n-- Re-fetching shows --');
for (const s of SHOW_SLUGS) await refetchShow(s);

console.log('\n-- Re-fetching static pages --');
for (const p of STATIC_PAGES) await refetchStaticPage(p);

console.log('\nDone.');
