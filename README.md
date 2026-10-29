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
itself: `pnpm build` bundles it, with the few modules it shares with the
editor, into the single file `server/dist/main.js`.

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
a one-line reason per missing/invalid value.

| Variable | Meaning |
|---|---|
| `VIS_BASE_URL` | Absolute origin the app is reached at (behind any proxies). Used for share links; never derived from incoming requests. |
| `VIS_DB_DIR` | Directory for the SQLite database. Initialized when empty; malformed state fails startup. |
| `VIS_DATA_DIR` | Directory for dataset files (one gzipped JSON file per dataset). |
| `VIS_PORT` | Port to listen on. Plain HTTP — put TLS termination in front. |
| `VIS_PUBLISH_DIR` | Directory published embeds are written into. Serve it publicly with a separate dumb static file server (e.g. `python3 -m http.server`); everything in it is fully public, and published embeds keep working with the app server off. |
| `VIS_PUBLISH_BASE_URL` | Public base URL that static server serves `VIS_PUBLISH_DIR` at — a file at `$VIS_PUBLISH_DIR/<path>` must be reachable at `$VIS_PUBLISH_BASE_URL/<path>`. |

Operational notes: `GET /alive` answers 200 for liveness probes; logs go to
stdout/stderr; SIGTERM drains in-flight requests and closes the database
cleanly; run exactly one replica (SQLite is embedded). The same build served
without the server behaves exactly like the local editor — the frontend
detects the server at boot via `GET /api/config`. Users on the same server
share one library; edits are last-write-wins per item. A host that runs the
handler (`createHandler` in `server/src/routes.ts`) behind its own sign-in can
pass an `identify(req) → { id, name } | null` hook; with it, the editor shows
who else has the same visual open and the top bar says who saved last. The
standalone server has no accounts and leaves this off. Dataset uploads warn
above 25 MB and are rejected above 100 MB (browser performance is the real
constraint). Note: Node prints an `ExperimentalWarning` for `node:sqlite` on
startup; it's expected.

### Creating a visual from a chart spec

`POST /api/visuals` creates one visual from a short chart spec instead of
the full saved-visual JSON the editor writes. The server fills in everything
the spec leaves out exactly as the editor does for a new visual (theme
palettes, fonts, axis and label defaults), checks the spec against the stored
data, and saves the result. It only ever creates: the server picks the id,
so a spec can't overwrite anything.

```
curl -X POST https://charts.example.com/api/visuals \
  -H 'content-type: application/json' \
  -d '{"datasetId":"ds-…","folderId":null,
       "encodings":{"x":"month","length":"sales","hue":"region"},
       "title":"Sales by month","stack":"group"}'
```

| Field | Meaning |
|---|---|
| `datasetId` | Required. The data set to chart; the spec is checked against its latest version. |
| `folderId` | Required. A folder id, or `null` for the library root. |
| `encodings` | Required. Channel → field name, e.g. `{"y":"country","length":"rate"}`. Channels are the shelf's (`x`, `y`, `length`, `hue`, `facet`, …), by id or by the shelf's label (`"X position"`, `"Color"`; case, spaces and punctuation ignored). The chart type follows from them as it does on the shelves. |
| `name`, `title`, `subtitle` | Optional text. `name` falls back to `title`, then "Untitled". |
| `family` | Optional quick-start family (`"bar"`, `"scatter"`, …) the encodings are expected to make; a mismatch is an error naming what is missing. The variation the encodings fill best supplies its settings, as the quick-start bar does. Map, sankey and chord charts are made in the editor for now. |
| `variation` | Optional. One of the family's variations by name, when several fit. |
| `fieldTypes` | Optional field → type overrides, as the Fields panel sets them. |
| `axes` | Optional `{x, y}`, each `{title, min, max, format}`. Bounds apply to a quantitative or measure axis (numbers) or a temporal axis (`"2020"`, `"2020-03"` or `"2020-01-01"`, read as local midnight as the date boxes do, or epoch ms); `format` is what the axis Format box takes. |
| `stack` | Optional `"stack"`, `"group"` or `"overlay"`; needs a categorical `hue`. |
| `themeId` | Optional theme, by id or by name (case, spaces and punctuation ignored); the server's default theme otherwise. |

The body is at most 64 KB (`SPEC_BODY_CAP_BYTES`). `?dryRun=1` (or `true`)
runs every check and answers with the visual it would save, writing nothing.

- **201** `{id, visual, warnings, editorUrl}`: saved. With the host's
  `identify` hook, `updatedBy` names the requester, as an editor save does.
- **200** `{visual, warnings}`: a dry run.
- **400** `{errors: [{path, message}, …]}`: nothing written. Every problem is
  listed with where it is (`encodings.x`, `axes.y.min`, or `""` for the whole
  body) and a suggestion when a name is close to a real one, up to 30.
- **409** when stored visuals, themes or data sets are at another content
  version than this server; **413** past the body cap.
- **415** for a body not sent as `content-type: application/json`, and
  **403** for a request whose `Origin` is another site, so a page elsewhere
  can't create charts with a visitor's session. A request with no `Origin`
  (a script, the MCP) is accepted.

The saved visual is an ordinary one: it opens in the editor and can be
edited, exported and embedded like any other. It has no preview image until
it is saved from the editor or "Regenerate previews" renders one.
`PUT /api/visuals/<id>` is unchanged.

`GET /api/chart-spec` lists what a spec can say: the channels (with the field
types each takes and the channels it can't be mapped with), the field types,
the families with the channels each variation fills, and the themes as
`{id, name, default}`, the keys a spec takes (`spec`, each with what it says),
and the `features` this server serves. All of it is read from the tables the
editor uses.

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
