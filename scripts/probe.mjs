import { load } from 'cheerio';

for (const slug of ['dip-and-twirl', 'pod-cast']) {
  const buf = await (await fetch(`https://kellybrooks.ca/${slug}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).arrayBuffer();
  const html = new TextDecoder('utf-8').decode(buf);
  const $ = load(html);
  console.log(`\n=== ${slug} ===`);
  console.log('#content text:', $('#content').text().trim().substring(0, 300));
}
