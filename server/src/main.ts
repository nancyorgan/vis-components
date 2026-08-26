/** Entry point. Foreground process, plain HTTP, logs to stdout/stderr.
 *
 *  Start:
 *    VIS_BASE_URL=… VIS_DB_DIR=… VIS_DATA_DIR=… VIS_PORT=… node server/dist/main.js
 *
 *  Lifecycle: fail-fast on bad config or malformed DB state; SIGTERM/SIGINT
 *  stop accepting, drain in-flight requests (10 s hard cap), close SQLite
 *  cleanly, exit 0. */

import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { loadConfig } from "./config.js"
import {
	listDatasetFiles,
	listDatasetVersionFiles,
} from "./datasetFiles.js"
import { listAllDatasetVersionRows, listDatasetIds, openDb } from "./db.js"
import { logError, logInfo } from "./log.js"
import { createHandler } from "./routes.js"

/* eslint-disable no-console -- config errors go to stderr before log.ts matters */

const SHUTDOWN_DRAIN_MS = 10_000

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

	const handler = createHandler({ config, db, distDir })
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
		logInfo(`listening on port ${config.port} (base URL ${config.baseUrl})`)
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
