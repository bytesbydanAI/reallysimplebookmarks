const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.TEST_PORT || '3999';
const BASE = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const results = [];
function check(name, cond) {
  if (cond) { passed++; results.push(`PASS | ${name}`); }
  else { failed++; results.push(`FAIL | ${name}`); }
}

async function j(p, o) {
  const r = await fetch(BASE + p, { headers: { 'Content-Type': 'application/json' }, ...o });
  let body = null;
  try { body = await r.json(); } catch {}
  return [r.status, body];
}
const post = (p, body) => j(p, { method: 'POST', body: JSON.stringify(body) });
const patch = (p, body) => j(p, { method: 'PATCH', body: JSON.stringify(body) });
const del = (p) => j(p, { method: 'DELETE' });

async function seed(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsb-test-'));
  fs.writeFileSync(path.join(dir, 'bookmarks.json'), JSON.stringify(data));
  return dir;
}

function startServer(dir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(ROOT, 'server.js')], {
      env: { ...process.env, PORT, DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => {
      if (String(d).includes('listening')) resolve(proc);
    });
    proc.on('error', reject);
    setTimeout(() => resolve(proc), 2000);
  });
}

const TOOLBAR_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://toolbar.example">Toolbar Direct</A>
        <DT><H3>News</H3>
        <DL><p>
            <DT><A HREF="https://news.example">News Site</A>
<DD>Daily news
        </DL><p>
    </DL><p>
    <DT><H3>Other</H3>
    <DL><p>
        <DT><A HREF="https://other.example">Other Site</A>
    </DL><p>
</DL><p>`;

async function testFreshStart() {
  const dir = await seed({ categories: [], bookmarks: [] });
  const proc = await startServer(dir);
  try {
    // categories
    const [s1, home] = await post('/api/categories', { name: 'Home' });
    check('create Home category (201)', s1 === 201);
    const [s2] = await post('/api/categories', { name: 'News' });
    check('create News category (201)', s2 === 201);
    const [s3, again] = await post('/api/categories', { name: 'news' });
    check('case-insensitive duplicate returns 200 existing', s3 === 200 && again.name === 'News');
    const [s4, cats] = await j('/api/categories');
    check('exactly two categories exist', s4 === 200 && cats.length === 2);

    // bookmarks CRUD
    const [s5, bm] = await post('/api/bookmarks', { title: 'A', url: 'https://a.io', category: 'News', description: 'desc' });
    check('create bookmark (201)', s5 === 201 && bm.description === 'desc');
    const [s6] = await post('/api/bookmarks', { title: 'X', url: 'ftp://bad', category: 'News' });
    check('non-http url rejected', s6 === 400);
    const [s7] = await post('/api/bookmarks', { title: 'X', url: 'https://x.io', category: 'Nope' });
    check('unknown category rejected', s7 === 400);
    const [s8, bm2] = await patch(`/api/bookmarks/${bm.id}`, { title: 'A2', url: 'https://a2.io', description: 'd2' });
    check('edit bookmark fields', s8 === 200 && bm2.title === 'A2' && bm2.url === 'https://a2.io');
    const [s9] = await patch(`/api/bookmarks/${bm.id}`, { url: 'not-a-url' });
    check('invalid url on edit rejected', s9 === 400);
    const [s10] = await del(`/api/bookmarks/${bm.id}`);
    check('delete bookmark', s10 === 200);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPositions() {
  const dir = await seed({
    categories: [
      { id: 'h', name: 'Home' },
      { id: 'n', name: 'News' },
      { id: 't', name: 'Tech' },
      { id: 'm', name: 'Misc' },
      { id: 'f', name: 'Fun' },
    ],
    bookmarks: [
      { id: 'b1', title: 'B1', url: 'https://b1.io', category: 'News', description: '', created: 1 },
      { id: 'b2', title: 'B2', url: 'https://b2.io', category: 'News', description: '', created: 2 },
      { id: 'b3', title: 'B3', url: 'https://b3.io', category: 'Tech', description: '', created: 3 },
      { id: 'b4', title: 'B4', url: 'https://b4.io', category: 'News', description: '', created: 4 },
    ],
  });
  const proc = await startServer(dir);
  try {
    // startup normalization: News block then Tech block
    const [, bms] = await j('/api/bookmarks');
    check('startup regroups categories contiguously', bms.map(b => b.title).join(' ') === 'B1 B2 B4 B3');

    // category positions (1-based, Home pinned at 0)
    const [sp1] = await post('/api/categories/f/position', { position: 1 });
    const [, cats1] = await j('/api/categories');
    check('category move to position 1', sp1 === 200 && cats1.map(c => c.name).join(' ') === 'Home Fun News Tech Misc');
    const [sp2] = await post('/api/categories/t/position', { position: 4 });
    const [, cats2] = await j('/api/categories');
    check('category move to end', sp2 === 200 && cats2.map(c => c.name).join(' ') === 'Home Fun News Misc Tech');
    const [sp3] = await post('/api/categories/t/position', { position: 0 });
    const [sp4] = await post('/api/categories/t/position', { position: 99 });
    const [sp5] = await post('/api/categories/h/position', { position: 1 });
    check('category position validation (0, 99, Home rejected)', sp3 === 400 && sp4 === 400 && sp5 === 400);

    // bookmark positions (0-based API)
    const [sb1] = await post('/api/bookmarks/b4/position', { position: 0 });
    const [, n1] = await j('/api/bookmarks');
    check('bookmark move to top of category', sb1 === 200 && n1.filter(b => b.category === 'News').map(b => b.title).join(' ') === 'B4 B1 B2');
    const [sb2] = await post('/api/bookmarks/b4/position', { position: 2 });
    const [, n2] = await j('/api/bookmarks');
    check('bookmark move to end of category', sb2 === 200 && n2.filter(b => b.category === 'News').map(b => b.title).join(' ') === 'B1 B2 B4');
    const [sb3] = await post('/api/bookmarks/b1/position', { position: 5 });
    const [sb4] = await post('/api/bookmarks/b1/position', { position: -1 });
    check('bookmark position validation', sb3 === 400 && sb4 === 400);

    // category move via PATCH relocates to end of new category
    const [sm] = await patch('/api/bookmarks/b2', { category: 'Tech' });
    const [, afterMove] = await j('/api/bookmarks');
    check('move to other category appends at end', sm === 200 && afterMove.filter(b => b.category === 'Tech').map(b => b.title).join(' ') === 'B3 B2');
    check('array stays contiguous after move', afterMove.map(b => b.title).join(' ') === 'B1 B4 B3 B2');
    const [sm2] = await patch('/api/bookmarks/b2', { category: 'Tech' });
    const [, afterSame] = await j('/api/bookmarks');
    check('same-category patch does not relocate', sm2 === 200 && afterSame.map(b => b.title).join(' ') === 'B1 B4 B3 B2');

    // rename cascades
    const [sr] = await patch('/api/categories/n', { name: 'Journalism' });
    const [, renamed] = await j('/api/bookmarks');
    check('rename moves bookmarks to new name', sr === 200 && renamed.filter(b => b.category === 'Journalism').length === 2);

    // category delete
    const [sd1, err] = await del('/api/categories/n');
    check('delete non-empty without force -> 409', sd1 === 409 && err.error === 'category not empty');
    const [sd2] = await del('/api/categories/n?force=1');
    const [, afterDel] = await j('/api/bookmarks');
    check('force delete removes bookmarks', sd2 === 200 && !afterDel.some(b => b.category === 'Journalism'));
    const [sd3] = await del('/api/categories/h');
    check('Home cannot be deleted', sd3 === 400);

    // OPTIONS preflight
    const opt = await fetch(BASE + '/api/bookmarks', { method: 'OPTIONS' });
    check('OPTIONS preflight 204 bodyless', opt.status === 204);

    // static files
    const html = await fetch(BASE + '/');
    const css = await fetch(BASE + '/style.css');
    check('static files served with no-cache', html.status === 200 && css.status === 200 && css.headers.get('cache-control') === 'no-cache');
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testMigration() {
  const dir = await seed({
    categories: [
      { id: 'c1', name: 'News' },
      { id: 'c2', name: 'Default' },
      { id: 'c3', name: 'Tech' },
    ],
    bookmarks: [
      { id: 'b1', title: 'D1', url: 'https://d1.io', category: 'Default', description: '', created: 1 },
      { id: 'b2', title: 'N1', url: 'https://n1.io', category: 'News', description: '', created: 2 },
    ],
  });
  const proc = await startServer(dir);
  try {
    const [, cats] = await j('/api/categories');
    check('Default migrated to Home at index 0', cats[0].name === 'Home' && cats.length === 3);
    const [, bms] = await j('/api/bookmarks');
    check('bookmarks moved from Default to Home', bms.find(b => b.title === 'D1').category === 'Home');
    const [sr] = await patch('/api/categories/c2', { name: 'NewName' });
    check('Home cannot be renamed', sr === 400);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testImportExport() {
  const dir = await seed({ categories: [], bookmarks: [] });
  const proc = await startServer(dir);
  try {
    const [si, imp] = await post('/api/import', { html: TOOLBAR_HTML });
    check('import succeeds', si === 200 && imp.added === 3);
    const [, cats] = await j('/api/categories');
    check('Home first after import', cats[0].name === 'Home' && cats.some(c => c.name === 'News') && cats.some(c => c.name === 'Other'));
    const [, bms] = await j('/api/bookmarks');
    const tb = bms.find(b => b.url === 'https://toolbar.example');
    const ns = bms.find(b => b.url === 'https://news.example');
    check('toolbar bookmark in Home', tb && tb.category === 'Home');
    check('folder bookmark in folder category with description', ns && ns.category === 'News' && ns.description === 'Daily news');

    // export
    const exp = await fetch(BASE + '/api/export');
    const html = await exp.text();
    check('export downloads with toolbar flag', exp.status === 200 && html.includes('PERSONAL_TOOLBAR_FOLDER'));

    // re-import export: no duplicates
    const [si2, imp2] = await post('/api/import', { html });
    check('re-import adds no duplicates', si2 === 200 && imp2.added === 0);

    // import invalid
    const [si3] = await post('/api/import', { html: '' });
    check('empty import rejected', si3 === 400);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  await testFreshStart();
  await testPositions();
  await testMigration();
  await testImportExport();
  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(results.join('\n'));
  console.error('\nFatal:', e);
  process.exit(1);
});
