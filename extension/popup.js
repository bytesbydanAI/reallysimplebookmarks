const api = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);
const serverEl = $('server');
const categoryEl = $('category');
const newCategoryEl = $('newCategory');
const titleEl = $('title');
const descEl = $('desc');
const statusEl = $('status');
const saveBtn = $('save');
const grantBtn = $('grant');

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

async function loadCategories() {
  const base = serverEl.value.replace(/\/+$/, '');
  if (!base) return [];
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
  if (!res.ok) throw new Error('categories: ' + res.status);
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

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    titleEl.value = tab.title || tab.url;
    titleEl.dataset.url = tab.url || '';
    titleEl.dataset.suggestion = tab.title || tab.url;
  }

  try {
    fillCategories(await loadCategories());
  } catch (e) {
    fillCategories([]);
    if (e.needsPermission) {
      setStatus('The extension needs permission to access your server. Click Grant access.', true);
      grantBtn.hidden = false;
    } else {
      setStatus('Could not load categories — check the server URL. You can still type a new category below.', true);
    }
  }
}

serverEl.addEventListener('change', async () => {
  await api.storage.local.set({ serverUrl: serverEl.value.trim() });
  grantBtn.hidden = true;
  try {
    fillCategories(await loadCategories());
    setStatus('');
  } catch (e) {
    if (e.needsPermission) {
      setStatus('The extension needs permission to access your server. Click Grant access.', true);
      grantBtn.hidden = false;
    } else {
      setStatus('Could not load categories from that URL.', true);
    }
  }
});

grantBtn.addEventListener('click', async () => {
  try {
    const base = serverEl.value.replace(/\/+$/, '');
    const origin = new URL(base).origin;
    const granted = await requestOriginPermission(origin);
    if (!granted) {
      setStatus('Permission denied. The extension cannot reach the server without it.', true);
      return;
    }
    grantBtn.hidden = true;
    fillCategories(await loadCategories());
    setStatus('');
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  }
});

categoryEl.addEventListener('change', () => {
  newCategoryEl.hidden = categoryEl.value !== '__new__';
  if (!newCategoryEl.hidden) newCategoryEl.focus();
});

saveBtn.addEventListener('click', async () => {
  const base = serverEl.value.replace(/\/+$/, '');
  const title = titleEl.value.trim();
  const url = titleEl.dataset.url;
  const description = descEl.value.trim();
  let category = categoryEl.value;

  if (!base) return setStatus('Server URL required.', true);
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
