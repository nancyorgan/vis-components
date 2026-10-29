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
| `settings` | Optional. Anything else the editor stores, by the names it stores it under (see below). |

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

### Editing a visual with a chart spec

`PATCH /api/visuals/<id>` changes a stored visual by the spec keys the body
names and nothing else: `{"title": "…"}` changes the title, and every other
setting, including ones made by hand in the editor, stays as it was. The keys
are the create keys except `datasetId`, `variation` and `themeId`; a channel
set to `null` is unmapped and an axis bound set to `null` is cleared. Edits
are checked like a create, against the visual's data as the editor shows it
(its reshape and derived variables included).

```
curl -X PATCH https://charts.example.com/api/visuals/vs-… \
  -H 'content-type: application/json' -H 'if-match: "kq3C…"' \
  -d '{"title":"Sales by month, 2026","encodings":{"hue":null}}'
```

`If-Match` is required and carries the visual's ETag as the caller last
read it: without it the edit answers **428**, `*` answers **400**, and a
visual changed since (or by another write while the edit runs) answers
**412**, changing nothing. The ETag is a SHA-256 (base64url, quoted) of the
visual's JSON with its keys sorted and `updatedAt`, `updatedBy`,
`thumbnail` and `thumbnailAt` left out, so a save that changes only when or
by whom it was saved, or its preview image (as opening it in the editor
does), keeps the ETag. Create, edit and restore answer it in an `ETag`
header, and `GET /api/visuals/<id>` answers the stored visual (without its
preview image, as `GET /api/visuals?thumbnails=0` lists it) with its current
`ETag`; **404** for an unknown visual or one in the trash. A visual read from
`GET /api/visuals` hashes the same way (`visualEtag` in
`server/src/chartSpecRoute.ts`). A saved edit answers **200** `{id, visual, warnings,
editorUrl, undo}`; `?dryRun=1` answers `{visual, warnings}` and writes
nothing. **404** for an unknown visual, **409** for one in the trash. The
preview image is cleared. An editor tab already open on the visual still
holds the old version, and its next save replaces the edit.

`undo` is the visual as it was, with the content version it was stored at.
`POST /api/visuals/<id>/restore` with that `undo` as the body, unchanged,
and `If-Match` carrying the ETag the edit answered, puts it back:
**200** `{id, updatedAt, editorUrl}` and its new `ETag`; **412** when the
visual changed after the edit (a new preview alone doesn't count); **409** for a visual in the trash or an `undo` from another content
version; **428** without `If-Match`; **400** for a body that isn't a whole
`undo` for this visual; **415** and **403** as for a create.

### Settings by their stored names

`settings` sets what the spec has no key of its own for, by the names the
editor stores it under, on a create or an edit:

```
{"settings": {
  "legendConfig": {"position": "top"},
  "channelConfigs": {"facet": {"panelAxisOverrides": {"West": {"yMax": 100000}}}},
  "labelsConfig": {"hiddenTitles": {"legend:hue": true}}
}}
```

The slices it may write are the keys of `Visual` (lib/types.ts) except the
chart's identity, what a save stamps and what spec keys set
(`NOT_SETTINGS` in `tooling/setting-catalog.js`), so a slice added to
`Visual` is settable with nothing else to change. The patch is deep-merged
last, after the spec's own keys; a list replaces the stored one, so send the
whole list. An entry of a list keyed by `id` (annotations, composed labels)
keeps an id the chart already has; a new entry leaves `id` out and gets one,
and an id twice in one list is refused.

Where an editor panel does more than store a value, a patch gets the
same: a new annotation (an entry of `annotationsConfig.texts`,
`rectangles`, `lineSegments` or `circles` without an `id`) starts as the
Annotations panel's Add makes it, styled by the chart's theme and named
"Text 1", "Text 2"…, then takes what the patch says, so
`{"texts": [{"text": "Peak", "x": 0.9, "y": 0.1}]}` is a whole annotation.
`dataLabelsEncodings.value` with `field` labels by that field, and with
`fields` by several, the composed labels following the checklist as in the
Data Labels panel. `fieldLevelOrderSpecs.<field>` (`{by: "alphabetical"}`
or `{by: "field", byField, scopeField?, scopeLevel?, decreasing?}`) computes
`fieldLevelOrders.<field>` as the Fields panel's Order-by picker does; an
order set by hand in `fieldLevelOrders` clears the field's Order-by choice,
as the panel's arrows do. Sending both keeps both as sent. A server that
does this lists `panelEdits` in `GET /api/chart-spec`'s `features`.

Every key and value is checked against the declared types, read from
`lib/types.ts` with the TypeScript checker at build time (the
`virtual:setting-catalog` module): a key the type doesn't declare is refused
with the closest real name, a value of the wrong type or outside its allowed
words is refused, and a map keyed by data (`Record<string, …>`: levels,
panels, fields) takes any key with the declared value type. Values are also
judged by name: colors must be CSS colors, `…Field` settings a field of the
data, opacities 0 to 1, counts whole numbers in range. A value the chart
already stores passes as it is, so a chart read back and sent whole isn't
refused for a field a later data version dropped.

`GET /api/chart-spec/settings` lists every setting a patch can name as
`{path, type, values?, doc}` rows, the doc being the type's own comment;
`*` in a path stands for any key of a map keyed by data and `[]` for a
list's entries. With `?visualId=<id>` the rows carry that visual's values,
and each of its entries of a map keyed by data gets a row of its own, with
the catalog path it falls under as `setting`.

### Creating a dataset from rows

`POST /api/datasets` with `{name, rows, types?}` stores rows as a new
dataset, the same shape an upload makes, so a spec can chart data that
arrives without a file. Values are kept as text; each column's type is
inferred as an upload infers it unless `types` names it (`quantitative`,
`categorical`, `temporal`, `ordinal`).

```
curl -X POST https://charts.example.com/api/datasets \
  -H 'content-type: application/json' \
  -d '{"name":"Muffins","rows":[{"month":"Jan","muffins":3},{"month":"Feb","muffins":5}]}'
```

It answers **201** `{id, name, rowCount, fields}`; **400** `{errors}` with
every problem and its path; **409** when a dataset of that name exists or
stored data sets are at another content version; **413** past the upload size
limit, checked before sparse rows are filled out; **415** and **403** as
for a chart create. The library lists the dataset only once all of it is
stored.

`GET /api/chart-spec` lists what a spec can say: the channels (with the field
types each takes and the channels it can't be mapped with), the field types,
the families with the channels each variation fills, and the themes as
`{id, name, default}`, the keys a spec takes (`spec`, each with what it says)
and the ones an edit takes (`editKeys`), the slices a `settings` patch
may write (`settingsSlices`), and the `features` this server serves. All
of it is read from the tables the editor uses.

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
