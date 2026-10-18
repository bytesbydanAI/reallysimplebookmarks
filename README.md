# Really Simple Bookmarks

A minimal self-hosted bookmark manager: a small Node.js backend with JSON file
storage, a responsive web UI, and a cross-browser (Chrome/Chromium + Firefox)
extension for saving the current page.

No accounts, no framework, no database — designed to sit behind a reverse
proxy (e.g. Pangolin handles auth in front of it).

## Backend (Docker)

### Option A: Pull the prebuilt image (recommended, e.g. for Dockge)

A prebuilt image is published to GHCR on every push to `main`, so no local
build step is needed. Just drop [`docker-compose.yml`](./docker-compose.yml)
into Dockge (or run `docker compose up -d`) and the container is pulled
automatically:

```yaml
services:
  bookmarks:
    image: ghcr.io/bytesbydanai/reallysimplebookmarks:latest
    container_name: reallysimplebookmarks
    restart: unless-stopped
    ports:
      - "26482:3000"
    volumes:
      - ./data:/data
```

- Web UI: `http://localhost:26482`
- Data is stored in `./data/bookmarks.json` on the host.
- No login: authentication is expected to be handled by your reverse proxy
  (e.g. Pangolin).

### Option B: Build locally

```bash
docker build -t reallysimplebookmarks .
docker run -d -p 26482:3000 -v ./data:/data reallysimplebookmarks
```

or with compose:

```bash
docker compose up -d --build   # first move the `image:` line back to `build: .`
```

The image is built and pushed by `.github/workflows/docker-publish.yml`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/export` | Download bookmarks as browser-compatible bookmarks.html |
| POST | `/api/import` | Import bookmarks.html `{ html }` — dedupes by URL |
| GET | `/api/categories` | List categories (Home always first) |
| POST | `/api/categories` | Create category `{ name }` |
| POST | `/api/categories/:id/position` | Move category to `{ position }` (1..n; Home stays at 0) |
| POST | `/api/bookmarks/:id/position` | Move bookmark to `{ position }` within its category (0-based) |
| PATCH | `/api/categories/:id` | Rename category `{ name }` — moves its bookmarks; not for Home |
| DELETE | `/api/categories/:id` | Delete category; add `?force=1` to delete its bookmarks too; Home protected |
| GET | `/api/bookmarks` | List bookmarks |
| POST | `/api/bookmarks` | Create bookmark `{ title, url, category, description? }` |
| DELETE | `/api/bookmarks/:id` | Delete a bookmark |
| PATCH | `/api/bookmarks/:id` | Update bookmark `{ category?, title?, description? }` — use for moving entries |

## Website

- Desktop: categories laid out in multiple columns (auto-fitting grid).
- Mobile: single column, filter/scroll via the category dropdown in the header.
- Categories can be created (+), renamed (✎), and deleted (−) via the header controls. Deleting shows the entry count and confirmation; ⚠ deletion also removes the category's bookmarks.
- Each column heading shows its position as (0), (1), … — click the number and enter a new position to reorder; others shift automatically. Home is always (0). Bookmark order: click ⇅ on a column heading to enter reorder mode (rows become inert and show index numbers), click an index and enter the new position to move it, click ⇅ again to exit. A legacy "Default" category is automatically renamed to Home on first start.
- Each entry has a ✎ button to edit its title, URL, and description, and a → button to move it to another category.
- Bookmarks can be added on the site itself via the "+ Bookmark" button (category, title, URL, optional description) — useful on mobile, where no extension is available.
- **Import/Export**: the header has Import/Export buttons for the standard browser bookmarks.html format (Netscape). On import, ungrouped toolbar bookmarks go to the **Home** category (always listed first); toolbar sub-folders and other folders become categories. Export reverses the mapping: Home → toolbar, categories → folders.
- **Export caveat (Firefox)**: Firefox only honors the toolbar marker (`PERSONAL_TOOLBAR_FOLDER`) during initial profile migration — not when importing via the Library. Imported content therefore lands in the Bookmarks Menu as a folder named "Bookmarks Toolbar"; drag its contents onto the real toolbar once after importing. The exported file itself is exactly the format Firefox writes.
- Descriptions show on hover (desktop) or via the ⓘ button next to each entry.

## Browser extension

The `extension/` folder is a WebExtension (MV3) that works in both
Chromium-based browsers and Firefox.

1. Open the extension popup, enter your server URL (e.g.
   `https://bookmarks.example.com`) — it is remembered.
2. Choose a category from the dropdown, or pick "+ Add new category…" to
   create one.
3. The title field is pre-filled with the page title and fully editable.
4. Optionally add a description, then Save.

### Install (Chromium)

1. Visit `chrome://extensions`, enable Developer mode.
2. "Load unpacked" and select the `extension/` folder.

### Install (Firefox)

1. Visit `about:debugging#/runtime/this-firefox`.
2. "Load Temporary Add-on" and select the `extension/manifest.json` file
   (or zip the `extension/` folder and sign it via
   [addons.mozilla.org](https://addons.mozilla.org) for permanent install).

### Reverse proxy / CORS note

The extension calls your server directly from the popup, so it needs CORS
enabled for extension origins. The server allows all origins
(`Access-Control-Allow-Origin: *`), which is safe since the extension only
makes requests with a JSON content type (no cookies).

## Project layout

```
server.js             # zero-dependency Node HTTP server + JSON API
public/               # web UI (index.html, style.css, app.js)
extension/            # browser extension (manifest.json, popup.html/js, icons)
Dockerfile            # runs server.js on port 3000 with /data volume
docker-compose.yml    # example compose stack
```
