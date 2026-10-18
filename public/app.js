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

function bookmarkRow(b) {
  const li = document.createElement('li');
  li.dataset.id = b.id;

  const a = document.createElement('a');
  a.href = b.url;
  a.textContent = b.title;
  a.rel = 'noopener noreferrer';
  li.appendChild(a);

  const info = document.createElement('button');
  info.className = 'info';
  info.textContent = 'i';
  info.title = 'Info';
  if (b.description) {
    info.onclick = () => li.querySelector('.desc').classList.toggle('open');
  } else {
    info.disabled = true;
    info.style.opacity = '.25';
    info.style.cursor = 'default';
  }
  li.appendChild(info);

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

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = b.description || '';
  li.appendChild(desc);

  return li;
}

function fillColumn(h2, bookmarks) {
  const div = document.createElement('div');
  div.className = 'category';
  const heading = document.createElement('h2');
  heading.textContent = `${h2} (${bookmarks.length})`;
  div.appendChild(heading);
  const ul = document.createElement('ul');
  for (const b of bookmarks) ul.appendChild(bookmarkRow(b));
  div.appendChild(ul);
  return div;
}

async function render() {
  const [cats, bms] = await Promise.all([api('/api/categories'), api('/api/bookmarks')]);

  const previous = filter.value;
  filter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All categories';
  filter.appendChild(all);
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.name;
    filter.appendChild(o);
  }

  filter.value = [...filter.options].some((o) => o.value === previous) ? previous : '';
  const selected = filter.value;
  const visible = selected ? bms.filter((b) => b.category === selected) : bms;
  emptyMsg.hidden = visible.length > 0;
  columns.replaceChildren();

  const byCat = new Map();
  for (const b of visible) {
    if (!byCat.has(b.category)) byCat.set(b.category, []);
    byCat.get(b.category).push(b);
  }
  const order = cats.map((c) => c.name).filter((n) => byCat.has(n));
  for (const n of byCat.keys()) if (!order.includes(n)) order.push(n);

  for (const name of order) {
    columns.appendChild(fillColumn(name, byCat.get(name)));
  }
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

$('#delCategory').addEventListener('click', async () => {
  const name = filter.value;
  if (!name) return alert('Select a category to delete first.');
  if (!confirm(`Delete category "${name}"?`)) return;
  const cats = await api('/api/categories');
  const cat = cats.find((c) => c.name === name);
  if (!cat) return;
  try {
    await api('/api/categories/' + cat.id, { method: 'DELETE' });
    filter.value = '';
    await render();
  } catch (e) {
    alert(e.message === 'category not empty' ? `"${name}" still has bookmarks. Delete or move them first.` : 'Error: ' + e.message);
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
