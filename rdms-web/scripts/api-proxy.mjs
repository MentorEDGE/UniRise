// Serves the built frontend (dist/) and forwards /api to the Java API, so the pages and the API share one origin
// locally, as they do with the prototype server. Usage: API=http://127.0.0.1:8181 PORT=8201 node scripts/api-proxy.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const API = new URL(process.env.API ?? 'http://127.0.0.1:8181');
const PORT = Number(process.env.PORT ?? 8201);
const DIST = path.resolve(process.env.DIST ?? 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    // Keep the browser's Host: the pages and the API are one origin here, so the API must not see a cross-origin call.
    const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '' };
    const up = http.request({ hostname: API.hostname, port: API.port, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"The API is not reachable."}'); });
    req.pipe(up);
    return;
  }
  const clean = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(DIST, clean);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`frontend on http://127.0.0.1:${PORT}, /api → ${API.origin}`));
