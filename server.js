const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'bookmarks.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.bookmarks) || !Array.isArray(data.categories)) throw new Error('bad shape');
    return data;
  } catch {
    return { categories: [], bookmarks: [] };
  }
}

let store = loadStore();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error('persist failed:', e.message);
    }
  }, 50);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

route('GET', /^\/api\/categories$/, (req, res) => {
  send(res, 200, store.categories);
});

route('POST', /^\/api\/categories$/, async (req, res) => {
  const body = await readBody(req);
  const name = cleanStr(body.name, 100);
  if (!name) return send(res, 400, { error: 'name required' });
  const exists = store.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exists) return send(res, 200, exists);
  const cat = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name };
  store.categories.push(cat);
  persist();
  send(res, 201, cat);
});

route('DELETE', /^\/api\/categories\/([a-z0-9]+)$/, (req, res, id) => {
  const cat = store.categories.find((c) => c.id === id);
  if (!cat) return send(res, 404, { error: 'not found' });
  if (store.bookmarks.some((b) => b.category === cat.name)) {
    return send(res, 409, { error: 'category not empty' });
  }
  store.categories = store.categories.filter((c) => c.id !== id);
  persist();
  send(res, 200, { ok: true });
});

route('GET', /^\/api\/bookmarks$/, (req, res) => {
  send(res, 200, store.bookmarks);
});

route('POST', /^\/api\/bookmarks$/, async (req, res) => {
  const body = await readBody(req);
  const title = cleanStr(body.title, 500);
  const url = cleanStr(body.url, 2000);
  const category = cleanStr(body.category, 100);
  const description = cleanStr(body.description, 2000);
  if (!title || !url) return send(res, 400, { error: 'title and url required' });
  if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: 'url must be http(s)' });
  if (!store.categories.find((c) => c.name.toLowerCase() === category.toLowerCase())) {
    return send(res, 400, { error: 'unknown category' });
  }
  const bm = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    url,
    category,
    description,
    created: Date.now(),
  };
  store.bookmarks.push(bm);
  persist();
  send(res, 201, bm);
});

route('DELETE', /^\/api\/bookmarks\/([a-z0-9]+)$/, (req, res, id) => {
  const i = store.bookmarks.findIndex((b) => b.id === id);
  if (i === -1) return send(res, 404, { error: 'not found' });
  store.bookmarks.splice(i, 1);
  persist();
  send(res, 200, { ok: true });
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.pattern);
      if (m) {
        try {
          return await r.handler(req, res, ...m.slice(1));
        } catch (e) {
          return send(res, e.message === 'invalid json' || e.message === 'too large' ? 400 : 500, { error: e.message });
        }
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`bookmarks listening on ${PORT}`));
