const $ = (s) => document.querySelector(s);
const columns = $('#columns');
const filter = $('#categoryFilter');
const emptyMsg = $('#empty');

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.json();
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const hoverInfo = $('#hoverInfo');
let reorderCategory = null;
function startEdit(li, b) {
  const moveSel = li.querySelector('.moveSel');
  if (moveSel && !moveSel.hidden) moveSel.hidden = true;
  li.replaceChildren();
  li.classList.add('editing');

  const form = document.createElement('form');
  form.className = 'editForm';
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/bookmarks/' + b.id, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.querySelector('.et').value.trim(),
          url: form.querySelector('.eu').value.trim(),
          description: form.querySelector('.ed').value.trim(),
        }),
      });
      render();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const mk = (cls, val, ph, type) => {
    const inp = document.createElement('input');
    inp.className = cls;
    inp.value = val;
    inp.placeholder = ph;
    if (type) inp.type = type;
    return inp;
  };
  form.appendChild(mk('et', b.title, 'Title'));
  form.appendChild(mk('eu', b.url, 'https://…', 'url'));
  form.appendChild(mk('ed', b.description || '', 'Description (optional)'));

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  form.appendChild(save);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => render();
  form.appendChild(cancel);

  li.appendChild(form);
  form.querySelector('.et').focus();
}

function fillMoveSelect(sel, current) {
  sel.replaceChildren();
  const allCats = [];
  for (const o of filter.options) if (o.value) allCats.push(o.value);
  for (const name of allCats) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  sel.value = current;
}

function bookmarkRow(b, reordering) {
  const li = document.createElement('li');
  li.dataset.id = b.id;

  if (reordering) {
    const up = document.createElement('button');
    up.className = 'rowBtn';
    up.textContent = '↑';
    up.title = 'Move up';
    up.onclick = async () => {
      try { await api('/api/bookmarks/' + b.id + '/up', { method: 'POST' }); render(); } catch (e) { alert('Error: ' + e.message); }
    };
    const down = document.createElement('button');
    down.className = 'rowBtn';
    down.textContent = '↓';
    down.title = 'Move down';
    down.onclick = async () => {
      try { await api('/api/bookmarks/' + b.id + '/down', { method: 'POST' }); render(); } catch (e) { alert('Error: ' + e.message); }
    };
    const lbl = document.createElement('span');
    lbl.textContent = b.title;
    lbl.className = 'reorderLbl';
    li.appendChild(up);
    li.appendChild(down);
    li.appendChild(lbl);
    return li;
  }

  const a = document.createElement('a');
  a.href = b.url;
  a.textContent = b.title;
  a.rel = 'noopener noreferrer';
  li.appendChild(a);

  li.addEventListener('mouseenter', () => {
    hoverInfo.textContent = b.description || b.title;
  });

  const move = document.createElement('button');
  move.className = 'rowBtn';
  move.textContent = '→';
  move.title = 'Move to another category';
  move.onclick = () => {
    const sel = li.querySelector('.moveSel');
    if (sel.hidden) {
      sel.hidden = false;
      fillMoveSelect(sel, b.category);
      sel.focus();
    } else {
      sel.hidden = true;
    }
  };
  li.appendChild(move);

  const moveSel = document.createElement('select');
  moveSel.className = 'moveSel';
  moveSel.hidden = true;
  moveSel.onchange = async () => {
    if (!moveSel.value || moveSel.value === b.category) {
      moveSel.hidden = true;
      return;
    }
    try {
      await api('/api/bookmarks/' + b.id, { method: 'PATCH', body: JSON.stringify({ category: moveSel.value }) });
      render();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };
  li.appendChild(moveSel);

  const edit = document.createElement('button');
  edit.className = 'rowBtn';
  edit.textContent = '✎';
  edit.title = 'Edit entry';
  edit.onclick = () => startEdit(li, b);
  li.appendChild(edit);

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.title = 'Delete';
  del.onclick = async () => {
    if (!confirm('Delete this bookmark?')) return;
    await api('/api/bookmarks/' + b.id, { method: 'DELETE' });
    render();
  };
  li.appendChild(del);

  return li;
}

let columnOrder = [];
let fullCategoryList = [];
function fillColumn(cat, bookmarks, position, total) {
  const div = document.createElement('div');
  div.className = 'category';
  const heading = document.createElement('h2');
  const pos = document.createElement('span');
  pos.className = 'catPos';
  pos.textContent = `(${position})`;
  if (cat.id && cat.name !== 'Home') {
    pos.dataset.clickable = '1';
    pos.title = 'Click to change category position';
    pos.onclick = async () => {
      const list = fullCategoryList;
      const cur = list.findIndex((c) => c.id === cat.id);
      const input = prompt(`Move category "${cat.name}" to position (1–${list.length - 1}):`, cur);
      if (input === null) return;
      const p = parseInt(input, 10);
      if (isNaN(p) || p === cur) return;
      try {
        await api('/api/categories/' + cat.id + '/position', { method: 'POST', body: JSON.stringify({ position: p }) });
        render();
      } catch (e) {
        alert(e.message === 'invalid position' ? `Enter a number between 1 and ${list.length - 1}.` : 'Error: ' + e.message);
      }
    };
  }
  heading.appendChild(pos);
  const span = document.createElement('span');
  span.textContent = cat.name;
  heading.appendChild(span);
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  heading.appendChild(spacer);
  const reordering = reorderCategory === cat.name;
  const re = document.createElement('button');
  re.className = 'reorderBtn';
  re.textContent = '⇅';
  re.title = reordering ? 'Exit reorder mode' : 'Reorder bookmarks';
  re.onclick = () => {
    reorderCategory = reordering ? null : cat.name;
    render();
  };
  if (reordering) re.classList.add('active');
  heading.appendChild(re);
  div.appendChild(heading);
  const ul = document.createElement('ul');
  for (const b of bookmarks) ul.appendChild(bookmarkRow(b, reordering));
  div.appendChild(ul);
  return div;
}

async function render() {
  const [cats, bms] = await Promise.all([api('/api/categories'), api('/api/bookmarks')]);

  const previous = filter.value;
  filter.replaceChildren();
  const bmCat = $('#bmCategory');
  const bmPrevious = bmCat.value;
  bmCat.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All categories';
  filter.appendChild(all);
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.name;
    filter.appendChild(o);
    const o2 = o.cloneNode(true);
    bmCat.appendChild(o2);
  }

  filter.value = [...filter.options].some((o) => o.value === previous) ? previous : '';
  bmCat.value = [...bmCat.options].some((o) => o.value === bmPrevious) ? bmPrevious : (bmPrevious ? '' : bmCat.options[0]?.value || '');
  const selected = filter.value;
  const visible = selected ? bms.filter((b) => b.category === selected) : bms;
  emptyMsg.hidden = visible.length > 0;
  columns.replaceChildren();

  const byCat = new Map();
  for (const b of visible) {
    if (!byCat.has(b.category)) byCat.set(b.category, []);
    byCat.get(b.category).push(b);
  }
  fullCategoryList = cats;
  const order = cats.filter((c) => byCat.has(c.name)).map((c) => c);
  for (const name of byCat.keys()) {
    if (!order.some((c) => c.name === name)) order.push({ id: '', name });
  }

  columnOrder = order;
  order.forEach((cat, idx) => {
    const fullPos = fullCategoryList.findIndex((c) => c.id === cat.id);
    columns.appendChild(fillColumn(cat, byCat.get(cat.name), fullPos, fullCategoryList.length));
  });
}

$('#addCategory').addEventListener('click', async () => {
  const name = prompt('New category name:');
  if (!name || !name.trim()) return;
  try {
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    await render();
    filter.value = name.trim();
    filter.dispatchEvent(new Event('change'));
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

$('#renameCategory').addEventListener('click', async () => {
  const name = filter.value;
  if (!name) return alert('Select a category to rename first.');
  if (name === 'Home') return alert('Home category cannot be renamed.');
  const newName = prompt(`Rename category "${name}" to:`, name);
  if (!newName || !newName.trim() || newName.trim() === name) return;
  const cats = await api('/api/categories');
  const cat = cats.find((c) => c.name === name);
  if (!cat) return;
  try {
    await api('/api/categories/' + cat.id, { method: 'PATCH', body: JSON.stringify({ name: newName.trim() }) });
    filter.value = newName.trim();
    await render();
  } catch (e) {
    alert(e.message === 'category already exists' ? 'A category with that name already exists.' : 'Error: ' + e.message);
  }
});

$('#delCategory').addEventListener('click', async () => {
  const name = filter.value;
  if (!name) return alert('Select a category to delete first.');
  const cats = await api('/api/categories');
  const cat = cats.find((c) => c.name === name);
  if (!cat) return;
  const bms = await api('/api/bookmarks');
  const count = bms.filter((b) => b.category === name).length;
  const msg = count > 0
    ? `Delete category "${name}" and its ${count} bookmark(s)? This cannot be undone.`
    : `Delete category "${name}"?`;
  if (!confirm(msg)) return;
  try {
    await api('/api/categories/' + cat.id + '?force=1', { method: 'DELETE' });
    filter.value = '';
    await render();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const html = await file.text();
    const res = await api('/api/import', { method: 'POST', body: JSON.stringify({ html }) });
    await render();
    alert(`Imported ${res.added} bookmark(s) into ${res.categories} category(s).`);
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});
$('#exportBtn').addEventListener('click', () => {
  window.location = '/api/export';
});

const addForm = $('#addBookmarkForm');
const bmTitle = $('#bmTitle');
const bmUrl = $('#bmUrl');
const bmDesc = $('#bmDesc');
const bmStatus = $('#bmStatus');

$('#addBookmarkBtn').addEventListener('click', () => {
  addForm.hidden = !addForm.hidden;
  if (!addForm.hidden) {
    const cats = [...$('#bmCategory').options].map((o) => o.value).filter(Boolean);
    if (!cats.length) {
      bmStatus.textContent = 'Create a category first (+ button).';
      $('#bmCategory').focus();
      return;
    }
    bmStatus.textContent = '';
    if (!$('#bmCategory').value) $('#bmCategory').focus();
    else bmTitle.focus();
  }
});

$('#bmCancel').addEventListener('click', () => {
  addForm.hidden = true;
  bmStatus.textContent = '';
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = $('#bmCategory').value;
  const title = bmTitle.value.trim();
  const url = bmUrl.value.trim();
  if (!category) return (bmStatus.textContent = 'Select a category.');
  if (!title) return (bmStatus.textContent = 'Title required.');
  if (!/^https?:\/\//i.test(url)) return (bmStatus.textContent = 'URL must start with http(s)://');
  try {
    await api('/api/bookmarks', { method: 'POST', body: JSON.stringify({ title, url, category, description: bmDesc.value.trim() }) });
    bmTitle.value = bmUrl.value = bmDesc.value = '';
    bmStatus.textContent = '';
    addForm.hidden = true;
    await render();
  } catch (err) {
    bmStatus.textContent = 'Error: ' + err.message;
  }
});

filter.addEventListener('change', () => {
  if (filter.value) {
    for (const col of columns.children) {
      if (col.querySelector('h2').textContent.replace(/ \(\d+\)$/, '') === filter.value) {
        const h = col.offsetTop;
        window.scrollTo({ top: h, behavior: 'smooth' });
        break;
      }
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  render();
});

render().catch((e) => console.error(e));
