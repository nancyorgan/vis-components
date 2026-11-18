/** Entry point. Foreground process, plain HTTP, logs to stdout/stderr.
 *
 *  Start:
 *    VIS_BASE_URL=… VIS_DB_DIR=… VIS_DATA_DIR=… VIS_PORT=… \
 *    VIS_PUBLISH_DIR=… VIS_PUBLISH_BASE_URL=… node server/dist/main.js
 *
 *  VIS_PUBLISH_DIR is where published embeds are written; a separate dumb
 *  static file server (e.g. `python3 -m http.server`) serves it publicly at
 *  VIS_PUBLISH_BASE_URL. Embeds must load with this server completely off.
 *
 *  Optional VIS_AUTH_MODE=header trusts a sign-in proxy in front of the
 *  server: X-Forwarded-User / X-Forwarded-Email name the person on every
 *  request, a request without them gets a 401 (GET /alive excepted), and
 *  presence, "Saved by" and /api/config's `user` switch on. Unset is
 *  today's anonymous behavior. There is no sign-out: single sign-on would
 *  sign the person straight back in, so `signOutUrl` stays unset.
 *
 *  Lifecycle: fail-fast on bad config or malformed DB state; SIGTERM/SIGINT
 *  stop accepting, drain in-flight requests (10 s hard cap), close SQLite
 *  cleanly, exit 0. */

import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { installAddin } from "./addinFiles.js"
import { loadConfig } from "./config.js"
import {
	listDatasetFiles,
	listDatasetVersionFiles,
} from "./datasetFiles.js"
import { listAllDatasetVersionRows, listDatasetIds, openDb } from "./db.js"
import { readEmbedTemplate } from "./embedFiles.js"
import { convertPublishedEmbeds, prepareEmbedTemplate } from "./embedRuntimeFiles.js"
import { identifyFromForwardedHeaders } from "./identity.js"
import { logError, logInfo } from "./log.js"
import { createHandler } from "./routes.js"

/* eslint-disable no-console -- config errors go to stderr before log.ts matters */

const SHUTDOWN_DRAIN_MS = 10_000
/** When the embed conversion pass runs again after startup (see `main`). */
const EMBED_CONVERSION_RETRY_MS = [15_000, 60_000, 300_000]

const main = (): void => {
	let config
	try {
		config = loadConfig(process.env)
	} catch (error) {
		console.error(
			`Refusing to start — configuration is invalid:\n${(error as Error).message}`
		)
		process.exit(1)
	}

	mkdirSync(config.dataDir, { recursive: true })
	mkdirSync(config.publishDir, { recursive: true })
	const db = openDb(config.dbDir)

	// dist/ ships alongside the compiled server in the build output:
	// <repo>/server/dist/main.js ← we are here; <repo>/dist ← the frontend.
	const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist")

	// Boot sweep: report (never auto-fix) dataset index/file mismatches.
	// A malformed DB fails hard above; a stray file is only worth a warning.
	void (async () => {
		try {
			const indexed = new Set(listDatasetIds(db))
			const onDisk = new Set(await listDatasetFiles(config.dataDir))
			for (const id of indexed) {
				if (!onDisk.has(id)) logError(`dataset ${id} indexed but file missing`)
			}
			for (const id of onDisk) {
				if (!indexed.has(id)) logInfo(`warning: dataset file ${id} has no index row`)
			}
			// Per-version bodies, same treatment — and same MECHANISM: set
			// membership against one directory listing and one SQL query.
			// (An earlier draft read every version file off disk to test
			// existence, which re-created the whole-corpus startup read this
			// change exists to eliminate.)
			const versionFilesOnDisk = await listDatasetVersionFiles(config.dataDir)
			const versionFileKeys = new Set(
				versionFilesOnDisk.map(([d, v]) => `${d}/${v}`)
			)
			for (const [datasetId, versionId] of versionFilesOnDisk) {
				if (!indexed.has(datasetId)) {
					// Dead weight in the data dir — reported, never removed, so a
					// human decides.
					logInfo(
						`warning: dataset version file ${datasetId}/${versionId} has no dataset`
					)
				}
			}
			for (const { dataset_id, version_id } of listAllDatasetVersionRows(db)) {
				if (!versionFileKeys.has(`${dataset_id}/${version_id}`)) {
					logError(
						`dataset ${dataset_id} version ${version_id} indexed but file missing`
					)
				}
			}
		} catch (error) {
			logError(`data-dir sweep failed: ${String(error)}`)
		}
	})()

	// The PowerPoint add-in goes out beside the embeds, refreshed from this
	// build on every start (addinFiles.ts). Never blocks or fails startup.
	void installAddin(distDir, config.publishDir, config.publishBaseUrl).then(
		(result) => {
			if (!result.installed) {
				logInfo(`PowerPoint add-in not installed: ${result.reason}`)
				return
			}
			logInfo(
				`PowerPoint add-in installed (${result.files} files); manifest at ${result.manifestUrl}` +
					(result.https
						? ""
						: " — Office loads add-ins only over HTTPS, so it won't load from this http address")
			)
		},
		(error: unknown) => logError(`installing the PowerPoint add-in failed: ${String(error)}`)
	)

	// The shared embed app (embedRuntimeFiles.ts): install this build's files
	// (repairing a damaged copy), then convert any published embed that still
	// carries its own inline app or a payload from before the public
	// boundary (publicEmbed.ts). Never blocks or fails startup; a page that
	// can't be converted keeps working as it is.
	void (async () => {
		try {
			const template = await readEmbedTemplate(distDir)
			if (template === null) {
				logInfo("embed app not installed: this build has no dist/embed-runtime.html")
			} else {
				await prepareEmbedTemplate(config.publishDir, template)
				logInfo("embed app installed in the publish dir's runtime/ folder")
			}
		} catch (error) {
			logError(`installing the embed app failed: ${String(error)}`)
		}
		// A network-mounted publish dir can list as EMPTY for the first seconds
		// after the process starts (seen on a blob mount: nothing at 5 s, all
		// there at 10 s), so one pass at startup can find no pages at all. The
		// pass is safe to repeat and skips converted pages, so it runs again
		// a few times; a later pass is logged only when it did something.
		const convert = async (first: boolean): Promise<void> => {
			try {
				const pass = await convertPublishedEmbeds(config.publishDir)
				for (const { path, reason } of pass.failed) {
					logError(`embed page ${path} left unconverted: ${reason}`)
				}
				if (first || pass.converted > 0 || pass.failed.length > 0) {
					logInfo(
						`embed pages: ${pass.converted} converted (shared app, public fields only), ` +
							`${pass.current} already converted, ${pass.failed.length} left unconverted`
					)
				}
			} catch (error) {
				logError(`converting published embeds failed: ${String(error)}`)
			}
		}
		await convert(true)
		for (const delayMs of EMBED_CONVERSION_RETRY_MS) {
			setTimeout(() => void convert(false), delayMs).unref()
		}
	})()

	const handler = createHandler({
		config,
		db,
		distDir,
		...(config.authMode === "header"
			? { identify: identifyFromForwardedHeaders, requireUser: true }
			: {}),
	})
	const server = createServer((req, res) => {
		const started = Date.now()
		res.on("finish", () => {
			logInfo(
				`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`
			)
		})
		void handler(req, res)
	})

	server.listen(config.port, () => {
		logInfo(
			`listening on port ${config.port} (base URL ${config.baseUrl}, auth mode ${config.authMode})`
		)
	})

	let shuttingDown = false
	const shutdown = (signal: string): void => {
		if (shuttingDown) return
		shuttingDown = true
		logInfo(`${signal} received — draining`)
		server.closeIdleConnections()
		const force = setTimeout(() => {
			logError(`drain exceeded ${SHUTDOWN_DRAIN_MS}ms — closing connections`)
			server.closeAllConnections()
		}, SHUTDOWN_DRAIN_MS)
		force.unref()
		server.close(() => {
			clearTimeout(force)
			try {
				db.close()
			} catch (error) {
				logError(`closing database failed: ${String(error)}`)
				process.exit(1)
			}
			logInfo("shutdown complete")
			process.exit(0)
		})
	}
	process.on("SIGTERM", () => shutdown("SIGTERM"))
	process.on("SIGINT", () => shutdown("SIGINT"))
}

main()
