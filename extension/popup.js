const api = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);
const serverEl = $('server');
const categoryEl = $('category');
const newCategoryEl = $('newCategory');
const titleEl = $('title');
const descEl = $('desc');
const statusEl = $('status');
const saveBtn = $('save');
const settingsBtn = $('settingsBtn');
const settingsBox = $('settings');
const testResult = $('testResult');

function setStatus(msg, err) {
  statusEl.textContent = msg;
  statusEl.className = err ? 'err' : '';
}

async function getServerUrl() {
  const { serverUrl } = await api.storage.local.get('serverUrl');
  return serverUrl || '';
}

async function hasOriginPermission(origin) {
  if (typeof api.permissions?.contains !== 'function') return true;
  return api.permissions.contains({ origins: [origin + '/*'] });
}

async function requestOriginPermission(origin) {
  if (typeof api.permissions?.request !== 'function') return true;
  return api.permissions.request({ origins: [origin + '/*'] });
}

function normalizeBase() {
  return serverEl.value.replace(/\/+$/, '');
}

async function loadCategories() {
  const base = normalizeBase();
  if (!base) throw new Error('no server URL set — open ⚙ Settings');
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    throw new Error('invalid server URL');
  }
  if (!(await hasOriginPermission(origin))) {
    const err = new Error('permission missing');
    err.needsPermission = origin;
    throw err;
  }
  const res = await fetch(base + '/api/categories');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function fillCategories(cats) {
  categoryEl.replaceChildren();
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.name;
    categoryEl.appendChild(o);
  }
  const addNew = document.createElement('option');
  addNew.value = '__new__';
  addNew.textContent = '+ Add new category…';
  categoryEl.appendChild(addNew);
}

async function init() {
  serverEl.value = await getServerUrl();
  if (!serverEl.value) {
    setStatus('Set your server first — click ⚙ below.', true);
    settingsBox.classList.add('open');
  }

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    titleEl.value = tab.title || tab.url;
    titleEl.dataset.url = tab.url || '';
  }

  try {
    fillCategories(await loadCategories());
  } catch (e) {
    fillCategories([]);
    setStatus('Categories not loaded: ' + e.message, true);
  }
}

settingsBtn.addEventListener('click', () => {
  settingsBox.classList.toggle('open');
});

$('testConn').addEventListener('click', async () => {
  testResult.textContent = 'Testing…';
  const base = normalizeBase();
  if (!base) {
    testResult.textContent = 'Enter a server URL first.';
    return;
  }
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    testResult.textContent = 'Invalid URL. Include http:// or https://';
    return;
  }
  if (!(await hasOriginPermission(origin))) {
    testResult.textContent = 'Requesting permission…';
    const granted = await requestOriginPermission(origin);
    if (!granted) {
      testResult.textContent = 'Permission denied — the extension cannot reach the server.';
      return;
    }
  }
  try {
    const res = await fetch(base + '/api/categories');
    if (!res.ok) {
      testResult.textContent = 'Reached server, but it answered HTTP ' + res.status + '. Check the URL path.';
      return;
    }
    const cats = await res.json();
    testResult.textContent = 'OK — connected. ' + cats.length + ' category(ies) found.';
  } catch (e) {
    testResult.textContent = 'Connection failed: ' + e.message;
  }
});

$('saveServer').addEventListener('click', async () => {
  await api.storage.local.set({ serverUrl: serverEl.value.trim() });
  try {
    fillCategories(await loadCategories());
    setStatus('');
    testResult.textContent = 'Saved. Categories loaded.';
  } catch (e) {
    setStatus('Categories not loaded: ' + e.message, true);
    testResult.textContent = 'Saved, but could not load categories: ' + e.message;
  }
});

categoryEl.addEventListener('change', () => {
  newCategoryEl.hidden = categoryEl.value !== '__new__';
  if (!newCategoryEl.hidden) newCategoryEl.focus();
});

saveBtn.addEventListener('click', async () => {
  const base = normalizeBase();
  const title = titleEl.value.trim();
  const url = titleEl.dataset.url;
  const description = descEl.value.trim();
  let category = categoryEl.value;

  if (!base) return setStatus('Set your server first (⚙ Settings).', true);
  if (!title) return setStatus('Title required.', true);
  if (!url || !/^https?:\/\//.test(url)) return setStatus('No bookmarkable page URL.', true);
  if (category === '__new__') {
    const name = newCategoryEl.value.trim();
    if (!name) return setStatus('New category name required.', true);
    category = name;
  } else if (!category) {
    return setStatus('Select a category.', true);
  }

  saveBtn.disabled = true;
  try {
    let catRes = await fetch(base + '/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: category }),
    });
    if (!catRes.ok) {
      const e = await catRes.json().catch(() => ({}));
      throw new Error(e.error || catRes.status);
    }

    const res = await fetch(base + '/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url, category, description }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || res.status);
    }
    setStatus('Saved.');
    window.close();
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  } finally {
    saveBtn.disabled = false;
  }
});

init();
