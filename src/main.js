const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
app.commandLine.appendSwitch('enable-features', 'MediaSessionService,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
const PORT = 47821;
const FMT = 'bestaudio[ext=webm]/bestaudio';
const cache = new Map();
const fs = require('fs');
const CF = path.join(os.homedir(), '.cache', 'orion-music-info.json');
let disk = {}; try { disk = JSON.parse(fs.readFileSync(CF, 'utf8')); } catch (e) {}
let svT = 0;
function saveDisk() { clearTimeout(svT); svT = setTimeout(() => { try { fs.mkdirSync(path.dirname(CF), { recursive: true }); fs.writeFileSync(CF, JSON.stringify(disk)); } catch (e) {} }, 500); }
const DTTL = 2 * 3600 * 1000;
function getInfo(u) {
  const c = cache.get(u);
  if (c && Date.now() - c.at < 15 * 60 * 1000) return c.p;
  const d = disk[u];
  if (d && Date.now() - d.at < DTTL) { const pd = Promise.resolve(d.info); cache.set(u, { at: Date.now(), p: pd }); return pd; }
  const p = new Promise((resolve, reject) => {
    execFile('yt-dlp', ['-q', '--no-playlist', '--no-warnings', '-f', FMT, '-j', u], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) { cache.delete(u); return reject(err); }
      try { const j = JSON.parse(out); const slim = { url: j.url, duration: j.duration, protocol: j.protocol, http_headers: j.http_headers }; disk[u] = { at: Date.now(), info: slim }; saveDisk(); resolve(slim); } catch (e) { cache.delete(u); reject(e); }
    });
  });
  cache.set(u, { at: Date.now(), p });
  return p;
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const u = url.searchParams.get('u');
  if (!u) { res.writeHead(400); return res.end(); }
  try {
    const info = await getInfo(u);
    if (url.pathname === '/i') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ duration: info.duration || 0, direct: !!info.url && /^https?$/.test(info.protocol || '') }));
    }
    if (info.url && /^https?$/.test(info.protocol || '') && !url.searchParams.get('t')) {
      const h = Object.assign({}, info.http_headers || {});
      if (req.headers.range) h.Range = req.headers.range;
      const mod = info.url.startsWith('https') ? require('https') : require('http');
      const r = mod.get(info.url, { headers: h }, up => {
        const oh = {};
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (up.headers[k]) oh[k] = up.headers[k];
        res.writeHead(up.statusCode, oh); up.pipe(res);
      });
      r.on('error', () => { try { res.end(); } catch (e) {} });
      res.on('close', () => r.destroy());
      return;
    }
    const t = Math.max(0, Number(url.searchParams.get('t')) || 0);
    const hdrs = Object.entries(info.http_headers || {}).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n';
    const args = ['-loglevel', 'quiet', '-headers', hdrs];
    if (t > 0) args.push('-ss', String(t));
    args.push('-i', info.url, '-vn', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'pipe:1');
    res.writeHead(200, { 'Content-Type': 'audio/webm' });
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    p.stdout.pipe(res);
    res.on('close', () => { try { process.kill(-p.pid); } catch (e) {} });
  } catch (e) { res.writeHead(500); res.end(); }
}).listen(PORT, '127.0.0.1');
ipcMain.handle('cache-stats', () => ({ n: Object.keys(disk).length }));
ipcMain.handle('cache-clear', () => { disk = {}; cache.clear(); saveDisk(); return 1; });
ipcMain.handle('search', (e, q, s) => require('./search.js').search(q, s).catch(() => []));
ipcMain.handle('theme', () => new Promise(r => {
  const code = "import sys,json,os;h=os.path.expanduser('~/jarvis');sys.path.insert(0,h);os.chdir(h);import jarvis_theme;print(json.dumps(jarvis_theme.load_colors()))";
  execFile(os.homedir() + '/jarvis/venv/bin/python', ['-c', code], { timeout: 5000 }, (err, out) => { try { r(JSON.parse(out)); } catch (e) { r(null); } });
}));
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 900, height: 640, title: 'Orion Music', backgroundColor: '#131318', autoHideMenuBar: true,
    icon: path.join(__dirname, 'orion.jpg'), webPreferences: { nodeIntegration: true, contextIsolation: false } });
  w.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
