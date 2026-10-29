/** POST /api/visuals: create one visual from a chart spec (see
 *  src/contexts/chartBuilder/lib/visualSpec). Create-only: the server mints
 *  the id, so a spec can never overwrite an existing visual. The spec is
 *  composed by the same library the editor's defaults come from, against
 *  the stored dataset, folders and theme, and the result is written through
 *  the thumbnail split a PUT uses, insert-only. `?dryRun=1` answers with
 *  the visual and writes nothing. Spec problems answer 400 with
 *  `{errors: [{path, message}]}`; every other failure keeps the server's
 *  `{error}` shape (HttpError). GET /api/chart-spec lists what a spec can
 *  say. */

import type { IncomingMessage, ServerResponse } from "node:http"
import type { DatabaseSync } from "node:sqlite"
import { gunzipSync } from "node:zlib"

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
import { chartVocabulary } from "../../src/contexts/chartBuilder/lib/visualSpec/vocabulary"
import type { ServerConfig } from "./config.js"
import { isSafeId, readDatasetFile, readDatasetVersionFile } from "./datasetFiles.js"
import { insertVisual, listContentVersions, listRows, readDatasetMeta } from "./db.js"
import { assertJsonWrite, HttpError, readBody, sendJson } from "./http.js"
import { requestUser, type AppUser, type IdentifyUser } from "./identity.js"
import { SPEC_BODY_CAP_BYTES } from "./limits.js"

/** What this server's chart-spec routes do, listed by GET /api/chart-spec
 *  so a client can tell which of them it serves. */
export const CHART_SPEC_FEATURES = ["create"] as const

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
	let dataset: ComposeContext["dataset"]
	try {
		dataset = await loadDataset(db, config.dataDir, spec.datasetId)
	} catch (e) {
		if (!(e instanceof RowsMissing)) throw e
		return specErrors(res, [
			{
				path: "datasetId",
				message:
					"this dataset's rows can't be loaded (its data file is missing), so it can't be charted; upload the data again",
			},
		])
	}
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
	// A spec write is a save, so it names its saver as an editor save does.
	let visual = user ? { ...result.visual, updatedBy: user } : result.visual
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
		})
	)
}

/** The chart-spec routes, dispatched before the generic collection routes:
 *  GET /api/chart-spec and POST /api/visuals. False when the request is
 *  neither. */
export const handleChartSpec = async (
	req: IncomingMessage,
	res: ServerResponse,
	deps: {
		config: ServerConfig
		db: DatabaseSync
		mintVisualId?: () => string
		identify?: IdentifyUser
	},
	route: { method: string; collection: string; id?: string; query: string }
): Promise<boolean> => {
	const { config, db } = deps
	if (route.collection === "chart-spec" && !route.id) {
		if (route.method !== "GET") throw new HttpError(405, "Method not allowed")
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
	if (route.collection === "visuals" && !route.id && route.method === "POST") {
		const user = requestUser(deps.identify, req)
		const query = new URLSearchParams(route.query)
		await createVisualFromSpec(req, res, db, config, query, deps.mintVisualId, user)
		return true
	}
	return false
}
