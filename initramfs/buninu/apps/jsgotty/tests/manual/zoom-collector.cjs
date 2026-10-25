// Usage: node tests/manual/zoom-collector.cjs [port] [output.jsonl]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const port = Number(process.argv[2] || 18767);
const file = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'jsgotty-zoom-debug.jsonl'));
const token = randomBytes(16).toString('hex');
const endpoint = `http://127.0.0.1:${port}/${token}`;
const client = fs.readFileSync(path.join(__dirname, 'zoom-debug.js'), 'utf8') +
  `\nwindow.startGottyZoomDebug({endpoint:${JSON.stringify(endpoint)}});\n`;
let count = 0;
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url !== '/' + token && req.url !== '/' + token + '/client.js') {
    res.writeHead(404); return res.end();
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url.endsWith('/client.js')) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(client);
  }
  if (req.method !== 'POST' || req.url !== '/' + token) {
    res.writeHead(405); return res.end();
  }
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 16384) req.destroy();
  });
  req.on('end', () => {
    if (count >= 20000) { res.writeHead(429); return res.end(); }
    let event;
    try { event = JSON.parse(body); }
    catch { res.writeHead(400); return res.end(); }
    try {
      fs.appendFileSync(file, JSON.stringify({receivedAt: new Date().toISOString(), event}) + '\n', {mode: 0o600});
      count++;
      res.writeHead(204); res.end();
    } catch (error) {
      console.error(error.message);
      res.writeHead(500); res.end();
    }
  });
}).listen(port, '127.0.0.1', () => {
  console.log('Log (append): ' + file);
  console.log('Run in the connected jsgotty page via DevTools or CDP:');
  console.log(`fetch(${JSON.stringify(endpoint + '/client.js')}).then(r => r.text()).then(source => (0, eval)(source))`);
  console.log('Stop browser capture: window.stopGottyZoomDebug()');
});
