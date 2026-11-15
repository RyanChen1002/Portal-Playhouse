'use strict';
// Serve only the preview assets, on loopback. Never expose repository files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/world.js', ['world.js', 'text/javascript; charset=utf-8']],
  ['/world.css', ['world.css', 'text/css; charset=utf-8']],
  ['/vendor/three.module.js', ['vendor/three.module.js', 'text/javascript; charset=utf-8']],
  ['/vendor/three.core.js', ['vendor/three.core.js', 'text/javascript; charset=utf-8']]
]);
const server = http.createServer((request, response) => {
  const asset = assets.get(request.url.split('?')[0]);
  if (!asset || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404); response.end('Not found'); return;
  }
  fs.readFile(path.join(__dirname, '..', 'frontend', asset[0]), (error, data) => {
    if (error) { response.writeHead(500); response.end('Preview asset unavailable'); return; }
    response.writeHead(200, {'Content-Type':asset[1], 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : data);
  });
});
server.on('error', error => { console.error(error.message); process.exitCode=1; });
server.listen(4173, '127.0.0.1', () => console.log('Portal Playhouse preview: http://127.0.0.1:4173'));
