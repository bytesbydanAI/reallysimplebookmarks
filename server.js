const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseBookmarksHtml, serializeBookmarksHtml } = require('./bookmarks-html');

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
(function migrate() {
  const legacy = store.categories.find((c) => c.name === 'Default');
  if (legacy && !store.categories.some((c) => c.name === 'Home')) {
    legacy.name = 'Home';
    for (const b of store.bookmarks) {
      if (b.category === 'Default') b.category = 'Home';
    }
    persist();
  }
})();
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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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
      if (size > 20 * 1024 * 1024) {
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
  const def = store.categories.filter((c) => c.name === 'Home');
  const others = store.categories.filter((c) => c.name !== 'Home');
  send(res, 200, [...def, ...others]);
});

route('POST', /^\/api\/import$/, async (req, res) => {
  const body = await readBody(req);
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html) return send(res, 400, { error: 'html required' });

  let parsed;
  try {
    parsed = parseBookmarksHtml(html);
  } catch (e) {
    return send(res, 400, { error: 'invalid bookmarks file: ' + e.message });
  }

  const catNames = new Set(parsed.folders.map((f) => f.name));
  catNames.add('Home');
  for (const name of catNames) {
    if (!store.categories.find((c) => c.name === name)) {
      store.categories.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name });
    }
  }

  const seen = new Map();
  for (const b of store.bookmarks) seen.set(b.url, b);

  let added = 0;
  const mk = (b, category) => {
    if (seen.has(b.url)) return;
    const bm = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: b.title.slice(0, 500),
      url: b.url.slice(0, 2000),
      category,
      description: (b.description || '').slice(0, 2000),
      created: Date.now(),
    };
    store.bookmarks.push(bm);
    seen.set(b.url, bm);
    added++;
  };
  for (const b of parsed.defaultBookmarks) mk(b, 'Home');
  for (const f of parsed.folders) for (const b of f.bookmarks) mk(b, f.name);

  persist();
  send(res, 200, { added, categories: catNames.size });
});

route('GET', /^\/api\/export$/, (req, res) => {
  const defaultBms = store.bookmarks.filter((b) => b.category === 'Home');
  const byCat = {};
  for (const b of store.bookmarks) {
    if (b.category === 'Home') continue;
    (byCat[b.category] = byCat[b.category] || []).push(b);
  }
  const html = serializeBookmarksHtml(defaultBms, byCat);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': 'attachment; filename="bookmarks.html"',
    'Cache-Control': 'no-store',
  });
  res.end(html);
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

route('POST', /^\/api\/categories\/([a-z0-9]+)\/position$/, async (req, res, id) => {
  const i = store.categories.findIndex((c) => c.id === id);
  if (i === -1) return send(res, 404, { error: 'not found' });
  if (store.categories[i].name === 'Home') return send(res, 400, { error: 'Home stays first' });
  const body = await readBody(req);
  let targetIdx;
  if (body.before === null) {
    targetIdx = store.categories.length - 1;
  } else {
    const target = store.categories.findIndex((c) => c.id === body.before);
    if (target === -1 || target === 0) return send(res, 400, { error: 'invalid target' });
    targetIdx = target > i ? target - 1 : target;
  }
  const [cat] = store.categories.splice(i, 1);
  store.categories.splice(targetIdx, 0, cat);
  persist();
  send(res, 200, { ok: true });
});

route('PATCH', /^\/api\/categories\/([a-z0-9]+)$/, async (req, res, id) => {
  const cat = store.categories.find((c) => c.id === id);
  if (!cat) return send(res, 404, { error: 'not found' });
  if (cat.name === 'Home') return send(res, 400, { error: 'Home category cannot be renamed' });
  const body = await readBody(req);
  const name = cleanStr(body.name, 100);
  if (!name) return send(res, 400, { error: 'name required' });
  if (name === 'Home') return send(res, 400, { error: 'name reserved' });
  if (store.categories.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
    return send(res, 409, { error: 'category already exists' });
  }
  const oldName = cat.name;
  cat.name = name;
  for (const b of store.bookmarks) {
    if (b.category === oldName) b.category = name;
  }
  persist();
  send(res, 200, cat);
});

route('DELETE', /^\/api\/categories\/([a-z0-9]+)$/, (req, res, id) => {
  const cat = store.categories.find((c) => c.id === id);
  if (!cat) return send(res, 404, { error: 'not found' });
  if (cat.name === 'Home') return send(res, 400, { error: 'Home category cannot be deleted' });
  const count = store.bookmarks.filter((b) => b.category === cat.name).length;
  if (count > 0 && !new URL(req.url, 'http://localhost').searchParams.get('force')) {
    return send(res, 409, { error: 'category not empty', count });
  }
  store.categories = store.categories.filter((c) => c.id !== id);
  store.bookmarks = store.bookmarks.filter((b) => b.category !== cat.name);
  persist();
  send(res, 200, { ok: true });
});

route('PATCH', /^\/api\/bookmarks\/([a-z0-9]+)$/, async (req, res, id) => {
  const bm = store.bookmarks.find((b) => b.id === id);
  if (!bm) return send(res, 404, { error: 'not found' });
  const body = await readBody(req);
  if (body.category !== undefined) {
    const category = cleanStr(body.category, 100);
    if (!store.categories.find((c) => c.name.toLowerCase() === category.toLowerCase())) {
      return send(res, 400, { error: 'unknown category' });
    }
    bm.category = category;
  }
  if (body.title !== undefined) {
    const title = cleanStr(body.title, 500);
    if (!title) return send(res, 400, { error: 'title required' });
    bm.title = title;
  }
  if (body.url !== undefined) {
    const url = cleanStr(body.url, 2000);
    if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: 'url must be http(s)' });
    bm.url = url;
  }
  if (body.description !== undefined) bm.description = cleanStr(body.description, 2000);
  persist();
  send(res, 200, bm);
});

route('POST', /^\/api\/bookmarks\/([a-z0-9]+)\/(up|down)$/, (req, res, id, dir) => {
  const i = store.bookmarks.findIndex((b) => b.id === id);
  if (i === -1) return send(res, 404, { error: 'not found' });
  const bm = store.bookmarks[i];
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= store.bookmarks.length || store.bookmarks[j].category !== bm.category) {
    return send(res, 200, { ok: true });
  }
  const [moved] = store.bookmarks.splice(i, 1);
  store.bookmarks.splice(j, 0, moved);
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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`bookmarks listening on ${PORT}`));
