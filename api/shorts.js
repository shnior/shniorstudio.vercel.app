// Returns the channel's YouTube Shorts as JSON for /shorts and the home page.
// Source 1: the same request YouTube's own Shorts tab makes (full list, with view counts).
// Source 2: the public RSS feed of the Shorts playlist (newest 15, with publish dates).
// Vercel caches the answer for 30 minutes, so a new Short shows up on the site by itself.

const CHANNEL_ID = 'UCex_tMDarrDuOeutaedbxtA';
const SHORTS_PLAYLIST = 'UUSH' + CHANNEL_ID.slice(2);
const SHORTS_TAB_PARAMS = 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D';
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250312.04.00', hl: 'he', gl: 'IL' };

async function browse(body) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', 'accept-language': 'he-IL,he;q=0.9' },
    body: JSON.stringify({ context: { client: CLIENT }, ...body })
  });
  if (!r.ok) throw new Error('browse ' + r.status);
  return r.json();
}

function collect(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.shortsLockupViewModel) {
    const s = node.shortsLockupViewModel;
    const id = s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || (s.entityId || '').replace('shorts-shelf-item-', '');
    if (id) out.items.push({
      id,
      title: s.overlayMetadata?.primaryText?.content || '',
      views: (s.overlayMetadata?.secondaryText?.content || '').replace(/[‎‏‪-‮]/g, '').trim(),
      thumb: s.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url || ''
    });
  } else if (node.reelItemRenderer) {
    const s = node.reelItemRenderer;
    if (s.videoId) out.items.push({
      id: s.videoId,
      title: s.headline?.simpleText || '',
      views: s.viewCountText?.simpleText || '',
      thumb: s.thumbnail?.thumbnails?.[0]?.url || ''
    });
  }
  if (node.continuationCommand?.token) out.token = node.continuationCommand.token;
  for (const k in node) collect(node[k], out);
  return out;
}

async function fromShortsTab() {
  const first = collect(await browse({ browseId: CHANNEL_ID, params: SHORTS_TAB_PARAMS }), { items: [], token: null });
  const items = [...first.items];
  let token = first.token;
  for (let page = 0; token && page < 25; page++) {
    const next = collect(await browse({ continuation: token }), { items: [], token: null });
    if (!next.items.length) break;
    items.push(...next.items);
    token = next.token;
  }
  return items;
}

async function fromRss() {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${SHORTS_PLAYLIST}`);
  if (!r.ok) throw new Error('rss ' + r.status);
  const xml = await r.text();
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
    title: decode((e.match(/<media:title>([^<]*)/) || [])[1] || ''),
    published: (e.match(/<published>([^<]+)/) || [])[1] || ''
  })).filter(x => x.id);
}

module.exports = async (req, res) => {
  const [tab, rss] = await Promise.allSettled([fromShortsTab(), fromRss()]);
  const dated = new Map((rss.status === 'fulfilled' ? rss.value : []).map(x => [x.id, x]));
  let items = tab.status === 'fulfilled' ? tab.value : [];
  const seen = new Set();
  items = items.filter(x => !seen.has(x.id) && seen.add(x.id));
  if (!items.length) items = [...dated.values()];
  items = items.map(x => ({
    id: x.id,
    title: x.title || dated.get(x.id)?.title || '',
    views: x.views || '',
    thumb: x.thumb || '',
    published: dated.get(x.id)?.published || x.published || ''
  }));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!items.length) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    return res.end(JSON.stringify({ items: [], error: 'youtube unavailable' }));
  }
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.end(JSON.stringify({
    channel: `https://www.youtube.com/channel/${CHANNEL_ID}`,
    source: tab.status === 'fulfilled' && tab.value.length ? 'shorts-tab' : 'rss',
    fetchedAt: new Date().toISOString(),
    items
  }));
};
