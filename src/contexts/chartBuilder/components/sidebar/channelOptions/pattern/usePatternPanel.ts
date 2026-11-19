import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_DASH_RANGE,
	DEFAULT_PATTERN_ROTATION,
	DEFAULT_PATTERN_SCALE,
	type ConnectionConfig,
	type LineDashPattern,
	type PatternConfig,
} from "../../../../lib/channelConfig"
import {
	AREA_POINT_PATTERN_KEYS,
	POLYGON_PATTERN_KEYS,
} from "../../../../lib/resolveLayerColor"
import { DASH_CYCLE } from "../../../../lib/dashPatterns"
import { lineDashInEffect } from "../../../../lib/lineDashState"
import { areaBodyAutoFill } from "../../../../lib/colorSlotDefaults"
import { patternMenu, type PatternSection } from "../../../../lib/patternMenu"
import { LINE_TITLE, markPartTitles } from "../../../../lib/markPartTitles"
import { effectiveType } from "../../../../lib/fieldType"
import { isHierarchyModeId, packedSourceOf } from "../../../../lib/packedMeasure"
import {
	DEFAULT_PATTERN_INK,
	inkForHueColor,
	inkPaletteForHue,
	PATTERN_NONE,
	PATTERN_PALETTE,
} from "../../../../lib/patterns"
import { CATEGORICAL_HUE_PALETTE } from "../../../../lib/scales"
import {
	connectionConfigFromTheme,
	patternConfigFromTheme,
	resolveCategoricalPalette,
	resolveOrdinalPalette,
	valueChanged,
} from "../../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	themesAtom,
} from "../../../../store/atoms"
import { useChartModeDef } from "../../../../store/useChartModeDef"
import { usePartsContext } from "../../../../store/usePartsContext"
import { useCurrentDatasetView } from "../../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../../store/useCurrentTheme"
import { useCustomPatternEdits } from "../../../../store/useCustomPatternEdits"
import { useThemeInkFallback } from "../../../../store/useThemeInkFallback"

import { LineDashGlyph, PatternGlyph } from "../glyphShared"
import { useUniqueValuesForChannel } from "../useUniqueValuesForChannel"

import {
	fillTargetState,
	nonEmptyMap,
	targetSubsectionChanged,
} from "./fillTargetState"

/** Everything the Pattern options' sections share: the configs and their
 *  writers, what the menu lists for this chart (`patternMenu`), the ink /
 *  tile lookups the chips preview with, and the panel-level open flags.
 *  Read ONCE by `PatternOptionsPanel` and handed to each section, so every
 *  section agrees on what is mapped, overridden and changed. */
export const usePatternPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Categories where the user picked the "Custom" dash option. Tracked
	// locally so the custom-dasharray box can open (and stay open) before any
	// value is typed — an empty string isn't persisted to `customDashOverrides`.
	const [customDashOpen, setCustomDashOpen] = useState<Record<string, boolean>>(
		{}
	)
	// Same open-before-typed flag for the no-field default Line dash row's
	// "Custom" option (writes `connection.customDashPattern`).
	const [defaultCustomDashOpen, setDefaultCustomDashOpen] = useState(false)
	// Same flag for the polygon mode's "Point outline" dash picker.
	const [pointOutlineCustomOpen, setPointOutlineCustomOpen] = useState(false)
	// Which swatch row's "+" custom-pattern upload editor is open (the row
	// key `customPatternControls` is given), null when closed.
	const [patternEditorFor, setPatternEditorFor] = useState<string | null>(null)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const theme = useCurrentTheme()
	const themeInkFallback = useThemeInkFallback()
	// Live theme for connection-config writes (settings edits appear
	// immediately) — same lookup as ConnectionDashRangeRows.
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId) ?? theme
	const modeDef = useChartModeDef()
	const partsCtx = usePartsContext()
	// Hierarchy-DERIVED sources (Top-level group / Nesting depth) count as
	// "mapped" for both channels — they drive the same per-category rows a
	// field would, with categories from the tree instead of a column.
	const hierarchyMode = isHierarchyModeId(modeDef.id)
	const patternSource = hierarchyMode
		? packedSourceOf(encodings.pattern)
		: null
	const hueSource = hierarchyMode ? packedSourceOf(encodings.hue) : null
	const patternFieldMapped = !!encodings.pattern?.field || !!patternSource
	// Defensive spread over defaults so older saved visualizations (missing
	// `inkColors`, for example) don't crash when we read cfg.inkColors[v].
	const cfg: PatternConfig = {
		...patternConfigFromTheme(theme),
		...configs.pattern,
	}
	const fieldValues = useUniqueValuesForChannel("pattern")
	// The COLOR encoding's categories — the dash-gap swatches show one row
	// per hue category (gap colors pair with the line colors, and line
	// colors come from hue).
	const hueCategoryValues = useUniqueValuesForChannel("hue")
	const hueIsMapped = !!encodings.hue?.field || !!hueSource
	// When pattern shares a field (or a derived source) with hue, the
	// rendered pattern ink is hue-derived (see inkForHueColor in
	// ScatterPlot). Look it up per category position so the Color picker
	// defaults match what's actually drawn — otherwise the picker shows
	// DEFAULT_PATTERN_INK (dark navy, reads as black) even when the live
	// pattern is using a brighter palette-paired ink.
	const patternMatchesHue =
		(!!encodings.pattern?.field &&
			encodings.pattern?.field === encodings.hue?.field) ||
		(!!patternSource && patternSource === hueSource)
	// Read the inks from the palette matching the hue variable's TYPE
	// (ordinal fields — and the ordinal Nesting depth source — render from
	// the ordinal palette), so the picker's defaults match what the
	// renderer draws — mirrors inkPaletteForHue in the viz pipeline.
	const hueField = encodings.hue?.field ?? null
	const hueType = hueSource
		? hueSource === "depth"
			? ("ordinal" as const)
			: ("categorical" as const)
		: dataset && hueField
			? effectiveType(dataset, hueField, overrides)
			: undefined
	const huePalette = inkPaletteForHue(configs, hueType)
	const palettePatternInks = huePalette.inks ?? []
	// Per-value hue overrides move a category's mark color off the palette
	// slot — the renderer then pairs the ink with THAT color (cross-palette
	// table included), so the picker default must follow the same chain.
	const hueOverrideColors =
		configs.hue?.kind === "categorical" ? configs.hue.colors : undefined
	// What the marks tile over when no hue drives them: their own default
	// fill (the `patternTile` rule) — the Color menu's fill, which is why
	// this panel has no Background swatch (a `backgroundColor` an older save
	// carries is inert everywhere).
	// (An area chart's body on Auto draws the theme's fill color for it.)
	const markFill =
		areaBodyAutoFill(modeDef, encodings, configs, theme) ??
		configs.defaultFill ??
		theme.defaultFill
	const previewBg = markFill
	// The ink the renderer pairs with a tile color when no explicit ink is
	// set (`resolveDefaultPatternInk` / the per-category `preferredInk`): the
	// palette-paired ink for that color — default categorical first, then
	// default ordinal, then every other theme palette via the cross-palette
	// table — else the theme's global pattern ink. Read straight from the
	// theme: the channel configs don't carry the resolved palette.
	const catPalette = resolveCategoricalPalette(theme)
	const ordPalette = resolveOrdinalPalette(theme)
	const pairedInkForTile = (tile: string): string =>
		inkForHueColor(tile, catPalette.colors, catPalette.patternInks) ??
		inkForHueColor(
			tile,
			ordPalette.colors,
			ordPalette.patternInks,
			themeInkFallback
		) ??
		theme.patternInkColor
	const effectiveInkFor = (categoryIdx: number, value: string): string => {
		// Pattern on a different variable than hue (or hue unmapped): the mark
		// tiles over its own fill / the Background override, and the ink pairs
		// on THAT color — the chips preview on `previewBg`, so pair on it too.
		if (!patternMatchesHue) return pairedInkForTile(previewBg)
		const overrideColor = hueOverrideColors?.[value]
		if (overrideColor) {
			return (
				inkForHueColor(
					overrideColor,
					huePalette.palette,
					huePalette.inks,
					themeInkFallback
				) ?? DEFAULT_PATTERN_INK
			)
		}
		const paired = palettePatternInks[categoryIdx % palettePatternInks.length]
		return paired ?? DEFAULT_PATTERN_INK
	}
	// With pattern sharing hue's field the marks' tile background IS the hue
	// color, so the per-category chips preview on it (same lookup chain as
	// `effectiveInkFor`: per-value hue override, then the palette slot).
	const effectiveBgFor = (categoryIdx: number, value: string): string => {
		if (!patternMatchesHue) return previewBg
		// Same fallback as makeHueScale when the configs carry no palette.
		const palette =
			huePalette.palette && huePalette.palette.length > 0
				? huePalette.palette
				: CATEGORICAL_HUE_PALETTE
		return (
			hueOverrideColors?.[value] ??
			palette[categoryIdx % palette.length] ??
			previewBg
		)
	}
	// Pattern swatches must match the visualization. Two modes:
	//   • fill: no connection mapped — Pattern drives SVG fill patterns
	//     on marks (bars, areas, points); show fill swatches only.
	//   • compound: line chart context (connection mapped) — Pattern
	//     drives BOTH point fill AND line dash (same idx, different
	//     palettes). Show both rows so the user can preview each effect.
	//     The points still get fill patterns even without a separate
	//     shape encoding, so both rows are useful in any line chart.
	// Geo and STRUCTURE modes (hierarchy trees + chord/sankey flows) are
	// always "fill": there `connection` is a KEY (region join / parent
	// group / flow source), not a drawn line, and their marks render fill
	// patterns only — compound mode would show dash pickers (with fills
	// defaulting to "none selected") that disagree with the auto-cycled
	// fill patterns actually drawn.
	//
	// WHICH of these the chart gets, the parts the menu styles for it, what
	// each is titled and the order they are listed in are decided in one
	// place — `patternMenu` (lib/patternMenu) — like every other menu's
	// sections. The panel renders what it returns.
	const menu = patternMenu(partsCtx, patternFieldMapped)
	const patternMode = menu.mode
	const offers = (kind: PatternSection["kind"]): boolean =>
		menu.sections.some((s) => s.kind === kind)
	// Scatter LINE SEGMENTS (Length / Angle marks, no connection): Pattern
	// is either the segment's stroke paint (fill mode — the tile fills the
	// capsule like a bar) or its dash (dash mode — the connection-line dash
	// pickers, minus the range window). A "Segments" toggle chooses; auto
	// = fill once the base thickness holds one pattern tile. With a
	// connection mapped the line-chart modes already own the dash.
	const segmentContext = menu.segments
	const activePalette = patternMode === "fill" ? PATTERN_PALETTE : DASH_CYCLE
	const PatternSwatch = patternMode === "fill" ? PatternGlyph : LineDashGlyph
	// `dashOnly` / `segmentDash` collapse to a single dash-only picker; same
	// primary palette + glyph as the legacy "dash" rendering, but we skip
	// the Point-fill row and Color picker downstream.
	const showFillRow = patternMode === "fill" || patternMode === "compound"
	// The targets are named as every aesthetic menu names them
	// (`markPartTitles`): the dash is the "Line"'s (a line chart's, an
	// area's edge, a radar polygon's outline), and the base fill picks are
	// the marks' own fill — "Point fill", a combo's "Bar fill".
	// AREA CHARTS name three pattern targets: the "Line" (the layer edge's
	// dash), the "Area fill" (the body — the base fill picks, as it always
	// was) and, while points draw, their own "Point fill"
	// (`pattern.areaPoint*`). An unfilled area has no body, so its Area
	// fill section stands down.
	const partTitles = markPartTitles(modeDef, configs, encodings)
	const baseFillTitle =
		menu.sections.find((s) => s.kind === "fill")?.title ?? partTitles.fill
	const lineDashTitle = LINE_TITLE
	/** The marks' own picks sit under a title (beside a Violin / box fill
	 *  section); otherwise, in the plain fill form, they are listed bare. */
	const ownFillTitled =
		menu.sections.find((s) => s.kind === "fill")?.titled ?? false
	/** The menu has a section it lists bare, with no header. */
	const listedBare = menu.sections.some((s) => !s.titled)

	// Line-dash state lives on the CONNECTION config (the renderers'
	// source): the no-field default dash, the gap-fill choice, and the
	// dash range. Writes seed untouched fields from the live theme so the
	// stored slice keeps matching the changed-dot baseline (mirrors
	// ConnectionOptionsPanel's updateCfg).
	const updateConnectionCfg = (next: Partial<ConnectionConfig>) =>
		setConfigs((prev) => ({
			...prev,
			connection: {
				...connectionConfigFromTheme(liveTheme),
				...prev.connection,
				...next,
			},
		}))
	const connDefaultDash: LineDashPattern =
		configs.connection?.defaultDashPattern ?? "solid"
	// The dash's follow-on options ("Apply pattern to range", "Fill dash
	// gaps", the gap colors) style a dash, so they show only once one can
	// draw: with a solid line there are no gaps to fill and nothing for a
	// range to window.
	const dashInEffect = lineDashInEffect(configs, patternFieldMapped)

	// Subsection change indicators — mirror the fields each subsection's
	// controls write, compared against the theme-seeded pattern baseline so
	// they agree with the top-level dot (channelHasCustomization → pattern).
	// "Apply pattern to range" deviation — folds into the Line-dash
	// subsection dot (the range gates where ALL the dashes apply). Only
	// counted while the rows are visible: a mapped pattern variable hides
	// them AND the renderers ignore the stored range then.
	const dashRangeChanged =
		!patternFieldMapped &&
		dashInEffect &&
		valueChanged(
			{ ...DEFAULT_DASH_RANGE, ...configs.connection?.dashRange },
			DEFAULT_DASH_RANGE
		)
	const gapFillChanged =
		dashInEffect &&
		((configs.connection?.dashGapFill ?? null) !== null ||
			nonEmptyMap(configs.connection?.dashAlternateColors) ||
			(configs.connection?.dashGapColor ?? null) !== null)
	const dashSubsectionChanged =
		(patternFieldMapped
			? nonEmptyMap(cfg.dashOverrides) || nonEmptyMap(cfg.customDashOverrides)
			: valueChanged(connDefaultDash, "solid") ||
				(configs.connection?.customDashPattern ?? null) !== null) ||
		dashRangeChanged ||
		gapFillChanged
	const fillSubsectionChanged = patternFieldMapped
		? nonEmptyMap(cfg.overrides) ||
			nonEmptyMap(cfg.inkColors) ||
			nonEmptyMap(cfg.scales) ||
			nonEmptyMap(cfg.rotations)
		: valueChanged(configs.defaultPattern, null) ||
			valueChanged(configs.defaultPatternInk ?? null, null) ||
			(cfg.defaultScale ?? null) !== null ||
			(cfg.defaultRotation ?? null) !== null

	const updateCfg = (next: Partial<PatternConfig>) => {
		// Seed untouched fields from the THEME's pattern config (background
		// color) so the stored slice matches the "changed" dot's theme baseline;
		// seeding from the built-in `DEFAULT_PATTERN_CONFIG` would diverge in the
		// theme-driven background and light the dot on the first edit.
		setConfigs((prev) => ({
			...prev,
			pattern: {
				...patternConfigFromTheme(theme),
				...prev.pattern,
				...next,
			},
		}))
	}

	// Custom (uploaded) fill patterns — chart-wide slots, selectable from
	// every fill swatch row (point fill, polygon fill, violin / box fill)
	// and from the Maps section's no-data pattern row. An upload is selected
	// for the row that opened the editor (through that row's own setter, so
	// every target writes its own pick field); a delete drops every pick of
	// it, the map's no-data pick included.
	const { customPatterns, addCustomPattern, deleteCustomPattern } =
		useCustomPatternEdits()

	const setPaletteOverride = (
		value: string,
		idx: number | typeof PATTERN_NONE
	) => updateCfg({ overrides: { ...cfg.overrides, [value]: idx } })
	const resetPaletteOverride = (value: string) => {
		const { [value]: _removed, ...rest } = cfg.overrides
		updateCfg({ overrides: rest })
	}
	const dashOverrides = cfg.dashOverrides ?? {}
	const customDashOverrides = cfg.customDashOverrides ?? {}
	const setDashOverride = (
		value: string,
		idx: number | typeof PATTERN_NONE
	) => updateCfg({ dashOverrides: { ...dashOverrides, [value]: idx } })
	const resetDashOverride = (value: string) => {
		const { [value]: _removed, ...rest } = dashOverrides
		updateCfg({ dashOverrides: rest })
	}
	const setCustomDashOverride = (value: string, raw: string) => {
		updateCfg({
			customDashOverrides: { ...customDashOverrides, [value]: raw },
		})
	}
	const resetCustomDashOverride = (value: string) => {
		const { [value]: _removed, ...rest } = customDashOverrides
		updateCfg({ customDashOverrides: rest })
	}
	const setCategoryInk = (value: string, color: string) =>
		updateCfg({ inkColors: { ...cfg.inkColors, [value]: color } })
	const resetCategoryInk = (value: string) => {
		const { [value]: _removed, ...rest } = cfg.inkColors
		updateCfg({ inkColors: rest })
	}
	const polygon = fillTargetState(cfg, updateCfg, POLYGON_PATTERN_KEYS)
	const areaPoint = fillTargetState(cfg, updateCfg, AREA_POINT_PATTERN_KEYS)
	// PATTERN SCALE — the "Scale" box under each Color picker zooms that
	// category's tile (×1 = the palette's native size). Sparse maps like
	// `inkColors`: a blank box inherits ×1. (The fill targets carry their
	// own `scales`.)
	const scales = cfg.scales ?? {}
	const setCategoryScale = (value: string, scale: number) =>
		updateCfg({ scales: { ...scales, [value]: scale } })
	const resetCategoryScale = (value: string) => {
		const { [value]: _removed, ...rest } = scales
		updateCfg({ scales: rest })
	}
	// PATTERN ROTATION — the "Rotate" box beside each Scale box turns that
	// category's tile grid (0° = the palette's own orientation). Same sparse
	// shape as `scales`.
	const rotations = cfg.rotations ?? {}
	const setCategoryRotation = (value: string, rotation: number) =>
		updateCfg({ rotations: { ...rotations, [value]: rotation } })
	const resetCategoryRotation = (value: string) => {
		const { [value]: _removed, ...rest } = rotations
		updateCfg({ rotations: rest })
	}
	const polygonSubsectionChanged = targetSubsectionChanged(polygon, patternFieldMapped)
	const areaPointSubsectionChanged = targetSubsectionChanged(areaPoint, patternFieldMapped)

	const defaultPatternIdx = configs.defaultPattern ?? null
	const defaultScale = cfg.defaultScale ?? DEFAULT_PATTERN_SCALE
	const defaultRotation = cfg.defaultRotation ?? DEFAULT_PATTERN_ROTATION
	// The inherited ink (no explicit pick) follows the pattern-color
	// pairings the user configured in theme settings: each palette color
	// can carry a paired pattern ink. Match the tile color (the mark's
	// fill, or the Background override) against those palette colors
	// (default categorical first, then default ordinal, then every other
	// theme palette via the cross-palette table) and show its paired
	// ink; fall back to the theme's global pattern ink when the tile
	// color isn't a paired color anywhere — the same chain the marks
	// resolve through (`resolveDefaultPatternInk`).
	const resetInk = pairedInkForTile(previewBg)
	const defaultInk = configs.defaultPatternInk ?? resetInk

	const setDefaultPattern = (next: number | null) =>
		setConfigs((prev) => ({ ...prev, defaultPattern: next }))

	return {
		configs,
		setConfigs,
		encodings,
		setEncodings,
		overrides,
		dataset,
		theme,
		themeInkFallback,
		modeDef,
		hierarchyMode,
		patternSource,
		patternFieldMapped,
		cfg,
		fieldValues,
		hueCategoryValues,
		hueIsMapped,
		huePalette,
		palettePatternInks,
		hueOverrideColors,
		previewBg,
		pairedInkForTile,
		effectiveInkFor,
		effectiveBgFor,
		menu,
		patternMode,
		offers,
		segmentContext,
		activePalette,
		PatternSwatch,
		showFillRow,
		partTitles,
		baseFillTitle,
		lineDashTitle,
		ownFillTitled,
		listedBare,
		updateConnectionCfg,
		connDefaultDash,
		dashInEffect,
		dashSubsectionChanged,
		fillSubsectionChanged,
		polygonSubsectionChanged,
		areaPointSubsectionChanged,
		updateCfg,
		customPatterns,
		addCustomPattern,
		deleteCustomPattern,
		patternEditorFor,
		setPatternEditorFor,
		customDashOpen,
		setCustomDashOpen,
		defaultCustomDashOpen,
		setDefaultCustomDashOpen,
		pointOutlineCustomOpen,
		setPointOutlineCustomOpen,
		setPaletteOverride,
		resetPaletteOverride,
		dashOverrides,
		customDashOverrides,
		setDashOverride,
		resetDashOverride,
		setCustomDashOverride,
		resetCustomDashOverride,
		setCategoryInk,
		resetCategoryInk,
		polygon,
		areaPoint,
		scales,
		setCategoryScale,
		resetCategoryScale,
		rotations,
		setCategoryRotation,
		resetCategoryRotation,
		defaultPatternIdx,
		defaultScale,
		defaultRotation,
		resetInk,
		defaultInk,
		setDefaultPattern,
	}
}
export type PatternPanel = ReturnType<typeof usePatternPanel>

/** Per-category derived state shared by the Line-dash and Point-fill rows —
 *  read through one function so both agree on what's overridden. */
export const categoryState = (p: PatternPanel, v: string, i: number) => {
	const { cfg, patternMode, dashOverrides, scales, rotations } = p
	const fillOverride = cfg.overrides[v]
	// In line chart context (compound), point fills default to NONE
	// per-category — the user opts INTO a fill pattern by clicking a
	// Point-fill swatch. Outside line-chart context, auto-cycle palette
	// indices so non-line charts surface varied patterns out of the box.
	const fillIsNone =
		fillOverride === PATTERN_NONE ||
		(patternMode === "compound" && fillOverride === undefined)
	const dashOverride = dashOverrides[v]
	const dashIsNone = dashOverride === PATTERN_NONE
	const fillActiveIdx =
		typeof fillOverride === "number"
			? fillOverride
			: patternMode === "compound"
				? -1
				: i % PATTERN_PALETTE.length
	// Line dashes auto-cycle by category position when no override is
	// set — that's the "mix of line patterns" default.
	const dashActiveIdx =
		typeof dashOverride === "number" ? dashOverride : i % DASH_CYCLE.length
	const ink = cfg.inkColors[v] ?? p.effectiveInkFor(i, v)
	return {
		fillIsNone,
		dashIsNone,
		fillActiveIdx,
		dashActiveIdx,
		ink,
		hasInk: cfg.inkColors[v] !== undefined,
		scale: scales[v] ?? null,
		hasScale: scales[v] !== undefined,
		rotation: rotations[v] ?? null,
		hasRotation: rotations[v] !== undefined,
		hasPaletteOverride: fillOverride !== undefined,
		hasDashOverride: dashOverride !== undefined,
	}
}
