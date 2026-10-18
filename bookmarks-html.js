const DECODE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

function decodeEntities(s) {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+|#x[0-9a-f]+);/gi, (m, e) => {
      if (e.toLowerCase().startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
      return DECODE[m] !== undefined ? DECODE[m] : m;
    });
}

function encodeEntities(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TOOLBAR_NAMES = ['bookmarks toolbar', 'bookmarks bar', 'lesezeichenleiste', 'bookmarks menu', 'bookmarks-menu'];

function isToolbarHeading(name, attrs) {
  if (/PERSONAL_TOOLBAR_FOLDER/i.test(attrs || '')) return true;
  return TOOLBAR_NAMES.includes((name || '').trim().toLowerCase());
}

function parseBookmarksHtml(html) {
  const root = { name: '', bookmarks: [], children: [], parent: null, isToolbar: false };
  let cur = root;
  let pending = null;
  let lastBm = null;
  let seenRootDl = false;

  const re = /<DT><H3([^>]*)>([\s\S]*?)<\/H3>|<DT><A([^>]*)>([\s\S]*?)<\/A>|<DD>([^<]*)|<DL[^>]*>|<\/DL>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].toUpperCase().startsWith('<DL')) {
      if (cur === root && !pending && !seenRootDl) {
        seenRootDl = true;
        continue;
      }
      const f = {
        name: pending ? pending.name : '',
        bookmarks: [],
        children: [],
        parent: cur,
        isToolbar: pending ? pending.isToolbar : false,
      };
      cur.children.push(f);
      cur = f;
      pending = null;
      lastBm = null;
    } else if (m[0].toUpperCase() === '</DL>') {
      if (cur.parent) cur = cur.parent;
      lastBm = null;
    } else if (m[1] !== undefined) {
      const name = decodeEntities(m[2]).trim();
      pending = { name, isToolbar: isToolbarHeading(name, m[1]) };
    } else if (m[3] !== undefined) {
      const href = (/HREF\s*=\s*"([^"]*)"/i.exec(m[3]) || [])[1] || '';
      const bm = { title: decodeEntities(m[4]).trim(), url: href, description: '' };
      if (bm.url) cur.bookmarks.push(bm);
      lastBm = bm;
    } else if (m[5] !== undefined && lastBm) {
      lastBm.description = decodeEntities(m[5]).trim();
    }
  }

  const toolbar = root.children.find((c) => c.isToolbar) || null;

  const defaultBookmarks = [...root.bookmarks];
  if (toolbar) defaultBookmarks.push(...toolbar.bookmarks);

  const folders = [];
  function collect(folder, path, isToolbarChild) {
    const p = isToolbarChild ? folder.name : path ? path + '/' + folder.name : folder.name;
    if (folder.bookmarks.length) folders.push({ name: p, bookmarks: folder.bookmarks });
    for (const child of folder.children) collect(child, p, false);
  }
  if (toolbar) for (const child of toolbar.children) collect(child, '', true);
  for (const child of root.children) {
    if (child === toolbar) continue;
    collect(child, '');
  }

  return { defaultBookmarks, folders };
}

function serializeBookmarksHtml(defaultBookmarks, categoriesByName) {
  const now = Math.floor(Date.now() / 1000);
  const lines = [];
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  lines.push('<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->');
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  lines.push('<TITLE>Bookmarks</TITLE>');
  lines.push('<H1>Bookmarks</H1>');
  lines.push('<DL><p>');

  const bmLine = (bm, indent) => {
    lines.push(`${indent}<DT><A HREF="${encodeEntities(bm.url)}" ADD_DATE="${Math.floor((bm.created || Date.now()) / 1000)}">${encodeEntities(bm.title)}</A>`);
    if (bm.description) lines.push(`${indent}<DD>${encodeEntities(bm.description)}`);
  };

  lines.push(`    <DT><H3 ADD_DATE="${now}" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>`);
  lines.push('    <DL><p>');
  for (const bm of defaultBookmarks) bmLine(bm, '        ');
  lines.push('    </DL><p>');

  const tree = {};
  for (const [name, bms] of Object.entries(categoriesByName)) {
    const parts = name.split('/').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    let node = tree;
    for (const p of parts) {
      if (!node[p]) node[p] = { __bms: [], __children: {} };
      node = node[p];
    }
    node.__bms.push(...bms);
  }

  function emit(label, node, indent) {
    lines.push(`${indent}<DT><H3 ADD_DATE="${now}">${encodeEntities(label)}</H3>`);
    lines.push(`${indent}<DL><p>`);
    for (const bm of node.__bms) bmLine(bm, indent + '    ');
    for (const [childName, child] of Object.entries(node.__children)) {
      emit(childName, child, indent + '    ');
    }
    lines.push(`${indent}</DL><p>`);
  }

  for (const [name, node] of Object.entries(tree)) emit(name, node, '    ');

  lines.push('</DL><p>');
  return lines.join('\n') + '\n';
}

module.exports = { parseBookmarksHtml, serializeBookmarksHtml };
