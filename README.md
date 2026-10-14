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
share one library; edits are last-write-wins per item. Dataset uploads warn
above 25 MB and are rejected above 100 MB (browser performance is the real
constraint). Note: Node prints an `ExperimentalWarning` for `node:sqlite` on
startup; it's expected.

### Creating a visual from a chart spec

`POST /api/visuals` creates one visual from a short chart spec, instead of
the full saved-visual JSON the editor writes. The server fills in everything
the spec leaves out exactly as the editor does for a new visual (theme
palettes, fonts, axis and label defaults), checks the spec against the stored
data, and saves the result to the shared library. It only ever creates: the
server picks the new visual's id, so a spec can't overwrite anything.

```
curl -X POST https://charts.example.com/api/visuals \
  -H 'content-type: application/json' \
  -d '{"datasetId":"ds-…","folderId":null,
       "encodings":{"x":"month","length":"sales","hue":"region"},
       "title":"Sales by month","stack":"group",
       "dataLabels":{"format":",.0f","position":"outside-end"}}'
```

| Field | Meaning |
|---|---|
| `datasetId` | Required. The data set to chart. |
| `datasetVersionId` | Optional. The version the spec is checked against; the latest by default. The chart still draws the latest version. |
| `folderId` | Required. A folder id, or `null` for the library root. |
| `encodings` | Required. Channel → field name, e.g. `{"y":"country","length":"rate"}`. Channels are the shelf's (`x`, `y`, `length`, `hue`, `facet`, …), named by id or by the shelf's label (`"X position"`, `"Color"`, `"Facet (wrap)"`; case, spaces and punctuation ignored); the chart type follows from them as it does on the shelves. |
| `name`, `title`, `subtitle` | Optional text. `name` falls back to `title`, then "Untitled". |
| `family` | Optional quick-start family (`"bar"`, `"scatter"`, …) the encodings are expected to make; a mismatch is an error. The family's quick-start variation that the encodings fill best supplies its settings, as the quick-start bar does (a dumbbell connects each category's points, a line chart draws lines, a map goes geographic), except the stack mode, which only `stack` sets. Encodings that fill none of its variations are an error naming what is missing. |
| `fieldTypes` | Optional field → type overrides, as the Fields panel sets them. |
| `axes` | Optional `{x, y}`, each `{title, min, max, format}`. Bounds apply to a quantitative or measure axis; `format` is what the axis Format box takes, on any axis. |
| `colors` | Optional hue level → `#rgb`/`#rrggbb`. Needs a categorical or ordinal `hue`, and every level must be in the data. |
| `fill` | Optional mark color while `hue` is unmapped. |
| `stack` | Optional `"stack"`, `"group"` or `"overlay"`; needs `hue`. |
| `order` | Optional field → its levels in display order (every level, once). |
| `dataLabels` | Optional `true`, or `{format, position, color}`. Bar, area and scatter charts; `position` is for bars. |
| `themeId` | Optional theme; the server's default theme otherwise. |
| `sort` | Optional field → `{by, decreasing}`: order a categorical field's levels by another field's total, or `"alphabetical"`. Computed once, like the Fields panel's "Order by". |
| `colorThreshold` | Optional `{field, at, below, above}`: color each hue level by which side of `at` its `field` value falls. Pinned as per-level colors; a level with values on both sides is an error. `colors` given with it wins for the levels it names. |
| `stems` | Optional `{axis, at}`: a line from each point along `axis` to `at` on it (lollipops), or to the other axis's line without `at`. Scatter charts. |
| `annotations` | Optional list, each in data values: `{kind: "band", x: [from, to], y: [from, to], color, opacity, label, front}`, `{kind: "line", x, y, color, thickness, dash, front}` or `{kind: "text", x, y, text, color}`. Numbers on a quantitative axis, level names on a categorical one. At most 20. |
| `reshape` | Optional wide-to-long reshape, as the Reshape panel stores it: `{idFields, meltFields, variableName, valueName}`. Encodings, colors and orders may then name the new columns. In an edit, `null` turns it off. |
| `derivedVariables` | Optional list of derived variables, as the Fields panel stores them, without ids: `{name, kind: "math", math: {formula}}`, `{name, kind: "concat", concat: {template}}` or `{name, kind: "rules", rules: {rules: [{condition, output}], fallback}}`. Checked with the panel's own rules; other spec keys may name them. In an edit, one with the same name replaces it. |

The body is the spec as JSON, at most 64 KB (`SPEC_BODY_CAP_BYTES` in
`server/src/limits.ts`). `?dryRun=1` or `?dryRun=true` runs every check and
answers with the visual it would save, writing nothing; `0`, `false` or no
`dryRun` saves.

Responses:

- **201** `{id, visual, warnings}` plus `editorUrl`: saved. `warnings` is a
  list of `{path, message}` for settings that were accepted but have no
  effect.
- **200** `{visual, warnings}`: a dry run; nothing written.
- **400** `{errors: [{path, message}, …]}`: the spec has problems, and
  nothing was written. Every problem is listed, not just the first, each
  with where it is (`encodings.x`, `colors["U.S."]`, `?dryRun`, or `""` for
  the whole body) and what is wrong, with a suggestion when a name is close
  to a real one. Past 30 problems the list stops, and a last entry says how
  many more there were.
- Any other failure answers in the server's usual `{error}` shape:
  **409** when the stored visuals, themes or data sets are at a different
  content version than this server (open the app once if they are older,
  update the server if newer, then retry); **405** for any method but
  `POST` on `/api/visuals`; **500** for a server fault. A body over the cap
  is refused with **413**, and the connection is closed, so a client still
  sending may see the connection drop instead.

The visual it saves is an ordinary one: it shows up in the library, opens in
the editor, and can be edited, exported and embedded like any other. It is
saved without a preview image, so its library card reads "No preview" until
it is saved from the editor or the library's "Regenerate previews" button
renders one. `PUT /api/visuals/<id>` is unchanged and still stores whatever
the editor sends.

### Editing a visual with a chart spec

`PATCH /api/visuals/<id>` changes a stored visual by the spec keys the body
names and nothing else: `{"title": "…"}` changes the title, and every other
setting, including ones made by hand in the editor, stays as it was. The keys
are the create keys except `datasetId`, `datasetVersionId` and `themeId`; a
channel set to `null` is unmapped, and `annotations` are added to the
visual's own. `removeAnnotations` (edits only) lists kinds (`"band"`,
`"line"`, `"text"`) to remove first, every annotation of that kind. Edits are
checked like a create, against the visual's data as the editor shows it
(reshape and derived variables included). An edit that names nothing is
refused.

```
curl -X PATCH https://charts.example.com/api/visuals/vs-… \
  -H 'content-type: application/json' -H 'if-match: 1760000000000' \
  -d '{"sort":{"country":{"by":"rate","decreasing":true}}}'
```

`If-Match` is required and carries the `updatedAt` the caller last read
(`*` skips the check); without it the edit answers **428**, and when the
visual has changed since, **409**, changing nothing. A visual changed
by another write while the edit runs also answers **409**. Responses are the
create route's, with **200** `{id, visual, warnings, editorUrl}` for a saved
edit, **404** for an unknown visual and **409** for one in the trash. The
saved visual's preview image is cleared, since it no longer shows the chart.

An editor tab already open on the visual still holds the old version, and
its next save replaces the edit.

### What a spec can say

`GET /api/chart-spec` lists the channels (with the field types each takes and
the channels it can't be mapped with), the field types, and the chart
families with the channels each quick-start variation fills. It is read from
the same tables the editor uses, so a chart name that isn't listed isn't one
the app knows.

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
