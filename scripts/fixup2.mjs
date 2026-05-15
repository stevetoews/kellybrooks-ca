/**
 * Second fixup: correct encoding, strip WP wrapper, download missed inline images.
 */
import { load } from 'cheerio';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
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

/** Fetch page as explicit UTF-8 regardless of server charset declaration */
async function getUtf8(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.warn(`  HTTP ${res.status}: ${url}`); return null; }
    const buf = await res.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  } catch (e) {
    console.warn(`  ✗ ${url}: ${e.message}`);
    return null;
  }
}

async function downloadImage(src) {
  const fname = src.split('/').pop().split('?')[0].replace(/-\d+x\d+(\.[a-z]{2,5})$/i, '$1');
  if (!fname || fname.length < 3) return null;
  const dest = path.join(ROOT, 'public', 'images', fname);
  if (existsSync(dest)) return fname;

  const urls = [src, src.replace(/-\d+x\d+(\.[a-z]{2,5})$/i, '$1')];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      await writeFile(dest, Buffer.from(buf));
      console.log(`    ↓ ${fname} (${(buf.byteLength/1024).toFixed(0)}KB)`);
      return fname;
    } catch { continue; }
  }
  console.warn(`    ✗ image failed: ${fname}`);
  return null;
}

/** Extract meaningful inner content from WP page HTML */
function extract($) {
  // Try specific inner content wrapper first
  for (const sel of ['.single_inside_content', '.entry-content', '.post-content', '.page-content']) {
    const $el = $(sel).first();
    if ($el.length && $el.text().trim().length > 40) return $el;
  }
  // Fall back to #content
  return $('#content').first();
}

async function cleanEl($, $el) {
  // Remove navigation, social, etc.
  $el.find('.next_prev_cont, .sharedaddy, .jp-relatedposts, #respond, .entry-meta').remove();
  $el.find('script, style, noscript, iframe').remove();
  $el.find('.cycloneslider').remove(); // JS-based slideshows don't work statically

  const dl = [];
  $el.find('img').each((_, el) => {
    const $img = $(el);
    let src = $img.attr('data-large-file') || $img.attr('data-src') || $img.attr('src') || '';
    if (!src || src.includes('/staging/') || src.includes('gravatar') || src.includes('s.w.org')) {
      $img.remove();
      return;
    }
    if (!src.startsWith('http')) src = BASE_URL + (src.startsWith('/') ? '' : '/') + src;
    dl.push(downloadImage(src).then(fname => {
      if (fname) {
        $img.attr('src', `/images/${fname}`);
        $img.removeAttr('srcset').removeAttr('sizes').removeAttr('data-src')
            .removeAttr('data-large-file').removeAttr('data-medium-file').removeAttr('data-recalc-dims');
        $img.attr('loading', 'lazy').attr('decoding', 'async');
      } else {
        $img.remove();
      }
    }));
  });
  await Promise.all(dl);

  $el.find('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.includes('/staging/')) { $a.attr('href', '#'); return; }
    if (href.startsWith(BASE_URL)) {
      let rel = href.slice(BASE_URL.length) || '/';
      for (const slug of BLOG_SLUGS) {
        if (rel === `/${slug}` || rel === `/${slug}/`) { rel = `/blog/${slug}/`; break; }
      }
      $a.attr('href', rel);
    }
    // Remove lightbox rel attributes
    if ($a.attr('rel')?.includes('lightbox')) $a.removeAttr('rel');
  });

  let html = $el.html() || '';
  html = html.replace(/<!--\s*(\/?)wp:[^\-].*?-->/gs, '');
  html = html.replace(/\[[a-z_]+ [^\]]*\]/g, '').replace(/\[\/[a-z_]+\]/g, '');
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');
  return html.trim();
}

// ── Paintings: fix encoding in size/media ─────────────────────────────────────

async function fixPainting(slug) {
  const html = await getUtf8(`${BASE_URL}/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const txt = $('#content').text();
  const sizeM = txt.match(/Size:\s*([^\n\r]+)/i);
  const mediaM = txt.match(/[Mm]edia:\s*([^\n\r]+)/i);
  if (!sizeM && !mediaM) return;

  const size = (sizeM?.[1] || '').trim();
  const media = (mediaM?.[1] || '').trim();

  const mdPath = path.join(ROOT, 'src', 'content', 'paintings', `${slug}.md`);
  let md = await readFile(mdPath, 'utf-8');

  // Replace any existing size/media lines
  md = md.replace(/^size: .*$/m, '').replace(/^media: .*$/m, '');
  md = md.replace(/^(image: "[^"]*")$/m, `$1\n${size ? `size: ${JSON.stringify(size)}` : ''}\n${media ? `media: ${JSON.stringify(media)}` : ''}`);
  md = md.replace(/\n{3,}/g, '\n');

  await writeFile(mdPath, md, 'utf-8');
  console.log(`  ✓ painting/${slug}: size="${size}" media="${media}"`);
}

// ── Blog posts: clean HTML, download inline images ────────────────────────────

async function fixBlog(slug) {
  const html = await getUtf8(`${BASE_URL}/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const title = $('h1').first().text().trim();
  const date = ($('meta[property="article:published_time"]').attr('content') || '').split('T')[0] || '2022-01-01';
  const ogImg = $('meta[property="og:image"]').attr('content') || '';
  const imgFname = ogImg && !ogImg.includes('/staging/')
    ? ogImg.split('/').pop().replace(/-\d+x\d+(\.[a-z]{2,5})$/i, '$1') : '';

  const $c = extract($);
  $c.find('h1').remove();
  const body = $c.length ? await cleanEl($, $c) : '';

  const md = `---\ntitle: ${JSON.stringify(title)}\ndate: "${date}"\n${imgFname ? `image: "/images/${imgFname}"\n` : ''}---\n\n${body}\n`;
  await writeFile(path.join(ROOT, 'src', 'content', 'blog', `${slug}.md`), md, 'utf-8');
  console.log(`  ✓ blog/${slug}`);
}

// ── Shows ──────────────────────────────────────────────────────────────────────

async function fixShow(slug) {
  const html = await getUtf8(`${BASE_URL}/shows/${slug}/`);
  if (!html) return;

  const $ = load(html);
  const title = $('h1').first().text().trim() || slug.replace(/-/g,' ');
  const date = ($('meta[property="article:published_time"]').attr('content') || '').split('T')[0];
  const ogImg = $('meta[property="og:image"]').attr('content') || '';
  const imgFname = ogImg && !ogImg.includes('/staging/')
    ? ogImg.split('/').pop().replace(/-\d+x\d+(\.[a-z]{2,5})$/i, '$1') : '';

  const $c = extract($);
  $c.find('h1').remove();
  const body = $c.length ? await cleanEl($, $c) : '';

  const md = `---\ntitle: ${JSON.stringify(title)}\n${date ? `date: "${date}"\n` : ''}${imgFname ? `image: "/images/${imgFname}"\n` : ''}---\n\n${body}\n`;
  await writeFile(path.join(ROOT, 'src', 'content', 'shows', `${slug}.md`), md, 'utf-8');
  console.log(`  ✓ show/${slug}`);
}

// ── Static pages ──────────────────────────────────────────────────────────────

async function fixStaticPage({ key, url }) {
  const html = await getUtf8(url);
  if (!html) return;

  const $ = load(html);
  const title = $('h1, h2.entry-title').first().text().trim() || key;

  const $c = extract($);
  $c.find('h1').remove();
  const body = $c.length ? await cleanEl($, $c) : '';

  await writeFile(
    path.join(ROOT, 'src', 'data', 'pages', `${key}.json`),
    JSON.stringify({ title, html: body }, null, 2), 'utf-8'
  );
  console.log(`  ✓ page/${key}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('=== Fixup pass 2 (UTF-8 + clean HTML) ===\n');

console.log('-- Paintings --');
for (const s of PAINTING_SLUGS) await fixPainting(s);

console.log('\n-- Blog posts --');
for (const s of BLOG_SLUGS) await fixBlog(s);

console.log('\n-- Shows --');
for (const s of SHOW_SLUGS) await fixShow(s);

console.log('\n-- Static pages --');
for (const p of STATIC_PAGES) await fixStaticPage(p);

console.log('\nDone.');
