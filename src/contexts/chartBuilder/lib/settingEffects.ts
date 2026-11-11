/** What the sidebar panels do beyond storing a value, applied to a
 * settings patch after it merges (`applySettings`): the seeding a pick
 * triggers, the gates a control sits behind, and the clamps and sparse
 * storage the inputs apply. Every behavior here is the lib function the
 * panel itself calls, so the two can't drift. Pure. */

import { barTotalFieldName } from "./barTotalLabel"
import { canvasSizeToggled, aspectRatioToggled, MIN_CANVAS_DIM } from "./canvasSizeEdits"
import {
	axisFlipped,
	DATA_LABELS_SINGLE_COLOR_ID,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_SEGMENT_THICKNESS,
	type AxisConfig,
	type ChannelConfigs,
	type ColorSlotConfig,
	type FacetConfig,
} from "./channelConfig"
import { getChartModeDef } from "./chartMode"
import type { ChartModeDef } from "./chartModes/types"
import type { SpecProblem } from "./chartSpec"
import { COLOR_SLOT_DEFS } from "./colorSlots"
import { axisStemPatch, switchConnectionFill, withConnectionConfig } from "./connectionEdits"
import { resolveDashGapFill } from "./dashGapFill"
import { seedLabelTextPalette } from "./dataLabelsHue"
import {
	barValueAxis,
	DATA_LABEL_POSITION_CHANNELS,
	resolveDataLabelPositions,
	withBarLabelPosition,
} from "./dataLabelsPosition"
import { BAR_TOTAL_SEED, valueFieldsPatch } from "./dataLabelsValueFields"
import { columnAlignPatch, resolveDataTableStyle } from "./dataTableConfig"
import { distributionTypeOf, distributionTypePatch, type DistributionType } from "./distributionType"
import { facetAxisMapping } from "./facetAxisMapping"
import { facetGridPatch, facetSizingPatch, type FacetSizing } from "./facetEdits"
import { levelDefaultViewport, focusRegionPatch } from "./geo/focusRegion"
import { buildQuantHueConfigFromTheme } from "./hueDefaults"
import {
	LEGEND_CHANNELS,
	legendTitleChannels,
	mirroredVisualName,
	titleAlignmentPatch,
	titleAnglePatch,
	titlePlacementPatch,
	titleVerticalAlignmentPatch,
	tooltipBoxPatch,
	TOOLTIP_BOX_KEYS,
	type EncodingLegendChannel,
	type LabelFontKey,
	type TitlePlacement,
	type LegendChannel,
	type SwatchShapeChannel,
	type TooltipBoxKey,
} from "./labelsConfig"
import { legendHiddenPatch, swatchOutlineWidthPatch, swatchShapePatch, swatchSizePatch } from "./legendEdits"
import { UNTITLED_VISUAL_NAME } from "./nameUniqueness"
import { levelOrderFromSpec, withoutSelfScope } from "./orderLevelsByField"
import { paletteIdsOf, pickHuePalette, pickLabelPalette, pickSlotPalette } from "./paletteEdits"
import { seedQuantHue } from "./seedColorSlot"
import { fieldLevels, thicknessByLevel } from "./thicknessVaryBy"
import { customHtmlPatch } from "./tooltipDefaults"
import type { FieldLevelOrderSpec, FieldType, Theme, Visual } from "./types"
import { uniqueFieldValues } from "./uniqueFieldValues"
import { newVisualDraft } from "./visualDefaults"

export type SettingsDeps = {
	/** The theme the visual renders under; seeds anything the panels seed
	 *  from the theme. Without it those seeds are skipped. */
	theme?: Theme
	/** The data set's fields with their effective types. */
	fields?: ReadonlyArray<{ name: string; type: FieldType }>
	/** The data set's rows, for the settings that read the data (levels of
	 *  a field, computed orders, facet counts). */
	rows?: ReadonlyArray<Record<string, string>>
}

/** The settings paths whose effects read the data set rows. */
export const SETTINGS_READING_ROWS = [
	"fieldLevelOrderSpecs",
	"channelConfigs.connection.thicknessField",
	"channelConfigs.length.segmentThicknessField",
	"channelConfigs.facet.rows",
	"channelConfigs.facet.cols",
	"channelConfigs.facet.proportionalSizingX",
	"channelConfigs.facet.proportionalSizingY",
] as const

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether a settings patch touches a path whose effect reads the rows. */
export const settingsReadRows = (settings: unknown): boolean =>
	SETTINGS_READING_ROWS.some((path) => sent(settings, ...path.split(".")) !== undefined)

/** The value `patch` sends at `path`, or undefined when the path isn't in
 * it (a sent null is `null`). */
const sent = (patch: unknown, ...path: string[]): unknown => {
	let at: unknown = patch
	for (const key of path) {
		if (!isObj(at)) return undefined
		at = at[key]
	}
	return at
}
const has = (patch: unknown, ...path: string[]) => sent(patch, ...path) !== undefined

const continuous = (t: FieldType | undefined) => t === "quantitative" || t === "temporal"

/** The default tree a patch merges into where the visual has no stored
 * value yet (an absent slice, an absent `channelConfigs.x`): the editor's
 * own theme-seeded draft, with the color configs seeded by the mapped
 * field as the shelves seed them. */
export const settingDefaults = (visual: Visual, deps: SettingsDeps): Partial<Visual> | undefined => {
	if (!deps.theme) return undefined
	const theme = deps.theme
	const draft = newVisualDraft(theme)
	const typeOf = fieldTypeLookup(visual, deps)
	const hueFor = (field: string | null | undefined) =>
		continuous(field ? typeOf(field) : undefined)
			? buildQuantHueConfigFromTheme(theme)
			: DEFAULT_CATEGORICAL_HUE_CONFIG
	const slots: Record<string, ColorSlotConfig> = {}
	for (const [key, def] of Object.entries(COLOR_SLOT_DEFS))
		slots[key] = { field: null, singleColor: def.themeColor(theme), hue: DEFAULT_CATEGORICAL_HUE_CONFIG }
	return {
		...draft,
		channelConfigs: {
			...draft.channelConfigs,
			hue: hueFor(visual.encodings.hue?.field),
			outlineHue: hueFor(visual.encodings.outlineHue?.field),
			length: DEFAULT_LENGTH_CONFIG,
			colorSlots: slots as ChannelConfigs["colorSlots"],
		},
	}
}

const fieldTypeLookup =
	(visual: Visual, deps: SettingsDeps) =>
	(name: string): FieldType | undefined =>
		visual.fieldTypeOverrides?.[name] ?? deps.fields?.find((f) => f.name === name)?.type

const modeOf = (visual: Visual, typeOf: (n: string) => FieldType | undefined): ChartModeDef =>
	getChartModeDef(visual.encodings, typeOf, visual.channelConfigs, visual.mapConfig)

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** The clamps the number inputs apply, by catalog path (`*` = any key). */
const CLAMPS: Record<string, (n: number) => number> = {
	"channelConfigs.x.categoricalTickStride": (n) => Math.max(1, Math.floor(n)),
	"channelConfigs.y.categoricalTickStride": (n) => Math.max(1, Math.floor(n)),
	"channelConfigs.connection.chordAxis.labelEvery": (n) => Math.max(1, Math.floor(n)),
	"channelConfigs.connection.pointEveryN": (n) => Math.max(1, Math.floor(n)),
	"channelConfigs.length.barGapPx": (n) => Math.max(0, n),
	"channelConfigs.canvasSize.width": (n) => Math.max(MIN_CANVAS_DIM, n),
	"channelConfigs.canvasSize.height": (n) => Math.max(MIN_CANVAS_DIM, n),
	"channelConfigs.canvasSize.margins.*": (n) => Math.max(0, n),
	"channelConfigs.aspectRatio.length": (n) => Math.max(0.1, n),
	"channelConfigs.aspectRatio.width": (n) => Math.max(0.1, n),
	"legendConfig.columns": (n) => clamp(Math.round(n), 1, 6),
	"legendConfig.columnGap": (n) => clamp(n, -48, 96),
	"legendConfig.width": (n) => Math.max(0, n),
	"legendConfig.height": (n) => Math.max(0, n),
	"legendConfig.gradientBarLength": (n) => Math.max(0, n),
	"legendConfig.gradientBarThickness": (n) => Math.max(0, n),
	"legendConfig.gradientBarBorderWidth": (n) => Math.max(0, n),
	"legendConfig.swatchSizes.*": (n) => clamp(n, 3, 20),
	"legendConfig.swatchOutlineWidths.*": (n) => clamp(n, 0, 10),
	"tooltipConfig.hoverFadeAmount": (n) => clamp(n, 0, 1),
	"tooltipConfig.tooltipMaxWidth": (n) => Math.max(40, n),
	"tooltipConfig.tooltipCornerRadius": (n) => Math.max(0, n),
	"tooltipConfig.tooltipBackgroundOpacity": (n) => clamp(n, 0, 1),
	"tooltipConfig.tooltipShadowSize": (n) => Math.max(0, n),
	"tooltipConfig.tooltipShadowOpacity": (n) => clamp(n, 0, 1),
	"dataTableConfig.maxRows": (n) => Math.max(1, Math.round(n)),
}

/** Walk the sent paths of `patch` and clamp the stored number at each one
 * the table names. */
const applyClamps = (root: Record<string, unknown>, patch: unknown, at: string[]): void => {
	if (!isObj(patch)) return
	for (const [key, v] of Object.entries(patch)) {
		const path = [...at, key]
		if (typeof v === "number") {
			const rule = CLAMPS[path.join(".")] ?? CLAMPS[[...at, "*"].join(".")]
			if (rule) setAt(root, path, rule(v))
		} else if (isObj(v)) applyClamps(root, v, path)
	}
}

/** Write `value` at `path`, copying the objects along the way. */
const setAt = (root: Record<string, unknown>, path: readonly string[], value: unknown): void => {
	let at = root
	for (let i = 0; i < path.length - 1; i++) {
		const child = at[path[i]]
		const copy = isObj(child) ? { ...child } : {}
		at[path[i]] = copy
		at = copy
	}
	at[path[path.length - 1]] = value
}

/** `next` (the merged visual) with the panel behaviors the sent paths of
 * `patch` trigger. `prev` is the visual before the merge. */
export const applySettingEffects = (
	prev: Visual,
	next: Visual,
	patch: Record<string, unknown>,
	deps: SettingsDeps
): { visual: Visual; problems: SpecProblem[] } => {
	const problems: SpecProblem[] = []
	const bad = (path: string, message: string) => problems.push({ path, message })
	const theme = deps.theme
	const typeOf = fieldTypeLookup(next, deps)
	const fieldNames = deps.fields?.map((f) => f.name) ?? []
	const v = { ...next } as Record<string, unknown> & Visual
	const configs = () => v.channelConfigs
	const setConfigs = (c: ChannelConfigs) => {
		v.channelConfigs = c
	}
	const mode = modeOf(next, typeOf)
	/** A field's levels in display order; none without the rows. */
	const levelsOf = (field: string): string[] => {
		const type = typeOf(field)
		return deps.rows && type ? fieldLevels(deps.rows, field, type, v.fieldLevelOrders?.[field]) : []
	}

	// ---- Seeding -----------------------------------------------------

	// Data labels: the value checklist adds and removes composed labels; a
	// Bar total seeds its placement; coloring by a categorical field (or a
	// packed root group) seeds the text palette.
	if (has(patch, "dataLabelsEncodings")) {
		const before = prev.dataLabelsEncodings?.value
		const after = v.dataLabelsEncodings?.value
		const total = deps.fields ? barTotalFieldName(fieldNames) : null
		const cfg = v.dataLabelsConfig
		if (cfg && after && has(patch, "dataLabelsEncodings", "value")) {
			const prevFields = before?.multiField ? (before.fields ?? []) : []
			const nextFields = after.multiField ? (after.fields ?? []) : []
			if (after.multiField && nextFields.join("\u0000") !== prevFields.join("\u0000"))
				v.dataLabelsConfig = { ...cfg, ...valueFieldsPatch(cfg, prevFields, nextFields, total) }
			else if (!after.multiField && total !== null && after.field === total && before?.field !== total)
				v.dataLabelsConfig = { ...cfg, ...BAR_TOTAL_SEED }
		}
		const labelEncodings = v.dataLabelsEncodings
		if (labelEncodings)
			for (const ch of ["hue", "size"] as const) {
				const enc = labelEncodings[ch]
				// A field and a derived source are one choice: the sent one wins.
				if (!has(patch, "dataLabelsEncodings", ch) || !enc.measureSource || !enc.field) continue
				const sentField = has(patch, "dataLabelsEncodings", ch, "field")
				v.dataLabelsEncodings = {
					...labelEncodings,
					[ch]: sentField ? { ...enc, measureSource: undefined } : { ...enc, field: null },
				}
			}
		// A value with no position of its own takes the chart's axis fields,
		// stored, so the labels draw at once. A mode whose label positions
		// are locked to the axes (tile) takes no other field.
		const labels = v.dataLabelsEncodings
		if (labels && has(patch, "dataLabelsEncodings", "value")) {
			const filled = resolveDataLabelPositions(labels, v.encodings)
			let next = labels
			for (const ch of DATA_LABEL_POSITION_CHANNELS)
				if (filled[ch] !== labels[ch] && !has(patch, "dataLabelsEncodings", ch)) next = { ...next, [ch]: filled[ch] }
			// On bars, the value axis takes the Length variable, as the
			// panel's Value pick sets it, unless the patch sends that slot.
			const barAxis = barValueAxis(v.encodings)
			if (barAxis && !has(patch, "dataLabelsEncodings", barAxis))
				next = withBarLabelPosition(next, v.encodings)
			v.dataLabelsEncodings = next
		}
		if (labels && mode.labels.positionLockedToAxes)
			for (const ch of ["x", "y"] as const) {
				const field = labels[ch]?.field
				const axis = v.encodings[ch]?.field ?? null
				if (has(patch, "dataLabelsEncodings", ch) && field && field !== axis)
					bad(`dataLabelsEncodings.${ch}`, `a ${mode.id} chart's labels sit on its ${ch} axis${axis ? ` ("${axis}")` : ""}; the position can't be another field`)
			}
		const hue = v.dataLabelsEncodings?.hue
		if (hue && theme && v.dataLabelsConfig && has(patch, "dataLabelsEncodings", "hue")) {
			const seeds =
				hue.measureSource === "rootGroup" || (hue.field !== null && typeOf(hue.field) === "categorical")
			const seeded = seeds ? seedLabelTextPalette(v.dataLabelsConfig, theme) : null
			if (seeded) v.dataLabelsConfig = { ...v.dataLabelsConfig, ...seeded }
		}
	}

	// Order by: a spec computes the order; a hand order forgets the spec.
	if (has(patch, "fieldLevelOrderSpecs")) {
		const specs = { ...v.fieldLevelOrderSpecs }
		const orders = { ...v.fieldLevelOrders }
		for (const field of Object.keys(isObj(patch.fieldLevelOrderSpecs) ? patch.fieldLevelOrderSpecs : {})) {
			const spec = specs[field] as FieldLevelOrderSpec | undefined
			if (!spec) continue
			const type = typeOf(field)
			if (!type) {
				bad(`fieldLevelOrderSpecs.${field}`, `"${field}" is not a field of the data set`)
				continue
			}
			if (!deps.rows) {
				bad(`fieldLevelOrderSpecs.${field}`, `an order needs the data set rows to compute`)
				continue
			}
			const clean = withoutSelfScope(field, spec)
			const result = levelOrderFromSpec(deps.rows, field, type, clean, typeOf)
			if ("problem" in result) {
				bad(`fieldLevelOrderSpecs.${field}`, result.problem)
				continue
			}
			specs[field] = clean
			orders[field] = result.order
		}
		v.fieldLevelOrderSpecs = specs
		v.fieldLevelOrders = orders
	}
	if (has(patch, "fieldLevelOrders")) {
		const specs = { ...v.fieldLevelOrderSpecs }
		for (const field of Object.keys(isObj(patch.fieldLevelOrders) ? patch.fieldLevelOrders : {})) {
			if (!has(patch, "fieldLevelOrderSpecs", field)) delete specs[field]
		}
		v.fieldLevelOrderSpecs = specs
	}

	// Connection: fill polygon moves y to length and stacks; an axis-stem
	// mode seeds its threshold; thickness by field seeds one entry per level.
	if (has(patch, "channelConfigs", "connection")) {
		const fill = sent(patch, "channelConfigs", "connection", "fill")
		if (theme && (fill === "area" || fill === "line") && fill !== prev.channelConfigs?.connection?.fill) {
			const hueField = v.encodings.hue?.field ?? null
			const switched = switchConnectionFill(
				v.encodings,
				configs(),
				fill,
				theme,
				hueField ? (typeOf(hueField) ?? "categorical") : null
			)
			v.encodings = switched.encodings
			setConfigs(switched.configs)
		}
		const connection = configs().connection
		if (connection && has(patch, "channelConfigs", "connection", "axisStem")) {
			const stemmed = axisStemPatch(connection, connection.axisStem)
			setConfigs(
				theme
					? withConnectionConfig(configs(), theme, stemmed)
					: { ...configs(), connection: { ...connection, ...stemmed } }
			)
		}
		const c = configs().connection
		if (
			c &&
			has(patch, "channelConfigs", "connection", "thicknessField") &&
			!has(patch, "channelConfigs", "connection", "thicknessByValue")
		) {
			const field = c.thicknessField ?? null
			setConfigs({
				...configs(),
				connection: { ...c, thicknessByValue: field ? thicknessByLevel(levelsOf(field), c.thickness) : {} },
			})
		}
	}
	if (
		has(patch, "channelConfigs", "length", "segmentThicknessField") &&
		!has(patch, "channelConfigs", "length", "segmentThicknessByValue")
	) {
		const l = { ...DEFAULT_LENGTH_CONFIG, ...configs().length }
		const field = l.segmentThicknessField ?? null
		const thickness = l.segmentThickness ?? DEFAULT_SEGMENT_THICKNESS
		setConfigs({
			...configs(),
			length: { ...l, segmentThicknessByValue: field ? thicknessByLevel(levelsOf(field), thickness) : {} },
		})
	}

	// Palette picks: the id brings its colors (and pattern inks) along and
	// resets the per-value colors.
	if (theme) {
		for (const key of ["categoricalPaletteId", "ordinalPaletteId"] as const) {
			const id = sent(patch, "channelConfigs", key)
			if (typeof id !== "string") continue
			if (!paletteIdsOf(theme).includes(id)) {
				bad(`channelConfigs.${key}`, `no palette "${id}" in the theme; its palettes are ${paletteIdsOf(theme).map((p) => `"${p}"`).join(", ")}`)
				continue
			}
			setConfigs(pickHuePalette(configs(), theme, id, key === "ordinalPaletteId" ? "ordinal" : "categorical"))
		}
		const slotsSent = sent(patch, "channelConfigs", "colorSlots")
		if (isObj(slotsSent)) {
			const slots = { ...configs().colorSlots } as Record<string, ColorSlotConfig>
			for (const key of Object.keys(slotsSent)) {
				const id = sent(slotsSent, key, "paletteId")
				const slot = slots[key]
				if (typeof id !== "string" || !slot || has(slotsSent, key, "palette")) continue
				if (!paletteIdsOf(theme).includes(id)) {
					bad(`channelConfigs.colorSlots.${key}.paletteId`, `no palette "${id}" in the theme`)
					continue
				}
				const type = slot.field ? (typeOf(slot.field) ?? null) : null
				slots[key] = { ...slot, ...pickSlotPalette(theme, id, type) }
			}
			setConfigs({ ...configs(), colorSlots: slots as ChannelConfigs["colorSlots"] })
		}
		const labelPalette = sent(patch, "dataLabelsConfig", "paletteId")
		if (
			typeof labelPalette === "string" &&
			labelPalette !== DATA_LABELS_SINGLE_COLOR_ID &&
			!has(patch, "dataLabelsConfig", "palette") &&
			v.dataLabelsConfig
		) {
			if (!theme.categoricalPalettes.some((p) => p.id === labelPalette))
				bad("dataLabelsConfig.paletteId", `no palette "${labelPalette}" in the theme`)
			else v.dataLabelsConfig = { ...v.dataLabelsConfig, ...pickLabelPalette(theme, labelPalette) }
		}
	}

	// A continuous Fill field draws with a gradient: what the Color panel
	// makes true whenever it is open.
	if (theme && has(patch, "channelConfigs")) {
		const hueField = v.encodings.hue?.field
		if (hueField && continuous(typeOf(hueField)) && configs().hue?.kind !== "quantitative")
			setConfigs(seedQuantHue(configs(), theme))
	}

	// Canvas size and aspect ratio: enabling seeds the numbers.
	if (sent(patch, "channelConfigs", "canvasSize", "enabled") === true)
		setConfigs({ ...configs(), canvasSize: canvasSizeToggled(configs().canvasSize, true, theme) })
	if (sent(patch, "channelConfigs", "aspectRatio", "enabled") === true)
		setConfigs({ ...configs(), aspectRatio: aspectRatioToggled(configs().aspectRatio, true) })

	// Titles: the visual name follows the chart title while it still
	// tracks it; a legend title covers every channel sharing the field.
	if (typeof sent(patch, "labelsConfig", "title") === "string")
		v.name = mirroredVisualName(prev.name, prev.labelsConfig?.title ?? "", v.labelsConfig.title, UNTITLED_VISUAL_NAME)
	const titlesSent = sent(patch, "labelsConfig", "legendTitles")
	if (isObj(titlesSent)) {
		const titles = { ...v.labelsConfig.legendTitles } as Partial<Record<LegendChannel, string>>
		const combine = v.legendConfig?.combineSameVariable !== false
		for (const ch of Object.keys(titlesSent) as EncodingLegendChannel[]) {
			if (!LEGEND_CHANNELS.includes(ch)) continue
			for (const other of legendTitleChannels(v.encodings, ch, combine))
				if (!(other in titlesSent)) titles[other] = titles[ch]
		}
		v.labelsConfig = { ...v.labelsConfig, legendTitles: titles }
	}

	// Facets: proportional sizing clears the fixed panel size (and moves an
	// "all" share aside on a row / column facet); wrap rows and cols snap
	// the other dimension to fit.
	const facetSent = sent(patch, "channelConfigs", "facet")
	if (isObj(facetSent) && configs().facet) {
		let facet = configs().facet as FacetConfig
		const rowCol = !!(v.encodings.facetRow?.field || v.encodings.facetCol?.field)
		const mapping = facetAxisMapping(mode)
		const count = (field: string | null | undefined) =>
			field && deps.rows ? uniqueFieldValues(deps.rows, field, { type: typeOf(field) ?? "categorical" }).length : 1
		for (const axis of ["x", "y"] as const) {
			const key = axis === "x" ? "proportionalSizingX" : "proportionalSizingY"
			const sizing = facetSent[key]
			if (sizing === undefined || sizing === null) continue
			const own = axis === "x" ? v.encodings.facetCol?.field : v.encodings.facetRow?.field
			const perp = axis === "x" ? v.encodings.facetRow?.field : v.encodings.facetCol?.field
			facet = {
				...facet,
				...facetSizingPatch(facet, axis, sizing as FacetSizing, {
					flipShare: rowCol && mapping.showPanelSize,
					perGroupAvailable: count(own) >= 2 && count(perp) >= 2,
				}),
			}
		}
		const wrapField = v.encodings.facet?.field
		if (wrapField && deps.rows) {
			const facetCount = count(wrapField)
			for (const axis of ["rows", "cols"] as const) {
				if (!(axis in facetSent)) continue
				const n = facet[axis]
				const snapped = facetGridPatch(facet, axis, n, facetCount)
				if (snapped === null) bad(`channelConfigs.facet.${axis}`, `must be 1 to ${facetCount} (the number of panels)`)
				else facet = { ...facet, ...snapped }
			}
		}
		setConfigs({ ...configs(), facet })
	}

	// Tooltip custom HTML seeds its template; map Custom focus seeds a
	// viewport.
	if (theme && sent(patch, "tooltipConfig", "useCustomHtml") === true && v.tooltipConfig)
		v.tooltipConfig = { ...v.tooltipConfig, ...customHtmlPatch(v.tooltipConfig, true, fieldNames, theme) }
	const map = v.mapConfig
	if (sent(patch, "mapConfig", "focusRegion") === "custom" && map && prev.mapConfig)
		v.mapConfig = {
			...map,
			...focusRegionPatch(prev.mapConfig, "custom", () => levelDefaultViewport(map.geographyLevel)),
		}

	// ---- Gates -----------------------------------------------------------

	// Value-mode annotation coordinates need value axes (not on a pie, a
	// map or a structure layout; a radar's circles are polar values).
	const annotations = sent(patch, "annotationsConfig")
	if (isObj(annotations)) {
		const { xValueChannel, yValueChannel, polarValueCoords } = mode.annotations
		const noValues = mode.canvas.coordFamily === "polar" || (xValueChannel === null && yValueChannel === null)
		for (const [list, entries] of Object.entries(annotations)) {
			if (!Array.isArray(entries)) continue
			if (list === "circles" && polarValueCoords) continue
			entries.forEach((entry, i) => {
				if (noValues && isObj(entry) && typeof entry.coordSystem === "string" && entry.coordSystem.startsWith("values"))
					bad(`annotationsConfig.${list}[${i}].coordSystem`, `this chart has no value axes; use "percent" or "pixels" coordinates`)
			})
		}
	}

	// Flow charts (chord, sankey) place labels on their nodes: no x / y.
	if (mode.canvas.flowGeometry !== undefined)
		for (const ch of ["x", "y"] as const)
			if (has(patch, "dataLabelsEncodings", ch))
				bad(`dataLabelsEncodings.${ch}`, `a ${mode.id} chart labels its nodes; it has no x / y label position`)

	// An axis side belongs to its axis: x sits at the bottom or top, y at
	// the left or right (`AxisConfig.side`).
	for (const axis of ["x", "y"] as const) {
		const side = sent(patch, "channelConfigs", axis, "side")
		if (side === undefined || side === null) continue
		const allowed = axis === "x" ? ["bottom", "top"] : ["left", "right"]
		if (typeof side !== "string" || !allowed.includes(side))
			bad(`channelConfigs.${axis}.side`, `the ${axis} axis sits at ${allowed.join(" or ")}`)
	}

	// Axis range and breaks apply to a continuous, unmirrored axis.
	for (const axis of ["x", "y"] as const) {
		const axisSent = sent(patch, "channelConfigs", axis)
		if (!isObj(axisSent)) continue
		const touched = ["min", "max", "breaks"].filter((k) => k in axisSent)
		if (touched.length === 0) continue
		const why = axisRangeBlocker(v, axis, typeOf, mode)
		if (why) for (const k of touched) bad(`channelConfigs.${axis}.${k}`, why)
	}

	// ---- Normalizations ------------------------------------------------

	applyClamps(v, patch, [])

	for (const axis of ["x", "y"] as const) {
		const axisSent = sent(patch, "channelConfigs", axis)
		if (!isObj(axisSent)) continue
		const cfg = configs()[axis]
		if (!cfg) continue
		let out: AxisConfig = cfg
		// Histogram, density curve, violin and box plot are one choice: the
		// last one the patch turns on wins.
		const picks: Array<[DistributionType, unknown]> = [
			["histogram", sent(axisSent, "histogram", "enabled")],
			["density", sent(axisSent, "distributionOverlay", "showDensityCurve")],
			["violin", sent(axisSent, "distributionOverlay", "showDensityViolin")],
			["box", sent(axisSent, "distributionOverlay", "showBoxPlot")],
		]
		const on = picks.filter(([, flag]) => flag === true).map(([t]) => t)
		if (on.length > 0) {
			const type = on[on.length - 1]
			const histogram = { ...DEFAULT_HISTOGRAM_CONFIG, ...out.histogram }
			const overlay = out.distributionOverlay ?? { showDensityViolin: false, showBoxPlot: false }
			if (distributionTypeOf(histogram, overlay) !== type || on.length > 1)
				out = { ...out, ...distributionTypePatch(histogram, overlay, type) }
		}
		// Mirror off drops the mirror block; an empty breaks list is unset.
		if (sent(axisSent, "mirror", "enabled") === false) out = { ...out, mirror: undefined }
		// The default side ("bottom" / "left", or null) is stored as unset,
		// as the panel does.
		if ("side" in axisSent && out.side !== undefined && !axisFlipped(axis, out.side))
			out = { ...out, side: undefined }
		if (Array.isArray(out.breaks) && out.breaks.length === 0 && "breaks" in axisSent) out = { ...out, breaks: undefined }
		if (out.mirror && Array.isArray(out.mirror.breaks) && out.mirror.breaks.length === 0 && has(axisSent, "mirror", "breaks"))
			out = { ...out, mirror: { ...out.mirror, breaks: undefined } }
		if (out.gridlines && Array.isArray(out.gridlines.breaks) && out.gridlines.breaks.length === 0 && has(axisSent, "gridlines", "breaks"))
			out = { ...out, gridlines: { ...out.gridlines, breaks: undefined } }
		if (out !== cfg) setConfigs({ ...configs(), [axis]: out })
	}

	// Sparse storage: a value equal to its default is stored as unset.
	const legendSent = sent(patch, "legendConfig")
	if (isObj(legendSent) && v.legendConfig) {
		let legend = v.legendConfig
		const hidden = sent(legendSent, "hidden")
		if (isObj(hidden))
			for (const ch of Object.keys(hidden) as LegendChannel[]) {
				const flag = legend.hidden?.[ch]
				if (typeof flag === "boolean") legend = { ...legend, ...legendHiddenPatch(legend, ch, flag, mode.legend) }
			}
		if (theme) {
			const shapes = sent(legendSent, "swatchShapes")
			if (isObj(shapes))
				for (const ch of Object.keys(shapes) as SwatchShapeChannel[]) {
					const shape = legend.swatchShapes?.[ch]
					if (shape !== undefined) legend = { ...legend, ...swatchShapePatch(legend, ch, shape, theme) }
				}
			const sizes = sent(legendSent, "swatchSizes")
			if (isObj(sizes))
				for (const ch of Object.keys(sizes) as SwatchShapeChannel[]) {
					const size = legend.swatchSizes?.[ch]
					if (typeof size === "number") legend = { ...legend, ...swatchSizePatch(legend, ch, size, theme) }
				}
			const widths = sent(legendSent, "swatchOutlineWidths")
			if (isObj(widths))
				for (const ch of Object.keys(widths) as SwatchShapeChannel[])
					if (typeof legend.swatchOutlineWidths?.[ch] === "number")
						legend = { ...legend, ...swatchOutlineWidthPatch(legend, ch, legend.swatchOutlineWidths[ch] as number, theme) }
		}
		v.legendConfig = legend
	}
	const tooltipSent = sent(patch, "tooltipConfig")
	if (theme && isObj(tooltipSent) && v.tooltipConfig) {
		let tooltip = v.tooltipConfig
		for (const key of TOOLTIP_BOX_KEYS as readonly TooltipBoxKey[])
			if (key in tooltipSent) tooltip = tooltipBoxPatch(tooltip, key, tooltip[key], theme)
		v.tooltipConfig = tooltip
	}
	const alignSent = sent(patch, "dataTableConfig", "columnAlign")
	if (theme && isObj(alignSent) && v.dataTableConfig) {
		let table = v.dataTableConfig
		const look = resolveDataTableStyle(table, theme)
		for (const name of Object.keys(alignSent)) {
			const type = typeOf(name)
			const align = table.columnAlign[name]
			if (type && align) table = { ...table, ...columnAlignPatch(table, { name, type }, align, look) }
		}
		v.dataTableConfig = table
	}
	const labelsSent = sent(patch, "labelsConfig")
	if (isObj(labelsSent)) {
		let labels = v.labelsConfig
		for (const key of Object.keys(isObj(labelsSent.titleAlignments) ? labelsSent.titleAlignments : {}) as LabelFontKey[]) {
			const value = labels.titleAlignments?.[key]
			if (value) labels = { ...labels, ...titleAlignmentPatch(labels, key, value) }
		}
		for (const key of Object.keys(isObj(labelsSent.titleVerticalAlignments) ? labelsSent.titleVerticalAlignments : {}) as LabelFontKey[]) {
			const value = labels.titleVerticalAlignments?.[key]
			if (value) labels = { ...labels, ...titleVerticalAlignmentPatch(labels, key, value) }
		}
		for (const key of Object.keys(isObj(labelsSent.titleAngles) ? labelsSent.titleAngles : {}) as LabelFontKey[]) {
			const value = labels.titleAngles?.[key]
			if (typeof value === "number") labels = { ...labels, ...titleAnglePatch(labels, key, value) }
		}
		for (const key of Object.keys(isObj(labelsSent.titlePlacements) ? labelsSent.titlePlacements : {}) as LabelFontKey[]) {
			const value = labels.titlePlacements?.[key]
			if (isObj(value) && typeof value.side === "string")
				labels = { ...labels, ...titlePlacementPatch(labels, key, value as TitlePlacement) }
		}
		v.labelsConfig = labels
	}
	const dashed = configs().connection
	if (dashed && has(patch, "channelConfigs", "connection", "dashGapFill")) {
		const c = dashed
		const auto = resolveDashGapFill({
			configured: null,
			patternField: v.encodings.pattern?.field ?? null,
			hueField: v.encodings.hue?.field ?? null,
		})
		if (c.dashGapFill === auto) setConfigs({ ...configs(), connection: { ...c, dashGapFill: null } })
	}

	return { visual: v, problems }
}

/** Why a range or breaks can't be set on `axis`: null when they can. */
const axisRangeBlocker = (
	v: Visual,
	axis: "x" | "y",
	typeOf: (n: string) => FieldType | undefined,
	mode: ChartModeDef
): string | null => {
	const enc = v.encodings
	const configs = v.channelConfigs
	const direct = enc[axis]?.field ?? null
	const other = axis === "x" ? enc.y?.field : enc.x?.field
	const lengthField = enc.length?.field ?? null
	const impliedMeasure = !direct && !!lengthField && !!other
	const partner = axis === "x" ? "y" : "x"
	const histogramMeasure = !direct && !!enc[partner]?.field && configs[partner]?.histogram?.enabled === true
	const type: FieldType | undefined = histogramMeasure
		? "quantitative"
		: direct
			? typeOf(direct)
			: impliedMeasure && lengthField
				? typeOf(lengthField)
				: undefined
	if (!continuous(type)) return `the ${axis} axis is not continuous; only a quantitative or temporal axis takes a range or breaks`
	const mirror = configs[axis]?.mirror
	const mirrorCandidate =
		impliedMeasure && !histogramMeasure && mode.canvas.supportsNegativeMeasure === true && mode.canvas.measureAxis === axis
	if (mirrorCandidate && mirror?.enabled)
		return `the ${axis} axis is mirrored ("channelConfigs.${axis}.mirror"); its range is set per side there`
	return null
}
