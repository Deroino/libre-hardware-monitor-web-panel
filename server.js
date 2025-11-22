const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8085;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'example-data.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/data.json') {
    fs.readFile(DATA_FILE, 'utf-8', (err, contents) => {
      if (err) {
        console.error('Failed to read data file', err);
        return sendJSON(res, 500, { error: 'Unable to load telemetry data' });
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(contents);
    });
    return;
  }

  let relativePath = url.pathname === '/' ? '/index.html' : url.pathname;
  relativePath = decodeURIComponent(relativePath);
  const requestedPath = path.join(PUBLIC_DIR, relativePath);
  if (!requestedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(requestedPath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const filePath = stats.isDirectory() ? path.join(requestedPath, 'index.html') : requestedPath;
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';

    const stream = fs.createReadStream(filePath);
    stream.on('open', () => {
      res.writeHead(200, { 'Content-Type': type });
      stream.pipe(res);
    });

    stream.on('error', (streamErr) => {
      console.error('Error streaming file', streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Server Error');
    });
  });
});

server.listen(PORT, () => {
  console.log(`Libre Hardware Monitor panel available at http://localhost:${PORT}`);
});
