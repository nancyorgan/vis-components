/** Chart specs: a short, encodings-first description of a chart that a
 * program (the MCP package) sends, turned into EXACTLY the Visual row the
 * editor would save. Everything a spec leaves out comes from the editor's
 * own new-visual draft and the theme; everything it names is written to the
 * config keys the sidebar panels write. Pure: no store, no server. */

import { applySettings } from "./applySettings"
import type { AxisConfig, ChannelConfigs, StackMode } from "./channelConfig"
import { ALL_ENCODING_CHANNELS, CHANNELS, channelsConflict } from "./channels"
import { didYouMean } from "./didYouMean"
import { foldFlowNodeTitles } from "./foldFlowNodeTitles"
import { formatSpecProblem } from "./formatTick"
import { parseLocalDate } from "./localDate"
import { UNTITLED_VISUAL_NAME } from "./nameUniqueness"
import { scaffoldVariation, type ChannelAssignment } from "./quickStart"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "./quickStartVariations"
import { structureVisualKeys } from "./savedKeyStructure"
import { seedHueChannel, seedOutlineHueChannel } from "./seedColorSlot"
import { axisConfigFromTheme } from "./themeConfig"
import {
	rethemeCaption,
	rethemeChannelConfigs,
	rethemeDataLabels,
	rethemeDataTable,
	rethemeLabels,
	rethemeLegend,
	rethemeMap,
	rethemeTooltip,
} from "./themeSwitch"
import type { EncodingChannel, FieldType, Theme, Visual } from "./types"
import { hydrateVisual, newVisualDraft, newVisualId } from "./visualDefaults"
import { isTemplate, isTrashed } from "./visualTrash"

/** Every channel except the legacy `text`, which data labels replaced. */
export type SpecChannel = Exclude<EncodingChannel, "text">

export type AxisSpec = {
	/** Axis title; "" draws none, absent falls back to the field name. */
	title?: string
	/** A number, or on a temporal axis a date ("2020-01-01") or epoch ms. */
	min?: number | string
	max?: number | string
	/** The Format box's string (d3-format / d3-time-format). */
	format?: string
}

export type ChartSpec = {
	datasetId: string
	/** null = the library root. */
	folderId: string | null
	name?: string
	family?: QuickStartChartType
	variation?: string
	/** Channel → field name. */
	encodings: Partial<Record<SpecChannel, string>>
	/** Field-type overrides, as the Fields panel sets them. */
	fieldTypes?: Record<string, FieldType>
	title?: string
	subtitle?: string
	axes?: { x?: AxisSpec; y?: AxisSpec }
	stack?: StackMode
	themeId?: string
	/** Any stored setting, by the paths of `settingCatalog.json`; applied
	 * last (`applySettings`). */
	settings?: Record<string, unknown>
}

/** An edit: the spec's chart-level keys, every one optional. A null
 * encoding unmaps the channel; a null bound clears it; a `themeId`
 * re-themes the chart the way the Theme panel does. */
export type ChartSpecEdit = Partial<
	Omit<ChartSpec, "datasetId" | "folderId" | "variation" | "encodings" | "axes">
> & {
	encodings?: Partial<Record<SpecChannel, string | null>>
	axes?: Partial<
		Record<
			"x" | "y",
			Omit<AxisSpec, "min" | "max"> & { min?: number | string | null; max?: number | string | null }
		>
	>
}

/** Where (`encodings.x`, `axes.y.min`; "" for the whole body) and what. */
export type SpecProblem = { path: string; message: string }

export type ComposeDeps = {
	/** The dataset's fields with their effective types. */
	fields: ReadonlyArray<{ name: string; type: FieldType }>
	/** The theme the result is styled under: on an edit naming `themeId`,
	 * the theme that id names. */
	theme: Theme
	/** On an edit naming `themeId`: the theme the visual is styled under
	 * BEFORE the edit (the one its stored `themeId` names, else the
	 * default). Lets the re-theme keep every setting the user moved off
	 * that theme, as the Theme panel does; absent, every theme-driven
	 * field follows the new theme. */
	fromTheme?: Theme
	/** When given, a `folderId` outside it is a problem. */
	folderIds?: ReadonlySet<string>
	/** The dataset's latest version, stamped as `createdAtVersionId` the way
	 * the editor's first save stamps it. */
	latestVersionId?: string | null
	/** The data set's rows, for the settings whose effects read them (an
	 * "Order by" spec, thickness by field, facet counts; see
	 * `settingsReadRows`). */
	rows?: ReadonlyArray<Record<string, string>>
	now?: number
}

export type ComposeResult = {
	visual: Visual
	problems: SpecProblem[]
	warnings: string[]
}

export const SPEC_KEYS: Readonly<Record<keyof ChartSpec, string>> = {
	datasetId: "Required. The data set to chart.",
	folderId: "Required. A folder id, or null for the library root.",
	name: `The visual's name; falls back to title, then "${UNTITLED_VISUAL_NAME}".`,
	family: "A quick-start chart family the encodings should make.",
	variation: "One of the family's variations, by name.",
	encodings: "Required. Channel → field name (null unmaps, in an edit).",
	fieldTypes: "Field → type overrides, as the Fields panel sets them.",
	title: "The chart title.",
	subtitle: "The chart subtitle.",
	axes: "{x, y}, each {title, min, max, format}; min/max are dates on a temporal axis.",
	stack: `"stack", "group" or "overlay" for the hue levels.`,
	themeId:
		"The theme id the visual is styled under; on an edit, re-themes it as the Theme panel does (user overrides stay).",
	settings:
		"Any stored setting: slice → nested values, by list_settings paths. Objects merge; lists replace whole. Applied last.",
}
const CREATE_ONLY = new Set(["datasetId", "folderId", "variation"])

/** Maps need value-based region detection and flows a target column, which
 * only the editor sets up. */
const UNSUPPORTED_FAMILIES: readonly QuickStartChartType[] = ["map", "sankey", "chord"]
const SPEC_FAMILIES = QUICK_START_CHART_TYPES.filter((f) => !UNSUPPORTED_FAMILIES.includes(f))
const SPEC_CHANNELS = ALL_ENCODING_CHANNELS.filter((c): c is SpecChannel => c !== "text")
const FIELD_TYPES: readonly FieldType[] = ["quantitative", "categorical", "temporal", "ordinal"]
const STACK_MODES: readonly StackMode[] = ["stack", "group", "overlay"]
const AXIS_KEYS = ["title", "min", "max", "format"]

/** What a client may send: channels, families and variations, spec keys. */
export const chartSpecVocabulary = () => ({
	channels: SPEC_CHANNELS.map((c) => ({ name: c, accepts: [...CHANNELS[c].accepts] })),
	families: SPEC_FAMILIES.map((f) => ({
		name: f,
		variations: QUICK_START_VARIATIONS[f].map((v) => ({
			name: v.name,
			channels: v.channels,
			...(v.optional ? { optional: v.optional } : {}),
		})),
	})),
	specKeys: { ...SPEC_KEYS } as Record<string, string>,
})

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)
const quoted = (list: readonly string[]) => list.map((s) => `"${s}"`).join(", ")
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v)

/** Shape problems: unknown keys and channels, wrong value types. */
const shapeProblems = (input: unknown, edit: boolean): SpecProblem[] => {
	const out: SpecProblem[] = []
	const bad = (path: string, message: string) => out.push({ path, message })
	if (!isObj(input)) return [{ path: "", message: "the body must be a JSON object" }]
	const keys = Object.keys(SPEC_KEYS).filter((k) => !edit || !CREATE_ONLY.has(k))
	for (const k of Object.keys(input)) {
		if (!keys.includes(k)) bad(k, `unknown key "${k}"${didYouMean(k, keys)}`)
	}
	if (!edit) {
		if (typeof input.datasetId !== "string" || input.datasetId === "")
			bad("datasetId", `"datasetId" must be a non-empty string`)
		if (input.folderId !== null && typeof input.folderId !== "string")
			bad("folderId", `"folderId" must be a folder id or null`)
		if (!isObj(input.encodings)) bad("encodings", `"encodings" is required: channel → field name`)
	}
	for (const k of ["name", "title", "subtitle", "variation", "themeId"]) {
		if (input[k] !== undefined && typeof input[k] !== "string") bad(k, `"${k}" must be a string`)
	}
	if (input.family !== undefined && !oneOf(QUICK_START_CHART_TYPES, input.family))
		bad("family", `unknown family; families are ${quoted(SPEC_FAMILIES)}`)
	else if (UNSUPPORTED_FAMILIES.includes(input.family as QuickStartChartType))
		bad(
			"family",
			`a "${String(input.family)}" chart can't be made from a spec yet; build it in the editor`
		)
	if (input.stack !== undefined && !oneOf(STACK_MODES, input.stack))
		bad("stack", `"stack" must be one of ${quoted(STACK_MODES)}`)
	if (input.encodings !== undefined && !isObj(input.encodings))
		bad("encodings", `"encodings" must be an object`)
	for (const [ch, field] of Object.entries(isObj(input.encodings) ? input.encodings : {})) {
		if (!oneOf(SPEC_CHANNELS, ch))
			bad(`encodings.${ch}`, `unknown channel "${ch}"${didYouMean(ch, SPEC_CHANNELS)}`)
		else if (!(typeof field === "string" && field !== "") && !(edit && field === null))
			bad(`encodings.${ch}`, edit ? "must name a field, or be null to unmap" : "must name a field")
	}
	if (input.fieldTypes !== undefined && !isObj(input.fieldTypes))
		bad("fieldTypes", "must map field → type")
	for (const [f, t] of Object.entries(isObj(input.fieldTypes) ? input.fieldTypes : {})) {
		if (!oneOf(FIELD_TYPES, t)) bad(`fieldTypes.${f}`, `types are ${quoted(FIELD_TYPES)}`)
	}
	if (input.settings !== undefined && !isObj(input.settings))
		bad("settings", `"settings" must be an object: slice → values`)
	if (input.axes !== undefined && !isObj(input.axes)) bad("axes", `"axes" must be {x, y}`)
	for (const [axis, spec] of Object.entries(isObj(input.axes) ? input.axes : {})) {
		if (axis !== "x" && axis !== "y") {
			bad(`axes.${axis}`, `axes are "x" and "y"`)
			continue
		}
		if (!isObj(spec)) {
			bad(`axes.${axis}`, "must be an object")
			continue
		}
		for (const [k, v] of Object.entries(spec)) {
			const path = `axes.${axis}.${k}`
			if (!AXIS_KEYS.includes(k)) bad(path, `unknown axis key "${k}"${didYouMean(k, AXIS_KEYS)}`)
			else if ((k === "title" || k === "format") && typeof v !== "string")
				bad(path, "must be a string")
			else if (k === "format") {
				const why = formatSpecProblem(v as string)
				if (why) bad(path, why)
			}
			else if (
				(k === "min" || k === "max") &&
				!(edit && v === null) &&
				typeof v !== "string" &&
				!Number.isFinite(v)
			)
				bad(path, "must be a finite number, or a date string on a temporal axis")
		}
	}
	return out
}

/** The family's variation: by name, else the one these encodings fill with
 * the most channels (ties to the first listed, as on the quick-start bar). */
const pickVariation = (
	family: QuickStartChartType,
	name: string | undefined,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (f: string) => FieldType | undefined
): QuickStartVariation | string => {
	const all = QUICK_START_VARIATIONS[family]
	const unfilled = (v: QuickStartVariation) =>
		(Object.entries(v.channels) as Array<[SpecChannel, readonly FieldType[]]>)
			.filter(([ch, types]) => {
				if (!fields[ch]) return !v.optional?.includes(ch)
				const t = typeOf(fields[ch])
				return !t || !types.includes(t)
			})
			.map(([ch, types]) => `"${ch}" (${types.join(" or ")})`)
	if (name !== undefined) {
		const v = all.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
		const names = all.map((x) => x.name)
		if (!v)
			return `no "${name}" variation of "${family}"${didYouMean(name, names)} (variations: ${quoted(names)})`
		const missing = unfilled(v)
		return missing.length > 0 ? `"${v.name}" needs ${missing.join(", ")}` : v
	}
	const fits = all.filter((v) => unfilled(v).length === 0)
	const best = fits.reduce<QuickStartVariation | undefined>(
		(a, v) => (!a || Object.keys(v.channels).length > Object.keys(a.channels).length ? v : a),
		undefined
	)
	return (
		best ??
		`these encodings make no "${family}" variation (variations: ${quoted(all.map((v) => v.name))})`
	)
}

/** Checks and writes shared by create and edit: field existence and type fit,
 * channel conflicts, stack, titles, axes. Mutates `out`. */
const applyCommon = (
	spec: ChartSpecEdit,
	visual: Visual,
	deps: ComposeDeps,
	out: { problems: SpecProblem[]; warnings: string[] }
): Visual => {
	const known = new Map(deps.fields.map((f) => [f.name, f.type]))
	const names = [...known.keys()]
	const overrides = { ...visual.fieldTypeOverrides, ...spec.fieldTypes }
	const typeOf = (f: string) => overrides[f] ?? known.get(f)
	const bad = (path: string, message: string) => out.problems.push({ path, message })
	for (const f of Object.keys(spec.fieldTypes ?? {})) {
		if (!known.has(f)) bad(`fieldTypes.${f}`, `no field "${f}"${didYouMean(f, names)}`)
	}
	const encodings = { ...visual.encodings }
	const touched = new Set<string>([
		...Object.keys(spec.encodings ?? {}),
		...SPEC_CHANNELS.filter((ch) => spec.fieldTypes?.[encodings[ch]?.field ?? ""] !== undefined),
	])
	for (const ch of touched as Set<SpecChannel>) {
		const field = encodings[ch]?.field
		if (!field) continue
		const type = typeOf(field)
		if (type === undefined) bad(`encodings.${ch}`, `no field "${field}"${didYouMean(field, names)}`)
		else if (!CHANNELS[ch].accepts.includes(type))
			bad(
				`encodings.${ch}`,
				`"${ch}" takes ${CHANNELS[ch].accepts.join(" or ")}; "${field}" is ${type}`
			)
	}
	// A channel the spec maps clears a mapped channel it conflicts with, as
	// the shelf does after its confirmation (an agent guiding the chart is
	// that confirmation); two conflicting channels in one spec are refused.
	let configs: ChannelConfigs = visual.channelConfigs
	const mapped = SPEC_CHANNELS.filter((ch) => encodings[ch]?.field || encodings[ch]?.measureSource)
	mapped.forEach((a, i) => {
		for (const b of mapped.slice(i + 1)) {
			if (!channelsConflict(a, b) || (!touched.has(a) && !touched.has(b))) continue
			if (touched.has(a) && touched.has(b)) {
				bad(`encodings.${b}`, `"${a}" and "${b}" can't be mapped together`)
				continue
			}
			const [kept, cleared] = touched.has(a) ? [a, b] : [b, a]
			encodings[cleared] = { field: null }
			if (cleared === "length") configs = { ...configs, defaultLength: null }
			out.warnings.push(`unmapped "${cleared}" (it can't be mapped with "${kept}")`)
		}
	})

	const hueField = encodings.hue?.field
	if (spec.stack !== undefined) {
		const hueType = hueField ? typeOf(hueField) : undefined
		if (hueType !== "categorical" && hueType !== "ordinal")
			bad("stack", `"stack" needs a categorical or ordinal field on "hue"`)
		else if (configs.hue?.kind === "categorical")
			configs = { ...configs, hue: { ...configs.hue, stackMode: spec.stack } }
	}
	for (const axis of ["x", "y"] as const) {
		const want = spec.axes?.[axis]
		if (!want) continue
		const next: AxisConfig = { ...(configs[axis] ?? axisConfigFromTheme(deps.theme, axis)) }
		const field = encodings[axis]?.field
		const type = field ? typeOf(field) : undefined
		for (const bound of ["min", "max"] as const) {
			const v = want[bound]
			const path = `axes.${axis}.${bound}`
			if (v === undefined) continue
			if (v === null) next[bound] = null
			else if (type === "categorical" || type === "ordinal")
				bad(
					path,
					`the ${axis} axis shows "${field}" (${type}); bounds apply to a quantitative or temporal axis`
				)
			else if (typeof v === "string" && type !== "temporal")
				bad(path, `the ${axis} axis isn't temporal; "${bound}" must be a number`)
			else {
				const ms = typeof v === "string" ? parseLocalDate(v) : v
				if (Number.isNaN(ms)) bad(path, `"${v}" isn't a date like "2020-01-01"`)
				else next[bound] = ms
				if (!field)
					out.warnings.push(
						`axes.${axis}.${bound} pins the ${axis} axis, which has no field; it applies only when that axis is the measure axis`
					)
			}
		}
		if (typeof next.min === "number" && typeof next.max === "number" && next.min >= next.max)
			bad(`axes.${axis}`, `"min" must be below "max"`)
		if (want.format !== undefined) next.customFormat = want.format
		configs = { ...configs, [axis]: next }
	}

	const labelsConfig = { ...visual.labelsConfig }
	if (spec.title !== undefined) labelsConfig.title = spec.title
	if (spec.subtitle !== undefined) labelsConfig.subtitle = spec.subtitle
	if (spec.axes?.x?.title !== undefined) labelsConfig.xAxisTitle = spec.axes.x.title
	if (spec.axes?.y?.title !== undefined) labelsConfig.yAxisTitle = spec.axes.y.title

	if (spec.family !== undefined && SPEC_FAMILIES.includes(spec.family)) {
		const fields = Object.fromEntries(
			SPEC_CHANNELS.flatMap((ch) => (encodings[ch]?.field ? [[ch, encodings[ch].field]] : []))
		)
		const picked = pickVariation(spec.family, (spec as ChartSpec).variation, fields, typeOf)
		if (typeof picked === "string")
			bad((spec as ChartSpec).variation !== undefined ? "variation" : "family", picked)
	}
	return { ...visual, encodings, channelConfigs: configs, labelsConfig, fieldTypeOverrides: overrides }
}

/** The spec's `settings`, applied last; their problems are prefixed
 * `settings.`. Mutates `out`. */
const withSettings = (
	visual: Visual,
	settings: unknown,
	out: { problems: SpecProblem[] },
	deps: ComposeDeps
): Visual => {
	if (!isObj(settings)) return visual
	const applied = applySettings(visual, settings, { theme: deps.theme, fields: deps.fields, rows: deps.rows })
	for (const p of applied.problems) out.problems.push({ ...p, path: `settings.${p.path}` })
	return applied.visual
}

/** The intake every saved visual goes through (`store/saveVisual.ts`), and
 * the sparse `fieldOrder` the save writes. */
const intake = (v: Visual): Visual => {
	const { fieldOrder, ...rest } = v
	return foldFlowNodeTitles(
		structureVisualKeys(fieldOrder?.length ? { ...rest, fieldOrder } : rest)
	)
}

/** A new chart from a spec. Any problem is a refusal; the visual is still
 * the best effort, for a caller that wants to show it. */
export const composeVisual = (spec: ChartSpec, deps: ComposeDeps): ComposeResult => {
	const out = { problems: shapeProblems(spec, false), warnings: [] as string[] }
	if (spec.folderId && deps.folderIds && !deps.folderIds.has(spec.folderId))
		out.problems.push({ path: "folderId", message: `no folder with id "${spec.folderId}"` })
	const theme = deps.theme
	const draft = newVisualDraft(theme)
	const encs = (isObj(spec.encodings) ? spec.encodings : {}) as Partial<Record<SpecChannel, string>>
	const known = new Map(deps.fields.map((f) => [f.name, f.type]))
	const typeOf = (f: string) => spec.fieldTypes?.[f] ?? known.get(f)
	const assignments: ChannelAssignment[] = []
	for (const [channel, name] of Object.entries(encs) as Array<[SpecChannel, string]>) {
		const type = typeof name === "string" ? typeOf(name) : undefined
		if (type && SPEC_CHANNELS.includes(channel))
			assignments.push({ channel, field: { name, inferredType: type } })
	}
	const picked =
		spec.family && SPEC_FAMILIES.includes(spec.family)
			? pickVariation(spec.family, spec.variation, encs, typeOf)
			: undefined
	// The variation's knobs, minus field picks the spec made itself.
	const {
		name: _n,
		channels: _c,
		allowOpportunisticHue: _o,
		...knobs
	} = typeof picked === "object" ? picked : ({ name: "", channels: {} } as QuickStartVariation)
	if (encs.hue !== undefined) {
		delete knobs.hueFrom
		delete knobs.hueMeasureSource
	}
	if (encs.connection !== undefined) delete knobs.connectionFrom
	const scaffold = scaffoldVariation(
		{
			...knobs,
			name: "spec",
			channels: Object.fromEntries(assignments.map((a) => [a.channel, [a.field.inferredType]])),
			...(spec.stack ? { stackMode: spec.stack } : {}),
		},
		assignments,
		draft.channelConfigs,
		theme
	)
	const outline = assignments.find((a) => a.channel === "outlineHue")
	const configs = outline
		? seedOutlineHueChannel(scaffold.configs, outline.field.inferredType, theme)
		: scaffold.configs
	const now = deps.now ?? Date.now()
	const base: Visual = {
		id: newVisualId(),
		name: "",
		folderId: typeof spec.folderId === "string" ? spec.folderId : null,
		datasetId: typeof spec.datasetId === "string" ? spec.datasetId : null,
		createdAtVersionId: deps.latestVersionId ?? null,
		...draft,
		encodings: scaffold.encodings,
		channelConfigs: configs,
		dataLabelsEncodings: scaffold.dataLabels,
		...(spec.themeId ? { themeId: spec.themeId } : {}),
		thumbnail: null,
		createdAt: now,
		updatedAt: now,
	}
	// Unknown fields never reached the scaffold; place them so the field
	// check below names them.
	for (const [ch, f] of Object.entries(encs)) {
		if (SPEC_CHANNELS.includes(ch as SpecChannel) && typeof f === "string" && !known.has(f))
			base.encodings = { ...base.encodings, [ch]: { field: f } }
	}
	const visual = applyCommon(spec, base, deps, out)
	visual.name = spec.name?.trim() || spec.title?.trim() || UNTITLED_VISUAL_NAME
	return { visual: intake(withSettings(visual, spec.settings, out, deps)), ...out }
}

/** An edit of a stored chart: only the keys the edit names change. */
export const editVisual = (
	base: Visual,
	patch: ChartSpecEdit,
	deps: ComposeDeps
): ComposeResult => {
	const out = { problems: shapeProblems(patch, true), warnings: [] as string[] }
	if (isTemplate(base))
		out.problems.push({ path: "", message: "this is a template; edit it in the editor" })
	if (isTrashed(base))
		out.problems.push({ path: "", message: "this visual is in the Trash; restore it first" })
	const stored = foldFlowNodeTitles(structureVisualKeys(base))
	const hydrated = hydrateVisual(stored)
	const theme = deps.theme
	const from = deps.fromTheme ?? null
	const draft =
		typeof patch.themeId === "string"
			? {
					...hydrated,
					channelConfigs: rethemeChannelConfigs(hydrated.channelConfigs, theme, from),
					labelsConfig: rethemeLabels(hydrated.labelsConfig, theme, from),
					legendConfig: rethemeLegend(hydrated.legendConfig, theme, from),
					dataLabelsConfig: rethemeDataLabels(hydrated.dataLabelsConfig, theme, from),
					captionConfig: rethemeCaption(hydrated.captionConfig, theme, from),
					tooltipConfig: rethemeTooltip(hydrated.tooltipConfig, theme, from),
					dataTableConfig: rethemeDataTable(hydrated.dataTableConfig, theme, from),
					mapConfig: rethemeMap(hydrated.mapConfig, theme, from),
				}
			: hydrated
	const known = new Map(deps.fields.map((f) => [f.name, f.type]))
	const typeOf = (f: string) => patch.fieldTypes?.[f] ?? draft.fieldTypeOverrides[f] ?? known.get(f)
	const encodings = { ...draft.encodings }
	let configs = draft.channelConfigs
	for (const [ch, field] of Object.entries(isObj(patch.encodings) ? patch.encodings : {}) as Array<
		[SpecChannel, string | null]
	>) {
		if (!SPEC_CHANNELS.includes(ch) || (field !== null && typeof field !== "string")) continue
		const fresh = field !== null && field !== encodings[ch]?.field
		encodings[ch] = { field }
		if (ch === "length" && field === null) configs = { ...configs, defaultLength: null }
		const type = fresh && field ? typeOf(field) : undefined
		if (type && ch === "hue") configs = seedHueChannel(configs, type, deps.theme)
		if (type && ch === "outlineHue") configs = seedOutlineHueChannel(configs, type, deps.theme)
	}
	const visual = applyCommon(
		patch,
		{
			...stored,
			...draft,
			...(typeof patch.themeId === "string" ? { themeId: patch.themeId } : {}),
			encodings,
			channelConfigs: configs,
			updatedAt: deps.now ?? Date.now(),
		},
		deps,
		out
	)
	if (patch.name !== undefined) visual.name = patch.name.trim() || stored.name
	return { visual: intake(withSettings(visual, patch.settings, out, deps)), ...out }
}
