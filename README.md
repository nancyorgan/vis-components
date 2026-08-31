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

## Verifying changes

```
pnpm typecheck   # tsc --noEmit (also runs as the first step of `build`)
pnpm lint        # eslint
pnpm test        # unit + component tests (vitest)
pnpm test:watch  # vitest in watch mode
pnpm test:e2e    # Playwright end-to-end suite (~12 min; starts its own server)
pnpm build       # typecheck + production bundle + self-host server
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
