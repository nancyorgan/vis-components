/** The MCP tools. Handlers stay thin: chart logic is the editor's own lib
 *  (`chartSpec.ts`, `datasetFromRows.ts`); this file resolves what those
 *  functions need from the API and writes their result back. Every result
 *  and refusal is compact JSON; the three chart writes also return it as
 *  `structuredContent` under a declared `outputSchema`.
 *
 *  Pictures: every chart write that lands (and get_chart, unless asked not
 *  to) takes a picture through the injected Renderer AFTER the save, and
 *  returns it as an image block after the summary. A picture that fails
 *  never fails the write: a second text block says why and names the
 *  editor link. Each picture is also held by key (`pictureKey` in
 *  structuredContent) for the chart card's own tool, chart_picture. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import { SETTING_CATALOG } from "../../src/contexts/chartBuilder/lib/applySettings"
import {
	composeVisual,
	editVisual,
	specReadsRows,
	type ChartSpec,
	type ChartSpecEdit,
	type ComposeDeps,
	type SpecProblem,
} from "../../src/contexts/chartBuilder/lib/chartSpec"
import { editDistance } from "../../src/contexts/chartBuilder/lib/didYouMean"
import { datasetsEqual } from "../../src/contexts/chartBuilder/lib/datasetDedupe"
import {
	datasetFromParsed,
	datasetFromRows,
	PASTED_DATA_FILENAME,
} from "../../src/contexts/chartBuilder/lib/datasetFromRows"
import { settingsReadRows } from "../../src/contexts/chartBuilder/lib/settingEffects"
import { PUBLIC_SEED_FOLDER_IDS } from "../../src/contexts/chartBuilder/lib/stockFolders"
import { themeOf } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { DatasetMeta, FieldType, SavedTheme, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { CONTENT_MIGRATIONS } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { RefusalError, StaleVisualError, type Api, type TaggedVisual } from "./api"
import { TOOL_TEXT } from "./guide"
import {
	createHistory,
	HistoryBusyError,
	recordNamed,
	recordReturned,
	resolveStateDir,
	STEPS_KEPT,
	type History,
	type Session,
} from "./history"
import { chartListing, librarySummary } from "./library"
import { CARD_URI, createPictureStore, RESULT_LIMIT, type PictureStore } from "./pictures"
import { checkFileName, type ExportFormat, type PictureOutcome, type Renderer } from "./render"
import { resolveDataset, resolveFolder, resolveThemeName, rowCountOf } from "./resolve"
import { searchSettings } from "./settingSearch"
import { csvText, MAX_CELLS, MAX_ROWS, parseSource, readSourceFile, uploadName, type ReadHooks } from "./source"
import {
	changedPaths,
	conflictRoots,
	conflictsOf,
	describeChanges,
	normalizeVisual,
	overlaps,
	restoreAt,
	type SettingPath,
} from "./visualDiff"

/** Served text never carries an em dash (lib docs and messages may). */
const plain = (text: string) => text.replace(/\s*—\s*/g, "; ")

const ASK =
	"Tell the person each change below and ask what they want, then do it in one call:"

/** An edit paused over someone's change to the same setting. */
const EDIT_PAUSED = `Paused, nothing saved: since you last saw this chart someone (in the editor, a tab, or another chat) changed a setting this edit changes. ${ASK} keep theirs (this edit_chart again with keepTheirs: true, applying only your other settings); go ahead (this edit with this revision, replacing their change); leave it (no call); or a combined value (edit_chart with this revision and the combined value).`

/** An undo paused over someone's later change to a setting it restores. */
const UNDO_PAUSED = `Paused, nothing undone: since that edit someone changed a setting it would restore, and undoing would lose their change. ${ASK} keep theirs (undo_chart_edit with keepTheirs: true, undoing only the edit's other settings); undo over theirs (undo_chart_edit with this revision); leave it (no call); or a combined value (edit_chart with this revision and the combined value).`

const UNKNOWN_REVISION =
	"Nothing was saved: that revision was never returned for this chart; read it again with get_chart and send the edit with no revision (or the revision it returns)."

const BASELINE_GONE =
	"Nothing was saved: the MCP no longer has the copy of this chart it last showed you, so it can't tell what changed since. Read it again with get_chart, then send the edit."

const CHANGED_WHILE_SAVING =
	"Nothing was saved: the chart was saved elsewhere twice while this call ran. Read it again with get_chart, tell the person it is being changed, and ask what they want."

const UNDO_CHANGED_WHILE_SAVING =
	"Nothing was undone and the step is kept: the chart was saved elsewhere while this undo ran. Call undo_chart_edit again to see what changed."

const SPENT_YES =
	"Nothing was undone: that revision answered an earlier pause and was already used, or was for another step. Tell the person; call undo_chart_edit with no revision to see what the next undo would do."

const BUSY =
	"Nothing was saved: another copy of the Zafiro MCP on this computer is busy with a chart. Try again in a moment."

const NO_UNDO_STEP =
	"Saved, but without an undo step: the MCP could not write its history on this computer, so undo_chart_edit can't step back this edit. Tell the person if they ask to undo it."

const UNDO_NOT_RECORDED =
	"Undone, but the MCP could not write its history on this computer: the next undo_chart_edit may ask about this same edit again. Tell the person if it does."

const NOTHING_LEFT =
	"Nothing is left to undo for this chart: no edit made through this MCP on this computer in the last 30 days is still undone. Change it back with edit_chart instead."

const STOCK_FOLDER =
	"The stock Examples folder is read-only. Save the chart in another folder or at the library root, or duplicate the example in the editor first."

/** The collections a chart write reads from and writes to. */
const CHART_COLLECTIONS = ["visuals", "datasets", "themes"] as const

/** One block of a tool result. */
type Block = CallToolResult["content"][number]

const textBlock = (text: string): Block => ({ type: "text", text: plain(text) })

const ok = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: plain(JSON.stringify(value)) }],
})

/** A chart write: the text and `structuredContent` are the same object. */
const written = (value: ChartWrite): CallToolResult => {
	const text = plain(JSON.stringify(value))
	return { content: [{ type: "text", text }], structuredContent: JSON.parse(text) }
}

const refused = (message: string, problems?: SpecProblem[], about?: Record<string, unknown>): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: plain(JSON.stringify({ message, ...(problems ? { problems } : {}), ...about })) }],
})

/** A thrown error (HTTP failure, content-version mismatch) as tool output. */
const guarded =
	<A>(handler: (args: A) => Promise<CallToolResult>) =>
	async (args: A): Promise<CallToolResult> => {
		try {
			return await handler(args)
		} catch (error) {
			if (error instanceof RefusalError) return refused(error.message)
			const message = error instanceof Error ? error.message : String(error)
			return refused(
				`${message.replace(/\.$/, "")}. Try once more; if it fails again, tell the person the Zafiro server didn't answer as expected.`
			)
		}
	}

/** A data set's fields at its latest version, with their effective types. */
const fieldsOf = (meta: DatasetMeta): Array<{ name: string; type: FieldType }> => {
	const latest = meta.versions.find((v) => v.id === meta.latestVersionId)
	return (latest?.fields ?? meta.fields).map((f) => ({ name: f.name, type: f.inferredType }))
}

/** Field → type, the compact form results carry. */
const fieldTypesOf = (fields: ReadonlyArray<{ name: string; type: FieldType }>) =>
	Object.fromEntries(fields.map((f) => [f.name, f.type]))

/** The stored visual's settings slices (absent ones left out). */
const settingsOf = (visual: Visual) =>
	Object.fromEntries(
		SETTING_CATALOG.slices.flatMap((slice) => {
			const value = (visual as Record<string, unknown>)[slice]
			return value === undefined ? [] : [[slice, value]]
		})
	)

/** The catalog paths one level under the real path `parent` (its `*`
 *  keys and `[i]` entries matched as the catalog spells them). */
const catalogChildren = (parent: string[]): string[] =>
	Object.keys(SETTING_CATALOG.paths).filter((path) => {
		const segs = path.replace(/\[\]/g, ".[]").split(".")
		return (
			segs.length === parent.length + 1 &&
			parent.every((seg, i) => segs[i] === seg || segs[i] === "*" || (segs[i] === "[]" && /^\d+$/.test(seg)))
		)
	})

/** An unknown setting's problem, with the nearest existing settings by
 *  full path (siblings by edit distance; else the setting search) after
 *  the lib's own did-you-mean. */
const withNearestSettings = (problems: SpecProblem[]): SpecProblem[] =>
	problems.map((p) => {
		const unknown = /^unknown settings? (?:slice )?"([^"]+)"/.exec(p.message)
		if (!unknown || !p.path.startsWith("settings")) return p
		const key = unknown[1]
		const parent = p.path.replace(/\[(\d+)\]/g, ".$1").split(".").slice(1, -1)
		let near = catalogChildren(parent)
			.map((path) => ({ path, dist: editDistance(key, path.split(/[.\]]/).at(-1) ?? "") }))
			.sort((a, b) => a.dist - b.dist)
			.map((r) => r.path)
		if (near.length === 0)
			near = searchSettings({ query: key.replace(/([a-z0-9])([A-Z])/g, "$1 $2") }).rows.map((r) => r.path)
		const list = near.slice(0, 3).map((n) => `"${n}"`)
		return list.length === 0
			? { ...p, message: `${p.message}; search list_settings for the setting's path` }
			: { ...p, message: `${p.message}; nearest settings: ${list.join(", ")}` }
	})

/** A result's size as the client receives it. */
const serializedLength = (result: CallToolResult) => JSON.stringify(result).length

/** Said in place of a picture left out so the result reaches the card. */
const CARD_ONLY =
	"The person sees this chart in the card; its picture was too large to send you too, so you did not see it. Describe only what you set."

/** get_chart's text stays this far under the result limit, leaving room
 *  for its structuredContent and a no-picture line. */
const SETTINGS_BUDGET = RESULT_LIMIT - 4_000

const SETTINGS_LEFT_OUT =
	"The settings were too large to send whole; get_chart with slice returns one left out, in full."

/** A chart's name as the default export file name: a name holding a
 *  slash is still a name, so separators become spaces (checkFileName then
 *  takes out what else a file name can't hold). */
const defaultFileName = (name: string): string => name.replace(/[/\\]+/g, " ").replace(/\s+/g, " ").trim() || "chart"

/** get_chart's summary within SETTINGS_BUDGET: whole when it fits, else
 *  the settings slices that fit (in catalog order), the ones left out
 *  named, and a note that `slice` returns one in full. */
const fitSettings = (summary: Record<string, unknown> & { settings: Record<string, unknown> }) => {
	if (JSON.stringify(summary).length <= SETTINGS_BUDGET) return summary
	const kept: Record<string, unknown> = {}
	const leftOut: string[] = []
	const names = Object.keys(summary.settings)
	let used =
		JSON.stringify({ ...summary, settings: {}, settingsLeftOut: names, note: SETTINGS_LEFT_OUT }).length
	for (const name of names) {
		const size = JSON.stringify(summary.settings[name]).length + name.length + 4
		if (used + size <= SETTINGS_BUDGET) {
			kept[name] = summary.settings[name]
			used += size
		} else leftOut.push(name)
	}
	return { ...summary, settings: kept, settingsLeftOut: leftOut, note: SETTINGS_LEFT_OUT }
}

/** What a chart write returns. */
type ChartWrite = {
	id: string
	name: string
	editorUrl: string
	embedUrl: string
	warnings: string[]
	revision: string | null
}

const chartWriteShape = {
	id: z.string(),
	name: z.string(),
	editorUrl: z.string(),
	embedUrl: z.string(),
	warnings: z.array(z.string()),
	revision: z.string().nullable(),
	pictureKey: z.string().optional(),
}

/** A stored chart as a save left it (or a read found it): its ETag, null
 *  from a server older than tags, and its `updatedAt`. */
type Written = { tag: string | null; updatedAt: number }

/** What create_chart accepts beyond a spec: names for the data set and
 *  folder (the spec's ids still work). */
export type CreateChartArgs = Omit<ChartSpec, "datasetId" | "folderId"> & {
	dataset?: string
	datasetId?: string
	folder?: string | null
	folderId?: string | null
	/** Not a create_chart key: a write always returns its picture. Taken
	 *  off before the spec, so a client that sends it isn't refused. */
	picture?: unknown
}

export type GetChartArgs = { id: string; picture?: boolean; slice?: string }

export type ExportChartArgs = {
	id: string
	format: ExportFormat
	width?: number
	height?: number
	pixelRatio?: number
	fileName?: string
}

/** create_dataset's input: exactly one of rows, csv and path. */
export type CreateDatasetArgs = {
	name?: string
	rows?: Record<string, unknown>[]
	csv?: string
	path?: string
	expectedRows?: number
	types?: Record<string, FieldType>
}

export type HandlerDeps = {
	/** Test seams in reading a file by path (source.ts). */
	readHooks?: ReadHooks
	/** Takes the pictures and writes the exports. */
	renderer: Renderer
	/** Whether this connection's client shows the chart card (it announced
	 *  MCP Apps). Read per call; absent = no. */
	showsCards?: () => boolean
	/** Where pictures wait for chart_picture; one per process by default. */
	pictures?: PictureStore
	/** The state folder for the history; VIS_STATE_DIR or the platform's
	 *  by default (history.ts). */
	stateDir?: string
	/** The history itself, made from stateDir when absent. */
	history?: History
	/** The data format the history is keyed by; this build's by default. */
	formatVersion?: number
}

/** edit_chart's input. */
export type EditChartArgs = { id: string; revision?: string; keepTheirs?: boolean; patch: ChartSpecEdit }

/** undo_chart_edit's input. */
export type UndoChartArgs = { id: string; revision?: string; keepTheirs?: boolean }

export const createHandlers = (api: Api, deps: HandlerDeps) => {
	const pictures = deps.pictures ?? createPictureStore()
	const showsCards = deps.showsCards ?? (() => false)

	/** The baselines and undo steps, shared by every copy on this computer. */
	const history =
		deps.history ??
		createHistory({
			dir: deps.stateDir ?? resolveStateDir(process.env),
			server: api.serverUrl,
			version: deps.formatVersion ?? CONTENT_MIGRATIONS.visuals.currentVersion,
		})
	/** Trimmed on start. */
	const started = history.trim()

	/** Run `fn` holding the history; `historyFailed` when what it changed
	 *  couldn't be written. A busy history is a refusal, nothing saved. */
	const locked = async <T>(fn: (session: Session) => Promise<T>): Promise<{ value: T; historyFailed: boolean }> => {
		let historyFailed = false
		try {
			const value = await history.run(fn, () => {
				historyFailed = true
			})
			return { value, historyFailed }
		} catch (error) {
			if (error instanceof HistoryBusyError) throw new RefusalError(BUSY)
			throw error
		}
	}

	/** Note `visual` at `tag` as returned to a model, best effort: a busy or
	 *  unwritable history never fails a read or a create. */
	const remember = async (visual: Visual, tag: string | null): Promise<void> => {
		try {
			await history.run(async (session) => recordReturned(session, visual, tag))
		} catch {
			// The next read records it.
		}
	}

	/** Save `next` only over the stored chart still as `read`: a conditional
	 *  PUT at its tag, so the check and the write are one step on the
	 *  server. Against an older server with no tags, a check-then-write on
	 *  `updatedAt`. Null (nothing written) when the chart changed. */
	const saveAt = async (next: Visual, read: TaggedVisual): Promise<Written | null> => {
		if (read.tag === null && (await api.visual(next.id))?.updatedAt !== read.visual.updatedAt) return null
		try {
			return { tag: await api.putVisual(next, read.tag ?? undefined), updatedAt: next.updatedAt }
		} catch (error) {
			if (error instanceof StaleVisualError) return null
			throw error
		}
	}

	const links = async (id: string) => {
		const base = await api.baseUrl()
		return {
			editorUrl: `${base}/editor/${encodeURIComponent(id)}`,
			embedUrl: `${base}/embed/${encodeURIComponent(id)}`,
		}
	}

	/** The blocks after a summary: the picture (and, when it shows only part
	 *  of the plot, a line saying how much), or a line saying there is
	 *  none, why, and that the chart is saved; plus the picture's key. */
	const pictureBlocks = async (id: string, editorUrl: string): Promise<{ blocks: Block[]; key?: string }> => {
		let outcome: PictureOutcome
		try {
			outcome = await deps.renderer.picture(id)
		} catch (error) {
			outcome = { ok: false, reason: error instanceof Error ? error.message : String(error) }
		}
		if (!outcome.ok) {
			const why = outcome.reason.trim().replace(/\.$/, "")
			return {
				blocks: [
					textBlock(
						outcome.tooLarge
							? `The picture was too large to send. The chart is saved; open it in the editor: ${editorUrl}`
							: `No picture this time${why ? ` (${why})` : ""}. The chart is saved; the editor link opens it: ${editorUrl}`
					),
				],
			}
		}
		const { picture } = outcome
		const blocks: Block[] = [{ type: "image", data: picture.data, mimeType: picture.mimeType }]
		if (typeof picture.shownShare === "number" && picture.shownShare < 1)
			blocks.push(
				textBlock(
					`The picture shows ${Math.max(1, Math.round(picture.shownShare * 100))}% of the plot; the editor shows all of it: ${editorUrl}`
				)
			)
		return { blocks, key: pictures.put(picture) }
	}

	/** `result` with the chart's picture after it, its key in
	 *  structuredContent, and sized to reach a card: past RESULT_LIMIT, a
	 *  client that shows cards gets no image block (the card loads it by
	 *  key) and a line saying so. A client without cards keeps the image. */
	const withPicture = async (result: CallToolResult, id: string, editorUrl: string): Promise<CallToolResult> => {
		const { blocks, key } = await pictureBlocks(id, editorUrl)
		const content: Block[] = result.content.concat(blocks)
		const full: CallToolResult = {
			...result,
			content,
			...(key ? { structuredContent: { ...(result.structuredContent ?? {}), pictureKey: key } } : {}),
		}
		if (!showsCards() || serializedLength(full) <= RESULT_LIMIT) return full
		const lean: Block[] = content.filter((b) => b.type !== "image")
		if (lean.length === content.length) return full
		lean.push(textBlock(CARD_ONLY))
		return { ...full, content: lean }
	}

	/** A refusal about a chart that exists, naming it and its editor link,
	 *  so the card can still open it. (In the text: a client checks any
	 *  structuredContent against the tool's output schema, even on an error.) */
	const refusedAbout = async (visual: Visual, message: string, problems?: SpecProblem[]): Promise<CallToolResult> =>
		refused(message, problems, { name: visual.name, editorUrl: (await links(visual.id)).editorUrl })

	const chartWrite = async (visual: Visual, warnings: string[], wrote: Written) => {
		const summary: ChartWrite = { id: visual.id, name: visual.name, ...(await links(visual.id)), warnings, revision: wrote.tag }
		return withPicture(written(summary), visual.id, summary.editorUrl)
	}

	const defaultTheme = async (themes?: SavedTheme[]): Promise<SavedTheme> => {
		const [all, defaultId] = await Promise.all([themes ?? api.themes(), api.defaultThemeId()])
		return all.find((t) => t.id === defaultId) ?? all[0]
	}

	/** The theme a stored chart renders under: its own, else the default. */
	const storedTheme = async (themeId: string | null | undefined): Promise<SavedTheme> => {
		const themes = await api.themes()
		return themes.find((t) => t.id === themeId) ?? defaultTheme(themes)
	}

	/** The latest version's rows, only for a spec that reads them: a settings
	 *  patch whose effects read them, a map or flow variation (a map finds
	 *  its region column from the values, a flow its target column), or an
	 *  edit naming a region column on a stored map (`stored`). */
	const rowsFor = async (
		meta: DatasetMeta | undefined,
		spec: { family?: unknown; variation?: unknown; encodings?: unknown; settings?: unknown },
		stored?: Visual
	) => {
		if (!meta || !(settingsReadRows(spec.settings) || specReadsRows(spec, stored))) return undefined
		const body = await api.dataset(meta.id)
		return body.versions.find((v) => v.id === meta.latestVersionId)?.rows
	}

	const datasetMeta = async (datasetId: string | null): Promise<DatasetMeta | undefined> =>
		datasetId ? (await api.datasetIndex())[datasetId] : undefined

	const noChart = (id: string) =>
		refused(`No chart has id "${id}". list_charts finds a chart by its name, folder or data set.`)

	/** What an edit needs beyond the chart, read once per call: the themes
	 *  and the theme the patch names (null when it names none; a refusal
	 *  when it names none that exists). */
	const editContext = async (patch: ChartSpecEdit) => {
		const themes = await api.themes()
		const wanted = typeof patch?.themeId === "string" ? resolveThemeName(patch.themeId, themes) : null
		const rows = new Map<string, Awaited<ReturnType<typeof rowsFor>>>()
		return { themes, wanted, rows }
	}

	/** `patch` applied to `base` by the editor's own lib. A new theme must
	 *  exist; a visual whose stored theme is gone renders under the
	 *  default, so edit against that too. The stored theme is also the
	 *  baseline a re-theme diffs against, so settings the user moved off it
	 *  stay (as in the Theme panel). */
	const editOn = async (base: Visual, patch: ChartSpecEdit, ctx: Awaited<ReturnType<typeof editContext>>) => {
		const meta = await datasetMeta(base.datasetId)
		const current = ctx.themes.find((t) => t.id === base.themeId) ?? (await defaultTheme(ctx.themes))
		const named = ctx.wanted?.ok ? ctx.wanted.value : null
		const theme = named ?? current
		const edit = named ? { ...patch, themeId: theme.id } : (patch ?? {})
		const key = meta?.id ?? ""
		if (!ctx.rows.has(key)) ctx.rows.set(key, await rowsFor(meta, edit, base))
		return editVisual(base, edit, {
			fields: meta ? fieldsOf(meta) : [],
			theme: themeOf(theme),
			fromTheme: themeOf(current),
			latestVersionId: meta?.latestVersionId ?? null,
			rows: ctx.rows.get(key),
		})
	}

	/** A paused edit or undo: each change, the current revision, and the
	 *  choices in `message`. */
	const paused = async (visual: Visual, message: string, changes: string[], revision: string | null) =>
		refused(message, undefined, {
			changes,
			revision,
			name: visual.name,
			editorUrl: (await links(visual.id)).editorUrl,
		})

	return {
		/** Resolves once the start trim of the history is done. */
		started,

		create_dataset: guarded(async (args: CreateDatasetArgs) => {
			const given = (["rows", "csv", "path"] as const).filter((k) => args[k] !== undefined)
			if (given.length !== 1)
				return refused("Nothing was stored: give exactly one of rows, csv or path.")
			await api.assertCurrent(["datasets"])

			// The data as it arrived: rows as sent, or text parsed as an upload.
			let upload: { fieldNames: string[]; rows: Array<Record<string, string>>; filename: string } | null = null
			let name = args.name
			if (args.rows === undefined) {
				let text: string
				let delimiter: string | undefined
				let filename = PASTED_DATA_FILENAME
				if (args.csv !== undefined) {
					const sent = csvText(args.csv)
					if (!sent.ok) return refused(sent.message)
					text = sent.text
				} else {
					const file = await readSourceFile(String(args.path), deps.readHooks)
					if (!file.ok) return refused(file.message)
					;({ text, delimiter } = file)
					filename = file.fileName
					name ??= uploadName(file.fileName)
				}
				const parsed = parseSource(text, delimiter)
				if (!parsed.ok) return refused(parsed.message)
				upload = { fieldNames: parsed.fieldNames, rows: parsed.rows, filename }
			} else if (Array.isArray(args.rows) && args.rows.length > MAX_ROWS) {
				return refused(
					`Nothing was stored: the rows are more than ${MAX_ROWS.toLocaleString("en-US")}, the limit for one data set. Tell the person; a smaller extract or a split file would fit.`
				)
			}
			const arrived = upload ? upload.rows.length : Array.isArray(args.rows) ? args.rows.length : 0
			if (args.expectedRows !== undefined && arrived !== args.expectedRows)
				return refused(
					`Nothing was stored: ${arrived.toLocaleString("en-US")} rows arrived, not the ${args.expectedRows.toLocaleString("en-US")} expected. Send every row (the whole data as csv), or give the file's full path.`
				)

			const index = await api.datasetIndex()
			const existing = Object.values(index)
			const { dataset, problems, duplicateOf } = upload
				? datasetFromParsed({ name: name ?? "", ...upload, types: args.types }, { existing })
				: datasetFromRows({ name: name ?? "", rows: args.rows ?? [], types: args.types }, { existing })
			if (problems.length > 0)
				return refused("Nothing was stored; fix what each problem names and send it again.", problems)
			const cells = (dataset.versions[0]?.rows.length ?? 0) * dataset.fields.length
			if (cells > MAX_CELLS)
				return refused(
					`Nothing was stored: the rows hold more than ${MAX_CELLS.toLocaleString("en-US")} cells (rows times columns), the limit for one data set. Tell the person; a smaller extract or a split file would fit.`
				)
			// The hash is a PROBABLE match; reuse only once the stored body
			// proves equal, as the editor's upload does.
			if (duplicateOf && index[duplicateOf]) {
				const stored = await api.dataset(duplicateOf)
				if (datasetsEqual(stored, dataset)) {
					const meta = index[duplicateOf]
					return ok({
						id: meta.id,
						name: meta.name,
						rowCount: rowCountOf(meta),
						fields: fieldTypesOf(fieldsOf(meta)),
						reused: true,
					})
				}
			}
			await api.putDataset(dataset)
			return ok({
				id: dataset.id,
				name: dataset.name,
				rowCount: dataset.versions[0]?.rows.length ?? 0,
				fields: fieldTypesOf(dataset.fields.map((f) => ({ name: f.name, type: f.inferredType }))),
				reused: false,
			})
		}),

		create_chart: guarded(async (args: CreateChartArgs) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			const { dataset: datasetName, datasetId, folder, folderId, picture: _picture, ...spec } = args
			const [index, themes, folders] = await Promise.all([api.datasetIndex(), api.themes(), api.folders()])
			const pre: SpecProblem[] = []
			const meta = resolveDataset(datasetName ?? datasetId, index)
			if (!meta.ok) pre.push({ path: datasetName !== undefined ? "dataset" : "datasetId", message: meta.message })
			const folderKey = "folder" in args ? "folder" : "folderId"
			const place = resolveFolder("folder" in args ? folder : folderId, folders, folderKey)
			if (!place.ok) pre.push({ path: folderKey, message: place.message })
			else if (place.value && PUBLIC_SEED_FOLDER_IDS.includes(place.value.id))
				pre.push({ path: folderKey, message: STOCK_FOLDER })
			const named = resolveThemeName(spec.themeId, themes)
			if (!named.ok) pre.push({ path: "themeId", message: named.message })
			if (!meta.ok || !place.ok || !named.ok || pre.length > 0)
				return refused("The chart wasn't created; fix what each problem names and send it again.", pre)
			const theme = named.value ?? (await defaultTheme(themes))
			const full: ChartSpec = {
				...spec,
				datasetId: meta.value.id,
				folderId: place.value?.id ?? null,
				themeId: theme.id,
			}
			const deps: ComposeDeps = {
				fields: fieldsOf(meta.value),
				theme: themeOf(theme),
				folderIds: new Set(folders.map((f) => f.id)),
				latestVersionId: meta.value.latestVersionId,
				rows: await rowsFor(meta.value, full),
			}
			const { visual, problems, warnings } = composeVisual(full, deps)
			if (problems.length > 0)
				return refused(
					"The chart wasn't created; fix what each problem names and send it again.",
					withNearestSettings(problems)
				)
			const tag = await api.putVisual(visual)
			await remember(visual, tag)
			return chartWrite(visual, warnings, { tag, updatedAt: visual.updatedAt })
		}),

		get_chart: guarded(async ({ id, picture, slice }: GetChartArgs) => {
			const badSlice = slice !== undefined && !SETTING_CATALOG.slices.includes(slice)
			// Read and noted as returned in one hold of the history, so a copy's
			// edit can't land between them; a busy history still reads.
			const readAndNote = (session?: Session) => async () => {
				const r = await api.taggedVisual(id)
				if (r && !badSlice && session) recordReturned(session, r.visual, r.tag)
				return r
			}
			let read: TaggedVisual | null
			try {
				read = await history.run((session) => readAndNote(session)())
			} catch {
				read = await readAndNote()()
			}
			if (!read) return noChart(id)
			const { visual } = read
			if (badSlice)
				return refusedAbout(visual, `"${slice}" is not a settings slice. Give one of: ${SETTING_CATALOG.slices.join(", ")}.`)
			const chartLinks = await links(visual.id)
			const settings = settingsOf(visual)
			let summary: Record<string, unknown>
			if (slice !== undefined) {
				summary = {
					id: visual.id,
					name: visual.name,
					...chartLinks,
					revision: read.tag,
					settings: { [slice]: settings[slice] ?? null },
				}
			} else {
				const encodings = Object.fromEntries(
					Object.entries(visual.encodings ?? {}).flatMap(([ch, enc]) => (enc?.field ? [[ch, enc.field]] : []))
				)
				summary = fitSettings({
					id: visual.id,
					name: visual.name,
					folderId: visual.folderId,
					datasetId: visual.datasetId,
					themeId: visual.themeId ?? null,
					encodings,
					fieldTypes: visual.fieldTypeOverrides ?? {},
					title: visual.labelsConfig?.title ?? "",
					subtitle: visual.labelsConfig?.subtitle ?? "",
					...(typeof visual.deletedAt === "number" ? { trashed: true } : {}),
					...chartLinks,
					revision: read.tag,
					settings,
				})
			}
			const result = ok(summary)
			return picture === false ? result : withPicture(result, visual.id, chartLinks.editorUrl)
		}),

		list_charts: guarded(async (args: { folder?: string | null; dataset?: string; query?: string }) => {
			const [visuals, folders] = await Promise.all([api.visuals(), api.folders()])
			const query = args.query?.trim() ? args.query : undefined
			if (args.folder === undefined && args.dataset === undefined && query === undefined)
				return ok(librarySummary(visuals, folders))
			const place = args.folder === undefined ? null : resolveFolder(args.folder, folders)
			if (place && !place.ok) return refused(place.message)
			let datasetId: string | undefined
			if (args.dataset !== undefined) {
				const meta = resolveDataset(args.dataset, await api.datasetIndex())
				if (!meta.ok) return refused(meta.message)
				datasetId = meta.value.id
			}
			return ok(
				chartListing(visuals, folders, {
					folder: place?.ok ? place.value : undefined,
					datasetId,
					query,
				})
			)
		}),

		list_datasets: guarded(async (args: { fields?: boolean; query?: string }) => {
			const q = args.query?.trim().toLowerCase() ?? ""
			const metas = Object.values(await api.datasetIndex()).filter((m) => m.name.toLowerCase().includes(q))
			return ok({
				total: metas.length,
				datasets: metas.map((m) => ({
					id: m.id,
					name: m.name,
					rows: rowCountOf(m),
					...(args.fields ? { fields: fieldTypesOf(fieldsOf(m)), latestVersionId: m.latestVersionId } : {}),
				})),
			})
		}),

		list_settings: guarded(
			async (args: { query?: string; offset?: number; chartId?: string; descriptions?: boolean }) => {
				let visual: Visual | undefined
				let palettes: Record<string, unknown> | undefined
				if (args.chartId !== undefined) {
					const read = await api.visual(args.chartId)
					if (!read) return noChart(args.chartId)
					visual = read
					const theme = themeOf(await storedTheme(read.themeId))
					// A small hint, not the theme: palette ids, and the first
					// categorical palette's colors.
					const [first] = theme.categoricalPalettes
					palettes = {
						categorical: theme.categoricalPalettes.map((p) => p.id),
						...(first ? { [first.id]: first.colors } : {}),
						text: theme.defaultTextPaletteId,
					}
				}
				const result = searchSettings({
					query: args.query,
					offset: args.offset,
					descriptions: args.descriptions,
					visual,
				})
				return ok({ ...result, ...(palettes ? { palettes } : {}) })
			}
		),

		edit_chart: guarded(async ({ id, revision, keepTheirs, patch }: EditChartArgs) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			type Outcome = { result: CallToolResult } | { visual: Visual; warnings: string[]; wrote: Written }
			const { value, historyFailed } = await locked(async (session): Promise<Outcome> => {
				let read = await api.taggedVisual(id)
				if (!read) return { result: noChart(id) }
				if (PUBLIC_SEED_FOLDER_IDS.includes(read.visual.folderId ?? ""))
					return { result: await refusedAbout(read.visual, "The chart wasn't changed.", [{ path: "", message: STOCK_FOLDER }]) }
				// What the edit is judged against: the chart at the revision sent,
				// else as the MCP last returned it; a chart no copy ever returned
				// is edited as it is now.
				const chart = session.chart(id)
				let base: Visual | undefined
				if (revision !== undefined) {
					const known = chart?.revisions.find((r) => r.tag === revision)
					base = known && session.body(known.body)
					if (!base) return { result: await refusedAbout(read.visual, UNKNOWN_REVISION) }
				} else if (chart?.baseline) {
					base = session.body(chart.baseline.body)
					if (!base) return { result: await refusedAbout(read.visual, BASELINE_GONE) }
				} else if (chart?.lostAt !== undefined || session.corruptAt !== null) {
					return { result: await refusedAbout(read.visual, BASELINE_GONE) }
				} else base = read.visual
				const ctx = await editContext(patch)
				if (ctx.wanted && !ctx.wanted.ok)
					return {
						result: await refusedAbout(read.visual, "The chart wasn't changed.", [
							{ path: "themeId", message: ctx.wanted.message },
						]),
					}
				const problemsOf = async (on: Visual, problems: SpecProblem[]) =>
					refusedAbout(
						on,
						"The chart wasn't changed; fix what each problem names and send the edit again.",
						withNearestSettings(problems)
					)
				const mine = await editOn(base, patch, ctx)
				if (mine.problems.length > 0) return { result: await problemsOf(read.visual, mine.problems) }
				const from = normalizeVisual(base)
				const ours = changedPaths(from, normalizeVisual(mine.visual))
				// One retry when a save lands between this read and the write.
				for (let attempt = 0; ; attempt++) {
					const now = normalizeVisual(read.visual)
					const theirs = changedPaths(from, now)
					const clash = conflictsOf(theirs, ours)
					if (clash.length > 0 && !keepTheirs) {
						recordNamed(session, read.visual, read.tag)
						return {
							result: await paused(read.visual, EDIT_PAUSED, describeChanges(clash, from, now), read.tag),
						}
					}
					const next = read.visual === base ? mine : await editOn(read.visual, patch, ctx)
					if (next.problems.length > 0) return { result: await problemsOf(read.visual, next.problems) }
					const visual = next.visual
					for (const root of conflictRoots(ours, theirs)) restoreAt(visual as never, now, root)
					const wrote = await saveAt(visual, read)
					if (wrote) {
						const steps = session.ensure(id).steps
						steps.push({
							id: randomUUID(),
							at: session.now(),
							before: session.put(read.visual),
							beforeTag: read.tag,
							written: session.put(visual),
							tag: wrote.tag,
						})
						if (steps.length > STEPS_KEPT) steps.splice(0, steps.length - STEPS_KEPT)
						recordReturned(session, visual, wrote.tag)
						return { visual, warnings: next.warnings, wrote }
					}
					if (attempt >= 1) return { result: await refusedAbout(read.visual, CHANGED_WHILE_SAVING) }
					read = await api.taggedVisual(id)
					if (!read) return { result: noChart(id) }
				}
			})
			if ("result" in value) return value.result
			return chartWrite(value.visual, historyFailed ? value.warnings.concat(NO_UNDO_STEP) : value.warnings, value.wrote)
		}),

		undo_chart_edit: guarded(async ({ id, revision, keepTheirs }: UndoChartArgs) => {
			type Outcome = { result: CallToolResult } | { visual: Visual; wrote: Written }
			const { value, historyFailed } = await locked(async (session): Promise<Outcome> => {
				const chart = session.chart(id)
				const step = chart?.steps.at(-1)
				if (!chart || !step) return { result: refused(NOTHING_LEFT) }
				await api.assertCurrent(CHART_COLLECTIONS)
				let read = await api.taggedVisual(id)
				if (!read) return { result: noChart(id) }
				const before = session.body(step.before)
				const written = session.body(step.written)
				if (!before || !written) {
					chart.steps.pop()
					return { result: await refusedAbout(read.visual, `${NOTHING_LEFT.replace(/:.*$/, "")}: its last step could not be read.`) }
				}
				const from = normalizeVisual(before)
				const wrote = normalizeVisual(written)
				// The settings this step's own edit changed.
				const ours = changedPaths(from, wrote)
				// A yes is bound to the pause that asked for it.
				const asked = revision === undefined ? undefined : chart.pauses.find((p) => p.revision === revision)
				const yes = asked && !asked.spent && asked.step === step.id ? asked : undefined
				const pause = async (current: TaggedVisual, now: Record<string, unknown>, clash: SettingPath[], message: string) => {
					if (current.tag !== null) {
						chart.pauses.push({ step: step.id, revision: current.tag, at: session.now() })
						recordNamed(session, current.visual, current.tag)
					}
					return { result: await paused(current.visual, message, describeChanges(clash, wrote, now), current.tag) }
				}
				for (let attempt = 0; ; attempt++) {
					const now = normalizeVisual(read.visual)
					// Changed since the edit wrote, by anyone (this MCP included).
					const theirs = changedPaths(wrote, now)
					const clash = conflictsOf(theirs, ours)
					if (asked && !yes) return pause(read, now, clash, SPENT_YES)
					let restore = ours
					if (clash.length > 0) {
						if (keepTheirs) restore = ours.filter((p) => !theirs.some((t) => overlaps(p, t)))
						else if (!yes || read.tag !== revision) return pause(read, now, clash, UNDO_PAUSED)
					}
					const next = structuredClone(read.visual) as Visual
					for (const path of restore) restoreAt(next as never, from, path)
					next.updatedAt = Date.now()
					const landed = await saveAt(next, read)
					if (landed) {
						// Spent only now its save has landed.
						chart.steps.pop()
						for (const p of chart.pauses) if (p.step === step.id) p.spent = true
						// The step below is checked against this write when nothing
						// else saved between its edit and this undo (UNDO-17).
						const below = chart.steps.at(-1)
						if (below && below.tag !== null && step.beforeTag === below.tag && read.tag === step.tag) {
							below.written = session.put(next)
							below.tag = landed.tag
						}
						recordReturned(session, next, landed.tag)
						return { visual: next, wrote: landed }
					}
					if (yes || attempt >= 1) return { result: await refusedAbout(read.visual, UNDO_CHANGED_WHILE_SAVING) }
					read = await api.taggedVisual(id)
					if (!read) return { result: noChart(id) }
				}
			})
			if ("result" in value) return value.result
			return chartWrite(value.visual, historyFailed ? [UNDO_NOT_RECORDED] : [], value.wrote)
		}),

		export_chart: guarded(async (args: ExportChartArgs) => {
			const visual = await api.visual(args.id)
			if (!visual) return noChart(args.id)
			// The name is checked before the renderer runs: a refused one starts
			// no browser and makes no folder.
			const named = checkFileName(args.fileName ?? defaultFileName(visual.name ?? ""))
			if (!named.ok)
				return refused(
					`${named.reason.replace(/\.$/, "")}. Give a plain file name with no folder, or leave fileName out for the chart's name.`
				)
			const out = await deps.renderer.exportChart(visual.id, {
				format: args.format,
				...(args.width !== undefined ? { width: args.width } : {}),
				...(args.height !== undefined ? { height: args.height } : {}),
				...(args.pixelRatio !== undefined ? { pixelRatio: args.pixelRatio } : {}),
				fileName: named.name,
			})
			if (!out.ok) {
				const { editorUrl } = await links(visual.id)
				return refused(
					`No file was written: ${out.reason.trim().replace(/\.$/, "")}. Tell the person; the editor's Export still saves it: ${editorUrl}`
				)
			}
			return ok({
				path: out.path,
				format: out.format,
				bytes: out.bytes,
				width: out.width,
				height: out.height,
				pixelRatio: out.pixelRatio,
			})
		}),

		/** The card's own tool: a held picture's base64, one slice at a time. */
		chart_picture: async ({ picture_key, offset }: { picture_key: string; offset?: number }): Promise<CallToolResult> => {
			const slice = pictures.slice(picture_key, offset ?? 0)
			if (!slice)
				return refused("That picture is no longer held. Show the chart again (get_chart) to see its picture.")
			// The text names the slice without repeating its data, so the
			// result stays one slice in size.
			const { data, ...about } = slice
			return {
				content: [{ type: "text", text: JSON.stringify({ ...about, length: data.length }) }],
				structuredContent: slice,
			}
		},
	}
}

export type Handlers = ReturnType<typeof createHandlers>

const T = TOOL_TEXT

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const
/** Draws its result in the chart card on a client with MCP Apps. */
const CARD = { ui: { resourceUri: CARD_URI } }
const CHART_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

const fieldType = z.enum(["quantitative", "categorical", "temporal", "ordinal"])
const axisShape = z
	.object({
		title: z.string().optional(),
		min: z.union([z.number(), z.string()]).nullable().optional(),
		max: z.union([z.number(), z.string()]).nullable().optional(),
		format: z.string().optional(),
	})
	.passthrough()

/** A schema with a description, or none when `text` is absent (the
 *  patch's keys are described once, on create_chart). */
const d = <S extends z.ZodTypeAny>(schema: S, text: string | undefined): S =>
	text === undefined ? schema : schema.describe(text)

/** The keys create_chart and edit_chart share. */
const sharedShape = (p?: typeof T.create_chart.params) => ({
	name: d(z.string().optional(), p?.name),
	variation: d(z.string().optional(), p?.variation),
	fieldTypes: d(z.record(z.string(), fieldType).optional(), p?.fieldTypes),
	title: d(z.string().optional(), p?.title),
	subtitle: d(z.string().optional(), p?.subtitle),
	axes: d(z.object({ x: axisShape.optional(), y: axisShape.optional() }).passthrough().optional(), p?.axes),
	stack: d(z.enum(["stack", "group", "overlay"]).optional(), p?.stack),
	themeId: d(z.string().optional(), p?.themeId),
	settings: d(z.record(z.string(), z.unknown()).optional(), p?.settings),
})

const createShape = {
	dataset: z.string().optional().describe(T.create_chart.params.dataset),
	folder: z.string().nullable().optional().describe(T.create_chart.params.folder),
	encodings: z.record(z.string(), z.string()).describe(T.create_chart.params.encodings),
	...sharedShape(T.create_chart.params),
}

const patchShape = {
	...sharedShape(),
	encodings: z.record(z.string(), z.string().nullable()).optional(),
}

/** Register every tool on `server`. Unknown keys pass through to the lib,
 *  whose problems name them (with a did-you-mean) instead of zod dropping
 *  them silently. */
export const registerTools = (
	server: McpServer,
	handlers: Handlers,
	{ showsCards = () => false }: { showsCards?: () => boolean } = {}
): void => {
	server.registerTool(
		"create_dataset",
		{
			description: T.create_dataset.description,
			inputSchema: {
				name: z.string().optional().describe(T.create_dataset.params.name),
				rows: z.array(z.record(z.string(), z.unknown())).optional().describe(T.create_dataset.params.rows),
				csv: z.string().optional().describe(T.create_dataset.params.csv),
				path: z.string().optional().describe(T.create_dataset.params.path),
				expectedRows: z.number().int().min(0).optional().describe(T.create_dataset.params.expectedRows),
				types: z.record(z.string(), fieldType).optional().describe(T.create_dataset.params.types),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		(args) => handlers.create_dataset(args)
	)
	server.registerTool(
		"create_chart",
		{
			description: T.create_chart.description,
			inputSchema: z.object(createShape).passthrough(),
			outputSchema: chartWriteShape,
			annotations: CHART_WRITE,
			_meta: CARD,
		},
		(args) => handlers.create_chart(args as unknown as CreateChartArgs)
	)
	server.registerTool(
		"edit_chart",
		{
			description: T.edit_chart.description,
			inputSchema: {
				id: z.string().describe(T.edit_chart.params.id),
				revision: z.string().optional().describe(T.edit_chart.params.revision),
				keepTheirs: z.boolean().optional().describe(T.edit_chart.params.keepTheirs),
				patch: z.object(patchShape).passthrough().describe(T.edit_chart.params.patch),
			},
			outputSchema: chartWriteShape,
			annotations: CHART_WRITE,
			_meta: CARD,
		},
		(args) => handlers.edit_chart(args as unknown as EditChartArgs)
	)
	server.registerTool(
		"undo_chart_edit",
		{
			description: T.undo_chart_edit.description,
			inputSchema: {
				id: z.string().describe(T.undo_chart_edit.params.id),
				revision: z.string().optional().describe(T.undo_chart_edit.params.revision),
				keepTheirs: z.boolean().optional().describe(T.undo_chart_edit.params.keepTheirs),
			},
			outputSchema: chartWriteShape,
			annotations: CHART_WRITE,
			_meta: CARD,
		},
		(args) => handlers.undo_chart_edit(args)
	)
	server.registerTool(
		"get_chart",
		{
			description: T.get_chart.description,
			inputSchema: {
				id: z.string().describe(T.get_chart.params.id),
				picture: z.boolean().optional().describe(T.get_chart.params.picture),
				slice: z.string().optional().describe(T.get_chart.params.slice),
			},
			annotations: READ_ONLY,
			_meta: CARD,
		},
		(args) => handlers.get_chart(args)
	)
	server.registerTool(
		"list_charts",
		{
			description: T.list_charts.description,
			inputSchema: {
				folder: z.string().nullable().optional().describe(T.list_charts.params.folder),
				dataset: z.string().optional().describe(T.list_charts.params.dataset),
				query: z.string().optional().describe(T.list_charts.params.query),
			},
			annotations: READ_ONLY,
		},
		(args) => handlers.list_charts(args)
	)
	server.registerTool(
		"list_datasets",
		{
			description: T.list_datasets.description,
			inputSchema: {
				fields: z.boolean().optional().describe(T.list_datasets.params.fields),
				query: z.string().optional().describe(T.list_datasets.params.query),
			},
			annotations: READ_ONLY,
		},
		(args) => handlers.list_datasets(args)
	)
	server.registerTool(
		"list_settings",
		{
			description: T.list_settings.description,
			inputSchema: {
				query: z.string().optional().describe(T.list_settings.params.query),
				offset: z.number().int().min(0).optional().describe(T.list_settings.params.offset),
				chartId: z.string().optional().describe(T.list_settings.params.chartId),
				descriptions: z.boolean().optional().describe(T.list_settings.params.descriptions),
			},
			annotations: READ_ONLY,
		},
		(args) => handlers.list_settings(args)
	)
	server.registerTool(
		"export_chart",
		{
			description: T.export_chart.description,
			inputSchema: {
				id: z.string().describe(T.export_chart.params.id),
				format: z.enum(["png", "jpeg", "svg", "pdf"]).describe(T.export_chart.params.format),
				width: z.number().int().positive().optional().describe(T.export_chart.params.width),
				height: z.number().int().positive().optional().describe(T.export_chart.params.height),
				pixelRatio: z.number().positive().optional().describe(T.export_chart.params.pixelRatio),
				fileName: z.string().optional().describe(T.export_chart.params.fileName),
			},
			// It writes a local file, not a chart: no output schema.
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		},
		(args) => handlers.export_chart(args)
	)
	// The card's own tool, never offered to the model, and listed (and
	// callable) only on a connection whose client announced MCP Apps.
	const picture = server.registerTool(
		"chart_picture",
		{
			description:
				"The chart card's own tool: a chart picture's base64 from offset, at most 100,000 characters per call.",
			inputSchema: {
				picture_key: z.string().describe("The pictureKey from a chart result."),
				offset: z.number().int().min(0).optional().describe("Where this slice starts; 0 when left out."),
			},
			outputSchema: {
				data: z.string(),
				offset: z.number(),
				total: z.number(),
				mimeType: z.string(),
			},
			annotations: READ_ONLY,
			_meta: { ui: { visibility: ["app"] } },
		},
		(args) => handlers.chart_picture(args)
	)
	Object.defineProperty(picture, "enabled", { get: showsCards, set: () => {}, configurable: true })
}
