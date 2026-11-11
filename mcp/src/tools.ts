/** The MCP tools. Handlers stay thin: chart logic is the editor's own lib
 *  (`chartSpec.ts`, `datasetFromRows.ts`); this file resolves what those
 *  functions need from the API and writes their result back. Every result
 *  and refusal is compact JSON; the three chart writes also return it as
 *  `structuredContent` under a declared `outputSchema`. */

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
import { datasetFromRows } from "../../src/contexts/chartBuilder/lib/datasetFromRows"
import { settingsReadRows } from "../../src/contexts/chartBuilder/lib/settingEffects"
import { PUBLIC_SEED_FOLDER_IDS } from "../../src/contexts/chartBuilder/lib/stockFolders"
import { themeOf } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { DatasetMeta, FieldType, SavedTheme, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { RefusalError, StaleVisualError, type Api } from "./api"
import { TOOL_TEXT } from "./guide"
import { chartListing, librarySummary } from "./library"
import { resolveDataset, resolveFolder, resolveThemeName, rowCountOf } from "./resolve"
import { searchSettings } from "./settingSearch"

const UNDO_DEPTH = 20

/** Served text never carries an em dash (lib docs and messages may). */
const plain = (text: string) => text.replace(/\s*—\s*/g, "; ")

const STALE =
	"The chart was changed elsewhere (in the editor, another tab, or by someone) since it was read; nothing was saved. Tell the person and ask what they want. To go ahead, read it again with get_chart and send the edit with that revision."

const STOCK_FOLDER =
	"The stock Examples folder is read-only. Save the chart in another folder or at the library root, or duplicate the example in the editor first."

/** The collections a chart write reads from and writes to. */
const CHART_COLLECTIONS = ["visuals", "datasets", "themes"] as const

const ok = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: plain(JSON.stringify(value)) }],
})

/** A chart write: the text and `structuredContent` are the same object. */
const written = (value: ChartWrite): CallToolResult => {
	const text = plain(JSON.stringify(value))
	return { content: [{ type: "text", text }], structuredContent: JSON.parse(text) }
}

const refused = (message: string, problems?: SpecProblem[]): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: plain(JSON.stringify(problems ? { message, problems } : { message })) }],
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
}

export const createHandlers = (api: Api) => {
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

	const chartWrite = async (visual: Visual, warnings: string[], wrote: Written) => {
		seen.set(visual.id, wrote)
		return written({ id: visual.id, name: visual.name, ...(await links(visual.id)), warnings, revision: wrote.tag })
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
		create_dataset: guarded(
			async (args: { name: string; rows: Record<string, unknown>[]; types?: Record<string, FieldType> }) => {
				await api.assertCurrent(["datasets"])
				const index = await api.datasetIndex()
				const { dataset, problems, duplicateOf } = datasetFromRows(args, {
					existing: Object.values(index),
				})
				if (problems.length > 0)
					return refused("The rows weren't stored; fix what each problem names and send them again.", problems)
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
			}
		),

		create_chart: guarded(async (args: CreateChartArgs) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			const { dataset: datasetName, datasetId, folder, folderId, ...spec } = args
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

		get_chart: guarded(async ({ id }: { id: string }) => {
			const read = await api.taggedVisual(id)
			if (!read) return noChart(id)
			const { visual } = read
			seen.set(id, { tag: read.tag, updatedAt: visual.updatedAt })
			const encodings = Object.fromEntries(
				Object.entries(visual.encodings ?? {}).flatMap(([ch, enc]) => (enc?.field ? [[ch, enc.field]] : []))
			)
			return ok({
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
				...(await links(visual.id)),
				revision: read.tag,
				settings: settingsOf(visual),
			})
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
			if (read.tag !== null && expected !== undefined && expected !== read.tag) return refused(STALE)
			if (PUBLIC_SEED_FOLDER_IDS.includes(base.folderId ?? ""))
				return refused("The chart wasn't changed.", [{ path: "", message: STOCK_FOLDER }])
			const meta = await datasetMeta(base.datasetId)
			// A new theme must exist; a visual whose stored theme is gone
			// renders under the default, so edit against that too. The
			// stored theme is also the baseline a re-theme diffs against, so
			// settings the user moved off it stay (as in the Theme panel).
			const themes = await api.themes()
			const wanted = typeof patch?.themeId === "string" ? resolveThemeName(patch.themeId, themes) : null
			if (wanted && !wanted.ok) return refused("The chart wasn't changed.", [{ path: "themeId", message: wanted.message }])
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
				return refused(
					"The chart wasn't changed; fix what each problem names and send the edit again.",
					withNearestSettings(problems)
				)
			const wrote = await saveIfUnchanged(visual, { tag: read.tag, updatedAt: base.updatedAt })
			if (!wrote) return refused(STALE)
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
				return refused(STALE)
			}
			// The next entry's edit wrote the chart this undo just put back, so
			// it is now checked against this write.
			const below = stack.at(-1)
			if (below) below.wrote = wrote
			return chartWrite(restored, [], wrote)
		}),
	}
}

export type Handlers = ReturnType<typeof createHandlers>

const T = TOOL_TEXT

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const
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
export const registerTools = (server: McpServer, handlers: Handlers): void => {
	server.registerTool(
		"create_dataset",
		{
			description: T.create_dataset.description,
			inputSchema: {
				name: z.string().describe(T.create_dataset.params.name),
				rows: z.array(z.record(z.string(), z.unknown())).describe(T.create_dataset.params.rows),
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
		},
		(args) => handlers.undo_chart_edit(args)
	)
	server.registerTool(
		"get_chart",
		{
			description: T.get_chart.description,
			inputSchema: { id: z.string().describe(T.get_chart.params.id) },
			annotations: READ_ONLY,
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
}
