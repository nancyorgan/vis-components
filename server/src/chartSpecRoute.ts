/** POST /api/visuals: create one visual from a chart spec (see
 *  src/contexts/chartBuilder/lib/visualSpec). Create-only: the server mints
 *  the id, so a spec can never overwrite an existing visual. The spec is
 *  composed by the same library the editor's defaults come from, against
 *  the stored dataset, folders and theme, and the result is written through
 *  the thumbnail split a PUT uses, insert-only. `?dryRun=1` answers with
 *  the visual and writes nothing. Spec problems answer 400 with
 *  `{errors: [{path, message}]}`; every other failure keeps the server's
 *  `{error}` shape (HttpError). */

import type { IncomingMessage, ServerResponse } from "node:http"
import { gunzipSync } from "node:zlib"
import type { DatabaseSync } from "node:sqlite"

import { datasetMetaFrom, isDatasetMeta } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import {
	DATASETS_VERSION,
	THEMES_VERSION,
	VISUALS_VERSION,
} from "../../src/contexts/chartBuilder/lib/storage/migrations"
import {
	normalizeSavedTheme,
	SYSTEM_LIGHT_THEME,
	SYSTEM_THEMES,
	themeOf,
} from "../../src/contexts/chartBuilder/lib/systemThemes"
import type {
	Dataset,
	DatasetMeta,
	Folder,
	SavedTheme,
} from "../../src/contexts/chartBuilder/lib/types"
import { newVisualId } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import type { SpecProblem } from "../../src/contexts/chartBuilder/lib/visualSpec/chartSpec"
import {
	composeChartSpec,
	type ComposeContext,
} from "../../src/contexts/chartBuilder/lib/visualSpec/composeVisual"
import type { ServerConfig } from "./config.js"
import { readDatasetFile, readDatasetVersionFile, isSafeId } from "./datasetFiles.js"
import { insertVisual, listContentVersions, listRows, readDatasetMeta } from "./db.js"
import { HttpError, readBody, sendJson } from "./http.js"
import { SPEC_BODY_CAP_BYTES } from "./limits.js"

/** Same row the client's settings adapter reads: which theme seeds new
 *  visualizations on this server. */
const DEFAULT_THEME_SETTING_ID = "default-theme"

/** The content versions this build reads and writes. A stamp behind them
 *  means the stored items still await the client's migration; ahead means
 *  a newer build wrote them. Either way composing against them could store
 *  a visual the library doesn't agree with, so the route refuses. An absent
 *  stamp reads as current, as it does in the client. */
const READ_VERSIONS = {
	visuals: VISUALS_VERSION,
	themes: THEMES_VERSION,
	datasets: DATASETS_VERSION,
} as const

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown
	} catch {
		return undefined
	}
}

const gunzipJson = (gzipped: Buffer | null): unknown =>
	gzipped === null ? undefined : parseJson(gunzipSync(gzipped).toString("utf-8"))

const rowsOf = (value: unknown): Array<Record<string, string>> | undefined => {
	const rows = (value as { rows?: unknown } | null | undefined)?.rows
	return Array.isArray(rows) ? (rows as Array<Record<string, string>>) : undefined
}

/** The spec's dataset: its metadata (stored, else derived from the body)
 *  and the rows of the version the spec names, else of its latest. The
 *  per-version file is preferred; datasets stored before the split only
 *  have the whole body. */
const loadDataset = async (
	db: DatabaseSync,
	dataDir: string,
	datasetId: unknown,
	versionId: unknown
): Promise<ComposeContext["dataset"]> => {
	if (typeof datasetId !== "string" || !isSafeId(datasetId)) return null
	const stored = readDatasetMeta(db, datasetId)
	if (stored === undefined) return null
	let body: Dataset | undefined
	const wholeBody = async (): Promise<Dataset | undefined> =>
		(body ??= gunzipJson(await readDatasetFile(dataDir, datasetId)) as
			| Dataset
			| undefined)
	const parsed = stored === null ? undefined : parseJson(stored)
	let meta: DatasetMeta | undefined = isDatasetMeta(parsed) ? parsed : undefined
	if (!meta) {
		const whole = await wholeBody()
		if (!whole) return null
		meta = datasetMetaFrom(whole)
	}
	const chosen = typeof versionId === "string" ? versionId : meta.latestVersionId
	if (!meta.versions.some((v) => v.id === chosen)) return { meta, rows: [] }
	const own = isSafeId(chosen)
		? rowsOf(gunzipJson(await readDatasetVersionFile(dataDir, datasetId, chosen)))
		: undefined
	const rows =
		own ?? rowsOf((await wholeBody())?.versions?.find((v) => v.id === chosen))
	return { meta, rows: rows ?? [] }
}

/** Saved themes as the client normalizes them, system themes included. */
const loadThemes = (db: DatabaseSync): SavedTheme[] => [
	...SYSTEM_THEMES,
	...listRows(db, "themes")
		.map(({ body }) => parseJson(body) as SavedTheme | undefined)
		.filter((t): t is SavedTheme => typeof t?.id === "string")
		.filter((t) => !SYSTEM_THEMES.some((s) => s.id === t.id))
		.map(normalizeSavedTheme),
]

const defaultThemeId = (db: DatabaseSync): string | null => {
	const setting = listRows(db, "settings")
		.map(({ body }) => parseJson(body) as { id?: unknown; themeId?: unknown } | undefined)
		.find((s) => s?.id === DEFAULT_THEME_SETTING_ID)
	return typeof setting?.themeId === "string" ? setting.themeId : null
}

const assertStampsCurrent = (db: DatabaseSync): void => {
	const stamps = listContentVersions(db)
	for (const [collection, version] of Object.entries(READ_VERSIONS)) {
		const stored = stamps[collection]
		if (stored === undefined || stored === version) continue
		throw new HttpError(
			409,
			stored > version
				? `Stored ${collection} are at content version ${stored}, newer than this server's ${version}; update the server`
				: `Stored ${collection} are at content version ${stored}, older than this server's ${version}; open the app once to migrate them`
		)
	}
}

const specErrors = (res: ServerResponse, errors: SpecProblem[]): void =>
	sendJson(res, 400, JSON.stringify({ errors }))

/** `?dryRun`: "1"/"true" checks only, "0"/"false"/absent saves. */
const DRY_RUN_VALUES: Record<string, boolean> = {
	"1": true,
	true: true,
	"0": false,
	false: false,
}

export const createVisualFromSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	query: URLSearchParams,
	mintId: () => string = newVisualId
): Promise<void> => {
	const rawDryRun = query.get("dryRun")
	if (rawDryRun !== null && !Object.hasOwn(DRY_RUN_VALUES, rawDryRun)) {
		return specErrors(res, [
			{ path: "?dryRun", message: `"dryRun" must be "1", "true", "0" or "false"` },
		])
	}
	const dryRun = rawDryRun !== null && DRY_RUN_VALUES[rawDryRun] === true
	const text = (await readBody(req, SPEC_BODY_CAP_BYTES)).toString("utf-8")
	const input = parseJson(text)
	if (input === undefined) {
		return specErrors(res, [{ path: "", message: "the body must be valid JSON" }])
	}
	assertStampsCurrent(db)

	const spec = (typeof input === "object" && input !== null ? input : {}) as {
		datasetId?: unknown
		datasetVersionId?: unknown
		themeId?: unknown
	}
	const themes = loadThemes(db)
	const wantedThemeId =
		typeof spec.themeId === "string" ? spec.themeId : defaultThemeId(db)
	const saved =
		themes.find((t) => t.id === wantedThemeId) ??
		(typeof spec.themeId === "string" ? undefined : SYSTEM_LIGHT_THEME)
	const folders = listRows(db, "folders")
		.map(({ body }) => parseJson(body) as Folder | undefined)
		.filter((f): f is Folder => typeof f?.id === "string")

	const id = mintId()
	const result = composeChartSpec(input, {
		dataset: await loadDataset(db, config.dataDir, spec.datasetId, spec.datasetVersionId),
		folders,
		theme: themeOf(saved ?? SYSTEM_LIGHT_THEME),
		themeId: saved?.id ?? null,
		now: Date.now(),
		id,
	})
	if (!result.ok) return specErrors(res, result.errors)

	const { warnings } = result
	let { visual } = result
	if (dryRun) return sendJson(res, 200, JSON.stringify({ visual, warnings }))
	// Insert-only: a minted id that is somehow taken gets one fresh retry,
	// never an overwrite.
	if (!insertVisual(db, visual.id, JSON.stringify(visual))) {
		visual = { ...visual, id: mintId() }
		if (!insertVisual(db, visual.id, JSON.stringify(visual))) {
			throw new HttpError(500, "Could not mint an unused visual id")
		}
	}
	const { id: savedId } = visual
	return sendJson(
		res,
		201,
		JSON.stringify({
			id: savedId,
			visual,
			warnings,
			editorUrl: `${config.baseUrl}/editor/${savedId}`,
		})
	)
}
