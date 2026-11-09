import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_DASH_RANGE,
	DEFAULT_PATTERN_ROTATION,
	DEFAULT_PATTERN_SCALE,
	PATTERN_ROTATION_MAX,
	PATTERN_ROTATION_MIN,
	PATTERN_ROTATION_STEP,
	PATTERN_SCALE_MAX,
	PATTERN_SCALE_MIN,
	PATTERN_SCALE_STEP,
	type ConnectionConfig,
	type LineDashPattern,
	type PatternConfig,
} from "../../../lib/channelConfig"
import { overlayOn, regressionOn } from "../../../lib/colorSlots"
import {
	POLYGON_PATTERN_KEYS,
	VIOLIN_PATTERN_KEYS,
	type FillTargetPatternKeys,
} from "../../../lib/resolveLayerColor"
import { DASH_CYCLE, resolveDashGapFill } from "../../../lib/dashPatterns"
import { resolveSegmentPatternContext } from "../../../lib/segmentPattern"
import { combine as c } from "../../../../../lib/cls"
import { effectiveType } from "../../../lib/fieldType"
import {
	PACKED_MEASURE_OPTION_VALUE,
	isHierarchyModeId,
	isStructureModeId,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
} from "../../../lib/packedMeasure"
import { channelAccepts } from "../../../lib/channels"
import {
	insertCustomPattern,
	removeCustomPattern,
	type CustomPattern,
} from "../../../lib/customPatterns"
import {
	DEFAULT_PATTERN_INK,
	inkForHueColor,
	inkPaletteForHue,
	PATTERN_NONE,
	PATTERN_PALETTE,
} from "../../../lib/patterns"
import { CATEGORICAL_HUE_PALETTE } from "../../../lib/scales"
import { orderedLevels } from "../../../lib/smartSort"
import {
	connectionConfigFromTheme,
	patternConfigFromTheme,
	resolveCategoricalPalette,
	resolveOrdinalPalette,
	valueChanged,
} from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	themesAtom,
} from "../../../store/atoms"
import { renderChannelConfigsAtom } from "../../../store/renderConfigs"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useThemeInkFallback } from "../../../store/useThemeInkFallback"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Segmented } from "../../../../../components/ui/Segmented"
import { SelectInput } from "../../../../../components/ui/SelectInput"

import { StackModeRow } from "./StackModeRow"
import { CustomPatternChips, CustomPatternEditor } from "./customPatternEditor"
import {
	ConnectionDashRangeRows,
	DashStylePicker,
	RegressionDashSubsection,
} from "./dashControls"
import {
	ColorRow,
	LineDashGlyph,
	PatternGlyph,
	swatchChipClass,
} from "./glyphShared"
import {
	useUniqueValuesForChannel,
	useUniqueValuesForField,
} from "./useUniqueValuesForChannel"

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------
const SEGMENT_PATTERN_SEGMENTS = [
	{ key: "dash", label: "Dash" },
	{ key: "fill", label: "Fill" },
] as const

/** The Violin / box fill "Vary by" value standing for Auto (follow the
 *  Pattern variable) — a stored key is absent then, so the select needs a
 *  sentinel; same device as the Color panel's inherit option. */
const VIOLIN_VARY_AUTO = "__auto__"

export const PatternOptionsPanel = () => {
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
	// immediately) — same lookup as ConnectionDashRangeRows below.
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId) ?? theme
	const modeDef = useChartModeDef()
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
	// The violin / box body's own "Vary by" (`pattern.violinField`): absent =
	// Auto (the Pattern variable, like the points), null = none (one default
	// pattern), a name = that variable's levels. Its level list comes from
	// the field itself, since the Pattern channel may map something else.
	const violinVaryBy = cfg.violinField
	const violinOwnLevels = useUniqueValuesForField(
		typeof violinVaryBy === "string" ? violinVaryBy : null
	)
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
	const geoMode = modeDef.canvas.coordFamily === "geo"
	const structuralConnection = geoMode || isStructureModeId(modeDef.id)
	const connectionMapped =
		!!encodings.connection?.field && !structuralConnection
	// When the user picks "No points" under Connection, there's no
	// shape to carry a fill pattern — hide the Point-fill row and the
	// Color picker entirely so the Pattern panel only offers dash
	// controls. Default to "all" for legacy configs.
	const pointsHidden =
		(configs.connection?.pointSampling ?? "all") === "none"
	// Scatter LINE SEGMENTS (Length / Angle marks, no connection): Pattern
	// is either the segment's stroke paint (fill mode — the tile fills the
	// capsule like a bar) or its dash (dash mode — the connection-line dash
	// pickers, minus the range window). A "Segments" toggle chooses; auto
	// = fill once the base thickness holds one pattern tile. With a
	// connection mapped the line-chart modes below already own the dash.
	const segmentContext = connectionMapped
		? null
		: resolveSegmentPatternContext({
				lengthRole: modeDef.canvas.lengthRole,
				encodings,
				channelConfigs: configs,
				patternMapped: patternFieldMapped,
			})
	const patternMode: "fill" | "compound" | "dashOnly" | "segmentDash" =
		segmentContext?.mode === "dash"
			? "segmentDash"
			: !connectionMapped
				? "fill"
				: pointsHidden
					? "dashOnly"
					: "compound"
	const activePalette = patternMode === "fill" ? PATTERN_PALETTE : DASH_CYCLE
	const PatternSwatch = patternMode === "fill" ? PatternGlyph : LineDashGlyph
	// `dashOnly` / `segmentDash` collapse to a single dash-only picker; same
	// primary palette + glyph as the legacy "dash" rendering, but we skip
	// the Point-fill row and Color picker downstream.
	const showFillRow = patternMode === "fill" || patternMode === "compound"
	// Filled radar: the series polygons have a BODY to pattern, separate
	// from their points — a "Polygon fill" subsection joins the panel with
	// its own picks (`pattern.polygonOverrides` / `defaultPolygonPattern`),
	// so a hatched polygon can sit under plain dots. Shown in dashOnly too
	// (hiding the points leaves the polygons). The polygon mode always maps
	// connection, so this never coincides with the plain fill form.
	const isPolygonMode = modeDef.canvas.connectionRole === "polygon"
	const radarPolygonFilled =
		isPolygonMode && connectionMapped && configs.connection?.fillPolygon === true
	// Polygon mode names its targets as the other aesthetic menus do
	// (`markPartTitles`): the line dash is the polygon outline — the
	// "Connection line" — beside Point fill, Point outline and Polygon fill.
	const lineDashTitle = isPolygonMode ? "Connection line" : "Line dash"
	// POINT OUTLINE DASH (polygon mode): the glyphs' outline ring takes a dash
	// of its own — one pick for every point, stored sparsely on the pattern
	// config (`pointOutlineDash` / `customPointOutlineDash`; absent = solid).
	// Offered in both panel forms (a mapped Pattern variable drives the
	// per-category Point-fill and Connection-line picks; the ring stays one
	// pick) while points draw at all.
	const pointOutlineDash: LineDashPattern = cfg.pointOutlineDash ?? "solid"
	const pointOutlineCustom = cfg.customPointOutlineDash ?? null
	const pointOutlineChanged =
		pointOutlineDash !== "solid" || pointOutlineCustom !== null
	const setPointOutlineDash = (next: {
		pattern: LineDashPattern
		customDasharray: string | null
	}) =>
		setConfigs((prev) => {
			const {
				pointOutlineDash: _dash,
				customPointOutlineDash: _custom,
				...rest
			} = { ...patternConfigFromTheme(theme), ...prev.pattern }
			return {
				...prev,
				pattern: {
					...rest,
					...(next.pattern !== "solid" ? { pointOutlineDash: next.pattern } : {}),
					...(next.customDasharray !== null
						? { customPointOutlineDash: next.customDasharray }
						: {}),
				},
			}
		})
	// Violin / box overlay: the body (what the Color panel's "Violin / box
	// fill" slot colors) is its own pattern target, like the radar polygon —
	// a "Violin / box fill" subsection with its own picks, so a hatched box
	// can sit under plain points, or stand alone with the points hidden.
	const violinFilled = overlayOn(configs)
	const violinLevels =
		violinVaryBy === undefined
			? fieldValues
			: violinVaryBy === null
				? null
				: violinOwnLevels
	const violinFieldMapped =
		violinVaryBy === undefined ? patternFieldMapped : violinLevels !== null
	// What the body's chips preview on: the renderer tiles a body over its own
	// fill (the Violin / box fill slot's color — its render-side default
	// included, e.g. the fill-palette color analogous to the marks' — else
	// the overlay's legacy fill, else the theme's). A field-mapped slot
	// varies per category; the chips show the single base color.
	const renderViolinFill = useAtomValue(renderChannelConfigsAtom).colorSlots?.violinFill
	const violinTile = (() => {
		const activeOverlay = [configs.x, configs.y]
			.map((c) => c?.distributionOverlay)
			.find((o) => o && (o.showBoxPlot || o.showDensityViolin))
		const fill =
			renderViolinFill?.singleColor ??
			activeOverlay?.fillColor ??
			theme.distributionOverlayFill
		return fill
	})()

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
	// "Fill dash gaps": whether the gaps between dashes are painted (an
	// alternate-color underlay keeps the line connected) or left empty
	// (truly dashed). Auto default: filled, EXCEPT when pattern and hue map
	// the same field (the dash restates the color split there, so true gaps
	// are the default and painting is opt-in).
	const patternFieldName = encodings.pattern?.field ?? null
	const hueFieldName = encodings.hue?.field ?? null
	const gapFillAuto = resolveDashGapFill({
		configured: null,
		patternField: patternFieldName,
		hueField: hueFieldName,
	})
	const gapFillOn = resolveDashGapFill({
		configured: configs.connection?.dashGapFill ?? null,
		patternField: patternFieldName,
		hueField: hueFieldName,
	})
	// Re-checking back to the auto value clears the stored choice so the
	// changed dot goes back out.
	const setGapFill = (checked: boolean) =>
		updateConnectionCfg({ dashGapFill: checked === gapFillAuto ? null : checked })
	// Per-category gap-color swatches, shown while "Fill dash gaps" is on.
	// One row per COLOR-encoding category (gap colors pair with line colors,
	// and line colors come from hue), keyed by hue value in
	// `connection.dashAlternateColors`. Defaults show the palette-paired
	// pattern ink each category's gaps resolve to. With no hue encoding
	// there's one line color → a single "Gap color" swatch
	// (`connection.dashGapColor`).
	const dashAltColors = configs.connection?.dashAlternateColors ?? {}
	const setGapColorOverride = (value: string, color: string) =>
		updateConnectionCfg({
			dashAlternateColors: { ...dashAltColors, [value]: color },
		})
	const resetGapColorOverride = (value: string) => {
		const { [value]: _removed, ...rest } = dashAltColors
		updateConnectionCfg({ dashAlternateColors: rest })
	}
	// Mirrors the renderer (`resolveDashGapColor`): a per-value hue override
	// moves the category off its palette slot, and the gap pairs with THAT
	// color's ink (cross-palette table included).
	const defaultGapColorFor = (categoryIdx: number, value?: string): string => {
		// Segment scatter with no hue: the segment's color is the DEFAULT FILL
		// (not a line-palette slot), so its gap pairs with that color's ink —
		// `resolveDashGapColor`'s `lineColor` step in `buildMarks`.
		if (segmentContext && !hueIsMapped) {
			return (
				inkForHueColor(
					configs.defaultFill ?? theme.defaultFill,
					huePalette.palette,
					huePalette.inks,
					themeInkFallback
				) ??
				configs.defaultPatternInk ??
				configs.patternInkColor ??
				DEFAULT_PATTERN_INK
			)
		}
		const overrideColor =
			value === undefined ? undefined : hueOverrideColors?.[value]
		const paired = overrideColor
			? inkForHueColor(
					overrideColor,
					huePalette.palette,
					huePalette.inks,
					themeInkFallback
				)
			: palettePatternInks.length > 0
				? palettePatternInks[categoryIdx % palettePatternInks.length]
				: null
		return paired ?? configs.defaultPatternInk ?? DEFAULT_PATTERN_INK
	}
	const gapColorRow = (args: {
		key: string
		label: string
		/** Names the palette picker + reset link; defaults to "Gap color for
		 *  <label>" (the single no-hue row passes plain "Gap color"). */
		ariaLabel?: string
		override: string | null
		fallback: string
		onChange: (color: string | null) => void
	}) => {
		const aria = args.ariaLabel ?? `Gap color for ${args.label}`
		return (
			// Inherit mode: no override = the paired / default ink (`fallback`),
			// previewed in the swatch. flex-wrap drops the reset link under the
			// swatch when the row is squeezed.
			<div
				key={args.key}
				className="flex flex-wrap items-center gap-2 text-sm"
			>
				<ColorInput
					label={args.label}
					labelClassName="w-24 truncate vc-muted"
					value={args.override}
					onChange={args.onChange}
					onClear={() => args.onChange(null)}
					placeholder={args.fallback}
					pickerLabel={`Pick palette ${aria.charAt(0).toLowerCase()}${aria.slice(1)}`}
					className="contents"
				/>
				{args.override !== null && (
					<ResetLink
						onClick={() => args.onChange(null)}
						ariaLabel={`Reset ${aria.charAt(0).toLowerCase()}${aria.slice(1)}`}
					/>
				)}
			</div>
		)
	}
	const gapColorRows = !gapFillOn ? null : hueFieldName && hueCategoryValues ? (
		<div className="flex flex-col gap-1">
			{orderedLevels(
				hueCategoryValues.values,
				hueCategoryValues.type,
				hueCategoryValues.order
			).map(({ value: v, index: i }) =>
				gapColorRow({
					key: v,
					label: hueCategoryValues.labels?.[i] ?? v,
					override: dashAltColors[v] ?? null,
					fallback: defaultGapColorFor(i, v),
					onChange: (color) =>
						color === null
							? resetGapColorOverride(v)
							: setGapColorOverride(v, color),
				})
			)}
		</div>
	) : (
		gapColorRow({
			key: "__single__",
			label: "Gap color",
			ariaLabel: "Gap color",
			override: configs.connection?.dashGapColor ?? null,
			fallback: defaultGapColorFor(0),
			onChange: (color) => updateConnectionCfg({ dashGapColor: color }),
		})
	)
	const gapFillRow = (
		<div className="flex flex-col gap-2">
			<Checkbox label="Fill dash gaps" checked={gapFillOn} onChange={setGapFill} />
			{gapColorRows}
		</div>
	)

	// Subsection change indicators — mirror the fields each subsection's
	// controls write, compared against the theme-seeded pattern baseline so
	// they agree with the top-level dot (channelHasCustomization → pattern).
	const nonEmptyMap = (m?: Record<string, unknown>) =>
		!!m && Object.keys(m).length > 0
	// "Apply pattern to range" deviation — folds into the Line-dash
	// subsection dot (the range gates where ALL the dashes apply). Only
	// counted while the rows are visible: a mapped pattern variable hides
	// them AND the renderers ignore the stored range then.
	const dashRangeChanged =
		!patternFieldMapped &&
		valueChanged(
			{ ...DEFAULT_DASH_RANGE, ...configs.connection?.dashRange },
			DEFAULT_DASH_RANGE
		)
	const gapFillChanged =
		(configs.connection?.dashGapFill ?? null) !== null ||
		nonEmptyMap(configs.connection?.dashAlternateColors) ||
		(configs.connection?.dashGapColor ?? null) !== null
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
	// every fill swatch row (point fill, polygon fill, violin / box fill).
	const customPatterns = cfg.customPatterns ?? []
	/** Store an uploaded pattern, then select it for the row that opened
	 *  the editor (through that row's own setter, so every target writes
	 *  its own pick field). */
	const addCustomPattern = (p: CustomPattern, select: (idx: number) => void) => {
		const { list, idx } = insertCustomPattern(customPatterns, p)
		updateCfg({ customPatterns: list })
		select(idx)
	}
	const deleteCustomPattern = (slot: number) =>
		setConfigs((prev) => removeCustomPattern(prev, slot))
	/** The custom chips + "+" for one fill swatch row, and (below the row)
	 *  its upload editor while open. */
	const customPatternControls = (
		rowKey: string,
		row: {
			activeIdx: number | null
			select: (idx: number) => void
			ink: string
			bg: string
			scale?: number | null
			rotation?: number | null
			ariaName: string
		}
	) => ({
		chips: (
			<CustomPatternChips
				patterns={customPatterns}
				activeIdx={row.activeIdx}
				onPick={row.select}
				onDelete={deleteCustomPattern}
				onAdd={() =>
					setPatternEditorFor((open) => (open === rowKey ? null : rowKey))
				}
				inkColor={row.ink}
				bgColor={row.bg}
				scale={row.scale}
				rotation={row.rotation}
				ariaName={row.ariaName}
			/>
		),
		editor: patternEditorFor === rowKey && (
			<CustomPatternEditor
				onCreate={(p) => addCustomPattern(p, row.select)}
				onClose={() => setPatternEditorFor(null)}
			/>
		),
	})

	// The "Segments" toggle: an explicit Dash / Fill pick, or auto (the key
	// is absent — reset STRIPS it rather than writing null, so untouched
	// saves don't grow a key).
	const segmentPatternSet = configs.pattern?.segmentPattern !== undefined
	const resetSegmentPattern = () =>
		setConfigs((prev) => {
			if (!prev.pattern || prev.pattern.segmentPattern === undefined) return prev
			const { segmentPattern: _removed, ...rest } = prev.pattern
			return { ...prev, pattern: rest }
		})
	const segmentsRow = segmentContext && (
		<div className="flex flex-col gap-1 px-2 text-sm">
			<div className="flex items-center gap-2">
				<span
					className={c(
						"shrink-0",
						LABEL_COL,
						segmentPatternSet && "font-semibold !text-vc-section-header"
					)}
				>
					Segments
				</span>
				<Segmented
					ariaLabel="Pattern on segments"
					value={segmentContext.mode}
					segments={SEGMENT_PATTERN_SEGMENTS}
					onChange={(segmentPattern) => updateCfg({ segmentPattern })}
				/>
				{segmentPatternSet && <ResetLink onClick={resetSegmentPattern} />}
			</div>
			{!segmentPatternSet && (
				<p className="vc-help">
					Auto: Fill once the segments are at least one pattern tile thick
					({Math.ceil(segmentContext.tileSide)}px), else Dash.
				</p>
			)}
		</div>
	)

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
	// Separate fill targets — the radar polygon body and the violin / box
	// body — keep the same shapes as the point-fill `overrides` / `inkColors`
	// / `scales` / `rotations` / `defaultPattern` set, stored beside them on
	// the pattern config so no two picks ever share an index. One accessor
	// per target.
	const fillTargetState = (keys: FillTargetPatternKeys) => {
		const overrides = cfg[keys.overrides] ?? {}
		const inkColors = cfg[keys.inkColors] ?? {}
		const scales = cfg[keys.scales] ?? {}
		const rotations = cfg[keys.rotations] ?? {}
		const write = (next: Record<string, unknown>) =>
			updateCfg(next as Partial<PatternConfig>)
		const without = <V,>(m: Record<string, V>, value: string) => {
			const { [value]: _removed, ...rest } = m
			return rest
		}
		return {
			overrides,
			inkColors,
			scales,
			rotations,
			setOverride: (value: string, idx: number | typeof PATTERN_NONE) =>
				write({ [keys.overrides]: { ...overrides, [value]: idx } }),
			resetOverride: (value: string) =>
				write({ [keys.overrides]: without(overrides, value) }),
			setInk: (value: string, color: string) =>
				write({ [keys.inkColors]: { ...inkColors, [value]: color } }),
			resetInk: (value: string) =>
				write({ [keys.inkColors]: without(inkColors, value) }),
			setScale: (value: string, scale: number) =>
				write({ [keys.scales]: { ...scales, [value]: scale } }),
			resetScale: (value: string) =>
				write({ [keys.scales]: without(scales, value) }),
			setRotation: (value: string, rotation: number) =>
				write({ [keys.rotations]: { ...rotations, [value]: rotation } }),
			resetRotation: (value: string) =>
				write({ [keys.rotations]: without(rotations, value) }),
			defaultIdx: cfg[keys.defaultPattern] ?? null,
			defaultInk: cfg[keys.defaultInk] ?? null,
			defaultScale: cfg[keys.defaultScale] ?? null,
			defaultRotation: cfg[keys.defaultRotation] ?? null,
			setDefaultIdx: (next: number | null) =>
				write({ [keys.defaultPattern]: next }),
			setDefaultInk: (next: string | null) =>
				write({ [keys.defaultInk]: next }),
			setDefaultScale: (next: number | null) =>
				write({ [keys.defaultScale]: next }),
			setDefaultRotation: (next: number | null) =>
				write({ [keys.defaultRotation]: next }),
			/** The panel-wide reset's patch for this target's defaults. */
			clearDefaults: {
				[keys.defaultPattern]: null,
				[keys.defaultInk]: null,
				[keys.defaultScale]: null,
				[keys.defaultRotation]: null,
			} as Partial<PatternConfig>,
		}
	}
	type FillTargetState = ReturnType<typeof fillTargetState>
	const polygon = fillTargetState(POLYGON_PATTERN_KEYS)
	const violin = fillTargetState(VIOLIN_PATTERN_KEYS)
	// PATTERN SCALE — the "Scale" box under each Color picker zooms that
	// category's tile (×1 = the palette's native size). Sparse maps like
	// `inkColors`: a blank box inherits ×1. (The fill targets above carry
	// their own `scales`.)
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
	/** The Scale and Rotate rows under a pattern's Ink color, one line each.
	 *  Scale: ×0 to ×4 in tenths, typed values clamp into the range; blank =
	 *  the ×1 default, shown as the placeholder so the spinner's first step
	 *  moves off ×1 rather than off 0. Rotate: −180° to 180° by 1°; blank =
	 *  0°. Each row carries its own reset link once a value is set, and
	 *  emptying a box resets it too. `context` names the rows for assistive
	 *  tech only ("Scale for north", "Rotate for north"), so every box has a
	 *  distinct name. */
	const numberRow = (args: {
		label: string
		context?: string
		labelClassName?: string
		value: number | null
		onChange: (next: number) => void
		onClear: () => void
		min: number
		max: number
		step: number
		placeholder: string
		suffix?: string
	}) => (
		// flex-wrap like ColorRow: a squeezed row drops the reset link under
		// the box instead of pushing past the sheet edge.
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<NumberInput
				label={
					args.context ? (
						<>
							{args.label}
							<span className="sr-only"> for {args.context}</span>
						</>
					) : (
						args.label
					)
				}
				labelClassName={args.labelClassName ?? "vc-muted"}
				value={args.value}
				onChange={args.onChange}
				onClear={args.onClear}
				min={args.min}
				max={args.max}
				step={args.step}
				clamp
				placeholder={args.placeholder}
				suffix={args.suffix}
				className="contents"
			/>
			{args.value !== null && (
				<ResetLink
					onClick={args.onClear}
					ariaLabel={`Reset ${args.label.toLowerCase()}${args.context ? ` for ${args.context}` : ""}`}
				/>
			)}
		</div>
	)
	const scaleRotateRows = (args: {
		context?: string
		labelClassName?: string
		value: number | null
		onChange: (next: number) => void
		onClear: () => void
		rotation: number | null
		onRotationChange: (next: number) => void
		onRotationClear: () => void
	}) => (
		<>
			{numberRow({
				label: "Scale",
				context: args.context,
				labelClassName: args.labelClassName,
				value: args.value,
				onChange: args.onChange,
				onClear: args.onClear,
				min: PATTERN_SCALE_MIN,
				max: PATTERN_SCALE_MAX,
				step: PATTERN_SCALE_STEP,
				placeholder: String(DEFAULT_PATTERN_SCALE),
			})}
			{numberRow({
				label: "Rotate",
				context: args.context,
				labelClassName: args.labelClassName,
				value: args.rotation,
				onChange: args.onRotationChange,
				onClear: args.onRotationClear,
				min: PATTERN_ROTATION_MIN,
				max: PATTERN_ROTATION_MAX,
				step: PATTERN_ROTATION_STEP,
				placeholder: String(DEFAULT_PATTERN_ROTATION),
				suffix: "°",
			})}
		</>
	)
	const targetSubsectionChanged = (t: FillTargetState, mapped: boolean) =>
		mapped
			? nonEmptyMap(t.overrides) ||
				nonEmptyMap(t.inkColors) ||
				nonEmptyMap(t.scales) ||
				nonEmptyMap(t.rotations)
			: t.defaultIdx !== null ||
				t.defaultInk !== null ||
				t.defaultScale !== null ||
				t.defaultRotation !== null
	const polygonSubsectionChanged = targetSubsectionChanged(polygon, patternFieldMapped)
	// Any explicit Vary by (a variable OR "none") is a deviation from Auto.
	const violinSubsectionChanged =
		violinVaryBy !== undefined || targetSubsectionChanged(violin, violinFieldMapped)
	/** Write the body's Vary by; `undefined` (Auto) drops the key. */
	const setViolinField = (next: string | null | undefined) =>
		setConfigs((prev) => {
			const { violinField: _removed, ...rest } = {
				...patternConfigFromTheme(theme),
				...prev.pattern,
			}
			return {
				...prev,
				pattern: next === undefined ? rest : { ...rest, violinField: next },
			}
		})

	// What the marks tile over when no hue drives them: their own default
	// fill (the `patternTile` rule) — the Color menu's fill, which is why
	// this panel has no Background swatch (a `backgroundColor` an older save
	// carries is inert everywhere).
	const markFill = configs.defaultFill ?? theme.defaultFill
	const previewBg = markFill
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

	// The panel-wide reset below shows only when a value it clears differs
	// from its default: the fill defaults always, the connection line-dash
	// state outside pure-fill mode, the polygon defaults on filled radars.
	// (No field is mapped here, so the subsection flags read their
	// no-field branches — the same fields the reset writes.)
	const panelResetChanged =
		fillSubsectionChanged ||
		(patternMode !== "fill" && dashSubsectionChanged) ||
		(radarPolygonFilled && polygonSubsectionChanged) ||
		(isPolygonMode && pointOutlineChanged) ||
		(violinFilled && violinSubsectionChanged) ||
		segmentPatternSet
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
	// A fill target's twin of the default point-fill row: same swatches,
	// writing the target's own default (`pattern.defaultPolygonPattern` /
	// `defaultViolinPattern`) instead.
	const targetDefaultRow = (t: FillTargetState, ariaName: string, tile?: string) => ({
		activeIdx: t.defaultIdx,
		setIdx: t.setDefaultIdx,
		ink: t.defaultInk ?? (tile ? pairedInkForTile(tile) : defaultInk),
		scale: t.defaultScale ?? DEFAULT_PATTERN_SCALE,
		rotation: t.defaultRotation ?? DEFAULT_PATTERN_ROTATION,
		ariaName,
		bg: tile,
	})
	const renderDefaultSwatchRow = (
		label: string | null,
		palette: readonly unknown[],
		Glyph: typeof PatternGlyph | typeof LineDashGlyph,
		showNone: boolean,
		target: {
			activeIdx: number | null
			setIdx: (next: number | null) => void
			ink: string
			/** Tile zoom / rotation previewed in the chips. */
			scale: number
			rotation: number
			ariaName: string
			/** Chip tile when the target's isn't the point tile (`previewBg`). */
			bg?: string
		} = {
			activeIdx: defaultPatternIdx,
			setIdx: setDefaultPattern,
			ink: defaultInk,
			scale: defaultScale,
			rotation: defaultRotation,
			ariaName: "Pattern option",
		}
	) => {
		// Fill rows (not line-dash rows) take custom uploaded patterns too.
		const custom =
			Glyph === PatternGlyph
				? customPatternControls(`default:${target.ariaName}`, {
						activeIdx: target.activeIdx,
						select: target.setIdx,
						ink: target.ink,
						bg: target.bg ?? previewBg,
						scale: target.scale,
						rotation: target.rotation,
						ariaName: target.ariaName,
					})
				: null
		return (
			<div className="flex flex-col gap-1 text-sm">
				{/* Group title. These rows open the panel (nothing above to
				 *  divide from), so the header carries no divider line. */}
				{label && <span className="vc-group-header">{label}</span>}
				<div className="flex flex-wrap gap-1">
					{showNone && (
						<button
							type="button"
							onClick={() => target.setIdx(null)}
							aria-pressed={target.activeIdx === null}
							className={swatchChipClass(target.activeIdx === null, "px-2 text-sm")}
						>
							None
						</button>
					)}
					{palette.map((_, idx) => {
						const selected = idx === target.activeIdx
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
								key={idx}
								type="button"
								onClick={() => target.setIdx(idx)}
								aria-pressed={selected}
								aria-label={`${target.ariaName} ${idx + 1}`}
								className={swatchChipClass(selected, "w-7")}
							>
								<Glyph
									idx={idx}
									selected={selected}
									inkColor={target.ink}
									bgColor={target.bg ?? previewBg}
									scale={target.scale}
									rotation={target.rotation}
								/>
							</button>
						)
					})}
					{custom?.chips}
				</div>
				{custom?.editor}
			</div>
		)
	}

	// Default LINE DASH row (no pattern variable) — the shared
	// DashStylePicker (same row the per-category and regression pickers
	// render), writing the CONNECTION config's `defaultDashPattern`, which
	// is what the line renderers actually read (scatter connection
	// polylines + area line-mode edges). Deliberately NOT
	// `configs.defaultPattern`: that's the point-fill selection, and
	// sharing one index between the two rows made picking a dash silently
	// pick a point fill too (and the dash itself never rendered). The
	// "Custom open" flag is this panel's state so the Reset link below can
	// close the box. "Blank" is a range-mode option (a whole-line blank
	// would erase the line), so the swatch only renders while the range
	// below is on.
	const renderDefaultDashRow = (label: string | null) => (
		<div className="flex flex-col gap-1 text-sm">
			{label && <span className="vc-group-header">{label}</span>}
			<DashStylePicker
				pattern={connDefaultDash}
				customDasharray={configs.connection?.customDashPattern ?? null}
				customOpen={defaultCustomDashOpen}
				onCustomOpenChange={setDefaultCustomDashOpen}
				showBlank={configs.connection?.dashRange?.enabled ?? false}
				onChange={({ pattern, customDasharray }) =>
					updateConnectionCfg({
						defaultDashPattern: pattern,
						customDashPattern: customDasharray,
					})
				}
				ariaContext="line"
			/>
		</div>
	)

	// Ink + background swatches for the point fill pattern. In compound
	// mode these live inside the "Point fill" subsection (alongside the
	// pattern swatches they recolor); in fill mode they trail the default
	// pattern row. `showFillRow` is false in dashOnly, so nothing renders.
	const fillColorRows = (
		<>
			{defaultPatternIdx !== null && showFillRow && (
				// Inherit mode: no pick = the palette-paired / theme ink
				// (`resetInk`), previewed in the swatch.
				<ColorRow
					label="Ink color"
					value={configs.defaultPatternInk ?? null}
					onChange={(c) =>
						setConfigs((prev) => ({
							...prev,
							defaultPatternInk: c,
						}))
					}
					onClear={() =>
						setConfigs((prev) => ({
							...prev,
							defaultPatternInk: null,
						}))
					}
					clearLabel="reset"
					placeholder={resetInk}
				/>
			)}
			{defaultPatternIdx !== null &&
				showFillRow &&
				scaleRotateRows({
					labelClassName: LABEL_COL,
					value: cfg.defaultScale ?? null,
					onChange: (n) => updateCfg({ defaultScale: n }),
					onClear: () => updateCfg({ defaultScale: null }),
					rotation: cfg.defaultRotation ?? null,
					onRotationChange: (n) => updateCfg({ defaultRotation: n }),
					onRotationClear: () => updateCfg({ defaultRotation: null }),
				})}
		</>
	)

	// A fill target's subsection — the default pattern + its ink + scale.
	// Filled radar: "Polygon fill"; violin / box overlay: "Violin / box
	// fill".
	const targetSubsection = (
		t: FillTargetState,
		title: string,
		ariaName: string,
		context: string,
		changed: boolean
	) => (
		<CollapsibleSubsection title={title} defaultOpen changed={changed}>
			<div className="flex flex-col gap-3">
				{renderDefaultSwatchRow(
					null,
					PATTERN_PALETTE,
					PatternGlyph,
					true,
					targetDefaultRow(t, ariaName)
				)}
				{t.defaultIdx !== null && (
					<ColorRow
						label="Ink color"
						value={t.defaultInk ?? defaultInk}
						onChange={(c) => t.setDefaultInk(c)}
						onClear={() => t.setDefaultInk(null)}
						clearLabel="reset"
						placeholder={resetInk}
					/>
				)}
				{t.defaultIdx !== null &&
					scaleRotateRows({
						context,
						labelClassName: LABEL_COL,
						value: t.defaultScale,
						onChange: (n) => t.setDefaultScale(n),
						onClear: () => t.setDefaultScale(null),
						rotation: t.defaultRotation,
						onRotationChange: (n) => t.setDefaultRotation(n),
						onRotationClear: () => t.setDefaultRotation(null),
					})}
			</div>
		</CollapsibleSubsection>
	)
	const polygonSubsection =
		radarPolygonFilled &&
		targetSubsection(
			polygon,
			"Polygon fill",
			"Polygon pattern option",
			"polygon fill",
			polygonSubsectionChanged
		)
	// The Point outline dash picker (polygon mode, while points draw).
	const pointOutlineSubsection = isPolygonMode && !pointsHidden && (
		<CollapsibleSubsection
			title="Point outline"
			defaultOpen
			changed={pointOutlineChanged}
		>
			<DashStylePicker
				pattern={pointOutlineDash}
				customDasharray={pointOutlineCustom}
				customOpen={pointOutlineCustomOpen}
				onCustomOpenChange={setPointOutlineCustomOpen}
				onChange={setPointOutlineDash}
				ariaContext="point outline"
			/>
		</CollapsibleSubsection>
	)

	// Per-category derived state shared by the Line-dash and Point-fill
	// renderers — read once so both subsections agree on what's overridden.
	const categoryState = (v: string, i: number) => {
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
		const ink = cfg.inkColors[v] ?? effectiveInkFor(i, v)
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

	const renderSwatchRow = (
		v: string,
		args: {
			palette: readonly unknown[]
			Glyph: typeof PatternGlyph | typeof LineDashGlyph
			isNone: boolean
			activeIdx: number
			ink: string
			/** Tile zoom / rotation previewed in the chips (×1 / 0° when
			 *  unset). */
			scale?: number | null
			rotation?: number | null
			/** Chip background (the category's hue color when pattern shares
			 *  hue's field); the panel's Background when unset. */
			bg?: string
			setIdx: (idx: number) => void
			setNone: () => void
			/** Accessible-name prefix for the row's buttons ("pattern" by
			 *  default). The Polygon-fill rows pass "polygon pattern" so they
			 *  stay distinguishable from the Point-fill rows beside them. */
			ariaKind?: string
		}
	) => {
		const Glyph = args.Glyph
		const kind = args.ariaKind ?? "pattern"
		const optionName = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} option`
		const custom =
			Glyph === PatternGlyph
				? customPatternControls(`${kind}:${v}`, {
						activeIdx: args.isNone ? null : args.activeIdx,
						select: args.setIdx,
						ink: args.ink,
						bg: args.bg ?? previewBg,
						scale: args.scale ?? DEFAULT_PATTERN_SCALE,
						rotation: args.rotation ?? DEFAULT_PATTERN_ROTATION,
						ariaName: optionName,
					})
				: null
		return (
			<>
				<div className="flex flex-wrap gap-1">
					<button
						type="button"
						onClick={args.setNone}
						aria-pressed={args.isNone}
						aria-label={`No ${kind} for ${v}`}
						className={swatchChipClass(args.isNone, "px-2 text-sm")}
					>
						None
					</button>
					{args.palette.map((_, idx) => {
						const selected = !args.isNone && idx === args.activeIdx
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
								key={idx}
								type="button"
								onClick={() => args.setIdx(idx)}
								aria-pressed={selected}
								aria-label={`${optionName} ${idx + 1}`}
								className={swatchChipClass(selected, "w-7")}
							>
								<Glyph
									idx={idx}
									selected={selected}
									inkColor={args.ink}
									bgColor={args.bg ?? previewBg}
									scale={args.scale ?? DEFAULT_PATTERN_SCALE}
									rotation={args.rotation ?? DEFAULT_PATTERN_ROTATION}
								/>
							</button>
						)
					})}
					{custom?.chips}
				</div>
				{custom?.editor}
			</>
		)
	}

	const renderColorPicker = (
		v: string,
		ink: string,
		hasInk: boolean,
		/** Which ink map the picker writes — the point fill's by default; the
		 *  Polygon-fill rows pass their own setters. */
		target: {
			set: (value: string, color: string) => void
			reset: (value: string) => void
			ariaKind: string
		} = { set: setCategoryInk, reset: resetCategoryInk, ariaKind: "Pattern" }
	) => (
		// Inherit mode: no per-category ink = the hue-paired / default ink,
		// which `ink` already resolves to (previewed in the swatch).
		<ColorInput
			label="Ink color"
			labelClassName={LABEL_COL}
			value={hasInk ? ink : null}
			onChange={(color) => target.set(v, color)}
			onClear={() => target.reset(v)}
			placeholder={ink}
			pickerLabel={`Pick palette ${target.ariaKind.toLowerCase()} color for ${v}`}
		/>
	)

	/** The category's Scale and Rotate rows, directly under its Color
	 *  picker. Blank = inherit ×1 / 0° (the map has no entry); typing writes
	 *  the entry. */
	const renderScaleRotatePicker = (
		v: string,
		scale: number | null,
		rotation: number | null,
		target: {
			set: (value: string, scale: number) => void
			reset: (value: string) => void
			setRotation: (value: string, rotation: number) => void
			resetRotation: (value: string) => void
			/** Accessible-name context ("<category>" for point fills, "polygon
			 *  fill <category>" for the Polygon-fill rows). */
			context: string
		} = {
			set: setCategoryScale,
			reset: resetCategoryScale,
			setRotation: setCategoryRotation,
			resetRotation: resetCategoryRotation,
			context: v,
		}
	) =>
		scaleRotateRows({
			context: target.context,
			labelClassName: LABEL_COL,
			value: scale,
			onChange: (n) => target.set(v, n),
			onClear: () => target.reset(v),
			rotation,
			onRotationChange: (n) => target.setRotation(v, n),
			onRotationClear: () => target.resetRotation(v),
		})

	const categoryNameRow = (
		v: string,
		canReset: boolean,
		onReset: () => void,
		/** Display text when the storage key isn't user-friendly (e.g. the
		 * Nesting-depth key "1" shows as "Level 1"). Overrides still key on
		 * `v`. */
		display?: string
	) => (
		<div className="flex items-center justify-between gap-2">
			<span
				className="min-w-0 flex-1 truncate vc-text"
				title={display ?? v}
			>
				{display ?? v}
			</span>
			{canReset && <ResetLink onClick={onReset} />}
		</div>
	)

	// One category's Line-dash controls: the shared DashStylePicker (None /
	// the dash swatches / Custom as a single mutually-exclusive choice; the
	// custom box opens below the row). The "Custom open" flag lives in this
	// panel's `customDashOpen` so the category's Reset link can close it;
	// Reset also clears the dash override and the custom dasharray.
	const renderDashCategory = (v: string, i: number, display?: string) => {
		const s = categoryState(v, i)
		const customDash = customDashOverrides[v] ?? null
		const customOpen = customDashOpen[v] ?? false
		const setCustomOpen = (open: boolean) =>
			setCustomDashOpen((prev) => {
				if (open) return { ...prev, [v]: true }
				const { [v]: _removed, ...rest } = prev
				return rest
			})
		// The row's pick as the picker's single choice: None is a solid stroke,
		// otherwise the override (or the auto-cycled position).
		const current: LineDashPattern = s.dashIsNone
			? "solid"
			: (DASH_CYCLE[s.dashActiveIdx % DASH_CYCLE.length] ?? "solid")
		return (
			<div key={v} className="flex flex-col gap-1 text-sm">
				{categoryNameRow(
					v,
					s.hasDashOverride || customDash !== null || customOpen,
					() => {
						if (s.hasDashOverride) resetDashOverride(v)
						if (customDash !== null) resetCustomDashOverride(v)
						setCustomOpen(false)
					},
					display
				)}
				<DashStylePicker
					pattern={current}
					customDasharray={customDash}
					customOpen={customOpen}
					onCustomOpenChange={setCustomOpen}
					onChange={({ pattern, customDasharray }) => {
						// Picking None or a swatch clears any custom dash (the row stays
						// single-select); typing in the Custom box leaves the dash pick
						// alone, so no override gets pinned where the auto-cycle applied.
						if (customDasharray !== customDash) {
							if (customDasharray === null) resetCustomDashOverride(v)
							else setCustomDashOverride(v, customDasharray)
						}
						if (pattern !== current) {
							setDashOverride(
								v,
								pattern === "solid" ? PATTERN_NONE : DASH_CYCLE.indexOf(pattern)
							)
						}
					}}
					ariaContext={v}
				/>
			</div>
		)
	}

	// One category's Point-fill controls: fill swatches + the per-category ink
	// color picker. Reset clears the fill override and the ink override.
	const renderFillCategory = (v: string, i: number, display?: string) => {
		const s = categoryState(v, i)
		return (
			<div key={v} className="flex flex-col gap-1 text-sm">
				{categoryNameRow(
					v,
					s.hasPaletteOverride || s.hasInk || s.hasScale || s.hasRotation,
					() => {
						if (s.hasPaletteOverride) resetPaletteOverride(v)
						if (s.hasInk) resetCategoryInk(v)
						if (s.hasScale) resetCategoryScale(v)
						if (s.hasRotation) resetCategoryRotation(v)
					},
					display
				)}
				{renderSwatchRow(v, {
					palette: patternMode === "fill" ? activePalette : PATTERN_PALETTE,
					Glyph: patternMode === "fill" ? PatternSwatch : PatternGlyph,
					isNone: s.fillIsNone,
					activeIdx: s.fillActiveIdx,
					ink: s.ink,
					scale: s.scale,
					rotation: s.rotation,
					bg: effectiveBgFor(i, v),
					setIdx: (idx) => setPaletteOverride(v, idx),
					setNone: () => setPaletteOverride(v, PATTERN_NONE),
				})}
				{renderColorPicker(v, s.ink, s.hasInk)}
				{renderScaleRotatePicker(v, s.scale, s.rotation)}
			</div>
		)
	}

	// One category's controls for a separate fill target (the filled radar's
	// polygon, the violin / box body): the same swatch + ink + scale layout
	// as Point fill, writing the target's own maps. Like point fills in
	// line-chart context, a category with no pick renders no pattern.
	// `aria.kind` keeps the rows distinguishable from the Point-fill rows
	// beside them ("No polygon pattern for X", "Polygon pattern option N").
	const renderTargetCategory = (
		t: FillTargetState,
		aria: { kind: string; context: string },
		v: string,
		i: number,
		display?: string,
		/** Preview the chips on this tile (the body's fill) instead of the
		 *  point tile, pairing the default ink on it like the renderer. */
		preview?: { tile: string }
	) => {
		const override = t.overrides[v]
		const isNone = override === undefined || override === PATTERN_NONE
		const activeIdx = typeof override === "number" ? override : -1
		const hasInk = t.inkColors[v] !== undefined
		const ink =
			t.inkColors[v] ??
			(preview ? pairedInkForTile(preview.tile) : effectiveInkFor(i, v))
		const scale = t.scales[v] ?? null
		const hasScale = scale !== null
		const rotation = t.rotations[v] ?? null
		const hasRotation = rotation !== null
		return (
			<div key={v} className="flex flex-col gap-1 text-sm">
				{categoryNameRow(
					v,
					override !== undefined || hasInk || hasScale || hasRotation,
					() => {
						if (override !== undefined) t.resetOverride(v)
						if (hasInk) t.resetInk(v)
						if (hasScale) t.resetScale(v)
						if (hasRotation) t.resetRotation(v)
					},
					display
				)}
				{renderSwatchRow(v, {
					palette: PATTERN_PALETTE,
					Glyph: PatternGlyph,
					isNone,
					activeIdx,
					ink,
					scale,
					rotation,
					bg: preview?.tile ?? effectiveBgFor(i, v),
					setIdx: (idx) => t.setOverride(v, idx),
					setNone: () => t.setOverride(v, PATTERN_NONE),
					ariaKind: aria.kind,
				})}
				{renderColorPicker(v, ink, hasInk, {
					set: t.setInk,
					reset: t.resetInk,
					ariaKind: `${aria.kind.charAt(0).toUpperCase()}${aria.kind.slice(1)}`,
				})}
				{renderScaleRotatePicker(v, scale, rotation, {
					set: t.setScale,
					reset: t.resetScale,
					setRotation: t.setRotation,
					resetRotation: t.resetRotation,
					context: `${aria.context} ${v}`,
				})}
			</div>
		)
	}
	const targetCategorySubsection = (
		t: FillTargetState,
		title: string,
		aria: { kind: string; context: string },
		changed: boolean
	) =>
		fieldValues && (
			<CollapsibleSubsection title={title} defaultOpen changed={changed}>
				<div className="flex flex-col gap-4">
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) =>
						renderTargetCategory(t, aria, v, i, fieldValues.labels?.[i])
					)}
				</div>
			</CollapsibleSubsection>
		)
	const polygonCategorySubsection =
		radarPolygonFilled &&
		targetCategorySubsection(
			polygon,
			"Polygon fill",
			{ kind: "polygon pattern", context: "polygon fill" },
			polygonSubsectionChanged
		)

	// Point fill's "Vary by" — two-way bound to the TOP-LEVEL pattern
	// encoding (the field the shelf row shows), so changing it here changes
	// the shelf and vice-versa. Mirrors Color's / Opacity's Fill. Shown in
	// the Point fill subsection that sits beside the Violin / box fill one,
	// where the two targets' variables are read side by side.
	const pointFillVaryBy = (() => {
		const packedOptions = packedDerivedOptions(
			"pattern",
			hierarchyMode,
			!!encodings.connection?.field
		)
		const eligible = (dataset?.fields ?? []).filter((f) =>
			channelAccepts("pattern", overrides[f.name] ?? f.inferredType)
		)
		const setField = (value: string) => {
			// A derived source picked → store the source, clear the field
			// (mutually exclusive); a field (or "— none —") clears any source.
			const packed = packedSourceForOptionValue(value)
			setEncodings((prev) => ({
				...prev,
				pattern: packed
					? { ...prev.pattern, field: null, measureSource: packed }
					: {
							...prev.pattern,
							field: value === "" ? null : value,
							measureSource: undefined,
						},
			}))
		}
		return (
			<SelectInput
				label="Vary by"
				labelClassName={LABEL_COL}
				value={
					patternSource
						? PACKED_MEASURE_OPTION_VALUE[patternSource]
						: (encodings.pattern?.field ?? "")
				}
				options={[
					{ value: "", label: "— none —" },
					...eligible.map((f) => ({ value: f.name, label: f.name })),
					...packedOptions.map(({ value, label }) => ({ value, label })),
				]}
				onChange={setField}
				disabled={!dataset}
				selectClassName="flex-1"
			/>
		)
	})()

	// The violin / box body subsection, rendered in BOTH panel forms (its
	// own Vary by decides what it lists, not the Pattern channel): the
	// selector, then per-level rows — the Pattern variable's levels under
	// Auto, its own variable's otherwise — or the default pattern + ink +
	// scale when it varies by nothing.
	const violinSubsection = violinFilled && (
		<CollapsibleSubsection
			title="Violin / box fill"
			defaultOpen
			changed={violinSubsectionChanged}
		>
			<div className="flex flex-col gap-3">
				<SelectInput
					label="Vary by"
					labelClassName={LABEL_COL}
					value={
						violinVaryBy === undefined ? VIOLIN_VARY_AUTO : (violinVaryBy ?? "")
					}
					options={[
						{ value: VIOLIN_VARY_AUTO, label: "Auto" },
						{ value: "", label: "— none —" },
						...(dataset?.fields ?? []).map((f) => ({
							value: f.name,
							label: f.name,
						})),
					]}
					onChange={(v) =>
						setViolinField(v === VIOLIN_VARY_AUTO ? undefined : v === "" ? null : v)
					}
					disabled={!dataset}
					selectClassName="flex-1"
				/>
				{violinVaryBy === undefined && (
					<p className="vc-help">
						{patternFieldMapped
							? "The Pattern variable, as for the points."
							: "No Pattern variable is mapped, so one pattern fills every body."}
					</p>
				)}
				{violinFieldMapped && violinLevels ? (
					<div className="flex flex-col gap-4">
						{orderedLevels(
							violinLevels.values,
							violinLevels.type,
							violinLevels.order
						).map(({ value: v, index: i }) =>
							renderTargetCategory(
								violin,
								{ kind: "violin / box pattern", context: "violin / box fill" },
								v,
								i,
								violinLevels.labels?.[i],
								{ tile: violinTile }
							)
						)}
					</div>
				) : (
					<>
						{renderDefaultSwatchRow(
							null,
							PATTERN_PALETTE,
							PatternGlyph,
							true,
							targetDefaultRow(violin, "Violin / box pattern option", violinTile)
						)}
						{violin.defaultIdx !== null && (
							<ColorRow
								label="Ink color"
								value={violin.defaultInk ?? pairedInkForTile(violinTile)}
								onChange={(c) => violin.setDefaultInk(c)}
								onClear={() => violin.setDefaultInk(null)}
								clearLabel="reset"
								placeholder={pairedInkForTile(violinTile)}
							/>
						)}
						{violin.defaultIdx !== null &&
							scaleRotateRows({
								context: "violin / box fill",
								labelClassName: LABEL_COL,
								value: violin.defaultScale,
								onChange: (n) => violin.setDefaultScale(n),
								onClear: () => violin.setDefaultScale(null),
								rotation: violin.defaultRotation,
								onRotationChange: (n) => violin.setDefaultRotation(n),
								onRotationClear: () => violin.setDefaultRotation(null),
							})}
					</>
				)}
			</div>
		</CollapsibleSubsection>
	)

	// Line-chart context (compound), no field: the default dash and the
	// default point fill, each its own card. Polygon mode lists its targets in
	// the other aesthetic menus' order — the points first, then the polygon —
	// while line charts lead with the dash, their main effect.
	const lineDashSubsection = (
		<CollapsibleSubsection
			title={lineDashTitle}
			defaultOpen
			changed={dashSubsectionChanged}
		>
			<div className="flex flex-col gap-3">
				{/* Range rows directly under the dash row — the picker above
				 *  chooses WHICH pattern, the range chooses WHERE it applies. */}
				{renderDefaultDashRow(null)}
				<ConnectionDashRangeRows />
				{gapFillRow}
			</div>
		</CollapsibleSubsection>
	)
	const pointFillSubsection = (
		<CollapsibleSubsection
			title="Point fill"
			defaultOpen
			changed={fillSubsectionChanged}
		>
			<div className="flex flex-col gap-3">
				{renderDefaultSwatchRow(null, PATTERN_PALETTE, PatternGlyph, true)}
				{fillColorRows}
			</div>
		</CollapsibleSubsection>
	)

	// No field mapped — show default pattern picker + ink color + background
	if (!patternFieldMapped) {
		return (
			<div className="vc-option-panel">
				{patternMode === "compound" ? (
					isPolygonMode ? (
						<>
							{pointFillSubsection}
							{pointOutlineSubsection}
							{lineDashSubsection}
							{polygonSubsection}
							{violinSubsection}
						</>
					) : (
						<>
							{lineDashSubsection}
							{polygonSubsection}
							{violinSubsection}
							{pointFillSubsection}
						</>
					)
				) : patternMode === "dashOnly" ? (
					<>
						{/* Bare rows here sit beside the "Regression line" card when
						 *  it renders — px-2 keeps their label/control columns on the
						 *  card rows' shared column. */}
						<div className="px-2">{renderDefaultDashRow(lineDashTitle)}</div>
						<div className="px-2">
							<ConnectionDashRangeRows />
						</div>
						<div className="px-2">{gapFillRow}</div>
						{polygonSubsection}
						{violinSubsection}
					</>
				) : patternMode === "segmentDash" ? (
					// Thin segments: Pattern is the segment dash. No range window
					// (a segment has no "from / to") and no polygon fill.
					<>
						{segmentsRow}
						<div className="px-2">{renderDefaultDashRow("Line dash")}</div>
						<div className="px-2">{gapFillRow}</div>
					</>
				) : violinFilled ? (
					// Beside the Violin / box fill subsection the point rows get
					// their own, so the two targets read as peers.
					<>
						{segmentsRow}
						<CollapsibleSubsection
							title="Point fill"
							defaultOpen
							changed={fillSubsectionChanged}
						>
							<div className="flex flex-col gap-3">
								{pointFillVaryBy}
								{renderDefaultSwatchRow(null, activePalette, PatternSwatch, true)}
								{fillColorRows}
							</div>
						</CollapsibleSubsection>
						{violinSubsection}
					</>
				) : (
					<>
						{segmentsRow}
						<div className="px-2">
							{renderDefaultSwatchRow(
								"Default pattern",
								activePalette,
								PatternSwatch,
								true
							)}
						</div>
						<div className="flex flex-col gap-2 px-2 empty:hidden">
							{fillColorRows}
						</div>
					</>
				)}
				{panelResetChanged && (
					<ResetLink
						onClick={() => {
							setDefaultCustomDashOpen(false)
							resetSegmentPattern()
							if (isPolygonMode) {
								setPointOutlineCustomOpen(false)
								setPointOutlineDash({ pattern: "solid", customDasharray: null })
							}
							setConfigs((prev) => ({
								...prev,
								defaultPattern: null,
								defaultPatternInk: null,
								// Line-chart contexts: also clear the line-dash state this
								// panel owns on the connection config (default dash, gap
								// fill, range window).
								...(patternMode === "fill"
									? {}
									: {
											connection: {
												...connectionConfigFromTheme(liveTheme),
												...prev.connection,
												defaultDashPattern: "solid",
												customDashPattern: null,
												dashGapFill: null,
												dashGapColor: null,
												dashAlternateColors: {},
												dashRange: DEFAULT_DASH_RANGE,
											},
										}),
							}))
							updateCfg({
								// No Background control any more (the tile follows the
								// mark's Color-menu fill); the reset still clears a stored
								// override so legacy saves can shed it.
								backgroundColor: null,
								// Only cleared once set, so untouched saves don't grow a
								// null key.
								...(cfg.defaultScale != null ? { defaultScale: null } : {}),
								...(cfg.defaultRotation != null ? { defaultRotation: null } : {}),
								// Filled-radar polygon defaults live on the pattern config;
								// only touched where the Polygon fill section exists, so
								// other charts' saves don't grow null keys.
								...(radarPolygonFilled ? polygon.clearDefaults : {}),
								...(violinFilled
									? { ...violin.clearDefaults, violinField: undefined }
									: {}),
							})
						}}
						underline
						className="self-start"
					/>
				)}
				{modeDef.canvas.statOverlays && regressionOn(configs) && (
					<RegressionDashSubsection />
				)}
			</div>
		)
	}

	// Line-chart context (compound), a Pattern variable mapped: per-category
	// dash and point-fill rows, each kind its own card.
	const lineDashCategories = fieldValues && (
		<CollapsibleSubsection
			title={lineDashTitle}
			defaultOpen
			changed={dashSubsectionChanged}
		>
			<div className="flex flex-col gap-4">
				{orderedLevels(
					fieldValues.values,
					fieldValues.type,
					fieldValues.order
				).map(({ value: v, index: i }) => renderDashCategory(v, i))}
				{/* No "Apply pattern to range" here: with a pattern variable
				 *  mapped, the variable itself says where each dash applies —
				 *  the two would conflict, so the range is hidden and ignored. */}
				{gapFillRow}
			</div>
		</CollapsibleSubsection>
	)
	const pointFillCategories = fieldValues && (
		<CollapsibleSubsection
			title="Point fill"
			defaultOpen
			changed={fillSubsectionChanged}
		>
			<div className="flex flex-col gap-4">
				{orderedLevels(
					fieldValues.values,
					fieldValues.type,
					fieldValues.order
				).map(({ value: v, index: i }) => renderFillCategory(v, i))}
			</div>
		</CollapsibleSubsection>
	)

	return (
		<div className="vc-option-panel">
			<StackModeRow channel="pattern" className="px-2" />
			{segmentsRow}
			{fieldValues &&
				fieldValues.values.length > 0 &&
				(patternMode === "compound" ? (
					// Line chart context: Pattern drives both line dash and point
					// fill. Split the two into separate subsections so each kind of
					// control reads as its own group, with every category listed
					// under it. Polygon mode orders them as the other menus do.
					isPolygonMode ? (
						<>
							{pointFillCategories}
							{pointOutlineSubsection}
							{lineDashCategories}
							{polygonCategorySubsection}
							{violinSubsection}
						</>
					) : (
						<>
							{lineDashCategories}
							{polygonCategorySubsection}
							{violinSubsection}
							{pointFillCategories}
						</>
					)
				) : patternMode === "fill" && violinFilled ? (
					// Beside the Violin / box fill subsection the point rows get
					// their own, so the two targets read as peers.
					<>
						<CollapsibleSubsection
							title="Point fill"
							defaultOpen
							changed={fillSubsectionChanged}
						>
							<div className="flex flex-col gap-4">
								{pointFillVaryBy}
								{orderedLevels(
									fieldValues.values,
									fieldValues.type,
									fieldValues.order
								).map(({ value: v, index: i }) =>
									renderFillCategory(v, i, fieldValues.labels?.[i])
								)}
							</div>
						</CollapsibleSubsection>
						{violinSubsection}
					</>
				) : (
					// Single-control modes (fill-only or dash-only) keep the flat
					// per-category list — there's only one kind of control, so a
					// subsection header would be redundant.
					<>
						<hr className="border-stone-200 dark:border-stone-700" />
						<div className="flex flex-col gap-4 px-2">
							{orderedLevels(
								fieldValues.values,
								fieldValues.type,
								fieldValues.order
							).map(({ value: v, index: i }) =>
								patternMode === "dashOnly" || patternMode === "segmentDash"
									? renderDashCategory(v, i, fieldValues.labels?.[i])
									: renderFillCategory(v, i, fieldValues.labels?.[i])
							)}
							{/* Range rows are hidden with a pattern variable mapped —
							 *  see the compound branch above. */}
							{(patternMode === "dashOnly" || patternMode === "segmentDash") &&
								gapFillRow}
						</div>
						{patternMode === "dashOnly" && polygonCategorySubsection}
						{violinSubsection}
					</>
				))}
			{modeDef.canvas.statOverlays && regressionOn(configs) && (
				<RegressionDashSubsection />
			)}
		</div>
	)
}
