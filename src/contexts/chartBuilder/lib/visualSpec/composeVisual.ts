/** Chart spec → complete Visual. The visual starts from the same draft a
 *  new visual in the editor starts from (`newVisualDraft`), takes its hue
 *  config the way a quick-start scaffold does (`scaffoldVariation`), and
 *  only then gets the spec's own choices layered on top, so every slice the
 *  renderer reads is present and themed. */

import { channelAccepts, channelsConflict } from "../channels"
import { getChartModeDef, type ChartMode } from "../chartMode"
import { isBarModeId } from "../chartModes/families"
import { DEFAULT_AXIS_CONFIG, type AxisConfig } from "../channelConfig"
import { effectiveType } from "../fieldType"
import { foldFlowNodeTitles } from "../foldFlowNodeTitles"
import { seedOutlineHue } from "../hueDefaults"
import { applyCellConversions } from "../materializeTransforms"
import { scaffoldVariation, type ChannelAssignment } from "../quickStart"
import {
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "../quickStartVariations"
import { resolveDatasetViewFromMeta } from "../resolveDatasetVersion"
import { structureVisualKeys } from "../savedKeyStructure"
import { parseValue } from "../scales"
import type { DatasetMeta, FieldType, Folder, Theme, Visual } from "../types"
import { newVisualDraft } from "../visualDefaults"
import {
	capProblems,
	MAX_PROBLEMS,
	MIN_EPOCH_MS,
	named,
	pathOf,
	readChartSpec,
	specDateMs,
	type ChartSpec,
	type ChartSpecDraft,
	type SpecChannel,
	type SpecProblem,
} from "./chartSpec"
import { didYouMean } from "./suggest"

/** What a spec is composed against. The caller looks up the spec's dataset
 *  and theme; `dataset` is null when no dataset has the spec's id. */
export type ComposeContext = {
	/** The spec's dataset, with the rows of its latest version. */
	dataset: { meta: DatasetMeta; rows: Array<Record<string, string>> } | null
	folders: readonly Folder[]
	/** The theme the visual is styled under: the spec's `themeId` resolved,
	 *  else the library default. */
	theme: Theme
	themeId: string | null
	/** The themes a `themeId` could name, listed when it names none. */
	themes?: ReadonlyArray<{ id: string; name: string }>
	now: number
	/** The new visual's id. */
	id: string
}

/** The intake every opened and saved visual goes through
 *  (`useLoadVisual`, `useSaveVisual`): saved keys structured, flow
 *  Node-titles styling folded into Data Labels. */
export const structuredVisual = (visual: Visual): Visual =>
	foldFlowNodeTitles(structureVisualKeys(visual))

export type ComposeVisualResult =
	| { ok: true; visual: Visual; warnings: SpecProblem[] }
	| { ok: false; errors: SpecProblem[] }

/** The chart modes each family a spec can name draws. */
export const FAMILY_MODES: Partial<Record<QuickStartChartType, readonly ChartMode[]>> = {
	bar: ["bars-x", "bars-y"],
	combo: ["combo-x", "combo-y"],
	scatter: ["scatter"],
	hexbin: ["hexbin"],
	dumbbell: ["scatter"],
	line: ["scatter"],
	area: ["areas-x", "areas-y"],
	pie: ["pies", "pies-x", "pies-y"],
	radar: ["radar"],
	violin: ["scatter"],
	density: ["scatter"],
	tile: ["tile"],
	circles: ["packed-circles"],
	treemap: ["treemap"],
	sunburst: ["sunburst"],
}

/** Channels a family's quick start fills for looks, which a spec may
 *  leave out. */
export const OPTIONAL_CHANNELS: Partial<Record<QuickStartChartType, readonly SpecChannel[]>> = {
	dumbbell: ["shape", "area"],
}

const DISCRETE: readonly FieldType[] = ["categorical", "ordinal"]

const list = (items: readonly string[]): string =>
	items.map((s) => `"${s}"`).join(", ")

const compose = (
	spec: ChartSpecDraft,
	prior: SpecProblem[],
	ctx: ComposeContext
): ComposeVisualResult => {
	const errors = [...prior]
	const problem = (path: string, message: string) => {
		errors.push({ path, message })
	}
	/** A did-you-mean hint, skipped once the report is past its cap. */
	const hint = (name: string, candidates: readonly string[]): string =>
		errors.length < MAX_PROBLEMS ? didYouMean(name, candidates) : ""

	if (spec.folderId && !ctx.folders.some((f) => f.id === spec.folderId)) {
		problem(
			"folderId",
			`no folder with id "${spec.folderId}"${hint(spec.folderId, ctx.folders.map((f) => f.id))}`
		)
	}
	if (spec.themeId !== undefined && spec.themeId !== ctx.themeId) {
		const known = (ctx.themes ?? []).map((t) => `"${t.name}" (${t.id})`)
		problem(
			"themeId",
			`no theme with id or name "${named(spec.themeId)}"${known.length > 0 ? ` (themes: ${known.join(", ")})` : ""}`
		)
	}

	const dataset =
		spec.datasetId !== undefined && ctx.dataset?.meta.id === spec.datasetId
			? ctx.dataset
			: null
	if (spec.datasetId !== undefined && !dataset) {
		problem("datasetId", `no dataset with id "${spec.datasetId}"`)
	}
	const raw = dataset
		? resolveDatasetViewFromMeta(dataset.meta, dataset.rows, undefined)
		: undefined
	if (!raw) return { ok: false, errors: capProblems(errors) }

	// No prototype, so a field named "constructor" or "toString" reads as
	// unset rather than as an Object.prototype member.
	const overrides: Record<string, FieldType> = Object.create(null)
	for (const [field, type] of Object.entries(spec.fieldTypes ?? {})) {
		overrides[field] = type
	}
	const rawNames = raw.fields.map((f) => f.name)
	for (const field of Object.keys(spec.fieldTypes ?? {})) {
		if (rawNames.includes(field)) continue
		problem(
			pathOf("fieldTypes", field),
			`no field "${named(field)}" in dataset "${raw.name}"${hint(field, rawNames)}`
		)
		delete overrides[field]
	}
	// The data as the editor shows it: the cell conversions an override
	// switches on.
	const view = applyCellConversions(raw, overrides) ?? raw
	const fieldNames = view.fields.map((f) => f.name)
	const hasField = (name: string) => fieldNames.includes(name)
	const typeOf = (field: string): FieldType => effectiveType(view, field, overrides)

	for (const [field, type] of Object.entries(spec.fieldTypes ?? {})) {
		if (!hasField(field) || (type !== "quantitative" && type !== "temporal")) continue
		if (!view.rows.some((r) => parseValue(r[field], type) !== null)) {
			problem(
				pathOf("fieldTypes", field),
				`no value in "${field}" reads as ${type}, so the chart would be empty`
			)
		}
	}

	const fields = spec.encodings
	const mapped = Object.entries(fields) as Array<[SpecChannel, string]>
	let encodingsOk = true
	for (const [channel, field] of mapped) {
		const path = pathOf("encodings", channel)
		if (!hasField(field)) {
			problem(
				path,
				`no field "${named(field)}" in dataset "${view.name}"${hint(field, fieldNames)}`
			)
			encodingsOk = false
			continue
		}
		const type = typeOf(field)
		if (!channelAccepts(channel, type)) {
			problem(path, `"${channel}" can't take "${field}" (${type})`)
			encodingsOk = false
		}
	}
	const channels = mapped.map(([c]) => c)
	channels.forEach((channel, i) => {
		const others = channels.slice(0, i).filter((o) => channelsConflict(channel, o))
		if (others.length === 0) return
		const names = list(others).replace(/, ([^,]*)$/, " and $1")
		problem(pathOf("encodings", channel), `"${channel}" can't be mapped together with ${names}`)
		encodingsOk = false
	})

	const picked =
		spec.family && spec.variation
			? namedVariation(spec.family, spec.variation, fields, typeOf)
			: undefined
	if (typeof picked === "string") problem("variation", picked)
	const variant =
		typeof picked === "object"
			? picked
			: spec.family && !spec.variation
				? matchVariation(spec.family, fields, typeOf)
				: undefined

	const hueField = fields.hue
	const hueType = hueField && hasField(hueField) ? typeOf(hueField) : null
	if (spec.stack && !hueField) {
		problem("stack", `"stack" needs encodings.hue: it stacks or groups the hue levels`)
	} else if (spec.stack && hueType && !DISCRETE.includes(hueType)) {
		problem("stack", `"stack" needs a categorical or ordinal hue; "${hueField}" is ${hueType}`)
	}

	const draft = newVisualDraft(ctx.theme)
	/** Each axis's bounds as stored: numbers, dates as epoch ms. */
	const bounds: Record<"x" | "y", { min?: number; max?: number }> = { x: {}, y: {} }
	let scaffold: ReturnType<typeof scaffoldVariation> | undefined
	if (encodingsOk) {
		const assignments: ChannelAssignment[] = mapped.map(([channel, field]) => ({
			channel,
			field: { name: field, inferredType: typeOf(field) },
		}))
		const variation: QuickStartVariation = {
			...(variant ? knobsOf(variant, fields) : {}),
			name: spec.family ?? "spec",
			channels: Object.fromEntries(assignments.map((a) => [a.channel, [a.field.inferredType]])),
			...(spec.stack ? { stackMode: spec.stack } : {}),
		}
		scaffold = scaffoldVariation(variation, assignments, draft.channelConfigs, ctx.theme)
		// The Outline color panel seeds its config when a field is picked; mirror it.
		if (fields.outlineHue !== undefined) {
			scaffold.configs.outlineHue = seedOutlineHue(
				scaffold.configs.outlineHue,
				typeOf(fields.outlineHue),
				ctx.theme
			)
		}
		const mode = getChartModeDef(scaffold.encodings, typeOf, scaffold.configs, draft.mapConfig)
		const modes: readonly string[] = spec.family ? (FAMILY_MODES[spec.family] ?? []) : []
		if (spec.family && !variant && !spec.variation) {
			problem(
				"family",
				`${familyNeeds(spec.family, fields, typeOf)}; these encodings make a "${mode.id}" chart`
			)
		} else if (spec.family && variant && !modes.includes(mode.id)) {
			problem(
				"family",
				`a "${spec.family}" chart is ${list(modes)}; these encodings make a "${mode.id}" chart`
			)
		}
		// A density curve is drawn only along one axis with the other empty.
		const curve = variant?.distributionOverlay
		const across = curve?.axis === "x" ? "y" : "x"
		if (curve?.mode === "density" && fields[across] !== undefined) {
			problem(
				pathOf("encodings", across),
				`a density curve is drawn along "${curve.axis}" alone, so "${across}" must be left out`
			)
		}
		for (const axis of ["x", "y"] as const) {
			const field = fields[axis]
			const type = field ? typeOf(field) : null
			const continuous = type ? type === "quantitative" : mode.canvas.measureAxis === axis
			for (const bound of ["min", "max"] as const) {
				const v = spec.axes?.[axis]?.[bound]
				const path = pathOf("axes", axis, bound)
				if (v === undefined) continue
				if (type === "temporal") {
					if (isBarModeId(mode.id) && mode.canvas.measureAxis !== axis) {
						problem(
							path,
							`a bar chart draws "${field}" as one band per value, so bounds don't apply; use a line chart`
						)
					} else if (typeof v === "number" && Math.abs(v) < MIN_EPOCH_MS) {
						problem(
							path,
							`a number on a temporal axis is epoch milliseconds; for a year or date write it as text, e.g. "${v}" or "2020-01-01"`
						)
					} else {
						bounds[axis][bound] = typeof v === "string" ? specDateMs(v) : v
					}
				} else if (!continuous) {
					problem(
						path,
						field
							? `the ${axis} axis shows "${field}" (${type}); "${bound}" applies only to a quantitative or temporal axis`
							: `the ${axis} axis has no field and isn't this chart's measure axis`
					)
				} else if (typeof v === "string") {
					problem(path, `the ${axis} axis is quantitative; "${bound}" must be a number`)
				} else {
					bounds[axis][bound] = v
				}
			}
		}
	}

	if (errors.length > 0 || !scaffold) return { ok: false, errors: capProblems(errors) }

	const channelConfigs = { ...scaffold.configs }
	for (const axis of ["x", "y"] as const) {
		const want = spec.axes?.[axis]
		if (!want) continue
		const next: AxisConfig = { ...(channelConfigs[axis] ?? DEFAULT_AXIS_CONFIG) }
		if (bounds[axis].min !== undefined) next.min = bounds[axis].min
		if (bounds[axis].max !== undefined) next.max = bounds[axis].max
		if (want.format !== undefined) next.customFormat = want.format
		channelConfigs[axis] = next
	}

	const labelsConfig = { ...draft.labelsConfig }
	if (spec.title !== undefined) labelsConfig.title = spec.title
	if (spec.subtitle !== undefined) labelsConfig.subtitle = spec.subtitle
	if (spec.axes?.x?.title !== undefined) labelsConfig.xAxisTitle = spec.axes.x.title
	if (spec.axes?.y?.title !== undefined) labelsConfig.yAxisTitle = spec.axes.y.title

	const visual: Visual = {
		...draft,
		id: ctx.id,
		name: spec.name?.trim() || spec.title?.trim() || "Untitled",
		folderId: spec.folderId ?? null,
		datasetId: raw.id,
		createdAtVersionId: raw.versionId,
		fieldTypeOverrides: { ...overrides },
		encodings: scaffold.encodings,
		channelConfigs,
		labelsConfig,
		dataLabelsEncodings: { ...scaffold.dataLabels },
		...(ctx.themeId !== null ? { themeId: ctx.themeId } : {}),
		thumbnail: null,
		createdAt: ctx.now,
		updatedAt: ctx.now,
	}
	return { ok: true, visual: structuredVisual(visual), warnings: [] }
}

/** The channels a spec must fill to make the variation, and the field
 *  types each takes. */
const requiredChannels = (
	family: QuickStartChartType,
	v: QuickStartVariation
): Array<[SpecChannel, readonly FieldType[]]> =>
	(Object.entries(v.channels) as Array<[SpecChannel, readonly FieldType[]]>).filter(
		([channel]) => !OPTIONAL_CHANNELS[family]?.includes(channel)
	)

/** The required channels these fields leave empty or fill with a type the
 *  variation doesn't take, as `"channel" (types)`. */
const unfilled = (
	family: QuickStartChartType,
	v: QuickStartVariation,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): string[] =>
	requiredChannels(family, v)
		.filter(([channel, types]) => {
			const field = fields[channel]
			return field === undefined || !types.includes(typeOf(field))
		})
		.map(([channel, types]) => `"${channel}" (${types.join(" or ")})`)

/** The family's quick-start variation these channels fill best: every
 *  channel it requires is mapped to a field of a type it takes. Ties go to
 *  the one listed first, as on the quick-start bar. */
export const matchVariation = (
	family: QuickStartChartType,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): QuickStartVariation | undefined => {
	let best: QuickStartVariation | undefined
	let bestSize = -1
	for (const v of QUICK_START_VARIATIONS[family]) {
		const size = requiredChannels(family, v).length
		if (size > bestSize && unfilled(family, v, fields, typeOf).length === 0) {
			best = v
			bestSize = size
		}
	}
	return best
}

/** The family's variation called `name` (case-insensitive), or why it
 *  can't be used: no such variation, or the encodings don't fill it. */
export const namedVariation = (
	family: QuickStartChartType,
	name: string,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): QuickStartVariation | string => {
	const all = QUICK_START_VARIATIONS[family]
	const v = all.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
	const names = all.map((x) => x.name)
	if (!v) {
		return `no "${named(name)}" variation of "${family}"${didYouMean(name, names)} (variations: ${list(names)})`
	}
	const missing = unfilled(family, v, fields, typeOf)
	return missing.length > 0 ? `"${v.name}" needs ${missing.join(", ")}` : v
}

/** What the closest variation of `family` still needs. */
const familyNeeds = (
	family: QuickStartChartType,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): string => {
	const needs = QUICK_START_VARIATIONS[family].map((v) => unfilled(family, v, fields, typeOf))
	const fewest = needs.reduce((a, b) => (b.length < a.length ? b : a))
	return `a "${family}" chart needs ${fewest.join(", ")} (the chart-spec vocabulary lists its variations)`
}

/** A variation's settings, minus the field choices the spec already made.
 *  Its stack mode stays the default a spec's `stack` overrides. */
const knobsOf = (
	v: QuickStartVariation,
	fields: Partial<Record<SpecChannel, string>>
): Omit<QuickStartVariation, "name" | "channels"> => {
	const { name: _name, channels: _channels, allowOpportunisticHue: _hue, ...knobs } = v
	if (fields.connection !== undefined) delete knobs.connectionFrom
	if (fields.hue !== undefined) {
		delete knobs.hueFrom
		delete knobs.hueMeasureSource
	}
	return knobs
}

/** Compose a parsed spec into a visual, checking it against the data:
 *  dataset, folder and fields exist, each field suits its channel,
 *  channels don't conflict, the family is the one the encodings make, and
 *  bounds sit on a quantitative or temporal axis. Every problem is
 *  collected. */
export const composeVisual = (spec: ChartSpec, ctx: ComposeContext): ComposeVisualResult =>
	compose(spec, [], ctx)

/** Parse and compose in one pass, so shape problems and data problems are
 *  reported together. */
export const composeChartSpec = (input: unknown, ctx: ComposeContext): ComposeVisualResult => {
	const { draft, errors } = readChartSpec(input)
	if (!draft) return { ok: false, errors: capProblems(errors) }
	return compose(draft, errors, ctx)
}
