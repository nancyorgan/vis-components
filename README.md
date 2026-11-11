# vis-components

Embeddable, data-centric visualization components.

## Prerequisites

Node 24 (the current LTS; `.node-version` pins the major, and `engines` in
package.json enforces `>=22.16 <23 || >=24` — the self-host server uses the
built-in `node:sqlite`, which needs at least that). With fnm, from any
directory in the repo:

```
eval "$(fnm env --use-on-cd)" && fnm use 24
```

pnpm 10 (the exact version is pinned via `packageManager` in package.json;
`corepack enable` picks it up automatically).

## Run the editor locally

From the project directory:

```
pnpm install
pnpm dev
```

Editor: http://localhost:3002.

To develop against a running self-host server instead of browser-local
storage, point the dev server's `/api` proxy at it:
`VIS_DEV_API=http://localhost:<port> pnpm dev`.

To test embed publishing without a real server, `pnpm embed:dev` starts a
scratch self-host server, the static server for published files, the
embed-runtime watch build, and the editor on http://localhost:3010 in server
mode — all on gitignored `.embed-dev/` storage; Ctrl-C stops them together.

Run this way (or served as static files), everything you make is stored in
your own browser (localStorage + IndexedDB) — private to that browser, no
server required.

## Self-hosting (shared server)

The repo also ships a small self-host server for running the app as a shared
deployment: same UI, but visuals, folders, datasets, embed instances, and
themes are stored centrally (SQLite + a dataset directory) and shared by
everyone who uses that URL. It has zero runtime dependencies beyond Node
itself.

```
corepack enable
pnpm install --frozen-lockfile
pnpm build     # emits dist/ (frontend) and server/dist/ (server)

VIS_BASE_URL=https://charts.example.com \
VIS_DB_DIR=/var/lib/vis/db \
VIS_DATA_DIR=/var/lib/vis/data \
VIS_PORT=8080 \
VIS_PUBLISH_DIR=/var/lib/vis/publish \
VIS_PUBLISH_BASE_URL=https://embeds.example.com \
node server/dist/main.js
```

All six environment variables are required; the server refuses to start with
a one-line reason per missing/invalid value. `VIS_AUTH_MODE` is the one
optional variable.

| Variable | Meaning |
|---|---|
| `VIS_BASE_URL` | Absolute origin the app is reached at (behind any proxies). Used for share links; never derived from incoming requests. |
| `VIS_DB_DIR` | Directory for the SQLite database. Initialized when empty; malformed state fails startup. |
| `VIS_DATA_DIR` | Directory for dataset files (one gzipped JSON file per dataset). |
| `VIS_PORT` | Port to listen on. Plain HTTP — put TLS termination in front. |
| `VIS_PUBLISH_DIR` | Directory published embeds are written into. Serve it publicly with a separate dumb static file server (e.g. `python3 -m http.server`); everything in it is fully public, and published embeds keep working with the app server off. |
| `VIS_PUBLISH_BASE_URL` | Public base URL that static server serves `VIS_PUBLISH_DIR` at — a file at `$VIS_PUBLISH_DIR/<path>` must be reachable at `$VIS_PUBLISH_BASE_URL/<path>`. |
| `VIS_AUTH_MODE` | Optional. Unset, empty or `none`: nobody is identified and identity headers are ignored (today's behavior). `header`: a sign-in proxy in front of the server names the person on every request — `X-Forwarded-User` (stable account id, compared and never shown) and `X-Forwarded-Email` (display name; `X-Forwarded-Preferred-Username` when there is no email) — and presence, "Saved by" and `/api/config`'s `user` switch on. In `header` mode a request without `X-Forwarded-User` gets a plain 401, except `GET /alive`; the proxy must set these headers itself and replace any a client sent. Any other value fails startup. |

Each published embed's folder also holds `image.png`, a picture of the chart
that is rewritten on every republish (so it can be linked into a slide deck
and refresh on open). The static server must serve `.png` as `image/png`, and
should send `Cache-Control: no-cache` for everything under `embeds/` — a
cached picture or page defeats that refresh.

Operational notes: `GET /alive` answers 200 for liveness probes; logs go to
stdout/stderr; SIGTERM drains in-flight requests and closes the database
cleanly; run exactly one replica (SQLite is embedded). The same build served
without the server behaves exactly like the local editor — the frontend
detects the server at boot via `GET /api/config`. Users on the same server
share one library; edits are last-write-wins per item, except that a visual
can be saved conditionally: `GET /api/visuals/<id>` answers it with an `ETag`,
and a `PUT` carrying that tag in `If-Match` is refused with 412 (nothing
written) if the stored visual changed since. The server has no
accounts of its own. Run it behind a sign-in proxy with `VIS_AUTH_MODE=header`
(above), or run the handler (`createHandler` in `server/src/routes.ts`) from
your own code and pass an `identify(req) → { id, name } | null` hook; either
way the editor then shows who else has the same visual open and the top bar
says who saved last. There is no sign-out: behind single sign-on it would sign
the person straight back in. When a sign-in lapses, the API answers 401 and
the app shows a banner asking for a reload. Without either, identity stays
off. Dataset uploads warn
above 25 MB and are rejected above 100 MB (browser performance is the real
constraint). Note: Node prints an `ExperimentalWarning` for `node:sqlite` on
startup; it's expected.

## MCP server

`mcp/` is an MCP server (stdio) that lets Claude make and edit charts on a
running self-host server through its existing HTTP API. Build it with
`pnpm mcp:build` (also part of `pnpm build`): the output, `mcp/dist/main.js`,
is one file with no runtime dependencies beyond Node 22. It needs one
environment variable, `VIS_API_URL`, the self-host server's URL. For Claude
Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zafiro": {
      "command": "node",
      "args": ["/path/to/vis-components/mcp/dist/main.js"],
      "env": { "VIS_API_URL": "http://localhost:8080" }
    }
  }
}
```

Tools (a first chart is two calls, `create_dataset` then `create_chart`, or
one when the data set is already in the library; nothing needs reading
first). The server's instructions carry the charting rules; the long-form
`mcp/guide/agent-guide.md` is documentation only and no tool serves it.

- `create_dataset`: store a data set from exactly one of `rows` (flat objects), `csv` (CSV text, header first) or `path` (a file on the MCP's computer); an identical one under the same name is reused, including one the editor's upload stored from the same file. Returns its id, row count and field types. See "Data in" below.
- `create_chart`: make a chart from encodings (the only required key). The data set, folder and theme go by name or id (`dataset`, `folder`, `themeId`; `datasetId` / `folderId` still work); an unknown, near-miss or shared name is refused with the choices and nothing is saved. Returns editor and embed links and the save's `revision`.
- `edit_chart`: change only the keys a patch names. Judged against the chart at the `revision` it is given, else as the MCP last returned it to a model on this computer; changes others made since to other settings are kept, and a change to the same setting pauses the edit (see "Edit safety and undo").
- `undo_chart_edit`: step back the last edit made through this MCP on this computer, restoring only that edit's settings (see below).
- `get_chart`: a chart's encodings, titles, links, stored settings and `revision`.
- `list_charts`: library counts and every folder by path; or one folder's charts (newest first, at most 50), narrowed by data set or name words. Trash and templates are left out, as in the library's Visuals view.
- `list_datasets`: data sets with row counts; `fields: true` adds field types.
- `list_settings`: search the stored settings a `settings` patch can set (`*` = a level, field or panel key; `[]` = a list entry; lists replace whole), a page at a time. With a `chartId`, each row shows the chart's current value, plus its theme's palette ids.
- `export_chart`: write the chart as a png, jpeg, svg or pdf file through the app's own Export pipeline into the person's Export folder (never another folder, never over an existing file).

Data in (`create_dataset`): `csv` text and a `path` file parse exactly as
the editor's upload does (`parseCsvTextWithin` in `lib/parseCsv.ts`, the
upload's options: UTF-8, a leading BOM dropped, quoted delimiters and line
breaks, blank lines skipped, the delimiter detected, the same field types,
the header's column order kept). A `.tsv` file parses as tab-separated; a
`.csv` or `.txt` file as an upload would. The data set takes `name`, or, with
`path`, the file's name without its extension; a path's version is named
after the file, csv text's "Pasted data". With `expectedRows` (the data's
row count, header not counted), any other number of rows arriving stores
nothing and the refusal says how many arrived. Path rules, since a model can
be talked into naming any file: an absolute path only, ending `.csv`,
`.tsv` or `.txt` (any case), with no hidden part (no file or folder name
starting with `.`); a symlink is followed and its target must pass the same
rules; folders, devices, sockets, named pipes, unreadable or missing files
and a header with no rows are refused. The file is opened once,
non-blocking, its open descriptor checked (the same regular file that was
checked, within the size limit) before any byte is read, and read for at
most its checked size plus one byte, so a file that grows or a pipe swapped
in after the check is refused rather than read or waited on. Limits, each
refused with nothing stored: 100 MB of source (the file's size or the csv
text's UTF-8 bytes, the editor's upload limit, never the expanded rows),
1,000,000 data rows, 10,000,000 cells (rows times columns), and a parse
memory budget of 1 GiB of parsed rows (estimated per row and cell, two bytes
a character), or a quarter of the Node heap limit when that is smaller. The
parse runs in chunks and stops as soon as a limit is passed, so an
oversized file never takes the MCP down.

Pictures: every successful `create_chart`, `edit_chart` and `undo_chart_edit`
(and `get_chart`, unless `picture: false`) returns a picture of the stored
chart after its text, so the model sees what it made. The MCP takes it with
the Chrome or Edge already installed on the machine, run headless on the
chart's `/embed` page with a fresh temporary profile, reads only (any
non-GET request from the page is failed), one render at a time, and
encoded as WebP under 120,000 base64 characters. No browser, or a browser
that fails, never fails a saved write: the result says there is no picture
and why. For hosts that support MCP Apps (Claude Desktop), the chart also
shows in the conversation as a card (`ui://zafiro/chart.html`) with the
chart's name, its picture, "Open in editor" and "Full screen"; the card
loads its picture through `chart_picture`, a tool listed only to such
hosts and never offered to the model.

Edit safety and undo: the MCP remembers, in one small file
(`history.json`) in the person's state folder, every chart it returned to a
model (from `create_chart`, `get_chart`, a saved edit or an undo) and up to
20 undo steps per chart. Every copy of the MCP on the computer (Claude
Desktop runs two) shares it, and it survives restarts. The folder is
`VIS_STATE_DIR` when set (an absolute path; a leading `~` is the home
folder), else `~/Library/Application Support/Zafiro MCP` on macOS,
`%LOCALAPPDATA%\Zafiro MCP` on Windows, and `$XDG_STATE_HOME/zafiro-mcp`
(default `~/.local/state/zafiro-mcp`) on Linux. Entries are keyed by the
Zafiro server address and the data format version, so another server or a
build on another format sees none of them; anything older than 30 days is
trimmed. The file is written atomically, and a lock file next to it, held
only while a call reads, saves and records (never while a picture is taken
or between calls), keeps the copies to one operation at a time: a call
that waits more than about 10 s is refused with nothing saved, and a lock
whose copy died is taken over within about 10 s.

An edit is compared with the chart as the model last saw it (or at the
`revision` it sends), setting by setting: lists compare whole, keys holding
dots stay separate, defaults the editor fills in and save bookkeeping
(times, saver, preview) never count. Someone else's changes to other
settings are kept and the edit lands on top (one retry when a save lands
mid-call). When they changed a setting the edit also changes, nothing is
saved and the result lists each change as `path: from -> to` with the
current `revision` and four ways on, each one call: keep theirs
(`keepTheirs: true`), go ahead (the same edit with that `revision`), leave
it, or a combined value (`edit_chart` with that `revision`). A revision the
MCP never returned for the chart is refused. `undo_chart_edit` restores
only the settings its edit changed, over the current chart, and pauses the
same way when one was changed again since: keep theirs (`keepTheirs:
true`), undo over theirs (the `revision` from that pause, bound to it and
usable once), leave it, or a combined value through `edit_chart`. A step is
used up only once its restoring save lands; an edit that saved but could
not be recorded says it has no undo step.

Optional environment variables: `VIS_EXPORT_DIR`, the folder exports go to
(default `~/Downloads/Zafiro`; a leading `~` or `${HOME}` is the home
folder; a blank or relative value means the default); `VIS_BROWSER_PATH`,
the browser to use instead of the standard Chrome / Edge install paths. A
change takes effect when the host restarts the MCP. With
`VIS_TEST_REAL_BROWSER=1` (after `pnpm build`),
`pnpm vitest run mcp/src/render/realBrowser` exercises the real browser.

The three chart writes declare an output schema and return the same JSON as
`structuredContent` (plus the card's `pictureKey`). `mcp/src/__snapshots__/surface.json` is the served
surface (instructions, descriptions, schemas, annotations); a test keeps the
instructions plus every description under 8,000 characters, and the
snapshot changes only on purpose (`pnpm vitest run mcp/src/surface.test.ts -u`).

The catalog behind `settings` is `src/contexts/chartBuilder/lib/settingCatalog.json`; regenerate it with `pnpm settings:catalog` after changing a saved config type. A setting behaves as its sidebar panel does (`lib/settingEffects.ts`): the panel and the settings path call the same lib function for anything a pick seeds, gates or normalizes.

## Verifying changes

```
pnpm typecheck   # tsc --noEmit (also runs as the first step of `build`)
pnpm lint        # eslint
pnpm test        # unit + component tests (vitest)
pnpm test:watch  # vitest in watch mode
pnpm test:coverage # same suite with the CI coverage floor enforced
pnpm test:e2e    # Playwright end-to-end suite (~12 min; starts its own server)
pnpm build       # typecheck + production bundle + self-host server
pnpm build:static # typecheck + production bundle only (browser-local mode)
pnpm embed:dev   # local embed-publishing loop (scratch server + static publish server + editor on :3010)
pnpm preview     # serve the production bundle locally (dev-grade, not for deployment)
```

`build` is gated on `typecheck`, so type errors fail the build rather than
accumulating silently. CI (`.github/workflows/ci.yml`) runs `typecheck`,
`lint`, `test:coverage`, and `build`, plus the e2e suite as a separate job, on
pushes to `main` and on pull requests.

## Docs

[APPLICATION.md](APPLICATION.md) is the behavioral source of truth for how the
editor works; [LAYOUT.md](LAYOUT.md) documents the layout math.

## License

Licensed under the [O'Saasy License](LICENSE) — free to use, copy, modify, and
redistribute, except as a competing hosted/SaaS offering of the software
itself. Bundled open-source dependencies are credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
