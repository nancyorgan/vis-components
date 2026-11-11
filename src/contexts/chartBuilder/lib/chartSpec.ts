/** Chart specs: a short, encodings-first description of a chart that a
 * program (the MCP package) sends, turned into EXACTLY the Visual row the
 * editor would save. Everything a spec leaves out comes from the editor's
 * own new-visual draft and the theme; everything it names is written to the
 * config keys the sidebar panels write. Pure: no store, no server. */

import { applySettings } from "./applySettings"
import { explicitFlowTargetField, resolveFlowTargetField } from "./buildFlowGraph"
import { withSpecPickEffects } from "./chartSpecPicks"
import type { AxisConfig, ChannelConfigs, StackMode } from "./channelConfig"
import { ALL_ENCODING_CHANNELS, CHANNELS, channelsConflictIn } from "./channels"
import { didYouMean } from "./didYouMean"
import { foldFlowNodeTitles } from "./foldFlowNodeTitles"
import { formatSpecProblem } from "./formatTick"
import { detectGeoFields, type GeoFieldDetection } from "./geo/detectGeoFields"
import { parseLocalDate } from "./localDate"
import { UNTITLED_VISUAL_NAME } from "./nameUniqueness"
import { mapConfigForVariation, scaffoldVariation, type ChannelAssignment } from "./quickStart"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "./quickStartVariations"
import { structureVisualKeys } from "./savedKeyStructure"
import { seedHueChannel, seedOutlineHueChannel } from "./seedColorSlot"
import { axisConfigFromTheme, mapConfigFromTheme } from "./themeConfig"
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
	Omit<ChartSpec, "datasetId" | "folderId" | "encodings" | "axes">
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
	 * `settingsReadRows`) and for the variations that read the data (a map
	 * finds its region or lat/long columns from their values, a flow its
	 * target column; see `specReadsRows`). */
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
	variation:
		"A quick-start variation by name (it implies its family). A map finds its region (or longitude / latitude) columns from their values; a flow its target column. On an edit, re-shapes the chart as that variation, keeping titles, legend, labels and theme.",
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
const CREATE_ONLY = new Set(["datasetId", "folderId"])

const SPEC_FAMILIES = QUICK_START_CHART_TYPES
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

/** Every quick-start variation with its family. Names are unique across
 * families, so a variation name alone names its family. */
const ALL_VARIATIONS = QUICK_START_CHART_TYPES.flatMap((family) =>
	QUICK_START_VARIATIONS[family].map((variation) => ({ family, variation }))
)

/** The variation names a spec accepts (`variation`), in quick-start bar
 * order: every chart type the product makes. */
export const specVariationNames = (): string[] => ALL_VARIATIONS.map((e) => e.variation.name)

const variationNamed = (name: string) =>
	ALL_VARIATIONS.find((e) => e.variation.name.toLowerCase() === name.trim().toLowerCase())

const familyOfVariation = (name: string): QuickStartChartType | undefined =>
	variationNamed(name)?.family

/** Families whose variations read the data set's rows: a map finds its
 * geography from the values, a flow its target column. */
const ROW_READING_FAMILIES: readonly QuickStartChartType[] = ["map", "sankey", "chord"]

/** Whether composing (or editing with) this spec reads the data set's rows,
 * so a caller fetches them into `ComposeDeps.rows`. */
export const specReadsRows = (
	spec: { family?: unknown; variation?: unknown; encodings?: unknown },
	stored?: Pick<Visual, "mapConfig">
): boolean =>
	[spec.family, typeof spec.variation === "string" ? familyOfVariation(spec.variation) : undefined].some(
		(f) => ROW_READING_FAMILIES.includes(f as QuickStartChartType)
	) || (!!stored && editsStoredMapRegion(stored, spec))

/** An edit that names a `connection` column on a chart already drawn as a
 * geographic map: the column is checked as a region column, as on create. */
const editsStoredMapRegion = (
	stored: Pick<Visual, "mapConfig">,
	patch: { encodings?: unknown }
): boolean =>
	stored.mapConfig?.coordSystem === "geographic" &&
	typeof patch.encodings === "object" &&
	patch.encodings !== null &&
	typeof (patch.encodings as Record<string, unknown>).connection === "string"

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

/** What `connection` is to a family, for a refusal that names it. */
const CONNECTION_ROLE: Partial<Record<QuickStartChartType, string>> = {
	line: "the series field, one line per level",
	area: "the series field, one area per level",
	radar: "the series field, one polygon per level",
	circles: "the group field",
	treemap: "the group field",
	sunburst: "the group field",
	sankey: "the flow source column",
	chord: "the flow source column",
}

/** Channels a variation needs EMPTY: the geo and the tree / flow chart modes
 * detect off which channels are unmapped (an `area` turns a choropleth into
 * a bubble map; a position channel takes a tree or flow off its layout). */
const mustBeEmpty = (v: QuickStartVariation): SpecChannel[] =>
	v.geo === "choropleth"
		? ["x", "y", "area"]
		: v.geo === "symbols"
			? ["x", "y"]
			: v.hierarchyLayout
				? ["x", "y", "r", "angle", "length"]
				: []

/** The family's variation: by name, else the one these encodings fill with
 * the most channels (ties to the first listed, as on the quick-start bar).
 * A map's geo channels aren't checked here: they come from the data
 * (`placeGeo`). */
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
			.map(
				([ch, types]) =>
					`"${ch}" (${types.join(" or ")}${ch === "connection" && CONNECTION_ROLE[family] ? `: ${CONNECTION_ROLE[family]}` : ""})`
			)
	const crowded = (v: QuickStartVariation) => mustBeEmpty(v).filter((ch) => fields[ch])
	if (name !== undefined) {
		const v = all.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
		const names = all.map((x) => x.name)
		if (!v)
			return `no "${name}" variation of "${family}"${didYouMean(name, names)} (variations: ${quoted(names)})`
		const missing = unfilled(v)
		const extra = crowded(v)
		const why = [
			...(missing.length > 0 ? [`needs ${missing.join(", ")}`] : []),
			...(extra.length > 0 ? [`leaves ${quoted(extra)} unmapped`] : []),
		]
		return why.length > 0 ? `"${v.name}" ${why.join(" and ")}` : v
	}
	const fits = all.filter((v) => unfilled(v).length === 0 && crowded(v).length === 0)
	const best = fits.reduce<QuickStartVariation | undefined>(
		(a, v) => (!a || Object.keys(v.channels).length > Object.keys(a.channels).length ? v : a),
		undefined
	)
	return (
		best ??
		`these encodings make no "${family}" variation (variations: ${quoted(all.map((v) => v.name))})`
	)
}

type PickedVariation = {
	variation: QuickStartVariation
	/** Where a problem with it is reported. */
	path: "family" | "variation"
}

/** The spec's variation: named (its family implied, or checked against a
 * named family), else the family's best fit; undefined with neither. A
 * variation these encodings can't make is a problem. Mutates `out`. */
const resolveVariation = (
	spec: { family?: unknown; variation?: unknown },
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (f: string) => FieldType | undefined,
	out: { problems: SpecProblem[] }
): PickedVariation | undefined => {
	const name = typeof spec.variation === "string" ? spec.variation : undefined
	if (spec.family !== undefined && !oneOf(QUICK_START_CHART_TYPES, spec.family)) return undefined
	const family = (spec.family as QuickStartChartType | undefined) ?? (name !== undefined ? familyOfVariation(name) : undefined)
	if (name !== undefined && family === undefined) {
		out.problems.push({
			path: "variation",
			message: `no "${name}" variation${didYouMean(name, specVariationNames())}`,
		})
		return undefined
	}
	if (family === undefined) return undefined
	const path = name !== undefined ? "variation" : "family"
	const picked = pickVariation(family, name, fields, typeOf)
	if (typeof picked === "string") {
		out.problems.push({ path, message: picked })
		return undefined
	}
	return { variation: picked, path }
}

/** What a region column's values must be for a map to find it
 * (`detectGeoFields`, as the quick-start bar uses it). */
const REGION_VALUES =
	'US state names, USPS abbreviations or state FIPS codes; county FIPS codes ("06037") or county names ("Cook County" or "Cook County, IL"); or country names or ISO codes. A column of number codes also needs a name that says what they are (FIPS, state, county, ISO, …). ZIP codes (ZCTAs) aren\'t found from values: map the column on "connection" and set settings.mapConfig.geographyLevel to "zcta"'

/** A concrete geography level the spec's settings pin (not "auto"). */
const pinnedGeographyLevel = (settings: unknown): boolean => {
	const level = isObj(settings) && isObj(settings.mapConfig) ? settings.mapConfig.geographyLevel : undefined
	return typeof level === "string" && level !== "auto"
}

/** The data set's geo columns, as the quick-start bar detects them. */
const detectGeo = (
	deps: ComposeDeps,
	typeOf: (f: string) => FieldType | undefined
): GeoFieldDetection | null =>
	deps.rows
		? detectGeoFields(
				deps.fields.map((f) => ({ name: f.name, inferredType: typeOf(f.name) ?? f.type })),
				deps.rows
			)
		: null

/** The column named on `connection` when it is a region column
 * `detectGeoFields` finds for a region map (Choropleth, Bubble map). Such a
 * column may be stored as numbers (county FIPS read as quantitative), which
 * `connection` otherwise refuses; the field check lets this one through, as
 * it does the same column placed from the data. */
const regionColumnOnConnection = (
	geoKind: QuickStartVariation["geo"],
	named: string | null | undefined,
	geo: GeoFieldDetection | null
): string | null =>
	(geoKind === "choropleth" || geoKind === "symbols") &&
	named &&
	geo?.regionFields.some((r) => r.field.name === named)
		? named
		: null

/** A map variation's geo channels, found from the data the way the
 * quick-start bar finds them (`detectGeoFields`): the region column on
 * `connection` (the one named, which must be a region column, else the
 * first found), or longitude on `x` and latitude on `y`. Returns the
 * channels to add and the detection `mapConfigForVariation` reads, or
 * undefined after recording a problem. Mutates `out`. */
const placeGeo = (
	picked: PickedVariation,
	mapped: Partial<Record<SpecChannel, string>>,
	deps: ComposeDeps,
	typeOf: (f: string) => FieldType | undefined,
	levelPinned: boolean,
	out: { problems: SpecProblem[]; warnings: string[] }
): { add: ChannelAssignment[]; geo: GeoFieldDetection } | undefined => {
	const { variation: v, path } = picked
	const bad = (where: string, message: string) => {
		out.problems.push({ path: where, message })
		return undefined
	}
	const geo = detectGeo(deps, typeOf)
	if (!geo) return bad(path, `a ${v.name} finds its geography from the data set's rows, which weren't given`)
	const field = (name: string) => ({ name, inferredType: typeOf(name) ?? "categorical" })
	if (v.geo === "points") {
		const lon = geo.lonField
		const lat = geo.latField
		if (!lon || !lat)
			return bad(
				path,
				`a ${v.name} needs longitude and latitude columns: quantitative, named like "lon", "lng" or "longitude" and "lat" or "latitude", with values in range; none were found`
			)
		if (mapped.x && mapped.x !== lon.name)
			return bad("encodings.x", `a ${v.name} puts longitude on "x"; the longitude column is "${lon.name}"`)
		if (mapped.y && mapped.y !== lat.name)
			return bad("encodings.y", `a ${v.name} puts latitude on "y"; the latitude column is "${lat.name}"`)
		const add: ChannelAssignment[] = []
		if (!mapped.x) add.push({ channel: "x", field: field(lon.name) })
		if (!mapped.y) add.push({ channel: "y", field: field(lat.name) })
		if (add.length > 0)
			out.warnings.push(`longitude "${lon.name}" is on "x" and latitude "${lat.name}" on "y", found from their values`)
		return { add, geo }
	}
	const named = mapped.connection
	if (named) {
		if (!levelPinned && !geo.regionFields.some((r) => r.field.name === named))
			return bad(
				"encodings.connection",
				`"${named}" isn't a region column a map can join: its values should be ${REGION_VALUES}`
			)
		return { add: [], geo }
	}
	const found = geo.regionFields[0]
	if (!found)
		return bad(
			path,
			`a ${v.name} needs a region column on "connection", and no field's values name places a map knows; expected ${REGION_VALUES}`
		)
	out.warnings.push(
		`"connection" maps "${found.field.name}", the region column found from its values (${found.level})`
	)
	return { add: [{ channel: "connection", field: field(found.field.name) }], geo }
}

/** The quick-start scaffold over exactly the channels the spec maps: the
 * variation's knobs (stacking, area fill, layouts, overlays, derived hue,
 * data labels) minus the ones that would overwrite a field the spec
 * picked itself. */
const scaffoldFor = (
	picked: QuickStartVariation | undefined,
	assignments: readonly ChannelAssignment[],
	configs: ChannelConfigs,
	theme: Theme,
	stack: StackMode | undefined
) => {
	const {
		name: _n,
		channels: _c,
		allowOpportunisticHue: _o,
		...knobs
	} = picked ?? ({ name: "", channels: {} } as QuickStartVariation)
	if (assignments.some((a) => a.channel === "hue")) {
		delete knobs.hueFrom
		delete knobs.hueMeasureSource
	}
	if (assignments.some((a) => a.channel === "connection")) delete knobs.connectionFrom
	return scaffoldVariation(
		{
			...knobs,
			name: "spec",
			channels: Object.fromEntries(assignments.map((a) => [a.channel, [a.field.inferredType]])),
			...(stack ? { stackMode: stack } : {}),
		},
		assignments,
		configs,
		theme
	)
}

/** A flow draws the rows from its source column to a target column it
 * resolves from the data at render time (`resolveFlowTargetField`); with
 * no target it draws nothing, so that is a problem. Mutates `out`. */
const checkFlowTarget = (
	visual: Visual,
	picked: PickedVariation | undefined,
	deps: ComposeDeps,
	out: { problems: SpecProblem[]; warnings: string[] }
) => {
	if (!picked?.variation.requiresFlowTarget) return
	const source = visual.encodings.connection?.field
	if (!source) return
	const value = visual.encodings.area?.field ?? null
	const explicit = visual.channelConfigs.connection?.flowTargetField
	const fields = deps.fields.map((f) => ({
		name: f.name,
		inferredType: visual.fieldTypeOverrides?.[f.name] ?? f.type,
	}))
	const target = resolveFlowTargetField(explicit, deps.rows ?? [], fields, source, value)
	if (!target)
		out.problems.push({
			path: picked.path,
			message: `a ${picked.variation.name} needs a target column: a categorical field besides the source "${source}"${value ? ` and the value "${value}"` : ""}`,
		})
	else if (!explicitFlowTargetField(explicit, source))
		out.warnings.push(
			`the flows run from "${source}" to "${target}", the target column found from the data; settings.channelConfigs.connection.flowTargetField picks another`
		)
}

/** The channels a visual maps to fields, as scaffold assignments. */
const assignmentsOf = (
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (f: string) => FieldType | undefined
): ChannelAssignment[] =>
	(Object.entries(fields) as Array<[SpecChannel, string]>).flatMap(([channel, name]) => {
		const type = typeof name === "string" ? typeOf(name) : undefined
		return type && SPEC_CHANNELS.includes(channel)
			? [{ channel, field: { name, inferredType: type } }]
			: []
	})

/** Checks and writes shared by create and edit: field existence and type fit,
 * channel conflicts, stack, titles, axes. `regionColumn` is a map's detected
 * region column named on `connection` (`regionColumnOnConnection`), taken
 * whatever its type. Mutates `out`. */
const applyCommon = (
	spec: ChartSpecEdit,
	visual: Visual,
	deps: ComposeDeps,
	out: { problems: SpecProblem[]; warnings: string[] },
	regionColumn: string | null = null
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
		else if (!CHANNELS[ch].accepts.includes(type) && !(ch === "connection" && field === regionColumn))
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
			if (!channelsConflictIn(a, b, encodings) || (!touched.has(a) && !touched.has(b))) continue
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

	return { ...visual, encodings, channelConfigs: configs, labelsConfig, fieldTypeOverrides: overrides }
}

/** The channels a visual maps to fields. */
const mappedOf = (visual: Visual): Partial<Record<SpecChannel, string>> =>
	Object.fromEntries(
		SPEC_CHANNELS.flatMap((ch) => {
			const field = visual.encodings[ch]?.field
			return field ? [[ch, field]] : []
		})
	)

/** An edit naming a variation re-shapes the chart as the quick-start bar
 * scaffolds that variation over the chart's (edited) encodings: its knobs
 * apply (stacking, area or line fill, tree / flow layout, overlays, the
 * map's coord system and geography) while titles, legend, data labels,
 * annotations, theme, the hue colors and the line's styling stay. A map
 * variation finds its geo channels from the data, as on create. Mutates
 * `out`. */
const reshape = (
	visual: Visual,
	pick: PickedVariation,
	patch: ChartSpecEdit,
	deps: ComposeDeps,
	typeOf: (f: string) => FieldType | undefined,
	out: { problems: SpecProblem[]; warnings: string[] }
): Visual => {
	const mapped = mappedOf(visual)
	const assignments = assignmentsOf(mapped, typeOf)
	let geo: GeoFieldDetection | null = null
	if (pick.variation.geo) {
		const placed = placeGeo(pick, mapped, deps, typeOf, pinnedGeographyLevel(patch.settings), out)
		if (!placed) return visual
		for (const a of placed.add) assignments.push(a)
		geo = placed.geo
	}
	const before = visual.channelConfigs
	const scaffold = scaffoldFor(pick.variation, assignments, before, deps.theme, patch.stack)
	const configs: ChannelConfigs = { ...scaffold.configs }
	const hueWas = visual.encodings.hue
	const hueIs = scaffold.encodings.hue
	if (
		before.hue &&
		configs.hue &&
		before.hue.kind === configs.hue.kind &&
		hueWas?.field === hueIs?.field &&
		hueWas?.measureSource === hueIs?.measureSource
	)
		configs.hue =
			before.hue.kind === "categorical" && configs.hue.kind === "categorical"
				? { ...before.hue, stackMode: configs.hue.stackMode }
				: before.hue
	const line = configs.connection
	if (before.connection && line && line !== before.connection)
		configs.connection = {
			...before.connection,
			fill: line.fill,
			hierarchyLayout: line.hierarchyLayout,
			fillPolygon: line.fillPolygon,
		}
	const text = visual.encodings.text
	const edits = isObj(patch.encodings) ? patch.encodings : {}
	const sameGeography =
		pick.variation.geo !== undefined &&
		visual.mapConfig?.coordSystem === "geographic" &&
		!["connection", "x", "y"].some((ch) => ch in edits)
	return {
		...visual,
		encodings: text?.field ? { ...scaffold.encodings, text } : scaffold.encodings,
		channelConfigs: configs,
		dataLabelsEncodings: pick.variation.dataLabelsValueFrom
			? { ...(visual.dataLabelsEncodings ?? scaffold.dataLabels), value: scaffold.dataLabels.value }
			: visual.dataLabelsEncodings,
		mapConfig: sameGeography
			? visual.mapConfig
			: mapConfigForVariation(
					pick.variation,
					assignments,
					geo,
					visual.mapConfig ?? mapConfigFromTheme(deps.theme)
				),
	}
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
	const assignments = assignmentsOf(encs, typeOf)
	// The variation's problems follow the field checks (`applyCommon`).
	const later = { problems: [] as SpecProblem[], warnings: [] as string[] }
	const pick = resolveVariation(spec, encs, typeOf, later)
	// A map's geo channels come from the data, as on the quick-start bar.
	let geo: GeoFieldDetection | null = null
	if (pick?.variation.geo) {
		const placed = placeGeo(pick, encs, deps, typeOf, pinnedGeographyLevel(spec.settings), later)
		for (const a of placed?.add ?? []) assignments.push(a)
		geo = placed?.geo ?? null
	}
	const scaffold = scaffoldFor(pick?.variation, assignments, draft.channelConfigs, theme, spec.stack)
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
		mapConfig: pick
			? mapConfigForVariation(pick.variation, assignments, geo, draft.mapConfig)
			: draft.mapConfig,
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
	const visual = applyCommon(
		spec,
		base,
		deps,
		out,
		regionColumnOnConnection(pick?.variation.geo, encs.connection, geo)
	)
	for (const p of later.problems) out.problems.push(p)
	for (const w of later.warnings) out.warnings.push(w)
	visual.name = spec.name?.trim() || spec.title?.trim() || UNTITLED_VISUAL_NAME
	const picked = withSpecPickEffects(
		withSettings(visual, spec.settings, out, deps),
		{
			theme,
			typeOf,
			mapsColorOrSeries: typeof encs.hue === "string" || typeof encs.connection === "string",
			settings: spec.settings,
		},
		out.warnings
	)
	checkFlowTarget(picked, pick, deps, out)
	return { visual: intake(picked), ...out }
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
	// A named region-map variation takes its detected region column on
	// `connection` whatever its type, as on create.
	// So does an edit naming the map family, or naming a region column on a
	// chart already drawn as a geographic map.
	const namedGeo =
		typeof patch.variation === "string"
			? variationNamed(patch.variation)?.variation.geo
			: patch.family === "map" || editsStoredMapRegion(stored, patch)
				? "choropleth"
				: undefined
	const regionColumn =
		namedGeo === "choropleth" || namedGeo === "symbols"
			? regionColumnOnConnection(namedGeo, encodings.connection?.field, detectGeo(deps, typeOf))
			: null
	const common = applyCommon(
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
		out,
		regionColumn
	)
	// A family is checked against the encodings; a named variation also
	// re-shapes the chart as that variation.
	const pick = resolveVariation(patch, mappedOf(common), typeOf, out)
	const visual =
		pick && typeof patch.variation === "string"
			? reshape(common, pick, patch, deps, typeOf, out)
			: common
	if (patch.name !== undefined) visual.name = patch.name.trim() || stored.name
	const edits = isObj(patch.encodings) ? patch.encodings : {}
	const picked = withSpecPickEffects(
		withSettings(visual, patch.settings, out, deps),
		{
			theme,
			typeOf,
			mapsColorOrSeries: typeof edits.hue === "string" || typeof edits.connection === "string",
			previousColor: { hueField: draft.encodings.hue?.field ?? null, configs: draft.channelConfigs },
			settings: patch.settings,
		},
		out.warnings
	)
	checkFlowTarget(picked, pick, deps, out)
	return { visual: intake(picked), ...out }
}
