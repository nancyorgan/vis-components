/** POST /api/visuals: create one visual from a chart spec (see
 *  src/contexts/chartBuilder/lib/visualSpec). Create-only: the server mints
 *  the id, so a spec can never overwrite an existing visual. The spec is
 *  composed by the same library the editor's defaults come from, against
 *  the stored dataset, folders and theme, and the result is written through
 *  the thumbnail split a PUT uses, insert-only. `?dryRun=1` answers with
 *  the visual and writes nothing. Spec problems answer 400 with
 *  `{errors: [{path, message}]}`; every other failure keeps the server's
 *  `{error}` shape (HttpError). PATCH /api/visuals/<id> edits one the same
 *  way and POST /api/visuals/<id>/restore undoes that edit. GET
 *  /api/visuals/<id> reads one with its ETag. GET /api/chart-spec lists
 *  what a spec can say, and GET /api/chart-spec/settings every setting a
 *  `settings` patch can name. */

import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { DatabaseSync } from "node:sqlite"
import { gunzipSync, gzipSync } from "node:zlib"

import { datasetContentHash } from "../../src/contexts/chartBuilder/lib/datasetDedupe"
import {
	datasetRejectMessage,
	datasetSizeIssue,
} from "../../src/contexts/chartBuilder/lib/datasetLimits"
import { datasetMetaFrom, isDatasetMeta } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { inferFieldType } from "../../src/contexts/chartBuilder/lib/inferFieldType"
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
	Field,
	FieldType,
	Folder,
	SavedTheme,
	Visual,
} from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual, newVisualId } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { isTrashed } from "../../src/contexts/chartBuilder/lib/visualTrash"
import {
	MAX_PROBLEMS,
	pathOf,
	type SpecProblem,
} from "../../src/contexts/chartBuilder/lib/visualSpec/chartSpec"
import {
	composeChartEdit,
	composeChartSpec,
	structuredVisual,
	type ComposeContext,
} from "../../src/contexts/chartBuilder/lib/visualSpec/composeVisual"
import { settingRows } from "../../src/contexts/chartBuilder/lib/visualSpec/settings"
import { chartVocabulary } from "../../src/contexts/chartBuilder/lib/visualSpec/vocabulary"
import type { ServerConfig } from "./config.js"
import {
	deleteDatasetFile,
	deleteDatasetVersionFile,
	isSafeId,
	readDatasetFile,
	readDatasetVersionFile,
	writeDatasetFile,
	writeDatasetVersionFile,
} from "./datasetFiles.js"
import {
	insertVisual,
	listContentVersions,
	listDatasetMeta,
	listRows,
	readDatasetMeta,
	readVisualBody,
	replaceVisualIfUnchanged,
	upsertDatasetMeta,
	upsertDatasetRow,
	upsertDatasetVersionRow,
} from "./db.js"
import { assertJsonWrite, HttpError, readBody, sendJson } from "./http.js"
import { requestUser, sanitizeUser, type AppUser, type IdentifyUser } from "./identity.js"
import { JSON_BODY_CAP_BYTES, SPEC_BODY_CAP_BYTES } from "./limits.js"

/** What this server's chart-spec routes do, listed by GET /api/chart-spec
 *  so a client can tell which of them it serves. */
export const CHART_SPEC_FEATURES = ["create", "edit", "restore", "read", "datasets", "settings"] as const

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

/** A listed dataset version whose rows are on neither the version file nor
 *  the whole body: checking a spec against no rows would misjudge every
 *  field, so the request is refused instead. */
class RowsMissing extends Error {}

/** The spec's dataset: its metadata (stored, else derived from the body)
 *  and the rows of its latest version. The per-version file is preferred;
 *  datasets stored before the split only have the whole body. */
const loadDataset = async (
	db: DatabaseSync,
	dataDir: string,
	datasetId: unknown
): Promise<ComposeContext["dataset"]> => {
	if (typeof datasetId !== "string" || !isSafeId(datasetId)) return null
	const stored = readDatasetMeta(db, datasetId)
	if (stored === undefined) return null
	let body: Dataset | undefined
	const wholeBody = async (): Promise<Dataset | undefined> =>
		(body ??= gunzipJson(await readDatasetFile(dataDir, datasetId)) as Dataset | undefined)
	const parsed = stored === null ? undefined : parseJson(stored)
	let meta: DatasetMeta | undefined = isDatasetMeta(parsed) ? parsed : undefined
	// No meta means the body was written after it, so a version file may be older than the body.
	const fromBody = !meta
	if (!meta) {
		const whole = await wholeBody()
		if (!whole) return null
		meta = datasetMetaFrom(whole)
	}
	const latest = meta.latestVersionId
	const bodyRows = async () => rowsOf((await wholeBody())?.versions?.find((v) => v.id === latest))
	const fileRows = async () =>
		isSafeId(latest)
			? rowsOf(gunzipJson(await readDatasetVersionFile(dataDir, datasetId, latest)))
			: undefined
	const rows = fromBody
		? ((await bodyRows()) ?? (await fileRows()))
		: ((await fileRows()) ?? (await bodyRows()))
	if (rows === undefined) throw new RowsMissing()
	return { meta, rows }
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

/** The theme a new visual takes when its spec names none. */
const defaultTheme = (db: DatabaseSync, themes: readonly SavedTheme[]): SavedTheme => {
	const setting = listRows(db, "settings")
		.map(({ body }) => parseJson(body) as { id?: unknown; themeId?: unknown } | undefined)
		.find((s) => s?.id === DEFAULT_THEME_SETTING_ID)
	return themes.find((t) => t.id === setting?.themeId) ?? SYSTEM_LIGHT_THEME
}

/** A theme name with case, spaces and punctuation taken out. */
const nameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** A spec's theme by id, else by the one name it matches ignoring case,
 *  spaces and punctuation. */
const themeNamed = (themes: readonly SavedTheme[], wanted: string): SavedTheme | undefined => {
	const byId = themes.find((t) => t.id === wanted)
	if (byId) return byId
	const byName = themes.filter((t) => nameKey(t.name) === nameKey(wanted))
	return byName.length === 1 ? byName[0] : undefined
}

const loadFolders = (db: DatabaseSync): Folder[] =>
	listRows(db, "folders")
		.map(({ body }) => parseJson(body) as Folder | undefined)
		.filter((f): f is Folder => typeof f?.id === "string")

const assertStampsCurrent = (db: DatabaseSync, only?: keyof typeof READ_VERSIONS): void => {
	const stamps = listContentVersions(db)
	for (const [collection, version] of Object.entries(READ_VERSIONS)) {
		if (only && collection !== only) continue
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

/** The dataset, or undefined once a 400 is sent for rows that can't be
 *  loaded. */
const loadDatasetOrRefuse = async (
	res: ServerResponse,
	db: DatabaseSync,
	dataDir: string,
	datasetId: unknown,
	path: string
): Promise<ComposeContext["dataset"] | undefined> => {
	try {
		return await loadDataset(db, dataDir, datasetId)
	} catch (e) {
		if (!(e instanceof RowsMissing)) throw e
		specErrors(res, [
			{
				path,
				message:
					"this dataset's rows can't be loaded (its data file is missing), so it can't be charted; upload the data again",
			},
		])
		return undefined
	}
}

/** A chart-spec write is a save, so `updatedBy` is the requesting user
 *  from the host's `identify`, or for an anonymous request the stored
 *  saver kept as it was. */
const stampedBy = <T extends { updatedBy?: AppUser }>(
	visual: T,
	user: AppUser | null,
	storedUpdatedBy: unknown
): T => {
	const { updatedBy: _dropped, ...rest } = visual
	const keep = user ?? sanitizeUser(storedUpdatedBy)
	return (keep ? { ...rest, updatedBy: keep } : rest) as T
}

/** The stored visual `id`, refusing a missing (404), unreadable (500) or
 *  trashed (409) one. */
const storedVisual = (db: DatabaseSync, id: string): { stored: string; visual: Visual } => {
	const stored = readVisualBody(db, id)
	if (stored === undefined) throw new HttpError(404, "Not found")
	const visual = parseJson(stored) as Visual | undefined
	if (!visual || typeof visual !== "object" || visual.id !== id) {
		throw new HttpError(500, "The stored visual isn't readable")
	}
	if (isTrashed(visual)) {
		throw new HttpError(409, "This visual is in the trash; restore it before editing")
	}
	return { stored, visual }
}

/** Keys a save rewrites without changing the chart: when it was saved and
 *  by whom, and the preview image and when that was captured. Opening a
 *  chart in the editor writes all four and nothing else. */
const BOOKKEEPING_KEYS = new Set(["updatedAt", "updatedBy", "thumbnail", "thumbnailAt"])

/** JSON with every object's keys sorted, so equal values hash equally
 *  whatever order they were written in. */
const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		typeof v === "object" && v !== null && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: v
	)

/** A visual's ETag: a hash of what it draws, its bookkeeping keys left
 *  out, so a save that changes only those keeps the stamp and any other
 *  change moves it. PATCH and restore take it as If-Match. */
export const visualEtag = (visual: object): string => {
	const content = Object.fromEntries(
		Object.entries(visual).filter(([key]) => !BOOKKEEPING_KEYS.has(key))
	)
	return `"${createHash("sha256").update(canonicalJson(content)).digest("base64url")}"`
}

/** Refuse unless `If-Match` names `visual`'s ETag (quotes and W/
 *  ignored). */
const assertIfMatch = (req: IncomingMessage, visual: Visual, missing: string, stale: string): void => {
	const raw = req.headers["if-match"]
	if (raw === undefined) throw new HttpError(428, missing)
	const unquote = (tag: string): string => tag.trim().replace(/^W\//, "").replace(/"/g, "")
	const wanted = unquote(String(raw))
	if (wanted === "*") {
		throw new HttpError(400, "If-Match must be the visual's ETag as last read, not *")
	}
	if (wanted !== unquote(visualEtag(visual))) throw new HttpError(412, stale)
}

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

/** GET /api/chart-spec/settings: every setting a `settings` patch can
 *  name, read from the `Visual` type, as `{path, type, values?, doc?}`
 *  rows (settings.ts `settingRows`). With `?visualId=` the rows carry that
 *  visual's values, and its entries of maps keyed by data get rows of
 *  their own. */
export const listSettings = (res: ServerResponse, db: DatabaseSync, query: URLSearchParams): void => {
	const visualId = query.get("visualId")
	let visual: Visual | undefined
	if (visualId !== null) {
		const stored = isSafeId(visualId) ? readVisualBody(db, visualId) : undefined
		const parsed = stored === undefined ? undefined : (parseJson(stored) as Visual | undefined)
		if (!parsed || typeof parsed !== "object" || parsed.id !== visualId) throw new HttpError(404, "Not found")
		visual = hydrateVisual(structuredVisual(parsed))
	}
	sendJson(res, 200, JSON.stringify({ settings: settingRows(visual) }))
}

export const createVisualFromSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	query: URLSearchParams,
	mintId: () => string = newVisualId,
	user: AppUser | null = null
): Promise<void> => {
	assertJsonWrite(req, new URL(config.baseUrl).origin)
	const dryRun = readDryRun(res, query)
	if (dryRun === undefined) return
	const input = parseJson((await readBody(req, SPEC_BODY_CAP_BYTES)).toString("utf-8"))
	if (input === undefined) {
		return specErrors(res, [{ path: "", message: "the body must be valid JSON" }])
	}
	assertStampsCurrent(db)

	const spec = (typeof input === "object" && input !== null ? input : {}) as {
		datasetId?: unknown
		themeId?: unknown
	}
	const themes = loadThemes(db)
	const theme =
		typeof spec.themeId === "string" ? themeNamed(themes, spec.themeId) : defaultTheme(db, themes)
	const dataset = await loadDatasetOrRefuse(res, db, config.dataDir, spec.datasetId, "datasetId")
	if (dataset === undefined) return
	// A theme named by name is stored by id.
	const byName = theme && spec.themeId !== undefined && spec.themeId !== theme.id
	const result = composeChartSpec(byName ? { ...spec, themeId: theme.id } : input, {
		dataset,
		folders: loadFolders(db),
		theme: themeOf(theme ?? SYSTEM_LIGHT_THEME),
		themeId: theme?.id ?? null,
		themes,
		now: Date.now(),
		id: mintId(),
	})
	if (!result.ok) return specErrors(res, result.errors)

	const { warnings } = result
	let visual = stampedBy(result.visual, user, undefined)
	if (dryRun) return sendJson(res, 200, JSON.stringify({ visual, warnings }))
	// Insert-only: a minted id that is somehow taken gets one fresh retry,
	// never an overwrite.
	if (!insertVisual(db, visual.id, JSON.stringify(visual))) {
		visual = { ...visual, id: mintId() }
		if (!insertVisual(db, visual.id, JSON.stringify(visual))) {
			throw new HttpError(500, "Could not mint an unused visual id")
		}
	}
	return sendJson(
		res,
		201,
		JSON.stringify({
			id: visual.id,
			visual,
			warnings,
			editorUrl: `${config.baseUrl}/editor/${visual.id}`,
		}),
		{ etag: visualEtag(visual) }
	)
}

/** What PATCH hands back for undoing it: the visual as it was before the
 *  edit, and the visuals content version it was stored at. Callers keep it
 *  and send it back unchanged. */
type UndoEnvelope = { visualsVersion: number; visual: Visual }

/** PATCH /api/visuals/<id>: apply a chart edit (the spec keys it names,
 *  nothing else) to a stored visual, checked like a create. `If-Match`
 *  (required) carries the ETag the caller last read; a visual whose chart
 *  changed since, or changed while this request ran, answers 412 and is
 *  left alone. A trashed visual answers 409. `?dryRun=1` answers with the
 *  edited visual and writes nothing. A saved edit also answers `undo`: the
 *  visual as it was, for POST /api/visuals/<id>/restore. */
export const editVisualFromSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	id: string,
	query: URLSearchParams,
	user: AppUser | null = null
): Promise<void> => {
	const dryRun = readDryRun(res, query)
	if (dryRun === undefined) return
	const input = parseJson((await readBody(req, SPEC_BODY_CAP_BYTES)).toString("utf-8"))
	if (input === undefined) {
		return specErrors(res, [{ path: "", message: "the body must be valid JSON" }])
	}
	assertStampsCurrent(db)
	const { stored, visual } = storedVisual(db, id)
	assertIfMatch(
		req,
		visual,
		"Send If-Match with the visual's ETag as last read, so an edit can't replace newer work",
		"This visual changed since it was read; read it again"
	)

	const themes = loadThemes(db)
	const theme = themes.find((t) => t.id === visual.themeId) ?? defaultTheme(db, themes)
	const dataset = await loadDatasetOrRefuse(res, db, config.dataDir, visual.datasetId, "")
	if (dataset === undefined) return
	const result = composeChartEdit(visual, input, {
		dataset,
		folders: loadFolders(db),
		theme: themeOf(theme),
		themeId: visual.themeId ?? null,
		now: Math.max(Date.now(), (visual.updatedAt ?? 0) + 1),
	})
	if (!result.ok) return specErrors(res, result.errors)
	const { warnings } = result
	// The preview no longer shows the chart.
	const edited = { ...stampedBy(result.visual, user, visual.updatedBy), thumbnail: null }
	if (dryRun) return sendJson(res, 200, JSON.stringify({ visual: edited, warnings }))
	if (!replaceVisualIfUnchanged(db, id, stored, JSON.stringify(edited))) {
		throw new HttpError(412, "This visual changed while the edit ran; read it again")
	}
	return sendJson(
		res,
		200,
		JSON.stringify({
			id,
			visual: edited,
			warnings,
			editorUrl: `${config.baseUrl}/editor/${id}`,
			undo: { visualsVersion: VISUALS_VERSION, visual } satisfies UndoEnvelope,
		}),
		{ etag: visualEtag(edited) }
	)
}

/** GET /api/visuals/<id>: the stored visual without its preview image (as
 *  the collection's `?thumbnails=0` answers it) and its ETag, the one an
 *  edit or restore takes as If-Match. An unknown or trashed visual answers
 *  404, like one deleted. */
const readVisual = (res: ServerResponse, db: DatabaseSync, id: string): void => {
	const stored = readVisualBody(db, id)
	if (stored === undefined) throw new HttpError(404, "Not found")
	const visual = parseJson(stored) as Visual | undefined
	if (!visual || typeof visual !== "object" || visual.id !== id) {
		throw new HttpError(500, "The stored visual isn't readable")
	}
	if (isTrashed(visual)) throw new HttpError(404, "Not found")
	sendJson(res, 200, stored, { etag: visualEtag(visual) })
}

const isRecord = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v)

/** The first required Visual key `visual` lacks or holds the wrong kind of
 *  value in, or undefined when it has them all. */
const missingVisualKey = (visual: Record<string, unknown>): string | undefined => {
	if (typeof visual.name !== "string") return "name"
	if (visual.datasetId !== null && typeof visual.datasetId !== "string") return "datasetId"
	return ["encodings", "channelConfigs", "labelsConfig"].find((key) => !isRecord(visual[key]))
}

/** POST /api/visuals/<id>/restore: put back the visual an edit replaced,
 *  from the `undo` that edit answered. `If-Match` carries the ETag the
 *  edit answered; a visual whose chart changed since answers 412 and is
 *  left alone, while a save that changed only bookkeeping (an editor
 *  opening it) does not stand in the way.
 *  An `undo` from another content version answers 409. */
export const restoreVisual = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig,
	id: string,
	user: AppUser | null = null
): Promise<void> => {
	assertJsonWrite(req, new URL(config.baseUrl).origin)
	const input = parseJson((await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8")) as
		| Partial<UndoEnvelope>
		| undefined
	const before = input?.visual
	if (typeof input?.visualsVersion !== "number" || typeof before !== "object" || before === null) {
		throw new HttpError(400, "Send the `undo` the edit answered: {visualsVersion, visual}")
	}
	if (before.id !== id) {
		throw new HttpError(400, `This undo is for visual "${String(before.id)}", not "${id}"`)
	}
	const missing = missingVisualKey(before as Record<string, unknown>)
	if (missing !== undefined) {
		throw new HttpError(
			400,
			`This undo's visual has no valid "${missing}"; send the \`undo\` the edit answered, unchanged`
		)
	}
	assertStampsCurrent(db)
	if (input.visualsVersion !== VISUALS_VERSION) {
		throw new HttpError(
			409,
			`This undo was saved at visuals content version ${input.visualsVersion}; this server writes ${VISUALS_VERSION}`
		)
	}
	const { stored, visual: current } = storedVisual(db, id)
	assertIfMatch(
		req,
		current,
		"Send If-Match with the ETag the edit answered",
		"This visual changed after that edit; undoing it would erase the newer change"
	)
	const updatedAt = Math.max(Date.now(), (current.updatedAt ?? 0) + 1)
	const restored = stampedBy(
		structuredVisual({ ...before, updatedAt, thumbnail: null }),
		user,
		current.updatedBy
	)
	if (!replaceVisualIfUnchanged(db, id, stored, JSON.stringify(restored))) {
		throw new HttpError(412, "This visual changed while the undo ran; read it again")
	}
	return sendJson(
		res,
		200,
		JSON.stringify({ id, updatedAt, editorUrl: `${config.baseUrl}/editor/${id}` }),
		{ etag: visualEtag(restored) }
	)
}

const newDatasetId = () =>
	`ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const newDatasetVersionId = () =>
	`dv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Problems with a `{name, rows, types?}` body, at most MAX_PROBLEMS. */
const rowsBodyProblems = (name: unknown, rows: unknown, types: unknown): SpecProblem[] => {
	const errors: SpecProblem[] = []
	if (typeof name !== "string" || name.trim() === "") {
		errors.push({ path: "name", message: "name must be a non-blank string" })
	}
	if (!Array.isArray(rows) || rows.length === 0) {
		errors.push({ path: "rows", message: "rows must be a non-empty array of objects" })
	} else {
		for (const [i, row] of rows.entries()) {
			if (errors.length >= MAX_PROBLEMS) break
			if (typeof row !== "object" || row === null || Array.isArray(row)) {
				errors.push({ path: `rows[${i}]`, message: "each row must be an object" })
				continue
			}
			for (const [column, value] of Object.entries(row)) {
				if (value === null || ["string", "number", "boolean"].includes(typeof value)) continue
				// "rows[0].x", or rows[0]["a b"] for a name that isn't an identifier.
				errors.push({
					path: `rows[${i}]${pathOf("r", column).slice(1)}`,
					message: "values must be text, numbers, true/false or null",
				})
			}
		}
	}
	if (types !== undefined && (typeof types !== "object" || types === null || Array.isArray(types))) {
		errors.push({ path: "types", message: "types must map column names to field types" })
	}
	return errors.slice(0, MAX_PROBLEMS)
}

/** POST /api/datasets: a new dataset from rows, as `{name, rows, types?}`.
 *  Values are stored as text and each column's type is inferred as an
 *  upload infers it, unless `types` names it. A name already in the
 *  library answers 409. The files are written first and the index rows in
 *  one transaction, so the library lists the dataset whole or not at all.
 *  Problems answer 400 with `{errors: [{path, message}]}`. */
export const createDatasetFromRows = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	config: ServerConfig
): Promise<void> => {
	assertJsonWrite(req, new URL(config.baseUrl).origin)
	const input = parseJson((await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8"))
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return specErrors(res, [{ path: "", message: "the body must be a JSON object" }])
	}
	const { name, rows, types } = input as { name?: unknown; rows?: unknown; types?: unknown }
	const errors = rowsBodyProblems(name, rows, types)
	if (errors.length > 0) return specErrors(res, errors)

	const records = rows as Array<Record<string, string | number | boolean | null>>
	const columns = [...new Set(records.flatMap((r) => Object.keys(r)))]
	const named = (types ?? {}) as Record<string, unknown>
	const fieldTypes = chartVocabulary().fieldTypes
	for (const [column, type] of Object.entries(named)) {
		if (!columns.includes(column)) {
			errors.push({ path: pathOf("types", column), message: `no column "${column}" in the rows` })
		} else if (!fieldTypes.includes(type as FieldType)) {
			errors.push({ path: pathOf("types", column), message: `must be one of ${fieldTypes.join(", ")}` })
		}
	}
	if (errors.length > 0) return specErrors(res, errors.slice(0, MAX_PROBLEMS))

	const datasetName = (name as string).trim()
	const taken = listDatasetMeta(db).some(({ meta }) => {
		const stored = meta === null ? undefined : (parseJson(meta) as { name?: unknown } | undefined)
		return typeof stored?.name === "string" && stored.name.toLowerCase() === datasetName.toLowerCase()
	})
	if (taken) throw new HttpError(409, `A dataset named "${datasetName}" already exists`)

	// Every row is stored with every column, each at least `"column":"",`:
	// a floor on the stored size, checked before the rows are filled out.
	const denseFloor =
		records.length * columns.reduce((sum, c) => sum + Buffer.byteLength(JSON.stringify(c)) + 4, 0)
	if (datasetSizeIssue(denseFloor) === "reject") {
		throw new HttpError(413, datasetRejectMessage(denseFloor))
	}
	// Own properties only: a column named toString or constructor must not
	// read the function every object inherits.
	const text = records.map((r) =>
		Object.fromEntries(columns.map((c) => [c, !Object.hasOwn(r, c) || r[c] == null ? "" : String(r[c])]))
	)
	const fields: Field[] = columns.map((c) => ({
		name: c,
		inferredType: Object.hasOwn(named, c)
			? (named[c] as FieldType)
			: inferFieldType(text.map((r) => r[c] ?? "")),
	}))
	const now = Date.now()
	const version = {
		id: newDatasetVersionId(),
		filename: `${datasetName}.json`,
		rows: text,
		createdAt: now,
	}
	const dataset: Dataset = {
		id: newDatasetId(),
		name: datasetName,
		fields,
		versions: [version],
		latestVersionId: version.id,
		createdAt: now,
		contentHash: datasetContentHash({ name: datasetName, fields, versions: [version] }),
	}
	const bodyJson = JSON.stringify(dataset)
	if (datasetSizeIssue(Buffer.byteLength(bodyJson)) === "reject") {
		throw new HttpError(413, datasetRejectMessage(Buffer.byteLength(bodyJson)))
	}
	const body = gzipSync(bodyJson)
	const versionBody = gzipSync(JSON.stringify({ id: version.id, rows: text }))
	assertStampsCurrent(db, "datasets")
	await writeDatasetFile(config.dataDir, dataset.id, body)
	await writeDatasetVersionFile(config.dataDir, dataset.id, version.id, versionBody)
	try {
		assertStampsCurrent(db, "datasets")
		db.exec("BEGIN")
		try {
			upsertDatasetRow(db, dataset.id, body.length)
			upsertDatasetVersionRow(db, dataset.id, version.id, versionBody.length)
			upsertDatasetMeta(db, dataset.id, JSON.stringify(datasetMetaFrom(dataset)))
			db.exec("COMMIT")
		} catch (error) {
			db.exec("ROLLBACK")
			throw error
		}
	} catch (error) {
		await deleteDatasetFile(config.dataDir, dataset.id)
		await deleteDatasetVersionFile(config.dataDir, dataset.id, version.id)
		throw error
	}
	return sendJson(
		res,
		201,
		JSON.stringify({
			id: dataset.id,
			name: dataset.name,
			rowCount: text.length,
			fields: fields.map((f) => ({ name: f.name, type: f.inferredType })),
		})
	)
}

/** The chart-spec routes, dispatched before the generic collection routes:
 *  GET /api/chart-spec, GET /api/chart-spec/settings, POST /api/visuals,
 *  GET and PATCH /api/visuals/<id>, POST /api/visuals/<id>/restore and
 *  POST /api/datasets. False when the request is none of these. */
export const handleChartSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	deps: {
		config: ServerConfig
		db: DatabaseSync
		mintVisualId?: () => string
		identify?: IdentifyUser
	},
	route: { method: string; collection: string; id?: string; rest: string[]; query: string }
): Promise<boolean> => {
	const { config, db } = deps
	const { method, collection, id, rest } = route
	if (collection === "chart-spec" && id === "settings" && rest.length === 0) {
		if (method !== "GET") throw new HttpError(405, "Method not allowed")
		listSettings(res, db, new URLSearchParams(route.query))
		return true
	}
	if (collection === "chart-spec" && !id) {
		if (method !== "GET") throw new HttpError(405, "Method not allowed")
		const themes = loadThemes(db)
		const fallback = defaultTheme(db, themes)
		const themeList = themes.map((t) => ({
			id: t.id,
			name: t.name,
			default: t.id === fallback.id,
		}))
		sendJson(res, 200, JSON.stringify({
				...chartVocabulary(),
				themes: themeList,
				features: CHART_SPEC_FEATURES,
			}))
		return true
	}
	if (collection === "datasets" && !id && method === "POST") {
		await createDatasetFromRows(req, res, db, config)
		return true
	}
	if (collection !== "visuals") return false
	const user = requestUser(deps.identify, req)
	const query = new URLSearchParams(route.query)
	if (!id && method === "POST") {
		await createVisualFromSpec(req, res, db, config, query, deps.mintVisualId, user)
		return true
	}
	if (id && method === "GET" && rest.length === 0) {
		if (!isSafeId(id)) throw new HttpError(400, "Invalid id")
		readVisual(res, db, id)
		return true
	}
	const restore = method === "POST" && rest.length === 1 && rest[0] === "restore"
	if (!id || !(restore || (method === "PATCH" && rest.length === 0))) return false
	if (!isSafeId(id)) throw new HttpError(400, "Invalid id")
	if (restore) await restoreVisual(req, res, db, config, id, user)
	else await editVisualFromSpec(req, res, db, config, id, query, user)
	return true
}
