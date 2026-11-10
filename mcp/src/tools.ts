/** The MCP tools. Handlers stay thin: chart logic is the editor's own lib
 *  (`chartSpec.ts`, `datasetFromRows.ts`); this file resolves what those
 *  functions need from the API and writes their result back. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { SETTING_CATALOG } from "../../src/contexts/chartBuilder/lib/applySettings"
import { settingsReadRows } from "../../src/contexts/chartBuilder/lib/settingEffects"
import { PUBLIC_SEED_FOLDER_IDS } from "../../src/contexts/chartBuilder/lib/stockFolders"
import {
	chartSpecVocabulary,
	composeVisual,
	editVisual,
	SPEC_KEYS,
	type ChartSpec,
	type ChartSpecEdit,
	type ComposeDeps,
	type SpecProblem,
} from "../../src/contexts/chartBuilder/lib/chartSpec"
import { datasetsEqual } from "../../src/contexts/chartBuilder/lib/datasetDedupe"
import { datasetFromRows } from "../../src/contexts/chartBuilder/lib/datasetFromRows"
import { didYouMean } from "../../src/contexts/chartBuilder/lib/didYouMean"
import { settingKeysOf } from "../../src/contexts/chartBuilder/lib/settingKeys"
import { themeOf } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type {
	DatasetMeta,
	FieldType,
	SavedTheme,
	Visual,
} from "../../src/contexts/chartBuilder/lib/types"
import type { Api } from "./api"
import { AGENT_GUIDE } from "./guide"

const UNDO_DEPTH = 20

/** list_settings returns at most this many rows. */
const SETTINGS_ROW_CAP = 200

const STALE =
	"the chart changed in the editor since it was read; read it again and resend"

/** The collections a chart write reads from and writes to. */
const CHART_COLLECTIONS = ["visuals", "datasets", "themes"] as const

const ok = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
})

const refused = (message: string, problems?: SpecProblem[]): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: JSON.stringify(problems ? { message, problems } : { message }, null, 2) }],
})

/** A thrown error (HTTP failure, content-version mismatch) as tool output. */
const guarded =
	<A>(handler: (args: A) => Promise<CallToolResult>) =>
	async (args: A): Promise<CallToolResult> => {
		try {
			return await handler(args)
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error))
		}
	}

/** A data set's fields at its latest version, with their effective types. */
const fieldsOf = (meta: DatasetMeta): Array<{ name: string; type: FieldType }> => {
	const latest = meta.versions.find((v) => v.id === meta.latestVersionId)
	return (latest?.fields ?? meta.fields).map((f) => ({ name: f.name, type: f.inferredType }))
}

const datasetSummary = (meta: DatasetMeta) => ({
	id: meta.id,
	name: meta.name,
	fields: fieldsOf(meta),
	rowCount: meta.versions.find((v) => v.id === meta.latestVersionId)?.rowCount ?? 0,
	latestVersionId: meta.latestVersionId,
})

/** A theme name with case, spaces and punctuation taken out. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** The stored visual's settings slices (absent ones left out). */
const settingsOf = (visual: Visual) =>
	Object.fromEntries(
		SETTING_CATALOG.slices.flatMap((slice) => {
			const value = (visual as Record<string, unknown>)[slice]
			return value === undefined ? [] : [[slice, value]]
		})
	)

export const createHandlers = (api: Api) => {
	/** Per chart: the visual each edit replaced, and the `updatedAt` it wrote. */
	const undo = new Map<string, Array<{ previous: Visual; wrote: number }>>()

	/** True when the stored chart's `updatedAt` is still `seen`. */
	const unchangedSince = async (id: string, seen: number) =>
		(await api.visual(id))?.updatedAt === seen

	const links = async (id: string) => {
		const base = await api.baseUrl()
		return {
			editorUrl: `${base}/editor/${encodeURIComponent(id)}`,
			embedUrl: `${base}/embed/${encodeURIComponent(id)}`,
			pictureUrl: `${base}/embed/${encodeURIComponent(id)}?export=png`,
		}
	}

	const chartResult = async (visual: Visual, warnings: string[]) =>
		ok({ id: visual.id, name: visual.name, ...(await links(visual.id)), warnings })

	/** The theme a spec names (id, else a unique name match), else the
	 *  server's default-theme row, else the first system theme. A name that
	 *  matches nothing is a problem. */
	const resolveTheme = async (wanted: string | undefined): Promise<SavedTheme | SpecProblem> => {
		const themes = await api.themes()
		if (wanted !== undefined) {
			const byName = themes.filter((t) => nameKey(t.name) === nameKey(wanted))
			const hit = themes.find((t) => t.id === wanted) ?? (byName.length === 1 ? byName[0] : undefined)
			if (hit) return hit
			return {
				path: "themeId",
				message: `no theme "${wanted}"; themes are ${themes.map((t) => `"${t.name}" (${t.id})`).join(", ")}`,
			}
		}
		return defaultTheme(themes)
	}

	const defaultTheme = async (themes?: SavedTheme[]): Promise<SavedTheme> => {
		const [all, defaultId] = await Promise.all([themes ?? api.themes(), api.defaultThemeId()])
		return all.find((t) => t.id === defaultId) ?? all[0]
	}

	/** The latest version's rows, only for a settings patch that reads them. */
	const rowsFor = async (meta: DatasetMeta | undefined, settings: unknown) => {
		if (!meta || !settingsReadRows(settings)) return undefined
		const body = await api.dataset(meta.id)
		return body.versions.find((v) => v.id === meta.latestVersionId)?.rows
	}

	const datasetMeta = async (datasetId: string | null): Promise<DatasetMeta | undefined> =>
		datasetId ? (await api.datasetIndex())[datasetId] : undefined

	const saveEdit = async (base: Visual, next: Visual, warnings: string[]) => {
		if (!(await unchangedSince(base.id, base.updatedAt))) return refused(STALE)
		await api.putVisual(next)
		const stack = undo.get(base.id) ?? []
		stack.push({ previous: base, wrote: next.updatedAt })
		if (stack.length > UNDO_DEPTH) stack.shift()
		undo.set(base.id, stack)
		return chartResult(next, warnings)
	}

	return {
		agent_guide: guarded(async () => ({ content: [{ type: "text", text: AGENT_GUIDE }] })),

		chart_vocabulary: guarded(async () => {
			const [folders, themes] = await Promise.all([api.folders(), api.themes()])
			const fallback = (await defaultTheme(themes)).id
			return ok({
				...chartSpecVocabulary(),
				folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
				themes: themes.map((t) => ({ id: t.id, name: t.name, default: t.id === fallback })),
			})
		}),

		list_datasets: guarded(async () =>
			ok(Object.values(await api.datasetIndex()).map(datasetSummary))
		),

		create_dataset: guarded(
			async (args: { name: string; rows: Record<string, unknown>[]; types?: Record<string, FieldType> }) => {
				await api.assertCurrent(["datasets"])
				const index = await api.datasetIndex()
				const { dataset, problems, duplicateOf } = datasetFromRows(args, {
					existing: Object.values(index),
				})
				if (problems.length > 0) return refused("the rows can't be stored as a data set", problems)
				// The hash is a PROBABLE match; reuse only once the stored body
				// proves equal, as the editor's upload does.
				if (duplicateOf && index[duplicateOf]) {
					const stored = await api.dataset(duplicateOf)
					if (datasetsEqual(stored, dataset))
						return ok({ ...datasetSummary(index[duplicateOf]), reused: true })
				}
				await api.putDataset(dataset)
				return ok({
					id: dataset.id,
					name: dataset.name,
					fields: dataset.fields.map((f) => ({ name: f.name, type: f.inferredType })),
					rowCount: dataset.versions[0]?.rows.length ?? 0,
				})
			}
		),

		create_chart: guarded(async (spec: ChartSpec) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			const [meta, theme, folders] = await Promise.all([
				datasetMeta(typeof spec.datasetId === "string" ? spec.datasetId : null),
				resolveTheme(spec.themeId),
				api.folders(),
			])
			const pre: SpecProblem[] = []
			if (!meta) pre.push({ path: "datasetId", message: `no data set with id "${spec.datasetId}"; see list_datasets` })
			if (typeof spec.folderId === "string" && PUBLIC_SEED_FOLDER_IDS.includes(spec.folderId))
				pre.push({ path: "folderId", message: STOCK_FOLDER })
			if (!("id" in theme)) pre.push(theme)
			if (pre.length > 0 || !meta || !("id" in theme)) return refused("the chart wasn't created", pre)
			const deps: ComposeDeps = {
				fields: fieldsOf(meta),
				theme: themeOf(theme),
				folderIds: new Set(folders.map((f) => f.id)),
				latestVersionId: meta.latestVersionId,
				rows: await rowsFor(meta, spec.settings),
			}
			const { visual, problems, warnings } = composeVisual({ ...spec, themeId: theme.id }, deps)
			if (problems.length > 0) return refused("the chart wasn't created", problems)
			await api.putVisual(visual)
			return chartResult(visual, warnings)
		}),

		get_chart: guarded(async ({ id }: { id: string }) => {
			const visual = await api.visual(id)
			if (!visual) return refused(`no chart with id "${id}"`)
			const encodings = Object.fromEntries(
				Object.entries(visual.encodings ?? {}).flatMap(([ch, enc]) =>
					enc?.field ? [[ch, enc.field]] : []
				)
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
				...(visual.deletedAt ? { trashed: true } : {}),
				...(await links(visual.id)),
				settings: settingsOf(visual),
			})
		}),

		list_settings: guarded(
			async ({ slice, query, chartId }: { slice?: string; query?: string; chartId?: string }) => {
				const { slices, paths } = SETTING_CATALOG
				if (slice !== undefined && !slices.includes(slice))
					return refused(`no settings slice "${slice}"${didYouMean(slice, slices)}; slices are ${slices.join(", ")}`)
				const q = query?.trim().toLowerCase() ?? ""
				const rows = Object.entries(paths)
					.filter(
						([path, entry]) =>
							(slice === undefined || path === slice || path.startsWith(`${slice}.`)) &&
							(q === "" || `${path} ${entry.doc ?? ""}`.toLowerCase().includes(q))
					)
					.map(([path, entry]) => ({ path, ...entry }))
				// With a chart: the keys its `*` paths take, and its theme's palettes.
				let keys: unknown
				let palettes: unknown
				if (chartId !== undefined) {
					const visual = await api.visual(chartId)
					if (!visual) return refused(`no chart with id "${chartId}"`)
					const meta = await datasetMeta(visual.datasetId)
					const body = meta ? await api.dataset(meta.id) : null
					const dataRows = body?.versions.find((v) => v.id === meta?.latestVersionId)?.rows ?? []
					keys = settingKeysOf(visual, meta ? fieldsOf(meta) : [], dataRows)
					const named = await resolveTheme(visual.themeId)
					const theme = themeOf("id" in named ? named : await defaultTheme())
					const list = (pals: SavedTheme["categoricalPalettes"]) =>
						pals.map((p) => ({ id: p.id, name: p.name, colors: p.colors }))
					palettes = {
						note: "For a color, prefer a palette id (where the setting takes one) or a color from these palettes over an arbitrary hex.",
						categorical: list(theme.categoricalPalettes),
						ordinal: list(theme.ordinalPalettes),
						text: theme.defaultTextPaletteId,
						fill: theme.defaultFillPaletteId ?? null,
					}
				}
				return ok({
					total: rows.length,
					rows: rows.slice(0, SETTINGS_ROW_CAP),
					...(rows.length > SETTINGS_ROW_CAP
						? { note: `showing ${SETTINGS_ROW_CAP} of ${rows.length}; narrow the query` }
						: {}),
					...(keys !== undefined ? { keys } : {}),
					...(palettes !== undefined ? { palettes } : {}),
				})
			}
		),

		edit_chart: guarded(async ({ id, patch }: { id: string; patch: ChartSpecEdit }) => {
			await api.assertCurrent(CHART_COLLECTIONS)
			const base = await api.visual(id)
			if (!base) return refused(`no chart with id "${id}"`)
			if (PUBLIC_SEED_FOLDER_IDS.includes(base.folderId ?? ""))
				return refused("the chart wasn't changed", [{ path: "", message: STOCK_FOLDER }])
			const meta = await datasetMeta(base.datasetId)
			// A new theme must exist; a visual whose stored theme is gone
			// renders under the default, so edit against that too. The
			// stored theme is also the baseline a re-theme diffs against, so
			// settings the user moved off it stay (as in the Theme panel).
			const wanted = typeof patch.themeId === "string" ? await resolveTheme(patch.themeId) : null
			if (wanted && !("id" in wanted)) return refused("the chart wasn't changed", [wanted])
			const stored = await resolveTheme(base.themeId)
			const current = "id" in stored ? stored : await defaultTheme()
			const theme = wanted ?? current
			const edit = wanted ? { ...patch, themeId: theme.id } : patch
			const { visual, problems, warnings } = editVisual(base, edit, {
				fields: meta ? fieldsOf(meta) : [],
				theme: themeOf(theme),
				fromTheme: themeOf(current),
				latestVersionId: meta?.latestVersionId ?? null,
				rows: await rowsFor(meta, patch.settings),
			})
			if (problems.length > 0) return refused("the chart wasn't changed", problems)
			return saveEdit(base, visual, warnings)
		}),

		undo_chart_edit: guarded(async ({ id }: { id: string }) => {
			const entry = undo.get(id)?.pop()
			if (!entry) return refused(`nothing to undo for "${id}" in this session`)
			const restored = { ...entry.previous, updatedAt: Date.now() }
			try {
				await api.assertCurrent(CHART_COLLECTIONS)
				if (!(await unchangedSince(id, entry.wrote))) {
					undo.get(id)?.push(entry)
					return refused(STALE)
				}
				await api.putVisual(restored)
			} catch (error) {
				undo.get(id)?.push(entry)
				throw error
			}
			return chartResult(restored, [])
		}),
	}
}

export type Handlers = ReturnType<typeof createHandlers>

const STOCK_FOLDER =
	"the stock Examples folder is read-only; create the chart in another folder (or null), or duplicate the example in the editor first"

const ENCODINGS_FIRST =
	"Zafiro is encodings-first: you say which field goes to which channel (x, y, hue, length, …) and the chart type follows from that."

const specShape = {
	datasetId: z.string().describe(SPEC_KEYS.datasetId),
	folderId: z.string().nullable().describe(SPEC_KEYS.folderId),
	name: z.string().optional().describe(SPEC_KEYS.name),
	family: z.string().optional().describe(SPEC_KEYS.family),
	variation: z.string().optional().describe(SPEC_KEYS.variation),
	encodings: z.record(z.string(), z.string()).describe(SPEC_KEYS.encodings),
	fieldTypes: z.record(z.string(), z.string()).optional().describe(SPEC_KEYS.fieldTypes),
	title: z.string().optional().describe(SPEC_KEYS.title),
	subtitle: z.string().optional().describe(SPEC_KEYS.subtitle),
	axes: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe(SPEC_KEYS.axes),
	stack: z.string().optional().describe(SPEC_KEYS.stack),
	themeId: z.string().optional().describe(`${SPEC_KEYS.themeId} A theme name works too.`),
	settings: z.record(z.string(), z.unknown()).optional().describe(SPEC_KEYS.settings),
}

const { datasetId: _d, folderId: _f, variation: _v, ...editShape } = specShape

const SETTINGS_RULES =
	"`settings` sets any stored setting by list_settings paths: objects merge, lists replace whole (send every entry; a new entry leaves out id). A setting behaves as the editor's panel does: a new annotation gets the theme's style and a name, data-label value fields get their labels, an Order by spec computes the order, a palette id brings its colors, thickness by field seeds every level, numbers clamp to the input's range, and a value equal to its default is stored as unset."

/** Register every tool on `server`. Unknown keys pass through to the lib,
 *  whose problems name them (with a did-you-mean) instead of zod dropping
 *  them silently. */
export const registerTools = (server: McpServer, handlers: Handlers): void => {
	server.registerTool(
		"agent_guide",
		{
			description:
				"The guide for making charts in Zafiro: the primary comparison, encodings by data type, what each set of encodings draws, titles, colors and the refusals to make. Read all of it before the first chart.",
		},
		() => handlers.agent_guide(undefined)
	)
	server.registerTool(
		"chart_vocabulary",
		{
			description: `What a chart spec can say: channels with the field types they accept, chart families and their variations, spec keys, folders and themes. ${ENCODINGS_FIRST} Call this first.`,
		},
		() => handlers.chart_vocabulary(undefined)
	)
	server.registerTool(
		"list_datasets",
		{
			description:
				"The data sets on this Zafiro server: id, name, fields with their types, row count and latest version. Charts are built from these fields.",
		},
		() => handlers.list_datasets(undefined)
	)
	server.registerTool(
		"create_dataset",
		{
			description:
				"Store rows (an array of flat objects) as a new Zafiro data set and return its id and inferred field types; identical data already stored under the same name is reused instead.",
			inputSchema: {
				name: z.string().describe("The data set's name."),
				rows: z.array(z.record(z.string(), z.unknown())).describe("Rows as objects: column → text, number, boolean or null."),
				types: z
					.record(z.string(), z.enum(["quantitative", "categorical", "temporal", "ordinal"]))
					.optional()
					.describe("Column → type, overriding inference."),
			},
		},
		(args) => handlers.create_dataset(args)
	)
	server.registerTool(
		"create_chart",
		{
			description: `Create a Zafiro chart from a spec and return its editor, embed and picture links. ${ENCODINGS_FIRST} ${SETTINGS_RULES} Problems come back as an error and nothing is saved.`,
			inputSchema: z.object(specShape).passthrough(),
		},
		(args) => handlers.create_chart(args as unknown as ChartSpec)
	)
	server.registerTool(
		"get_chart",
		{
			description:
				"A Zafiro chart's summary (name, folder, data set, channel → field encodings, titles, links) and its stored `settings` slices, with list entries' ids.",
			inputSchema: { id: z.string().describe("The chart id.") },
		},
		(args) => handlers.get_chart(args)
	)
	server.registerTool(
		"edit_chart",
		{
			description: `Change a Zafiro chart: only the keys the patch names change (a null encoding unmaps the channel, a null axis bound clears it; a themeId re-themes it, keeping user overrides). ${ENCODINGS_FIRST} ${SETTINGS_RULES} Refused if the chart changed in the editor since it was read.`,
			inputSchema: {
				id: z.string().describe("The chart id."),
				patch: z
					.object({
						...editShape,
						encodings: z
							.record(z.string(), z.string().nullable())
							.optional()
							.describe(SPEC_KEYS.encodings),
					})
					.passthrough(),
			},
		},
		(args) => handlers.edit_chart(args as unknown as { id: string; patch: ChartSpecEdit })
	)
	server.registerTool(
		"list_settings",
		{
			description:
				"The stored settings a `settings` patch can set: path, kinds, allowed values, doc, and color / format flags. In a path, `*` stands for a key you take from the chart (a level, field or panel) and `[]` for a list entry; lists replace whole. Filter by slice and a text query. With a chartId, also returns the keys that chart's `*` paths take (its fields, the levels of each mapped field, its composed label ids, facet panels and table columns) and its theme's palettes: prefer those colors to arbitrary hex.",
			inputSchema: {
				slice: z.string().optional().describe("One slice, such as channelConfigs or labelsConfig."),
				query: z.string().optional().describe("Case-insensitive text matched against path and doc."),
				chartId: z.string().optional().describe("A chart whose keys and theme palettes to include."),
			},
		},
		(args) => handlers.list_settings(args)
	)
	server.registerTool(
		"undo_chart_edit",
		{
			description:
				"Undo the last edit_chart on this chart made in this session (up to 20 deep). Refused if the chart changed in the editor since that edit.",
			inputSchema: { id: z.string().describe("The chart id.") },
		},
		(args) => handlers.undo_chart_edit(args)
	)
}
