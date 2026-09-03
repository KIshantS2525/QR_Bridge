// Zero-dependency static server. Uses only Node's built-ins so there's
// nothing to `npm install`. Serves ./public and, if certs/key.pem +
// certs/cert.pem exist, serves HTTPS too (needed for camera access on
// any device that isn't "localhost" — see README.md).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PUBLIC_DIR = path.join(__dirname, 'public');
const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function requestHandler(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath);

const ips = localIPs();

http.createServer(requestHandler).listen(HTTP_PORT, () => {
  console.log(`HTTP  server: http://localhost:${HTTP_PORT}`);
  ips.forEach(ip => console.log(`             http://${ip}:${HTTP_PORT}`));
});

if (hasCert) {
  const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  https.createServer(options, requestHandler).listen(HTTPS_PORT, () => {
    console.log(`HTTPS server: https://localhost:${HTTPS_PORT}`);
    ips.forEach(ip => console.log(`             https://${ip}:${HTTPS_PORT}  <-- use this on the phone`));
  });
} else {
  console.log('\nNo certs/cert.pem + certs/key.pem found, so only plain HTTP is running.');
  console.log('The phone\'s camera will likely be BLOCKED on plain HTTP unless it is');
  console.log('literally "localhost". See README.md for a 2-minute HTTPS setup.');
}
