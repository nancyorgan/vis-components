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
import { RefusalError, StaleVisualError, type Api } from "./api"
import { TOOL_TEXT } from "./guide"
import { chartListing, librarySummary } from "./library"
import { CARD_URI, createPictureStore, RESULT_LIMIT, type PictureStore } from "./pictures"
import { checkFileName, type ExportFormat, type PictureOutcome, type Renderer } from "./render"
import { resolveDataset, resolveFolder, resolveThemeName, rowCountOf } from "./resolve"
import { searchSettings } from "./settingSearch"
import { csvText, MAX_CELLS, MAX_ROWS, parseSource, readSourceFile, uploadName, type ReadHooks } from "./source"

const UNDO_DEPTH = 20

/** Served text never carries an em dash (lib docs and messages may). */
const plain = (text: string) => text.replace(/\s*—\s*/g, "; ")

const STALE =
	"The chart was changed elsewhere (in the editor, another tab, or by someone) since it was read; nothing was saved. Tell the person and ask what they want. To go ahead, read it again with get_chart and send the edit with that revision."

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
}

export const createHandlers = (api: Api, deps: HandlerDeps) => {
	const pictures = deps.pictures ?? createPictureStore()
	const showsCards = deps.showsCards ?? (() => false)

	/** Per chart: the visual each edit replaced, and what that edit wrote. */
	const undo = new Map<string, Array<{ previous: Visual; wrote: Written }>>()
	/** Per chart: the stored copy this session last wrote or read. An edit
	 *  with no revision builds on it, so a change made elsewhere since then
	 *  pauses the edit instead of being built over unseen. */
	const seen = new Map<string, Written>()

	/** Save `next` only over the stored chart still as `seen`: a conditional
	 *  PUT at its tag, so the check and the write are one step on the
	 *  server. Against an older server with no tags, the check-then-write on
	 *  `updatedAt` it always had. Null (nothing written) when the chart
	 *  changed. */
	const saveIfUnchanged = async (next: Visual, was: Written): Promise<Written | null> => {
		if (was.tag === null && (await api.visual(next.id))?.updatedAt !== was.updatedAt) return null
		try {
			return { tag: await api.putVisual(next, was.tag ?? undefined), updatedAt: next.updatedAt }
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
		seen.set(visual.id, wrote)
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

	return {
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
			return chartWrite(visual, warnings, { tag, updatedAt: visual.updatedAt })
		}),

		get_chart: guarded(async ({ id, picture, slice }: GetChartArgs) => {
			const read = await api.taggedVisual(id)
			if (!read) return noChart(id)
			const { visual } = read
			if (slice !== undefined && !SETTING_CATALOG.slices.includes(slice))
				return refusedAbout(visual, `"${slice}" is not a settings slice. Give one of: ${SETTING_CATALOG.slices.join(", ")}.`)
			seen.set(id, { tag: read.tag, updatedAt: visual.updatedAt })
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

		edit_chart: guarded(async ({ id, revision, patch }: { id: string; revision?: string; patch: ChartSpecEdit }) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			const read = await api.taggedVisual(id)
			if (!read) return noChart(id)
			const base = read.visual
			// The copy this edit builds on: the revision sent, else the one this
			// session last saw. A server with no tags can't be held to one.
			const expected = revision ?? seen.get(id)?.tag ?? undefined
			if (read.tag !== null && expected !== undefined && expected !== read.tag) return refusedAbout(base, STALE)
			if (PUBLIC_SEED_FOLDER_IDS.includes(base.folderId ?? ""))
				return refusedAbout(base, "The chart wasn't changed.", [{ path: "", message: STOCK_FOLDER }])
			const meta = await datasetMeta(base.datasetId)
			// A new theme must exist; a visual whose stored theme is gone
			// renders under the default, so edit against that too. The
			// stored theme is also the baseline a re-theme diffs against, so
			// settings the user moved off it stay (as in the Theme panel).
			const themes = await api.themes()
			const wanted = typeof patch?.themeId === "string" ? resolveThemeName(patch.themeId, themes) : null
			if (wanted && !wanted.ok)
				return refusedAbout(base, "The chart wasn't changed.", [{ path: "themeId", message: wanted.message }])
			const current = await storedTheme(base.themeId)
			const theme = wanted?.ok && wanted.value ? wanted.value : current
			const edit = wanted?.ok && wanted.value ? { ...patch, themeId: theme.id } : (patch ?? {})
			const { visual, problems, warnings } = editVisual(base, edit, {
				fields: meta ? fieldsOf(meta) : [],
				theme: themeOf(theme),
				fromTheme: themeOf(current),
				latestVersionId: meta?.latestVersionId ?? null,
				rows: await rowsFor(meta, edit, base),
			})
			if (problems.length > 0)
				return refusedAbout(
					base,
					"The chart wasn't changed; fix what each problem names and send the edit again.",
					withNearestSettings(problems)
				)
			const wrote = await saveIfUnchanged(visual, { tag: read.tag, updatedAt: base.updatedAt })
			if (!wrote) return refusedAbout(base, STALE)
			const stack = undo.get(id) ?? []
			stack.push({ previous: base, wrote })
			if (stack.length > UNDO_DEPTH) stack.shift()
			undo.set(id, stack)
			return chartWrite(visual, warnings, wrote)
		}),

		undo_chart_edit: guarded(async ({ id }: { id: string }) => {
			const stack = undo.get(id) ?? []
			const entry = stack.pop()
			if (!entry)
				return refused(
					`Nothing to undo for "${id}": this session made no edit to it that is still undone. Change it back with edit_chart instead.`
				)
			const restored = { ...entry.previous, updatedAt: Date.now() }
			let wrote: Written | null
			try {
				await api.assertCurrent(CHART_COLLECTIONS)
				wrote = await saveIfUnchanged(restored, entry.wrote)
			} catch (error) {
				stack.push(entry)
				throw error
			}
			if (!wrote) {
				stack.push(entry)
				return refusedAbout(entry.previous, STALE)
			}
			// The next entry's edit wrote the chart this undo just put back, so
			// it is now checked against this write.
			const below = stack.at(-1)
			if (below) below.wrote = wrote
			return chartWrite(restored, [], wrote)
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
				patch: z.object(patchShape).passthrough().describe(T.edit_chart.params.patch),
			},
			outputSchema: chartWriteShape,
			annotations: CHART_WRITE,
			_meta: CARD,
		},
		(args) => handlers.edit_chart(args as unknown as { id: string; revision?: string; patch: ChartSpecEdit })
	)
	server.registerTool(
		"undo_chart_edit",
		{
			description: T.undo_chart_edit.description,
			inputSchema: { id: z.string().describe(T.undo_chart_edit.params.id) },
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
