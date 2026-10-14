/** Chart spec → complete Visual. The visual starts from the same draft a
 *  new visual in the editor starts from (`newVisualDraft`), takes its hue
 *  config the way a quick-start scaffold does (`scaffoldVariation`), and
 *  only then gets the spec's own choices layered on top, so every slice the
 *  renderer reads is present and themed. */

import { channelAccepts, channelsConflict } from "../channels"
import { getChartModeDef, type ChartMode } from "../chartMode"
import { isBarModeId } from "../chartModes/families"
import type { AxisConfig } from "../channelConfig"
import { applyDollarConversionToView } from "../dollarCells"
import { effectiveType } from "../fieldType"
import { applyPercentConversionToView } from "../percentCells"
import { scaffoldVariation, type ChannelAssignment } from "../quickStart"
import type {
	QuickStartChartType,
	QuickStartVariation,
} from "../quickStartVariations"
import { resolveDatasetViewFromMeta } from "../resolveDatasetVersion"
import { parseValue } from "../scales"
import {
	emptyEncodings,
	type DatasetMeta,
	type DatasetView,
	type FieldType,
	type Folder,
	type Theme,
	type Visual,
} from "../types"
import { newVisualDraft } from "../visualDefaults"
import {
	capProblems,
	MAX_PROBLEMS,
	named,
	pathOf,
	readChartSpec,
	type ChartSpec,
	type ChartSpecDraft,
	type SpecChannel,
	type SpecProblem,
} from "./chartSpec"
import { didYouMean } from "./suggest"

/** What a spec is composed against. The caller looks up the spec's dataset
 *  and theme; `dataset` is null when no dataset has the spec's id. */
export type ComposeContext = {
	/** The spec's dataset, with the rows of the version the spec names (or
	 *  of its latest version when it names none). */
	dataset: { meta: DatasetMeta; rows: Array<Record<string, string>> } | null
	folders: readonly Folder[]
	/** The theme the visual is styled under: the spec's `themeId` resolved,
	 *  else the library default. */
	theme: Theme
	themeId: string | null
	now: number
	/** The new visual's id. */
	id: string
}

/** The visuals storage version composed visuals are complete at: no
 *  migration step up to it changes them. Raise it only after checking
 *  `compose` against each new step in `visualsMigrations`. */
export const COMPOSED_VISUALS_VERSION = 6

export type ComposeVisualResult =
	| { ok: true; visual: Visual; warnings: SpecProblem[] }
	| { ok: false; errors: SpecProblem[] }

/** The chart modes each quick-start family draws. */
const FAMILY_MODES: Record<QuickStartChartType, readonly ChartMode[]> = {
	bar: ["bars-x", "bars-y"],
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
	map: ["geo-points", "geo-symbols", "geo-choropleth"],
	circles: ["packed-circles"],
	treemap: ["treemap"],
	sunburst: ["sunburst"],
	sankey: ["sankey"],
	chord: ["chord"],
}

const DISCRETE: readonly FieldType[] = ["categorical", "ordinal"]

const list = (items: readonly string[]): string =>
	items.map((s) => `"${s}"`).join(", ")

/** Distinct values of `field` across `rows`, in first-seen order. */
const levelsOf = (
	rows: ReadonlyArray<Record<string, string>>,
	field: string
): string[] => [...new Set(rows.map((r) => r[field] ?? ""))]

/** The data-label mapping a chart's marks can carry: where each label sits
 *  (x / y) and what it prints (value). */
type LabelPlacement = { x: string; y: string; value: string }

const resolveLabelPlacement = (
	mode: ReturnType<typeof getChartModeDef>,
	encodings: ChartSpec["encodings"],
	typeOf: (field: string) => FieldType
): LabelPlacement | null => {
	const { x, y, length } = encodings
	const measureAxis = mode.canvas.measureAxis
	if (measureAxis && length) {
		const category = measureAxis === "x" ? y : x
		if (!category) return null
		return measureAxis === "x"
			? { x: length, y: category, value: length }
			: { x: category, y: length, value: length }
	}
	if (mode.id === "scatter" && x && y) {
		const value =
			typeOf(y) === "quantitative" ? y : typeOf(x) === "quantitative" ? x : null
		return value ? { x, y, value } : null
	}
	return null
}

const compose = (
	spec: ChartSpecDraft,
	prior: SpecProblem[],
	ctx: ComposeContext
): ComposeVisualResult => {
	const errors = [...prior]
	const warnings: SpecProblem[] = []
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
		problem("themeId", `no theme with id "${spec.themeId}"`)
	}

	const dataset =
		spec.datasetId !== undefined && ctx.dataset?.meta.id === spec.datasetId
			? ctx.dataset
			: null
	if (spec.datasetId !== undefined && !dataset) {
		problem("datasetId", `no dataset with id "${spec.datasetId}"`)
	}
	if (
		dataset &&
		spec.datasetVersionId !== undefined &&
		!dataset.meta.versions.some((v) => v.id === spec.datasetVersionId)
	) {
		problem(
			"datasetVersionId",
			`dataset "${dataset.meta.name}" has no version "${spec.datasetVersionId}"`
		)
	}
	const view: DatasetView | undefined = dataset
		? resolveDatasetViewFromMeta(dataset.meta, dataset.rows, spec.datasetVersionId)
		: undefined
	if (!view) return { ok: false, errors: capProblems(errors) }

	const fieldNames = view.fields.map((f) => f.name)
	const hasField = (name: string) => fieldNames.includes(name)
	const missingField = (path: string, name: string) =>
		problem(
			path,
			`no field "${named(name)}" in dataset "${view.name}"${hint(name, fieldNames)}`
		)

	// No prototype, so a field named "constructor" or "toString" reads as
	// unset rather than as an Object.prototype member.
	const overrides: Record<string, FieldType> = Object.create(null)
	for (const [field, type] of Object.entries(spec.fieldTypes ?? {})) {
		if (hasField(field)) overrides[field] = type
		else missingField(pathOf("fieldTypes", field), field)
	}
	const typeOf = (field: string): FieldType => effectiveType(view, field, overrides)

	// The cells as the renderer reads them, after the percent and dollar
	// conversions an override can switch on.
	const converted = applyDollarConversionToView(
		applyPercentConversionToView(view, overrides),
		overrides
	)
	for (const [field, type] of Object.entries(overrides)) {
		if (type !== "quantitative" && type !== "temporal") continue
		const parses = (converted?.rows ?? []).some(
			(r) => parseValue(r[field], type) !== null
		)
		if (!parses) {
			problem(
				pathOf("fieldTypes", field),
				`no value in "${field}" reads as ${type}, so the chart would be empty`
			)
		}
	}

	let encodingsOk = true
	const mapped = Object.entries(spec.encodings) as Array<[SpecChannel, string]>
	for (const [channel, field] of mapped) {
		const path = pathOf("encodings", channel)
		if (!hasField(field)) {
			missingField(path, field)
			encodingsOk = false
			continue
		}
		const type = typeOf(field)
		if (!channelAccepts(channel, type)) {
			problem(path, `"${channel}" can't take "${field}" (${type})`)
			encodingsOk = false
		}
	}
	mapped.forEach(([channel], i) => {
		const earlier = mapped.slice(0, i).find(([other]) => channelsConflict(channel, other))
		if (earlier) {
			problem(
				pathOf("encodings", channel),
				`"${channel}" can't be mapped together with "${earlier[0]}"`
			)
			encodingsOk = false
		}
	})

	const encodings = emptyEncodings()
	for (const [channel, field] of mapped) encodings[channel] = { field }
	const mode = getChartModeDef(encodings, typeOf)

	const hueField = spec.encodings.hue
	const hueType = hueField && hasField(hueField) ? typeOf(hueField) : null
	if (spec.colors) {
		if (!hueField || !hueType || !DISCRETE.includes(hueType)) {
			problem("colors", `"colors" needs encodings.hue mapped to a categorical or ordinal field`)
		} else {
			const levels = levelsOf(view.rows, hueField)
			for (const level of Object.keys(spec.colors)) {
				if (levels.includes(level)) continue
				problem(
					pathOf("colors", level),
					`"${hueField}" has no level "${named(level)}"${hint(level, levels)}`
				)
			}
		}
	}
	if (spec.stack && !hueField) {
		problem("stack", `"stack" needs encodings.hue: it stacks or groups the hue levels`)
	}
	if (spec.fill && hueField) {
		warnings.push({ path: "fill", message: `"fill" is unused while encodings.hue colors the marks` })
	}

	for (const [field, wanted] of Object.entries(spec.order ?? {})) {
		const path = pathOf("order", field)
		if (!hasField(field)) {
			missingField(path, field)
			continue
		}
		const levels = levelsOf(view.rows, field)
		const unknown = wanted.filter((l) => !levels.includes(l))
		const missing = levels.filter((l) => !wanted.includes(l))
		if (unknown.length > 0 || missing.length > 0) {
			problem(
				path,
				[
					`an order must list every level of "${field}" once`,
					unknown.length > 0 ? `no level ${list(unknown)}` : null,
					missing.length > 0 ? `missing ${list(missing)}` : null,
				]
					.filter(Boolean)
					.join("; ")
			)
		}
	}

	let labels: LabelPlacement | null = null
	if (encodingsOk) {
		const familyModes: readonly string[] = spec.family ? FAMILY_MODES[spec.family] : []
		if (spec.family && !familyModes.includes(mode.id)) {
			problem(
				"family",
				`a "${spec.family}" chart is ${list(FAMILY_MODES[spec.family])}; these encodings make a "${mode.id}" chart`
			)
		}

		for (const axis of ["x", "y"] as const) {
			const field = spec.encodings[axis]
			const type = field ? typeOf(field) : null
			const continuous = type
				? type === "quantitative"
				: mode.canvas.measureAxis === axis
			if (
				spec.axes?.[axis]?.format !== undefined &&
				!continuous &&
				type !== "temporal"
			) {
				problem(
					pathOf("axes", axis, "format"),
					field
						? `the ${axis} axis shows "${field}" (${type}); "format" applies only to a quantitative or temporal axis`
						: `the ${axis} axis has no field and isn't this chart's measure axis`
				)
			}
			if (continuous) continue
			for (const bound of ["min", "max"] as const) {
				if (spec.axes?.[axis]?.[bound] === undefined) continue
				problem(
					pathOf("axes", axis, bound),
					field
						? `the ${axis} axis shows "${field}" (${typeOf(field)}); "${bound}" applies only to a quantitative axis`
						: `the ${axis} axis has no field and isn't this chart's measure axis`
				)
			}
		}

		if (spec.dataLabels) {
			labels = resolveLabelPlacement(mode, spec.encodings, typeOf)
			if (!labels) {
				problem(
					"dataLabels",
					`a "${mode.id}" chart has nowhere to put data labels; use a bar, area or scatter chart with a quantitative value`
				)
			} else if (
				typeof spec.dataLabels === "object" &&
				spec.dataLabels.position !== undefined &&
				!isBarModeId(mode.id)
			) {
				problem("dataLabels.position", `"position" applies only to bar charts`)
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors: capProblems(errors) }

	const draft = newVisualDraft(ctx.theme)
	const assignments: ChannelAssignment[] = mapped.map(([channel, field]) => ({
		channel,
		field: { name: field, inferredType: typeOf(field) },
	}))
	const variation: QuickStartVariation = {
		name: spec.family ?? "spec",
		channels: Object.fromEntries(
			assignments.map((a) => [a.channel, [a.field.inferredType]])
		),
		...(spec.stack ? { stackMode: spec.stack } : {}),
	}
	const scaffold = scaffoldVariation(variation, assignments, draft.channelConfigs, ctx.theme)
	const channelConfigs = scaffold.configs

	const hue = channelConfigs.hue
	if (spec.colors && hue?.kind === "categorical") {
		channelConfigs.hue = { ...hue, colors: { ...spec.colors } }
	}
	if (spec.fill) channelConfigs.defaultFill = spec.fill
	for (const axis of ["x", "y"] as const) {
		const want = spec.axes?.[axis]
		const base = channelConfigs[axis]
		if (!want || !base) continue
		const next: AxisConfig = { ...base }
		if (want.min !== undefined) next.min = want.min
		if (want.max !== undefined) next.max = want.max
		if (want.format !== undefined) next.customFormat = want.format
		channelConfigs[axis] = next
	}

	const labelsConfig = { ...draft.labelsConfig }
	if (spec.title !== undefined) labelsConfig.title = spec.title
	if (spec.subtitle !== undefined) labelsConfig.subtitle = spec.subtitle
	if (spec.axes?.x?.title !== undefined) labelsConfig.xAxisTitle = spec.axes.x.title
	if (spec.axes?.y?.title !== undefined) labelsConfig.yAxisTitle = spec.axes.y.title

	const dataLabelsEncodings = { ...scaffold.dataLabels }
	const dataLabelsConfig = { ...draft.dataLabelsConfig }
	if (labels) {
		dataLabelsEncodings.x = { field: labels.x }
		dataLabelsEncodings.y = { field: labels.y }
		dataLabelsEncodings.value = { field: labels.value }
		const look = typeof spec.dataLabels === "object" ? spec.dataLabels : {}
		if (look.format !== undefined) {
			dataLabelsConfig.fieldFormats = { [labels.value]: look.format }
		}
		if (look.position !== undefined) dataLabelsConfig.barLabelPosition = look.position
		if (look.color !== undefined) dataLabelsConfig.color = look.color
	}

	const visual: Visual = {
		...draft,
		id: ctx.id,
		name: spec.name?.trim() || spec.title?.trim() || "Untitled",
		folderId: spec.folderId ?? null,
		datasetId: view.id,
		createdAtVersionId: view.versionId,
		fieldTypeOverrides: { ...overrides },
		encodings: scaffold.encodings,
		channelConfigs,
		labelsConfig,
		dataLabelsEncodings,
		dataLabelsConfig,
		fieldLevelOrders: { ...spec.order },
		...(ctx.themeId !== null ? { themeId: ctx.themeId } : {}),
		thumbnail: null,
		createdAt: ctx.now,
		updatedAt: ctx.now,
	}
	return { ok: true, visual, warnings }
}

/** Compose a parsed spec into a visual, checking it against the data:
 *  dataset, version, folder and fields exist, each field suits its channel,
 *  channels don't conflict, colors and orders name real levels, bounds sit
 *  on a quantitative axis, and data labels have somewhere to go. Every
 *  problem is collected. */
export const composeVisual = (
	spec: ChartSpec,
	ctx: ComposeContext
): ComposeVisualResult => compose(spec, [], ctx)

/** Parse and compose in one pass, so shape problems and data problems are
 *  reported together. */
export const composeChartSpec = (
	input: unknown,
	ctx: ComposeContext
): ComposeVisualResult => {
	const { draft, errors } = readChartSpec(input)
	if (!draft) return { ok: false, errors: capProblems(errors) }
	return compose(draft, errors, ctx)
}
