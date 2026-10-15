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
	Visual,
} from "../../src/contexts/chartBuilder/lib/types"
import {
	hydrateVisual,
	newVisualDraft,
	newVisualId,
} from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { flattenSettings } from "../../src/contexts/chartBuilder/lib/visualSpec/settings"
import { searchSettings } from "../../src/contexts/chartBuilder/lib/visualSpec/settingSearch"
import type { SpecProblem } from "../../src/contexts/chartBuilder/lib/visualSpec/chartSpec"
import {
	composeChartEdit,
	composeChartSpec,
	type ComposeContext,
} from "../../src/contexts/chartBuilder/lib/visualSpec/composeVisual"
import type { ServerConfig } from "./config.js"
import { readDatasetFile, readDatasetVersionFile, isSafeId } from "./datasetFiles.js"
import {
	insertVisual,
	listContentVersions,
	listRows,
	readDatasetMeta,
	readVisualBody,
	replaceVisualIfUnchanged,
} from "./db.js"
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

/** The `?dryRun` flag, or a 400 already sent (undefined). */
const readDryRun = (res: ServerResponse, query: URLSearchParams): boolean | undefined => {
	const raw = query.get("dryRun")
	if (raw !== null && !Object.hasOwn(DRY_RUN_VALUES, raw)) {
		specErrors(res, [
			{ path: "?dryRun", message: `"dryRun" must be "1", "true", "0" or "false"` },
		])
		return undefined
	}
	return raw !== null && DRY_RUN_VALUES[raw] === true
}

const loadFolders = (db: DatabaseSync): Folder[] =>
	listRows(db, "folders")
		.map(({ body }) => parseJson(body) as Folder | undefined)
		.filter((f): f is Folder => typeof f?.id === "string")

/** PATCH /api/visuals/<id>: apply a chart edit (the spec keys it names,
 *  nothing else) to a stored visual, checked like a create. `If-Match`
 *  (required; `*` skips the check) carries the `updatedAt` the caller last
 *  read; a visual changed since, or changed while this request ran, answers
 *  409 and is left alone. A
 *  trashed visual answers 409. `?dryRun=1` answers with the edited visual
 *  and writes nothing. */
export const editVisualFromSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	id: string,
	query: URLSearchParams
): Promise<void> => {
	const dryRun = readDryRun(res, query)
	if (dryRun === undefined) return
	const text = (await readBody(req, SPEC_BODY_CAP_BYTES)).toString("utf-8")
	const input = parseJson(text)
	if (input === undefined) {
		return specErrors(res, [{ path: "", message: "the body must be valid JSON" }])
	}
	assertStampsCurrent(db)

	const stored = readVisualBody(db, id)
	if (stored === undefined) throw new HttpError(404, "Not found")
	const visual = parseJson(stored) as Visual | undefined
	if (!visual || typeof visual !== "object" || visual.id !== id) {
		throw new HttpError(500, "The stored visual isn't readable")
	}
	if (visual.deletedAt) {
		throw new HttpError(409, "This visual is in the trash; restore it before editing")
	}
	const ifMatch = req.headers["if-match"]
	if (ifMatch === undefined) {
		throw new HttpError(
			428,
			"Send If-Match with the visual's updatedAt as last read, so an edit can't replace newer work"
		)
	}
	const wanted = String(ifMatch).replace(/^W\//, "").replace(/"/g, "").trim()
	if (wanted !== "*") {
		if (wanted !== String(visual.updatedAt)) {
			throw new HttpError(
				409,
				`This visual changed since it was read (updatedAt ${String(visual.updatedAt)}, expected ${wanted}); read it again`
			)
		}
	}

	const themes = loadThemes(db)
	const saved =
		themes.find((t) => t.id === (visual.themeId ?? defaultThemeId(db))) ?? SYSTEM_LIGHT_THEME
	const result = composeChartEdit(visual, input, {
		dataset: await loadDataset(db, config.dataDir, visual.datasetId, undefined),
		folders: loadFolders(db),
		theme: themeOf(saved),
		themeId: visual.themeId ?? null,
		now: Math.max(Date.now(), (visual.updatedAt ?? 0) + 1),
	})
	if (!result.ok) return specErrors(res, result.errors)
	const { warnings, visual: edited } = result
	if (dryRun) return sendJson(res, 200, JSON.stringify({ visual: edited, warnings }))
	if (!replaceVisualIfUnchanged(db, id, stored, JSON.stringify({ ...edited, thumbnail: null }))) {
		throw new HttpError(409, "This visual changed while the edit ran; read it again")
	}
	return sendJson(
		res,
		200,
		JSON.stringify({
			id,
			visual: edited,
			warnings,
			editorUrl: `${config.baseUrl}/editor/${id}`,
		})
	)
}

/** GET /api/chart-spec/settings: the settings a `settings` patch can
 *  name, as `{path, type, value}`: a new visual's defaults under the
 *  server's default theme, or with `?visualId=` that visual's own values.
 *  `?q=` finds them by words (settingSearch.ts); no words, or none that
 *  match, gives a census by group. `include_descriptions`, `offset` and
 *  `limit` as in searchSettings. */
export const listSettings = (
	res: ServerResponse,
	db: DatabaseSync,
	query: URLSearchParams
): void => {
	const visualId = query.get("visualId")
	let visual: Visual
	if (visualId !== null) {
		const stored = isSafeId(visualId) ? readVisualBody(db, visualId) : undefined
		const parsed = stored === undefined ? undefined : (parseJson(stored) as Visual | undefined)
		if (!parsed) throw new HttpError(404, "Not found")
		visual = hydrateVisual(parsed)
	} else {
		const themes = loadThemes(db)
		const saved = themes.find((t) => t.id === defaultThemeId(db)) ?? SYSTEM_LIGHT_THEME
		visual = newVisualDraft(themeOf(saved)) as Visual
	}
	const count = (name: string, min: number): number | undefined => {
		const raw = query.get(name)
		if (raw === null) return undefined
		const n = /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN
		if (!(n >= min)) throw new HttpError(400, `"${name}" must be a whole number from ${min} to 999999`)
		return n
	}
	const flag = query.get("include_descriptions")
	if (flag !== null && !Object.hasOwn(DRY_RUN_VALUES, flag)) {
		throw new HttpError(400, `"include_descriptions" must be "1", "true", "0" or "false"`)
	}
	const result = searchSettings(flattenSettings(visual), query.get("q") ?? "", {
		includeDescriptions: flag !== null && DRY_RUN_VALUES[flag] === true,
		offset: count("offset", 0),
		limit: count("limit", 1),
	})
	return sendJson(res, 200, JSON.stringify(result))
}

export const createVisualFromSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	query: URLSearchParams,
	mintId: () => string = newVisualId
): Promise<void> => {
	const dryRun = readDryRun(res, query)
	if (dryRun === undefined) return
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
	const folders = loadFolders(db)

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
