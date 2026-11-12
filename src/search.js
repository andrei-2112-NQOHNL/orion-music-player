const { execFile } = require('child_process');
const SOURCES = ['All', 'YouTube Music', 'SoundCloud', 'Deezer', 'Apple Music', 'Audius'];
const UA = { 'User-Agent': 'Mozilla/5.0' };
async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  return r.json();
}
function findAll(o, key, out = []) {
  if (!o || typeof o !== 'object') return out;
  if (o[key]) out.push(o[key]);
  for (const k in o) findAll(o[k], key, out);
  return out;
}
async function ytm(query, limit = 15) {
  const r = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA['User-Agent'], Origin: 'https://music.youtube.com' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241111.01.00', hl: 'en' } },
      query, params: 'EgWKAQIIAWoKEAkQBRADEAoQEA==' })
  });
  const items = findAll(await r.json(), 'musicResponsiveListItemRenderer');
  const out = [];
  for (const it of items) {
    const cols = it.flexColumns || [];
    const runs = c => ((cols[c] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text?.runs || [];
    const t = runs(0)[0];
    const id = it.playlistItemData?.videoId || t?.navigationEndpoint?.watchEndpoint?.videoId;
    if (!id) continue;
    const artists = runs(1).filter(x => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST').map(x => x.text);
    const th = it.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    out.push({ title: t.text, artist: (artists.length ? artists : [runs(1)[0]?.text || '']).join(', '),
      url: 'https://www.youtube.com/watch?v=' + id, source: 'YouTube Music', thumb: th.length ? th[th.length - 1].url : '' });
    if (out.length >= limit) break;
  }
  return out;
}
async function resolved(raw, source) {
  const urls = await Promise.all(raw.map(r => ytm(r.artist + ' ' + r.title, 1).then(x => x[0]?.url || '').catch(() => '')));
  return raw.map((r, i) => ({ ...r, url: urls[i], source })).filter(r => r.url);
}
function soundcloud(query) {
  return new Promise(ok => execFile('yt-dlp', ['--flat-playlist', '--playlist-end', '15', '-J', 'scsearch15:' + query],
    { timeout: 60000, maxBuffer: 1 << 25 }, (err, out) => {
      try {
        ok(JSON.parse(out).entries.map(e => ({ title: e.title || '', artist: e.uploader || '', url: e.url || e.webpage_url,
          source: 'SoundCloud', thumb: e.thumbnail || (e.thumbnails || [{}]).slice(-1)[0].url || '' })).filter(e => e.url));
      } catch (x) { ok([]); }
    }));
}
async function searchOne(query, source) {
  const q = encodeURIComponent(query);
  if (source === 'YouTube Music') return ytm(query);
  if (source === 'SoundCloud') return soundcloud(query);
  if (source === 'Deezer') {
    const d = (await getJson('https://api.deezer.com/search?q=' + q + '&limit=15')).data || [];
    return resolved(d.map(x => ({ title: x.title, artist: x.artist.name, thumb: x.album.cover_medium || '' })), source);
  }
  if (source === 'Apple Music') {
    const d = (await getJson('https://itunes.apple.com/search?term=' + q + '&entity=song&limit=15')).results || [];
    return resolved(d.map(x => ({ title: x.trackName || '', artist: x.artistName || '', thumb: (x.artworkUrl100 || '').replace('100x100', '300x300') })), source);
  }
  if (source === 'Audius') {
    const d = (await getJson('https://api.audius.co/v1/tracks/search?query=' + q + '&app_name=orion')).data || [];
    return d.slice(0, 15).map(x => ({ title: x.title, artist: x.user.name, url: 'https://api.audius.co/v1/tracks/' + x.id + '/stream?app_name=orion',
      source, thumb: (x.artwork || {})['480x480'] || '' }));
  }
  return [];
}
async function search(query, source) {
  if (source !== 'All') return searchOne(query, source);
  const lists = await Promise.all(SOURCES.slice(1).map(n => searchOne(query, n).catch(() => [])));
  const out = [], seen = new Set();
  for (let k = 0; k < 15; k++) for (const l of lists) if (k < l.length) {
    const key = (l[k].title + '|' + l[k].artist).toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(l[k]); }
  }
  return out;
}
module.exports = { search, SOURCES };
