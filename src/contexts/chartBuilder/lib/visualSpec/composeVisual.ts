/** Chart spec → complete Visual. The visual starts from the same draft a
 *  new visual in the editor starts from (`newVisualDraft`), takes its hue
 *  config the way a quick-start scaffold does (`scaffoldVariation`), and
 *  only then gets the spec's own choices layered on top, so every slice the
 *  renderer reads is present and themed. */

import { channelAccepts, channelsConflict } from "../channels"
import { getChartModeDef, type ChartMode } from "../chartMode"
import { isBarModeId } from "../chartModes/families"
import {
	DEFAULT_ANNOTATIONS_CONFIG,
	newLineSegment,
	newRectangle,
	newTextAnnotation,
	type AnnotationsConfig,
} from "../annotationsConfig"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
} from "../channelConfig"
import { buildQuantHueConfigFromTheme } from "../hueDefaults"
import { alphabeticalLevelOrder, orderLevelsByField } from "../orderLevelsByField"
import {
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	textAnnotationStyleFromTheme,
} from "../themeConfig"
import { parseExpression } from "../derivedExpression"
import {
	applyDerivedVariablesToView,
	DEFAULT_DERIVED_VARIABLES_CONFIG,
	derivedMathTypeIssues,
	derivedVariableIssues,
	effectiveDerivedName,
	makeNonNumericLookup,
	type DerivedVariable,
	type DerivedVariablesConfig,
} from "../derivedVariables"
import { applyDollarConversionToView } from "../dollarCells"
import { effectiveType } from "../fieldType"
import { applyPercentConversionToView } from "../percentCells"
import { detectGeoFields } from "../geo/detectGeoFields"
import {
	mapConfigForVariation,
	scaffoldVariation,
	type ChannelAssignment,
} from "../quickStart"
import {
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "../quickStartVariations"
import {
	applyReshapeToView,
	DEFAULT_RESHAPE_CONFIG,
	presentMeltFields,
	reshapeIssues,
	type ReshapeConfig,
} from "../reshape"
import { resolveDatasetViewFromMeta } from "../resolveDatasetVersion"
import { parseNumericCell, parseValue } from "../scales"
import {
	emptyEncodings,
	type DataLabelsEncodings,
	type DatasetMeta,
	type FieldLevelOrderSpec,
	type DatasetView,
	type FieldType,
	type Folder,
	type Theme,
	type Visual,
} from "../types"
import { hydrateVisual, newVisualDraft, type VisualDraft } from "../visualDefaults"
import {
	capProblems,
	MAX_PROBLEMS,
	named,
	pathOf,
	MIN_EPOCH_MS,
	readChartSpec,
	specDateMs,
	type AnnotationSpec,
	type ChartEdit,
	type DerivedVariableSpec,
	type ChartSpec,
	type ChartSpecDraft,
	type SpecChannel,
	type SpecProblem,
} from "./chartSpec"
import { applySettings, settingsProblems, type SettingsPatch } from "./settings"
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
export const FAMILY_MODES: Record<QuickStartChartType, readonly ChartMode[]> = {
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

/** Distinct non-blank values of `field` across `rows`, in first-seen
 *  order: the levels the Fields panel lists. */
const levelsOf = (
	rows: ReadonlyArray<Record<string, string>>,
	field: string
): string[] => [
	...new Set(rows.map((r) => r[field] ?? "").filter((v) => String(v) !== "")),
]

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
	ctx: ComposeContext,
	base?: Visual
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

	const datasetId = base ? base.datasetId : spec.datasetId
	const dataset =
		datasetId != null && ctx.dataset?.meta.id === datasetId ? ctx.dataset : null
	if (datasetId != null && !dataset) {
		problem(base ? "" : "datasetId", `no dataset with id "${datasetId}"`)
	}
	if (base && datasetId == null) {
		problem("", "this chart has no dataset to check the edit against")
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
	const raw: DatasetView | undefined = dataset
		? resolveDatasetViewFromMeta(dataset.meta, dataset.rows, spec.datasetVersionId)
		: undefined
	if (!raw) return { ok: false, errors: capProblems(errors) }
	const hydrated = base ? hydrateVisual(base) : undefined

	// No prototype, so a field named "constructor" or "toString" reads as
	// unset rather than as an Object.prototype member.
	const overrides: Record<string, FieldType> = Object.create(null)
	for (const [field, type] of Object.entries(base?.fieldTypeOverrides ?? {})) {
		overrides[field] = type
	}
	for (const [field, type] of Object.entries(spec.fieldTypes ?? {})) {
		overrides[field] = type
	}

	// The data as the editor shows it for this visual: its reshape, the
	// percent and dollar conversions an override switches on, then its
	// derived variables.
	const rawNames = raw.fields.map((f) => f.name)
	const reshapeConfig: ReshapeConfig =
		spec.reshape === null
			? { ...DEFAULT_RESHAPE_CONFIG }
			: spec.reshape
				? { ...DEFAULT_RESHAPE_CONFIG, ...spec.reshape, idFields: spec.reshape.idFields ?? [] }
				: (hydrated?.reshapeConfig ?? { ...DEFAULT_RESHAPE_CONFIG })
	if (spec.reshape) {
		for (const key of ["idFields", "meltFields"] as const) {
			for (const field of reshapeConfig[key]) {
				if (rawNames.includes(field)) continue
				problem(
					pathOf("reshape", key),
					`no field "${named(field)}" in dataset "${raw.name}"${hint(field, rawNames)}`
				)
			}
		}
		for (const issue of reshapeIssues(raw.fields, reshapeConfig)) problem("reshape", issue)
		if (presentMeltFields(raw.fields, reshapeConfig).length === 0 && reshapeConfig.meltFields.every((f) => rawNames.includes(f))) {
			problem("reshape.meltFields", "every melt field is also an ID field, so nothing would be reshaped")
		}
	}
	const shaped = applyReshapeToView(raw, reshapeConfig) ?? raw
	const converted =
		applyDollarConversionToView(applyPercentConversionToView(shaped, overrides), overrides) ??
		shaped

	const currentDerived = hydrated?.derivedVariablesConfig ?? DEFAULT_DERIVED_VARIABLES_CONFIG
	for (const name of spec.removeDerivedVariables ?? []) {
		if (!currentDerived.variables.some((v) => v.name === name)) {
			problem(
				"removeDerivedVariables",
				`no derived variable "${named(name)}"${hint(name, currentDerived.variables.map((v) => v.name))}`
			)
		}
	}
	const derivedConfig: DerivedVariablesConfig = mergeDerived(
		{ variables: currentDerived.variables.filter((v) => !(spec.removeDerivedVariables ?? []).includes(v.name)) },
		spec.derivedVariables ?? [],
		ctx.now
	)
	if (spec.derivedVariables) {
		const available = new Set(converted.fields.map((f) => f.name))
		const numeric = makeNonNumericLookup(converted.rows)
		const fromSpec = new Set(spec.derivedVariables.map((d) => d.name))
		derivedConfig.variables.forEach((variable, index) => {
			const name = effectiveDerivedName(variable, index)
			if (fromSpec.has(variable.name)) {
				const at = `derivedVariables[${spec.derivedVariables?.findIndex((d) => d.name === variable.name)}]`
				const issues = [
					...derivedVariableIssues(variable, index, available),
					...derivedMathTypeIssues(variable, available, numeric),
					...(variable.rules?.rules ?? []).flatMap((r) => {
						const parsed = parseExpression(r.condition)
						if (!parsed.ok) return [`condition "${named(r.condition)}": ${parsed.error}`]
						return parsed.fields
							.filter((f) => !available.has(f))
							.map((f) => `condition "${named(r.condition)}": {${f}} isn't a variable in the data.`)
					}),
				]
				for (const issue of issues) problem(at, issue)
			}
			available.add(name)
		})
	}
	const view = applyDerivedVariablesToView(converted, derivedConfig) ?? converted

	const fieldNames = view.fields.map((f) => f.name)
	const hasField = (name: string) => fieldNames.includes(name)
	const missingField = (path: string, name: string) =>
		problem(
			path,
			`no field "${named(name)}" in dataset "${view.name}"${hint(name, fieldNames)}`
		)

	for (const field of Object.keys(spec.fieldTypes ?? {})) {
		if (hasField(field)) continue
		missingField(pathOf("fieldTypes", field), field)
		if (base?.fieldTypeOverrides?.[field] !== undefined) {
			overrides[field] = base.fieldTypeOverrides[field]
		} else {
			delete overrides[field]
		}
	}
	const typeOf = (field: string): FieldType => effectiveType(view, field, overrides)

	for (const [field, type] of Object.entries(spec.fieldTypes ?? {})) {
		if (!hasField(field) || (type !== "quantitative" && type !== "temporal")) continue
		const parses = view.rows.some((r) => parseValue(r[field], type) !== null)
		if (!parses) {
			problem(
				pathOf("fieldTypes", field),
				`no value in "${field}" reads as ${type}, so the chart would be empty`
			)
		}
	}

	// The chart's channels after the spec: an edit starts from the chart's
	// own, and a null unmaps one.
	const fields: Partial<Record<SpecChannel, string>> = {}
	const derivedChannels: SpecChannel[] = []
	for (const [channel, enc] of Object.entries(base?.encodings ?? {})) {
		if (channel === "text" || !enc) continue
		if (enc.field) fields[channel as SpecChannel] = enc.field
		else if (enc.measureSource) derivedChannels.push(channel as SpecChannel)
	}
	const changed = Object.entries(spec.encodings) as Array<[SpecChannel, string | null]>
	for (const [channel, field] of changed) {
		if (field === null) {
			delete fields[channel]
			const i = derivedChannels.indexOf(channel)
			if (i >= 0) derivedChannels.splice(i, 1)
		} else {
			fields[channel] = field
			const i = derivedChannels.indexOf(channel)
			if (i >= 0) derivedChannels.splice(i, 1)
		}
	}
	const mapped = Object.entries(fields) as Array<[SpecChannel, string]>

	let encodingsOk = true
	for (const [channel, field] of changed) {
		const path = pathOf("encodings", channel)
		if (field === null) {
			if (!base) problem(path, `"${channel}" must name a field, as a string`)
			continue
		}
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
	if (base) {
		for (const [, field] of mapped) {
			if (!hasField(field)) encodingsOk = false
		}
		if (!encodingsOk && errors.length === 0) {
			problem("encodings", "this chart maps a field its dataset no longer has; fix it in the editor")
		}
	}
	const active = [...mapped.map(([c]) => c), ...derivedChannels]
	/** Channel → the channels it can't be mapped with, blaming the one the
	 *  spec names when only one of a pair is new. */
	const clashes = new Map<SpecChannel, SpecChannel[]>()
	active.forEach((channel, i) => {
		for (const other of active.slice(0, i)) {
			if (!channelsConflict(channel, other)) continue
			const blamed = spec.encodings[channel] !== undefined ? channel : other
			const kept = blamed === channel ? other : channel
			clashes.set(blamed, [...(clashes.get(blamed) ?? []), kept])
		}
	})
	for (const [blamed, others] of clashes) {
		const names = list(others).replace(/, ([^,]*)$/, " and $1")
		problem(
			pathOf("encodings", blamed),
			base
				? `"${blamed}" can't be mapped together with ${names}; set ${names} to null to unmap ${others.length > 1 ? "them" : "it"}`
				: `"${blamed}" can't be mapped together with ${names}`
		)
		encodingsOk = false
	}
	if (base && active.length === 0 && changed.some(([, f]) => f === null)) {
		problem("encodings", "an edit can't unmap every channel")
	}

	const encodings = emptyEncodings()
	for (const [channel, field] of mapped) encodings[channel] = { field }
	if (base) {
		for (const channel of derivedChannels) encodings[channel] = { ...base.encodings[channel] }
		if (base.encodings.text) encodings.text = { ...base.encodings.text }
	}
	const mode = getChartModeDef(
		encodings,
		typeOf,
		hydrated?.channelConfigs,
		hydrated?.mapConfig
	)
	const variant =
		!base && spec.family ? matchVariation(spec.family, fields, typeOf) : undefined

	const hueField = fields.hue
	const hueType = hueField && hasField(hueField) ? typeOf(hueField) : null
	const hueDiscrete = !!hueType && DISCRETE.includes(hueType)
	const hueLevels = hueField && hueDiscrete ? levelsOf(view.rows, hueField) : []
	if (spec.colors) {
		if (!hueDiscrete) {
			problem("colors", `"colors" needs encodings.hue mapped to a categorical or ordinal field`)
		} else {
			for (const level of Object.keys(spec.colors)) {
				if (hueLevels.includes(level)) continue
				problem(
					pathOf("colors", level),
					`"${hueField}" has no level "${named(level)}"${hint(level, hueLevels)}`
				)
			}
		}
	}
	if (spec.stack && !hueField) {
		problem("stack", `"stack" needs encodings.hue: it stacks or groups the hue levels`)
	} else if (spec.stack && hueType && !hueDiscrete) {
		problem("stack", `"stack" needs a categorical or ordinal hue; "${hueField}" is ${hueType}`)
	}
	if (spec.fill && hueField) {
		warnings.push({ path: "fill", message: `"fill" is unused while encodings.hue colors the marks` })
	}

	let thresholdColors: Record<string, string> | null = null
	if (spec.colorThreshold) {
		const t = spec.colorThreshold
		if (!hueDiscrete || !hueField) {
			problem(
				"colorThreshold",
				`"colorThreshold" colors the hue levels, so it needs encodings.hue mapped to a categorical or ordinal field`
			)
		} else if (!hasField(t.field)) {
			missingField("colorThreshold.field", t.field)
		} else if (typeOf(t.field) !== "quantitative") {
			problem("colorThreshold.field", `"${t.field}" is ${typeOf(t.field)}; the threshold needs a quantitative field`)
		} else {
			const sides = new Map<string, Set<"below" | "above">>()
			for (const row of view.rows) {
				const level = row[hueField] ?? ""
				const n = parseNumericCell(row[t.field])
				if (n === null || String(level) === "") continue
				const set = sides.get(level) ?? new Set()
				set.add(n < t.at ? "below" : "above")
				sides.set(level, set)
			}
			const mixed = [...sides].filter(([, set]) => set.size > 1).map(([l]) => l)
			if (mixed.length > 0) {
				problem(
					"colorThreshold",
					`"${hueField}" levels ${list(mixed.slice(0, 5))}${mixed.length > 5 ? " and more" : ""} have "${t.field}" values on both sides of ${t.at}; color by a field with one value per level`
				)
			} else {
				thresholdColors = {}
				for (const [level, set] of sides) {
					thresholdColors[level] = set.has("below") ? t.below : t.above
				}
			}
		}
	}

	for (const [field, wanted] of Object.entries(spec.order ?? {})) {
		const path = pathOf("order", field)
		if (!hasField(field)) {
			missingField(path, field)
			continue
		}
		if (spec.sort?.[field]) {
			problem(path, `"${field}" has both an "order" and a "sort"; keep one`)
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

	const sorted: Record<string, { levels: string[]; spec: FieldLevelOrderSpec }> = {}
	for (const [field, want] of Object.entries(spec.sort ?? {})) {
		const path = pathOf("sort", field)
		if (!hasField(field)) {
			missingField(path, field)
			continue
		}
		const type = typeOf(field)
		if (!DISCRETE.includes(type)) {
			problem(path, `"${field}" is ${type}; only categorical or ordinal fields have levels to sort`)
			continue
		}
		if (want.by === "alphabetical") {
			sorted[field] = {
				levels: alphabeticalLevelOrder(levelsOf(view.rows, field), !!want.decreasing),
				spec: { by: "alphabetical", ...(want.decreasing ? { decreasing: true } : {}) },
			}
			continue
		}
		if (!hasField(want.by)) {
			missingField(pathOf("sort", field, "by"), want.by)
			continue
		}
		const byType = typeOf(want.by)
		if (byType !== "quantitative" && byType !== "temporal") {
			problem(
				pathOf("sort", field, "by"),
				`"${want.by}" is ${byType}; sort by a quantitative or temporal field, or "alphabetical"`
			)
			continue
		}
		sorted[field] = {
			levels: orderLevelsByField(
				view.rows,
				field,
				type,
				want.by,
				byType,
				!!want.decreasing
			),
			spec: { by: "field", byField: want.by, ...(want.decreasing ? { decreasing: true } : {}) },
		}
	}

	/** The field drawn along an axis: its own channel, else the measure. */
	const axisField = (axis: "x" | "y"): string | undefined =>
		fields[axis] ?? (mode.canvas.measureAxis === axis ? fields.length : undefined)

	/** null clears a bound. */
	const bounds: Record<"x" | "y", { min?: number | null; max?: number | null }> = { x: {}, y: {} }
	let labels: LabelPlacement | null = null
	if (encodingsOk) {
		if (spec.family && base && !(FAMILY_MODES[spec.family] as readonly string[]).includes(mode.id)) {
			problem("family", familyMismatch(spec.family, mode.id))
		}
		if (spec.family && !base && !variant) {
			problem("family", `${familyNeeds(spec.family, fields, typeOf)}; these encodings make a "${mode.id}" chart`)
		}

		for (const axis of ["x", "y"] as const) {
			const field = fields[axis]
			const type = field ? typeOf(field) : null
			const continuous = type
				? type === "quantitative"
				: mode.canvas.measureAxis === axis
			for (const bound of ["min", "max"] as const) {
				const v = spec.axes?.[axis]?.[bound]
				if (v === undefined) continue
				if (v === null) {
					bounds[axis][bound] = null
				} else if (type === "temporal") {
					const banded = isBarModeId(mode.id) && mode.canvas.measureAxis !== axis
					if (banded) {
						problem(
							pathOf("axes", axis, bound),
							`a bar chart draws "${field}" as one band per value, so bounds don't apply; filter the data, or use a line chart`
						)
					} else if (typeof v === "number" && Math.abs(v) < MIN_EPOCH_MS) {
						problem(
							pathOf("axes", axis, bound),
							`a number on a temporal axis is epoch milliseconds; for a year or date write it as text, e.g. "${v}" or "2020-01-01"`
						)
					} else {
						bounds[axis][bound] = typeof v === "string" ? specDateMs(v) : v
					}
				} else if (!continuous) {
					problem(
						pathOf("axes", axis, bound),
						field
							? `the ${axis} axis shows "${field}" (${typeOf(field)}); "${bound}" applies only to a quantitative or temporal axis`
							: `the ${axis} axis has no field and isn't this chart's measure axis`
					)
				} else if (typeof v === "string") {
					problem(pathOf("axes", axis, bound), `the ${axis} axis is quantitative; "${bound}" must be a number`)
				} else {
					bounds[axis][bound] = v
				}
			}
		}

		if (spec.dataLabels) {
			labels = resolveLabelPlacement(mode, fields, typeOf)
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

		if (spec.stems) {
			const field = fields[spec.stems.axis]
			if (mode.id !== "scatter") {
				problem("stems", `stems draw from points, so they need a scatter chart; these encodings make a "${mode.id}" chart`)
			} else if (spec.stems.at !== undefined && (!field || typeOf(field) !== "quantitative")) {
				problem(
					"stems.at",
					`"at" is a value on the ${spec.stems.axis} axis, which needs a quantitative field${field ? `; "${field}" is ${typeOf(field)}` : ""}`
				)
			}
		}

		for (const [i, a] of (spec.annotations ?? []).entries()) {
			for (const axis of ["x", "y"] as const) {
				const field = axisField(axis)
				const path = `annotations[${i}].${axis}`
				const values = a.kind === "text" ? [a[axis]] : a[axis]
				if (!field) {
					problem(path, `the ${axis} axis has no field to place an annotation against`)
					continue
				}
				const type = typeOf(field)
				if (DISCRETE.includes(type)) {
					const levels = levelsOf(view.rows, field)
					for (const v of values) {
						if (typeof v === "string" && levels.includes(v)) continue
						problem(
							path,
							`the ${axis} axis shows "${field}" (${type}); use its level names${typeof v === "string" ? `, not "${named(v)}"${hint(v, levels)}` : ""}`
						)
					}
				} else if (type === "quantitative") {
					if (values.some((v) => typeof v !== "number")) {
						problem(path, `the ${axis} axis shows "${field}" (quantitative); use numbers`)
					}
				} else if (values.some((v) => parseValue(String(v), "temporal") === null)) {
					problem(path, `the ${axis} axis shows "${field}" (temporal); use dates like its values`)
				}
			}
		}
	}

	const settingsDraft = newVisualDraft(ctx.theme) as Visual
	if (spec.settings && hydrated) {
		errors.push(...settingsProblems(spec.settings, hydrated, settingsDraft, fieldNames))
	} else if (spec.settings && errors.length > 0) {
		errors.push(...settingsProblems(spec.settings, settingsDraft, undefined, fieldNames))
	}

	if (errors.length > 0) return { ok: false, errors: capProblems(errors) }

	let start: Visual & VisualDraft
	let channelConfigs: ChannelConfigs
	let dataLabelsEncodings: DataLabelsEncodings
	if (hydrated) {
		start = hydrated
		channelConfigs = { ...start.channelConfigs }
		dataLabelsEncodings = { ...start.dataLabelsEncodings }
		if (spec.encodings.length === null) channelConfigs.defaultLength = null
		if (spec.encodings.hue !== undefined && hueField) {
			const quant = hueType === "quantitative" || hueType === "temporal"
			const hue = channelConfigs.hue
			if (quant && hue?.kind !== "quantitative") {
				channelConfigs.hue = channelConfigs.hueQuantStash ?? buildQuantHueConfigFromTheme(ctx.theme)
				if (hue?.kind === "categorical") channelConfigs.hueCategoricalStash = hue
			} else if (!quant && hue?.kind !== "categorical") {
				channelConfigs.hue = channelConfigs.hueCategoricalStash ?? { ...DEFAULT_CATEGORICAL_HUE_CONFIG }
				if (hue?.kind === "quantitative") channelConfigs.hueQuantStash = hue
			}
		}
	} else {
		const draft = newVisualDraft(ctx.theme)
		const assignments: ChannelAssignment[] = mapped.map(([channel, field]) => ({
			channel,
			field: { name: field, inferredType: typeOf(field) },
		}))
		const variant = spec.family ? matchVariation(spec.family, fields, typeOf) : undefined
		const variation: QuickStartVariation = {
			...(variant ? knobsOf(variant, fields) : {}),
			name: spec.family ?? "spec",
			channels: Object.fromEntries(
				assignments.map((a) => [a.channel, [a.field.inferredType]])
			),
			...(spec.stack ? { stackMode: spec.stack } : {}),
		}
		const scaffold = scaffoldVariation(variation, assignments, draft.channelConfigs, ctx.theme)
		const mapConfig = variant?.geo
			? mapConfigForVariation(
					variation,
					assignments,
					detectGeoFields(view.fields, view.rows, overrides),
					draft.mapConfig
				)
			: draft.mapConfig
		const made = getChartModeDef(scaffold.encodings, typeOf, scaffold.configs, mapConfig)
		if (spec.family && !(FAMILY_MODES[spec.family] as readonly string[]).includes(made.id)) {
			return { ok: false, errors: [{ path: "family", message: familyMismatch(spec.family, made.id) }] }
		}
		start = {
			...draft,
			mapConfig,
			id: ctx.id,
			name: "",
			folderId: null,
			datasetId: raw.id,
			createdAtVersionId: raw.versionId,
			fieldTypeOverrides: {},
			encodings: scaffold.encodings,
			thumbnail: null,
			createdAt: ctx.now,
			updatedAt: ctx.now,
		} as Visual & VisualDraft
		channelConfigs = scaffold.configs
		dataLabelsEncodings = { ...scaffold.dataLabels }
	}

	const hue = channelConfigs.hue
	if (hue?.kind === "categorical" && (spec.colors || thresholdColors || (base && spec.stack))) {
		channelConfigs.hue = {
			...hue,
			colors: { ...hue.colors, ...thresholdColors, ...spec.colors },
			...(base && spec.stack ? { stackMode: spec.stack } : {}),
		}
	}
	if (spec.fill) channelConfigs.defaultFill = spec.fill
	for (const axis of ["x", "y"] as const) {
		const want = spec.axes?.[axis]
		const current = channelConfigs[axis] ?? DEFAULT_AXIS_CONFIG
		if (!want) continue
		const next: AxisConfig = { ...current }
		for (const bound of ["min", "max"] as const) {
			const b = bounds[axis][bound]
			if (b === null) delete next[bound]
			else if (b !== undefined) next[bound] = b
		}
		if (want.format !== undefined) next.customFormat = want.format
		channelConfigs[axis] = next
	}
	if (spec.stems) {
		const { axis, at } = spec.stems
		channelConfigs.connection = {
			...DEFAULT_CONNECTION_CONFIG,
			...channelConfigs.connection,
			axisStem: at === undefined ? (axis === "x" ? "y-axis" : "x-axis") : axis === "x" ? "custom-x" : "custom-y",
			...(at !== undefined ? (axis === "x" ? { axisStemCustomX: at } : { axisStemCustomY: at }) : {}),
		}
	}

	const labelsConfig = { ...start.labelsConfig }
	if (spec.title !== undefined) labelsConfig.title = spec.title
	if (spec.subtitle !== undefined) labelsConfig.subtitle = spec.subtitle
	if (spec.axes?.x?.title !== undefined) labelsConfig.xAxisTitle = spec.axes.x.title
	if (spec.axes?.y?.title !== undefined) labelsConfig.yAxisTitle = spec.axes.y.title

	const dataLabelsConfig = { ...start.dataLabelsConfig }
	if (labels) {
		dataLabelsEncodings.x = { field: labels.x }
		dataLabelsEncodings.y = { field: labels.y }
		dataLabelsEncodings.value = { field: labels.value }
		const look = typeof spec.dataLabels === "object" ? spec.dataLabels : {}
		if (look.format !== undefined) {
			dataLabelsConfig.fieldFormats = {
				...(base ? dataLabelsConfig.fieldFormats : {}),
				[labels.value]: look.format,
			}
		}
		if (look.position !== undefined) dataLabelsConfig.barLabelPosition = look.position
		if (look.color !== undefined) dataLabelsConfig.color = look.color
	}

	const fieldLevelOrders = { ...(base ? start.fieldLevelOrders : {}), ...spec.order }
	const fieldLevelOrderSpecs = { ...(base ? start.fieldLevelOrderSpecs : {}) }
	for (const field of Object.keys(spec.order ?? {})) delete fieldLevelOrderSpecs[field]
	for (const [field, s] of Object.entries(sorted)) {
		fieldLevelOrders[field] = s.levels
		fieldLevelOrderSpecs[field] = s.spec
	}

	const kept = base ? start.annotationsConfig : DEFAULT_ANNOTATIONS_CONFIG
	const removing = new Set(spec.removeAnnotations ?? [])
	const annotationsConfig = addAnnotations(
		{
			...kept,
			rectangles: removing.has("band") ? [] : kept.rectangles,
			lineSegments: removing.has("line") ? [] : kept.lineSegments,
			texts: removing.has("text") ? [] : kept.texts,
		},
		spec.annotations ?? [],
		ctx
	)

	const name =
		spec.name?.trim() ||
		(base ? start.name : undefined) ||
		spec.title?.trim() ||
		"Untitled"

	const visual: Visual = {
		...start,
		reshapeConfig,
		derivedVariablesConfig: derivedConfig,
		name,
		folderId: spec.folderId !== undefined ? spec.folderId : start.folderId,
		fieldTypeOverrides: { ...overrides },
		encodings: base ? { ...start.encodings, ...encodings } : start.encodings,
		channelConfigs,
		labelsConfig,
		dataLabelsEncodings,
		dataLabelsConfig,
		fieldLevelOrders,
		fieldLevelOrderSpecs,
		annotationsConfig,
		...(ctx.themeId !== null && !base ? { themeId: ctx.themeId } : {}),
		updatedAt: ctx.now,
	}
	if (base) {
		for (const [channel, field] of changed) {
			if (field === null) visual.encodings[channel] = { field: null }
		}
	}
	if (spec.settings) {
		const problems = settingsProblems(spec.settings, visual, settingsDraft, fieldNames)
		if (problems.length > 0) return { ok: false, errors: capProblems(problems) }
		return { ok: true, visual: applySettings(visual, spec.settings as SettingsPatch), warnings }
	}
	return { ok: true, visual, warnings }
}

/** The family's quick-start variation these channels fill best: every
 *  channel it lists is mapped to a field of a type it takes. Ties go to
 *  the one listed first, as on the quick-start bar. */
export const matchVariation = (
	family: QuickStartChartType,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): QuickStartVariation | undefined => {
	let best: QuickStartVariation | undefined
	let bestSize = -1
	for (const v of QUICK_START_VARIATIONS[family]) {
		const wanted = Object.entries(v.channels) as Array<[SpecChannel, readonly FieldType[]]>
		const fits = wanted.every(([channel, types]) => {
			const field = fields[channel]
			return field !== undefined && types.includes(typeOf(field))
		})
		if (fits && wanted.length > bestSize) {
			best = v
			bestSize = wanted.length
		}
	}
	return best
}

const familyMismatch = (family: QuickStartChartType, made: string): string =>
	`a "${family}" chart is ${list(FAMILY_MODES[family])}; these encodings make a "${made}" chart`

/** What the closest variation of `family` still needs. */
const familyNeeds = (
	family: QuickStartChartType,
	fields: Partial<Record<SpecChannel, string>>,
	typeOf: (field: string) => FieldType
): string => {
	const needs = QUICK_START_VARIATIONS[family].map((v) =>
		(Object.entries(v.channels) as Array<[SpecChannel, readonly FieldType[]]>)
			.filter(([channel, types]) => {
				const field = fields[channel]
				return field === undefined || !types.includes(typeOf(field))
			})
			.map(([channel, types]) => `"${channel}" (${types.join(" or ")})`)
	)
	const fewest = needs.reduce((a, b) => (b.length < a.length ? b : a))
	return `a "${family}" chart needs ${fewest.join(", ")} (GET /api/chart-spec lists its variations)`
}

/** A variation's settings, minus the field choices the spec already made
 *  and the stack mode, which only the spec sets. */
const knobsOf = (
	v: QuickStartVariation,
	fields: Partial<Record<SpecChannel, string>>
): Omit<QuickStartVariation, "name" | "channels"> => {
	const { name: _name, channels: _channels, allowOpportunisticHue: _hue, ...knobs } = v
	delete knobs.stackMode
	if (fields.connection !== undefined) delete knobs.connectionFrom
	if (fields.hue !== undefined) {
		delete knobs.hueFrom
		delete knobs.hueMeasureSource
	}
	return knobs
}

/** The chart's derived variables with the spec's merged in: same name
 *  replaces in place, new names append. */
const mergeDerived = (
	current: DerivedVariablesConfig,
	specs: readonly DerivedVariableSpec[],
	now: number
): DerivedVariablesConfig => {
	const variables = [...current.variables]
	specs.forEach((d, i) => {
		const made: DerivedVariable = {
			id: `dvr-${now.toString(36)}-${i.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
			...d,
		}
		const at = variables.findIndex((v) => v.name === d.name)
		if (at >= 0) variables[at] = { ...made, id: variables[at]?.id ?? made.id }
		else variables.push(made)
	})
	return { variables }
}

/** Id for an annotation made from a spec; same shape as the panel's. */
const annotationId = (prefix: string, now: number, i: number): string =>
	`${prefix}-${now.toString(36)}-${i.toString(36)}${Math.random().toString(36).slice(2, 5)}`

const addAnnotations = (
	current: AnnotationsConfig,
	specs: readonly AnnotationSpec[],
	ctx: ComposeContext
): AnnotationsConfig => {
	const next: AnnotationsConfig = {
		rectangles: [...(current.rectangles ?? [])],
		circles: [...(current.circles ?? [])],
		lineSegments: [...(current.lineSegments ?? [])],
		texts: [...(current.texts ?? [])],
	}
	specs.forEach((a, i) => {
		if (a.kind === "band") {
			const r = newRectangle(annotationId("rect", ctx.now, i), rectangleStyleFromTheme(ctx.theme))
			next.rectangles.push({
				...r,
				xMin: a.x[0],
				xMax: a.x[1],
				yMin: a.y[0],
				yMax: a.y[1],
				coordSystem: "values",
				zOrder: a.front ? "front" : "behind",
				...(a.color ? { backgroundColor: a.color, borderColor: a.color } : {}),
				...(a.opacity !== undefined ? { backgroundOpacity: a.opacity } : {}),
				...(a.label !== undefined ? { text: a.label } : {}),
			})
		} else if (a.kind === "line") {
			const l = newLineSegment(annotationId("line", ctx.now, i), lineAnnotationStyleFromTheme(ctx.theme))
			next.lineSegments.push({
				...l,
				xMin: a.x[0],
				xMax: a.x[1],
				yMin: a.y[0],
				yMax: a.y[1],
				coordSystem: "values",
				zOrder: a.front ? "front" : "behind",
				...(a.color ? { lineColor: a.color } : {}),
				...(a.thickness !== undefined ? { lineThickness: a.thickness } : {}),
				...(a.dash ? { lineDash: a.dash } : {}),
			})
		} else {
			const t = newTextAnnotation(annotationId("text", ctx.now, i), textAnnotationStyleFromTheme(ctx.theme))
			next.texts.push({
				...t,
				x: a.x,
				y: a.y,
				coordSystem: "values",
				text: a.text,
				...(a.color ? { textColor: a.color } : {}),
			})
		}
	})
	return next
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

/** Apply a parsed edit to an existing visual, with the same checks as a
 *  create. Only what the edit names changes; `ctx.dataset` must be the
 *  visual's own. */
export const editVisual = (
	visual: Visual,
	edit: ChartEdit,
	ctx: Omit<ComposeContext, "id">
): ComposeVisualResult => compose({ ...edit, encodings: edit.encodings ?? {} }, [], { ...ctx, id: visual.id }, visual)

/** Parse and apply an edit in one pass. */
export const composeChartEdit = (
	visual: Visual,
	input: unknown,
	ctx: Omit<ComposeContext, "id">
): ComposeVisualResult => {
	const { draft, errors } = readChartSpec(input, "edit")
	if (!draft) return { ok: false, errors: capProblems(errors) }
	return compose(draft, errors, { ...ctx, id: visual.id }, visual)
}
