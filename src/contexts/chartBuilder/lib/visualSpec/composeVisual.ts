/** Chart spec → complete Visual. The visual starts from the same draft a
 *  new visual in the editor starts from (`newVisualDraft`), takes its hue
 *  config the way a quick-start scaffold does (`scaffoldVariation`), and
 *  only then gets the spec's own choices layered on top, so every slice the
 *  renderer reads is present and themed. An edit starts from the stored
 *  visual as the editor opens it (`hydrateVisual`) instead. */

import { barTotalFieldName } from "../barTotalLabel"
import { channelAccepts, channelsConflict } from "../channels"
import { getChartModeDef, type ChartMode } from "../chartMode"
import { isBarModeId } from "../chartModes/families"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
	type ColorSlotConfig,
	type ColorSlotKey,
} from "../channelConfig"
import { COLOR_SLOT_DEFS, legacySlotColor } from "../colorSlots"
import {
	applyDerivedVariablesBeforeReshape,
	splitDerivedVariablesAroundReshape,
} from "../derivedReshapeStages"
import {
	applyDerivedVariablesToView,
	DEFAULT_DERIVED_VARIABLES_CONFIG,
	type DerivedVariablesConfig,
} from "../derivedVariables"
import { effectiveType } from "../fieldType"
import { flowLabelFieldNames } from "../flowNodeLabels"
import { foldFlowNodeTitles } from "../foldFlowNodeTitles"
import { buildQuantHueConfigFromTheme, seedOutlineHue } from "../hueDefaults"
import { applyCellConversions } from "../materializeTransforms"
import { scaffoldVariation, type ChannelAssignment } from "../quickStart"
import {
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "../quickStartVariations"
import { applyReshapeToView, DEFAULT_RESHAPE_CONFIG, type ReshapeConfig } from "../reshape"
import { resolveDatasetViewFromMeta } from "../resolveDatasetVersion"
import { structureVisualKeys } from "../savedKeyStructure"
import { parseValue } from "../scales"
import { seedColorSlot } from "../seedColorSlot"
import type {
	DataLabelsEncodings,
	DatasetMeta,
	DatasetView,
	Encodings,
	FieldType,
	Folder,
	Theme,
	Visual,
} from "../types"
import { hydrateVisual, newVisualDraft } from "../visualDefaults"
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
import { panelEdits } from "./panelEdits"
import {
	applySettings,
	completeSettings,
	isHueConfig,
	settingsProblems,
	shapeProblems,
	type SettingsPatch,
} from "./settings"
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

/** The data as the editor shows it for a visual (useCurrentDatasetView):
 *  the derived variables the reshape uses, computed wide; the reshape; the
 *  cell conversions an override switches on; then the other derived
 *  variables. */
const visualView = (
	raw: DatasetView,
	overrides: Record<string, FieldType>,
	reshape: ReshapeConfig,
	derived: DerivedVariablesConfig
): DatasetView => {
	const stages = splitDerivedVariablesAroundReshape(raw.fields, derived, reshape)
	const wide =
		applyDerivedVariablesBeforeReshape(raw, derived, stages.beforeIds, () =>
			applyCellConversions(raw, overrides)
		) ?? raw
	const converted = applyCellConversions(applyReshapeToView(wide, reshape), overrides) ?? wide
	return applyDerivedVariablesToView(converted, derived, stages.afterIds) ?? converted
}

const compose = (
	spec: ChartSpecDraft,
	prior: SpecProblem[],
	ctx: ComposeContext,
	base?: Visual
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

	const datasetId = base ? base.datasetId : spec.datasetId
	const dataset =
		datasetId != null && ctx.dataset?.meta.id === datasetId ? ctx.dataset : null
	if (datasetId != null && !dataset) {
		problem(base ? "" : "datasetId", `no dataset with id "${datasetId}"`)
	}
	if (base && datasetId == null) {
		problem("", "this chart has no dataset to check the edit against")
	}
	const raw = dataset
		? resolveDatasetViewFromMeta(dataset.meta, dataset.rows, undefined)
		: undefined
	if (!raw) return { ok: false, errors: capProblems(errors) }
	const hydrated = base ? hydrateVisual(base) : undefined

	// No prototype, so a field named "constructor" or "toString" reads as
	// unset rather than as an Object.prototype member.
	const overrides: Record<string, FieldType> = Object.create(null)
	for (const [field, type] of Object.entries({ ...base?.fieldTypeOverrides, ...spec.fieldTypes })) {
		overrides[field] = type
	}
	const view = visualView(
		raw,
		overrides,
		hydrated?.reshapeConfig ?? DEFAULT_RESHAPE_CONFIG,
		hydrated?.derivedVariablesConfig ?? DEFAULT_DERIVED_VARIABLES_CONFIG
	)
	const fieldNames = view.fields.map((f) => f.name)
	const hasField = (name: string) => fieldNames.includes(name)
	const missingField = (path: string, name: string) =>
		problem(path, `no field "${named(name)}" in dataset "${view.name}"${hint(name, fieldNames)}`)
	for (const field of Object.keys(spec.fieldTypes ?? {})) {
		if (hasField(field)) continue
		missingField(pathOf("fieldTypes", field), field)
		const kept = base?.fieldTypeOverrides?.[field]
		if (kept !== undefined) overrides[field] = kept
		else delete overrides[field]
	}
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

	// The chart's channels after the spec: an edit starts from the chart's
	// own, and a null unmaps one. A channel the chart fills with a derived
	// measure (no field) stays unless unmapped.
	const fields: Partial<Record<SpecChannel, string>> = {}
	const measureChannels: SpecChannel[] = []
	for (const [channel, enc] of Object.entries(base?.encodings ?? {})) {
		if (channel === "text" || !enc) continue
		if (enc.field) fields[channel as SpecChannel] = enc.field
		else if (enc.measureSource) measureChannels.push(channel as SpecChannel)
	}
	const changed = Object.entries(spec.encodings) as Array<[SpecChannel, string | null]>
	for (const [channel, field] of changed) {
		if (field === null) delete fields[channel]
		else fields[channel] = field
		const i = measureChannels.indexOf(channel)
		if (i >= 0) measureChannels.splice(i, 1)
	}
	const mapped = Object.entries(fields) as Array<[SpecChannel, string]>

	let encodingsOk = true
	for (const [channel, field] of changed) {
		if (field === null) continue
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
	if (base && mapped.some(([, field]) => !hasField(field))) {
		if (encodingsOk) {
			problem("encodings", "this chart maps a field its dataset no longer has; fix it in the editor")
		}
		encodingsOk = false
	}
	// A clash is blamed on the channel the spec names when only one of the
	// pair is new.
	const active = [...mapped.map(([c]) => c), ...measureChannels]
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

	const picked =
		spec.family && spec.variation
			? namedVariation(spec.family, spec.variation, fields, typeOf)
			: undefined
	if (typeof picked === "string") problem("variation", picked)
	const variant =
		typeof picked === "object"
			? picked
			: spec.family && !spec.variation && !base
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
	/** Each axis's bounds as stored: numbers, dates as epoch ms; null
	 *  clears one. */
	const bounds: Record<"x" | "y", { min?: number | null; max?: number | null }> = { x: {}, y: {} }
	let start: { encodings: Encodings; channelConfigs: ChannelConfigs; dataLabels: DataLabelsEncodings } | undefined
	if (encodingsOk) {
		let mode: ReturnType<typeof getChartModeDef>
		if (hydrated) {
			const encodings = { ...hydrated.encodings }
			for (const [channel, field] of changed) encodings[channel] = { field }
			start = {
				encodings,
				channelConfigs: { ...hydrated.channelConfigs },
				dataLabels: { ...hydrated.dataLabelsEncodings },
			}
			mode = getChartModeDef(encodings, typeOf, hydrated.channelConfigs, hydrated.mapConfig)
			const modes: readonly string[] = spec.family ? (FAMILY_MODES[spec.family] ?? []) : []
			if (spec.family && !modes.includes(mode.id)) {
				problem(
					"family",
					`a "${spec.family}" chart is ${list(modes)}; these encodings make a "${mode.id}" chart`
				)
			}
		} else {
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
			const scaffold = scaffoldVariation(variation, assignments, draft.channelConfigs, ctx.theme)
			start = { encodings: scaffold.encodings, channelConfigs: scaffold.configs, dataLabels: scaffold.dataLabels }
			mode = getChartModeDef(scaffold.encodings, typeOf, scaffold.configs, draft.mapConfig)
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
				if (v === null) {
					bounds[axis][bound] = null
				} else if (type === "temporal") {
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

	// Settings are checked against the visual they land on once it is
	// composed; when something else is already wrong they are checked now,
	// against the chart or a new chart's draft, so every problem is reported
	// in one answer.
	const settingsDraft = { ...draft } as Visual
	// A label may also print what the Data Labels panel derives: a bar's
	// total, a flow node's in and out.
	const labelFields = [
		...fieldNames,
		...[barTotalFieldName(fieldNames) ?? []].flat(),
		...flowLabelFieldNames(fieldNames),
	]
	/** The patch as the panels would make it, checked. */
	const settingsFor = (on: Visual) => {
		const edits = panelEdits(spec.settings as SettingsPatch, {
			visual: on,
			theme: ctx.theme,
			rows: view.rows,
			fieldNames,
			typeOf,
		})
		const problems = [...settingsProblems(edits.patch, on, settingsDraft, labelFields), ...edits.problems]
		return { edits, problems }
	}
	if (spec.settings && (errors.length > 0 || !start)) {
		errors.push(...settingsFor(hydrated ?? settingsDraft).problems)
	}

	if (errors.length > 0 || !start) return { ok: false, errors: capProblems(errors) }

	const channelConfigs = start.channelConfigs
	// The Outline color panel seeds its config when a field is picked; mirror it.
	if (typeof spec.encodings.outlineHue === "string") {
		channelConfigs.outlineHue = seedOutlineHue(
			channelConfigs.outlineHue,
			typeOf(spec.encodings.outlineHue),
			ctx.theme
		)
	}
	if (hydrated) {
		if (spec.encodings.length === null) channelConfigs.defaultLength = null
		// A hue field of the other kind swaps the hue config, keeping the
		// one it replaces as the Color panel does.
		if (spec.encodings.hue && hueType) {
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
		if (spec.stack && channelConfigs.hue?.kind === "categorical") {
			channelConfigs.hue = { ...channelConfigs.hue, stackMode: spec.stack }
		}
	}
	for (const axis of ["x", "y"] as const) {
		const want = spec.axes?.[axis]
		if (!want) continue
		const next: AxisConfig = { ...(channelConfigs[axis] ?? DEFAULT_AXIS_CONFIG) }
		for (const bound of ["min", "max"] as const) {
			const b = bounds[axis][bound]
			if (b === null) delete next[bound]
			else if (b !== undefined) next[bound] = b
		}
		// Only one bound can be new here: the reader already compared a pair
		// given together.
		if (typeof next.min === "number" && typeof next.max === "number" && next.min >= next.max) {
			const given = want.min !== undefined ? "min" : "max"
			const message =
				given === "min"
					? `"min" (${String(want.min)}) must be below "max" (${next.max}), which the chart already has`
					: `"max" (${String(want.max)}) must be above "min" (${next.min}), which the chart already has`
			return { ok: false, errors: [{ path: pathOf("axes", axis, given), message }] }
		}
		if (want.format !== undefined) next.customFormat = want.format
		channelConfigs[axis] = next
	}

	const labelsConfig = { ...(hydrated ?? draft).labelsConfig }
	if (spec.title !== undefined) labelsConfig.title = spec.title
	if (spec.subtitle !== undefined) labelsConfig.subtitle = spec.subtitle
	if (spec.axes?.x?.title !== undefined) labelsConfig.xAxisTitle = spec.axes.x.title
	if (spec.axes?.y?.title !== undefined) labelsConfig.yAxisTitle = spec.axes.y.title

	const name = spec.name?.trim() || hydrated?.name || spec.title?.trim() || "Untitled"
	const visual: Visual = hydrated
		? {
				...hydrated,
				name,
				folderId: spec.folderId !== undefined ? spec.folderId : hydrated.folderId,
				fieldTypeOverrides: { ...overrides },
				encodings: start.encodings,
				channelConfigs,
				labelsConfig,
				updatedAt: ctx.now,
			}
		: {
				...draft,
				id: ctx.id,
				name,
				folderId: spec.folderId ?? null,
				datasetId: raw.id,
				createdAtVersionId: raw.versionId,
				fieldTypeOverrides: { ...overrides },
				encodings: start.encodings,
				channelConfigs,
				labelsConfig,
				dataLabelsEncodings: { ...start.dataLabels },
				...(ctx.themeId !== null ? { themeId: ctx.themeId } : {}),
				thumbnail: null,
				createdAt: ctx.now,
				updatedAt: ctx.now,
			}
	if (spec.settings) {
		const { edits, problems } = settingsFor(visual)
		if (problems.length > 0) return { ok: false, errors: capProblems(problems) }
		const applied = applySettings(visual, edits.patch, edits.newId)
		const finished = edits.finish(seedPickedSlots(applied, edits.patch, typeOf, ctx.theme))
		const patched = completeSettings(finished.visual, edits.patch, (value, bare) =>
			isHueConfig(bare) ? completeHue(value, ctx.theme) : value
		)
		const unfinished = [...finished.problems, ...shapeProblems(edits.patch, visual, patched)]
		if (unfinished.length > 0) return { ok: false, errors: capProblems(unfinished) }
		return { ok: true, visual: structuredVisual(patched), warnings: [] }
	}
	return { ok: true, visual: structuredVisual(visual), warnings: [] }
}

/** The members of a categorical hue config, which a hue with no kind
 *  that names only these is taken to be. */
const CATEGORICAL_HUE_KEYS = Object.keys(DEFAULT_CATEGORICAL_HUE_CONFIG)

/** A hue config a settings patch names, completed as the Color panel
 *  makes one: a categorical hue from the default with no colors of its
 *  own (`SlotCategoricalControls`), a quantitative one from the theme's
 *  gradient. A kind it can't tell is left for shapeProblems to report. */
const completeHue = (hue: Record<string, unknown>, theme: Theme): Record<string, unknown> => {
	const kind = hue.kind ?? (Object.keys(hue).every((k) => CATEGORICAL_HUE_KEYS.includes(k)) ? "categorical" : undefined)
	if (kind === "categorical") return { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {}, ...hue }
	if (kind === "quantitative") return { ...buildQuantHueConfigFromTheme(theme), ...hue }
	return hue
}

/** A color slot a settings patch names gets a field and a single color,
 *  as the Color panel's first touch of a slot gives it (`updateSlot`).
 *  One the patch gives a field, and no colors, gets the colors the Color
 *  panel gives it when that field is picked there (`ColorSlotControls`). */
const seedPickedSlots = (
	visual: Visual,
	patch: SettingsPatch,
	typeOf: (field: string) => FieldType,
	theme: Theme
): Visual => {
	const configs = patch.channelConfigs as { colorSlots?: Record<string, unknown> } | undefined
	const slots = configs?.colorSlots
	if (!slots) return visual
	const colorSlots = { ...visual.channelConfigs.colorSlots }
	for (const [key, slot] of Object.entries(slots)) {
		if (typeof slot !== "object" || slot === null) continue
		const given = slot as Record<string, unknown>
		const k = key as ColorSlotKey
		const current = colorSlots[k]
		const base = {
			field: current?.field ?? null,
			singleColor:
				current?.singleColor ?? legacySlotColor(k, visual.channelConfigs) ?? COLOR_SLOT_DEFS[k]?.themeColor(theme),
			...current,
		}
		const picked = typeof given.field === "string" && !("hue" in given || "palette" in given || "paletteId" in given)
		colorSlots[k] = (picked ? { ...base, ...seedColorSlot(given.field as string, typeOf(given.field as string), theme) } : base) as ColorSlotConfig
	}
	return { ...visual, channelConfigs: { ...visual.channelConfigs, colorSlots } }
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

/** Parse and apply a chart edit in one pass, with the checks a create
 *  gets. Only what the edit names changes; `ctx.dataset` must be the
 *  visual's own. */
export const composeChartEdit = (
	visual: Visual,
	input: unknown,
	ctx: Omit<ComposeContext, "id">
): ComposeVisualResult => {
	const { draft, errors } = readChartSpec(input, "edit")
	if (!draft) return { ok: false, errors: capProblems(errors) }
	return compose(draft, errors, { ...ctx, id: visual.id }, structuredVisual(visual))
}
