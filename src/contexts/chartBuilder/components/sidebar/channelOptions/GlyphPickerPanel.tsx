import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_DASH_RANGE,
	DEFAULT_PATTERN_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_SHAPE,
	type ConnectionConfig,
	type DashRangeConfig,
	type LineDashPattern,
	type PatternConfig,
	type RegressionConfig,
	type ShapeConfig,
} from "../../../lib/channelConfig"
import {
	CHIP_BG,
	CHIP_INK,
	CHIP_INK_SELECTED,
	CHIP_STROKE,
	CHIP_STROKE_SELECTED,
} from "../../../lib/previewInk"
import { regressionOn } from "../../../lib/colorSlots"
import {
	flowNodeNames,
	resolveFlowEndpoints,
} from "../../../lib/buildFlowGraph"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	DASH_CYCLE,
	dashArrayFor,
	resolveDashGapFill,
} from "../../../lib/dashPatterns"
import { effectiveType } from "../../../lib/fieldType"
import {
	hierarchyDepthLevels,
	isFlowModeId,
	isHierarchyModeId,
	isStructureModeId,
	packedSourceOf,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import {
	DEFAULT_PATTERN_INK,
	inkForHueColor,
	inkPaletteForHue,
	PATTERN_NONE,
	PATTERN_PALETTE,
} from "../../../lib/patterns"
import { parseValue, SHAPE_PALETTE, symbolPath } from "../../../lib/scales"
import {
	resetShapeCategoryOverrides,
	shapeCategoryHasOverride,
} from "../../../lib/shapeColors"
import {
	axisConfigFromTheme,
	connectionConfigFromTheme,
	patternConfigFromTheme,
	resolveCategoricalPalette,
	resolveOrdinalPalette,
	shapeConfigFromTheme,
	valueChanged,
} from "../../../lib/themeConfig"
import { StackModeRow } from "./StackModeRow"
import type { FieldType } from "../../../lib/types"
import { orderedLevels } from "../../../lib/smartSort"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"

const PREVIEW_SIZE = 20

const ShapeGlyph = ({ idx, selected }: { idx: number; selected: boolean }) => (
	<svg
		width={PREVIEW_SIZE}
		height={PREVIEW_SIZE}
		viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
		aria-hidden="true"
	>
		<path
			d={symbolPath(idx, 5)}
			fill={selected ? "currentColor" : CHIP_INK}
			fillOpacity={0.9}
		/>
	</svg>
)

const LineDashGlyph = ({
	idx,
	selected,
}: {
	idx: number
	selected: boolean
	inkColor?: string
	bgColor?: string
}) => {
	const pattern = DASH_CYCLE[idx % DASH_CYCLE.length] ?? "solid"
	const strokeDashArray = dashArrayFor(pattern) ?? undefined
	// Dashes preview neutral — line color is owned by hue, not ink.
	const strokeColor = selected ? CHIP_INK_SELECTED : CHIP_INK
	return (
		<svg
			width={PREVIEW_SIZE}
			height={PREVIEW_SIZE}
			viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
			aria-hidden="true"
		>
			<line
				x1={2}
				y1={PREVIEW_SIZE / 2}
				x2={PREVIEW_SIZE - 2}
				y2={PREVIEW_SIZE / 2}
				stroke={strokeColor}
				strokeWidth={2}
				strokeLinecap="round"
				strokeDasharray={strokeDashArray}
			/>
		</svg>
	)
}

const PatternGlyph = ({
	idx,
	selected,
	inkColor: inkColorProp,
	bgColor = CHIP_BG,
}: {
	idx: number
	selected: boolean
	inkColor?: string
	bgColor?: string
}) => {
	const def = PATTERN_PALETTE[idx % PATTERN_PALETTE.length]
	const inkColor = inkColorProp ?? (selected ? CHIP_INK_SELECTED : CHIP_INK)
	const uniqueId = `glyph-${def.id}-${selected ? "sel" : "off"}-${inkColor.replaceAll(/[^a-zA-Z0-9]/g, "")}`
	return (
		<svg width={PREVIEW_SIZE} height={PREVIEW_SIZE} aria-hidden="true">
			<defs>
				<pattern
					id={uniqueId}
					patternUnits="userSpaceOnUse"
					width={def.size}
					height={def.size}
				>
					<rect width={def.size} height={def.size} fill={bgColor} />
					{def.render(inkColor)}
				</pattern>
			</defs>
			<rect
				x={0}
				y={0}
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				fill={`url(#${uniqueId})`}
				stroke={selected ? CHIP_STROKE_SELECTED : CHIP_STROKE}
				strokeWidth={0.5}
			/>
		</svg>
	)
}

type CategoryRowProps = {
	value: string
	paletteSize: number
	activeIdx: number
	hasAnyOverride: boolean
	Glyph: React.ComponentType<{ idx: number; selected: boolean }>
	onPick: (idx: number) => void
	onReset: () => void
}

/** One palette row per category. The reset link clears every override the
 *  category has accumulated — shape choice AND fill / stroke color overrides
 *  — so the user has a single way to "go back to defaults" instead of
 *  hunting down per-attribute reset links. */
const CategoryRow = ({
	value,
	paletteSize,
	activeIdx,
	hasAnyOverride,
	Glyph,
	onPick,
	onReset,
}: CategoryRowProps) => (
	<div className="flex flex-col gap-1 text-sm">
		<div className="flex items-center justify-between gap-2">
			<span
				className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300"
				title={value}
			>
				{value}
			</span>
			{hasAnyOverride && (
				<button
					type="button"
					onClick={onReset}
					className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					reset
				</button>
			)}
		</div>
		<div className="flex flex-wrap gap-1">
			{Array.from({ length: paletteSize }, (_, idx) => {
				const selected = idx === activeIdx
				return (
					<button
						key={idx}
						type="button"
						onClick={() => onPick(idx)}
						aria-pressed={selected}
						className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
							selected
								? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
								: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
						}`}
					>
						<Glyph idx={idx} selected={selected} />
					</button>
				)
			})}
		</div>
	</div>
)

/** Color row local to this panel that wraps the shared `ColorInput`
 *  with an optional inline "clear" button. The clearable semantics are
 *  GlyphPickerPanel-specific (per-shape stroke/fill overrides can be
 *  null = "inherit from defaults") so they don't belong in the shared
 *  primitive. */
const ColorRow = ({
	label,
	value,
	onChange,
	onClear,
	clearLabel = "clear",
	className,
}: {
	label: string
	value: string | null
	onChange: (c: string) => void
	onClear?: () => void
	clearLabel?: string
	placeholder?: string
	className?: string
}) => (
	<div
		className={`flex items-center gap-2 text-sm${className ? ` ${className}` : ""}`}
	>
		<ColorInput
			label={label}
			labelClassName={LABEL_COL}
			value={value ?? "#000000"}
			onChange={onChange}
			className="contents"
		/>
		{onClear && value !== null && (
			<button
				type="button"
				onClick={onClear}
				className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				{clearLabel}
			</button>
		)}
	</div>
)

const useUniqueValuesForChannel = (
	channel: "shape" | "pattern" | "hue"
): {
	values: string[]
	type: FieldType
	labels?: string[]
	/** User-pinned level order for the backing field (Fields reorder UI).
	 *  Undefined for derived / flow sources — those have no single backing
	 *  field, so their rows stay in the renderer's discovery/union order. */
	order?: readonly string[]
} | null => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const modeDef = useChartModeDef()
	const dataset = useCurrentDatasetView()
	const fieldName = encodings[channel].field
	// Hierarchy-DERIVED pattern sources (Top-level group / Nesting depth):
	// category rows come from the tree, not a column — the same stable
	// dataset-order lists the renderer's derived pattern domain uses.
	const derived =
		channel === "pattern" && isHierarchyModeId(modeDef.id)
			? packedSourceOf(encodings.pattern)
			: null
	if (dataset && derived) {
		const parentField = encodings.connection?.field ?? null
		if (!parentField) return null
		const areaField = encodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			configs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		if (derived === "rootGroup") {
			return {
				values: topLevelGroupNames(dataset.rows, parentField, idField, areaField),
				type: "categorical",
			}
		}
		const levels = hierarchyDepthLevels(
			dataset.rows,
			parentField,
			idField,
			areaField
		)
		return {
			values: levels,
			type: "ordinal",
			labels: levels.map((l) => `Level ${l}`),
		}
	}
	if (!dataset || !fieldName) return null
	const field = dataset.fields.find((f) => f.name === fieldName)
	const type: FieldType =
		overrides[fieldName] ?? field?.inferredType ?? "categorical"
	// Flow diagrams (chord / sankey) pattern by NODE over the source∪target
	// UNION domain (see useFlowScaffold) — pattern indices assign by position
	// in that union, so the per-category rows must list the same union in the
	// same order or the glyph shown drifts from the drawn pattern. Mirrors
	// the hue panel's `flowNodeValues` override.
	if (channel === "pattern" && isFlowModeId(modeDef.id)) {
		const { sourceField, targetField } = resolveFlowEndpoints(
			encodings,
			configs.connection,
			dataset
		)
		if (
			sourceField &&
			targetField &&
			(fieldName === sourceField || fieldName === targetField)
		) {
			return {
				values: flowNodeNames(dataset.rows, sourceField, targetField),
				type,
			}
		}
	}
	const values = [
		...new Set(
			dataset.rows
				.map((r) => parseValue(r[fieldName], type))
				.filter((v) => v !== null)
				.map(String)
		),
	]
	return { values, type, order: levelOrders[fieldName] }
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
export const ShapeOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useAtomValue(themeAtom)
	const fieldMapped = !!encodings.shape?.field
	// Same defensive merge: older visualizations may be missing outlineColor /
	// outlineWidth / overrides when the config was first introduced.
	const cfg: ShapeConfig = {
		...shapeConfigFromTheme(theme),
		...configs.shape,
	}
	const fieldValues = useUniqueValuesForChannel("shape")

	const updateCfg = (next: Partial<ShapeConfig>) => {
		// Seed untouched fields from the THEME (outline color / width) so the
		// stored slice matches the "changed" dot's theme baseline — seeding from
		// the built-in `DEFAULT_SHAPE_CONFIG` (white outline) would diverge from
		// a theme with a custom outline color and light the dot on first edit.
		setConfigs((prev) => ({
			...prev,
			shape: { ...shapeConfigFromTheme(theme), ...prev.shape, ...next },
		}))
	}

	const setOverride = (value: string, idx: number) =>
		updateCfg({ overrides: { ...cfg.overrides, [value]: idx } })
	const resetCategory = (value: string) =>
		updateCfg(resetShapeCategoryOverrides(cfg, value))

	const defaultShapeIdx = configs.defaultShape ?? DEFAULT_SHAPE

	return (
		<div className="vc-option-panel">
			<NumberInput
				label="Outline width"
				labelClassName={LABEL_COL}
				value={cfg.outlineWidth}
				min={0}
				max={10}
				step={0.5}
				clamp
				onChange={(outlineWidth) => updateCfg({ outlineWidth })}
				suffix="px"
				changed={valueChanged(cfg.outlineWidth, theme.outlineWidth)}
			/>
			{/* Outline COLOR now lives in the unified Color menu (Outline
			 *  subheader) — only outline WIDTH remains here. */}
			<p className="vc-help">
				Set outline color under the <strong>Color</strong> menu →{" "}
				<strong>Outline</strong>.
			</p>
			{!fieldMapped && (
				<>
					<hr className="border-stone-200 dark:border-stone-700" />
					<div className="flex flex-col gap-1 text-sm">
						<span className="text-stone-600 dark:text-stone-400">
							Default shape
						</span>
						<div className="flex flex-wrap gap-1">
							{SHAPE_PALETTE.map((_, idx) => {
								const selected = idx === defaultShapeIdx
								return (
									<button
										// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
										key={idx}
										type="button"
										onClick={() =>
											setConfigs((prev) => ({
												...prev,
												defaultShape: idx,
											}))
										}
										aria-pressed={selected}
										className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
											selected
												? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
												: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
										}`}
									>
										<ShapeGlyph idx={idx} selected={selected} />
									</button>
								)
							})}
						</div>
					</div>
				</>
			)}
			{fieldMapped && fieldValues && fieldValues.values.length > 0 && (
				<>
					<hr className="border-stone-200 dark:border-stone-700" />
					{/* Shape choice per category only. Per-category FILL / OUTLINE
					 *  color lives in the unified Color menu (Fill / Outline
					 *  subheaders → "Vary by" the shape field) — see the note above.
					 *  Legacy `fillOverrides` / `strokeOverrides` on saved visuals are
					 *  still honored by the renderer and cleared by this row's reset. */}
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) => (
						<CategoryRow
							key={v}
							value={v}
							paletteSize={SHAPE_PALETTE.length}
							activeIdx={cfg.overrides[v] ?? i % SHAPE_PALETTE.length}
							hasAnyOverride={shapeCategoryHasOverride(cfg, v)}
							Glyph={ShapeGlyph}
							onPick={(idx) => setOverride(v, idx)}
							onReset={() => resetCategory(v)}
						/>
					))}
				</>
			)}
			<button
				type="button"
				onClick={() => {
					setConfigs((prev) => ({
						...prev,
						defaultShape: theme.defaultShape,
					}))
					updateCfg({
						outlineColor: theme.outlineColor,
						outlineWidth: theme.outlineWidth,
					})
				}}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------
export const PatternOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Categories where the user picked the "Custom" dash option. Tracked
	// locally so the custom-dasharray box can open (and stay open) before any
	// value is typed — an empty string isn't persisted to `customDashOverrides`.
	const [customDashOpen, setCustomDashOpen] = useState<Record<string, boolean>>(
		{}
	)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const theme = useAtomValue(themeAtom)
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
	const palettePatternInks = inkPaletteForHue(configs, hueType).inks ?? []
	const effectiveInkFor = (categoryIdx: number): string => {
		if (!patternMatchesHue) return DEFAULT_PATTERN_INK
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
	const patternMode: "fill" | "compound" | "dashOnly" = !connectionMapped
		? "fill"
		: pointsHidden
			? "dashOnly"
			: "compound"
	const activePalette = patternMode === "fill" ? PATTERN_PALETTE : DASH_CYCLE
	const PatternSwatch = patternMode === "fill" ? PatternGlyph : LineDashGlyph
	// `dashOnly` collapses to a single dash-only picker; same primary
	// palette + glyph as the legacy "dash" rendering, but we skip the
	// Point-fill row and Color picker downstream.
	const showFillRow = patternMode !== "dashOnly"

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
	const defaultGapColorFor = (categoryIdx: number): string =>
		(palettePatternInks.length > 0
			? palettePatternInks[categoryIdx % palettePatternInks.length]
			: null) ??
		configs.defaultPatternInk ??
		DEFAULT_PATTERN_INK
	const gapColorRow = (args: {
		key: string
		label: string
		/** Accessible name for the inputs; defaults to "Gap color for <label>"
		 *  (the single no-hue row passes plain "Gap color"). */
		ariaLabel?: string
		override: string | null
		fallback: string
		onChange: (color: string | null) => void
	}) => {
		const aria = args.ariaLabel ?? `Gap color for ${args.label}`
		return (
			<div key={args.key} className="flex items-center gap-2 text-sm">
				<span
					className="w-24 flex-shrink-0 truncate text-stone-600 dark:text-stone-400"
					title={args.label}
				>
					{args.label}
				</span>
				<input
					type="text"
					value={args.override ?? ""}
					placeholder={args.fallback}
					onChange={(e) =>
						args.onChange(e.target.value === "" ? null : e.target.value)
					}
					aria-label={aria}
					className="w-24 rounded border border-stone-300 bg-white px-1 py-0.5 font-mono text-sm placeholder:text-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-600"
				/>
				<input
					type="color"
					value={args.override ?? args.fallback}
					onChange={(e) => args.onChange(e.target.value)}
					aria-label={`${aria} swatch`}
					className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
				/>
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
					fallback: defaultGapColorFor(i),
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
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={gapFillOn}
					onChange={(e) => setGapFill(e.target.checked)}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">
					Fill dash gaps
				</span>
			</label>
			<p className="vc-help">
				Paints the gaps between dashes so the line stays connected — by
				default in the palette&apos;s paired pattern color (the same pairing
				area patterns use). Adjust the gap colors below. Uncheck for a
				truly dashed line with empty gaps.
			</p>
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
			: valueChanged(connDefaultDash, "solid")) ||
		dashRangeChanged ||
		gapFillChanged
	const fillSubsectionChanged = patternFieldMapped
		? nonEmptyMap(cfg.overrides) || nonEmptyMap(cfg.inkColors)
		: valueChanged(configs.defaultPattern, null) ||
			valueChanged(configs.defaultPatternInk, theme.patternInkColor) ||
			valueChanged(cfg.backgroundColor, theme.patternBackgroundColor)

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

	const previewBg =
		cfg.backgroundColor ?? DEFAULT_PATTERN_CONFIG.backgroundColor

	// No field mapped — show default pattern picker + ink color + background
	if (!patternFieldMapped) {
		const defaultPatternIdx = configs.defaultPattern ?? null
		const defaultInk = configs.defaultPatternInk ?? DEFAULT_PATTERN_INK
		// Ink reset follows the pattern-color pairings the user configured in
		// theme settings: each palette color can carry a paired pattern ink.
		// Match the current Background against those palette colors (categorical
		// first, then ordinal) and restore its paired ink; fall back to the
		// theme's global pattern ink when the Background isn't a paired color.
		// Read straight from the theme — the channel configs don't carry the
		// resolved palette, so a configs-based lookup would always miss here.
		const catPalette = resolveCategoricalPalette(theme)
		const ordPalette = resolveOrdinalPalette(theme)
		const resetInk =
			inkForHueColor(previewBg, catPalette.colors, catPalette.patternInks) ??
			inkForHueColor(previewBg, ordPalette.colors, ordPalette.patternInks) ??
			theme.patternInkColor

		const setDefaultPattern = (next: number | null) =>
			setConfigs((prev) => ({ ...prev, defaultPattern: next }))
		const renderDefaultSwatchRow = (
			label: string | null,
			palette: readonly unknown[],
			Glyph: typeof PatternGlyph | typeof LineDashGlyph,
			showNone: boolean
		) => (
			<div className="flex flex-col gap-1 text-sm">
				{label && (
					<span className="text-stone-600 dark:text-stone-400">{label}</span>
				)}
				<div className="flex flex-wrap gap-1">
					{showNone && (
						<button
							type="button"
							onClick={() => setDefaultPattern(null)}
							aria-pressed={defaultPatternIdx === null}
							className={`flex h-7 items-center justify-center rounded border px-2 text-sm transition-colors ${
								defaultPatternIdx === null
									? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
									: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
							}`}
						>
							None
						</button>
					)}
					{palette.map((_, idx) => {
						const selected = idx === defaultPatternIdx
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
								key={idx}
								type="button"
								onClick={() => setDefaultPattern(idx)}
								aria-pressed={selected}
								aria-label={`Pattern option ${idx + 1}`}
								className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
									selected
										? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
										: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
								}`}
							>
								<Glyph
									idx={idx}
									selected={selected}
									inkColor={defaultInk}
									bgColor={previewBg}
								/>
							</button>
						)
					})}
				</div>
			</div>
		)

		// Default LINE DASH row (no pattern variable) — writes the CONNECTION
		// config's `defaultDashPattern`, which is what the line renderers
		// actually read (scatter connection polylines + area line-mode
		// edges). Deliberately NOT `configs.defaultPattern`: that's the
		// point-fill selection, and sharing one index between the two rows
		// made picking a dash silently pick a point fill too (and the dash
		// itself never rendered).
		const dashSwatchClass = (selected: boolean) =>
			`flex h-7 items-center justify-center rounded border transition-colors ${
				selected
					? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
					: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
			}`
		const renderDefaultDashRow = (label: string | null) => {
			const activeIdx = DASH_CYCLE.indexOf(connDefaultDash)
			return (
				<div className="flex flex-col gap-1 text-sm">
					{label && (
						<span className="text-stone-600 dark:text-stone-400">{label}</span>
					)}
					<div className="flex flex-wrap gap-1">
						<button
							type="button"
							onClick={() =>
								updateConnectionCfg({ defaultDashPattern: "solid" })
							}
							aria-pressed={activeIdx < 0}
							aria-label="No line dash"
							className={`${dashSwatchClass(activeIdx < 0)} px-2 text-sm`}
						>
							None
						</button>
						{DASH_CYCLE.map((style, idx) => {
							const selected = idx === activeIdx
							return (
								<button
									key={style}
									type="button"
									onClick={() =>
										updateConnectionCfg({ defaultDashPattern: style })
									}
									aria-pressed={selected}
									aria-label={`Line dash option ${idx + 1}`}
									className={`${dashSwatchClass(selected)} w-7`}
								>
									<LineDashGlyph idx={idx} selected={selected} />
								</button>
							)
						})}
					</div>
				</div>
			)
		}
		// Nudge when the range is on but no dash is picked — the range only
		// gates where a dash applies, so on its own it draws nothing.
		const rangeNeedsDashHint = (configs.connection?.dashRange?.enabled ??
			false) &&
			connDefaultDash === "solid" && (
				<p className="vc-help">
					Pick a dash style above — the range only sets where the dash
					applies.
				</p>
			)

		// Ink + background swatches for the point fill pattern. In compound
		// mode these live inside the "Point fill" subsection (alongside the
		// pattern swatches they recolor); in fill mode they trail the default
		// pattern row. `showFillRow` is false in dashOnly, so nothing renders.
		const fillColorRows = (
			<>
				{defaultPatternIdx !== null && showFillRow && (
					<ColorRow
						label="Ink color"
						value={defaultInk}
						onChange={(c) =>
							setConfigs((prev) => ({
								...prev,
								defaultPatternInk: c,
							}))
						}
						onClear={() =>
							setConfigs((prev) => ({
								...prev,
								defaultPatternInk: resetInk,
							}))
						}
						clearLabel="reset"
						placeholder={resetInk}
					/>
				)}
				{showFillRow && (
					<ColorRow
						label="Background"
						value={cfg.backgroundColor}
						onChange={(c) => updateCfg({ backgroundColor: c })}
						onClear={() =>
							updateCfg({ backgroundColor: theme.defaultFill })
						}
						clearLabel="reset"
						placeholder={theme.defaultFill}
					/>
				)}
			</>
		)

		return (
			<div className="vc-option-panel">
				{patternMode === "compound" ? (
					<>
						<CollapsibleSubsection
							title="Line dash"
							defaultOpen
							changed={dashSubsectionChanged}
						>
							<div className="flex flex-col gap-3">
								{renderDefaultDashRow(null)}
								{gapFillRow}
								<ConnectionDashRangeRows />
								{rangeNeedsDashHint}
							</div>
						</CollapsibleSubsection>
						<CollapsibleSubsection
							title="Point fill"
							defaultOpen
							changed={fillSubsectionChanged}
						>
							<div className="flex flex-col gap-3">
								{renderDefaultSwatchRow(
									null,
									PATTERN_PALETTE,
									PatternGlyph,
									true
								)}
								{fillColorRows}
							</div>
						</CollapsibleSubsection>
					</>
				) : patternMode === "dashOnly" ? (
					<>
						{/* Bare rows here sit beside the "Regression line" card when
						 *  it renders — px-2 keeps their label/control columns on the
						 *  card rows' shared column. */}
						<div className="px-2">{renderDefaultDashRow("Line dash")}</div>
						<div className="px-2">{gapFillRow}</div>
						<div className="px-2">
							<ConnectionDashRangeRows />
						</div>
						{rangeNeedsDashHint}
					</>
				) : (
					<>
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
				<button
					type="button"
					onClick={() => {
						setConfigs((prev) => ({
							...prev,
							defaultPattern: null,
							defaultPatternInk: theme.patternInkColor,
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
											dashGapFill: null,
											dashGapColor: null,
											dashAlternateColors: {},
											dashRange: DEFAULT_DASH_RANGE,
										},
									}),
						}))
						updateCfg({ backgroundColor: theme.patternBackgroundColor })
					}}
					className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					reset
				</button>
				{modeDef.id === "scatter" && regressionOn(configs) && (
					<RegressionDashSubsection />
				)}
			</div>
		)
	}

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
		const ink = cfg.inkColors[v] ?? effectiveInkFor(i)
		return {
			fillIsNone,
			dashIsNone,
			fillActiveIdx,
			dashActiveIdx,
			ink,
			hasInk: cfg.inkColors[v] !== undefined,
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
			setIdx: (idx: number) => void
			setNone: () => void
			/** When set, a trailing "Custom" button joins the row. `customActive`
			 *  takes visual precedence — None and every swatch de-highlight while
			 *  it's on (matching the renderer, where a custom dasharray wins). */
			customActive?: boolean
			onCustom?: () => void
		}
	) => {
		const Glyph = args.Glyph
		const customActive = !!args.customActive
		return (
			<div className="flex flex-wrap gap-1">
				<button
					type="button"
					onClick={args.setNone}
					aria-pressed={args.isNone && !customActive}
					aria-label={`No pattern for ${v}`}
					className={`flex h-7 items-center justify-center rounded border px-2 text-sm transition-colors ${
						args.isNone && !customActive
							? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
							: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
					}`}
				>
					None
				</button>
				{args.palette.map((_, idx) => {
					const selected =
						!args.isNone && !customActive && idx === args.activeIdx
					return (
						<button
							// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
							key={idx}
							type="button"
							onClick={() => args.setIdx(idx)}
							aria-pressed={selected}
							aria-label={`Pattern option ${idx + 1}`}
							className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
								selected
									? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
									: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
							}`}
						>
							<Glyph
								idx={idx}
								selected={selected}
								inkColor={args.ink}
								bgColor={previewBg}
							/>
						</button>
					)
				})}
				{args.onCustom && (
					<button
						type="button"
						onClick={args.onCustom}
						aria-pressed={customActive}
						aria-label={`Custom dash for ${v}`}
						className={`flex h-7 items-center justify-center rounded border px-2 text-sm transition-colors ${
							customActive
								? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
								: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
						}`}
					>
						Custom
					</button>
				)}
			</div>
		)
	}

	const renderColorPicker = (v: string, ink: string, hasInk: boolean) => (
		<div className="flex items-center gap-2">
			<label className="flex items-center gap-2">
				<span className="text-sm text-stone-600 dark:text-stone-400">Color</span>
				<input
					type="text"
					value={hasInk ? ink : ""}
					onChange={(e) => {
						if (e.target.value === "") resetCategoryInk(v)
						else setCategoryInk(v, e.target.value)
					}}
					placeholder={ink}
					className="w-24 rounded border border-stone-300 bg-white px-1 py-0.5 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
			</label>
			<input
				type="color"
				value={ink}
				onChange={(e) => setCategoryInk(v, e.target.value)}
				className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
				aria-label={`Pattern color for ${v}`}
			/>
		</div>
	)

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
				className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300"
				title={display ?? v}
			>
				{display ?? v}
			</span>
			{canReset && (
				<button
					type="button"
					onClick={onReset}
					className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					reset
				</button>
			)}
		</div>
	)

	// One category's Line-dash controls. None / the dash swatches / Custom are
	// a single mutually-exclusive choice; picking Custom opens the dasharray
	// box below the row. Reset clears the dash override, the custom dasharray,
	// and the local "Custom open" flag.
	const renderDashCategory = (v: string, i: number, display?: string) => {
		const s = categoryState(v, i)
		const hasCustomDash = customDashOverrides[v] !== undefined
		const customActive = customDashOpen[v] || hasCustomDash
		const closeCustom = () =>
			setCustomDashOpen((prev) => {
				const { [v]: _removed, ...rest } = prev
				return rest
			})
		// Switching to None or a swatch clears any custom dash so the row stays
		// single-select.
		const clearCustom = () => {
			if (hasCustomDash) resetCustomDashOverride(v)
			closeCustom()
		}
		return (
			<div key={v} className="flex flex-col gap-1 text-sm">
				{categoryNameRow(
					v,
					s.hasDashOverride || hasCustomDash || customActive,
					() => {
						if (s.hasDashOverride) resetDashOverride(v)
						if (hasCustomDash) resetCustomDashOverride(v)
						closeCustom()
					},
					display
				)}
				{renderSwatchRow(v, {
					palette: DASH_CYCLE,
					Glyph: LineDashGlyph,
					isNone: s.dashIsNone,
					activeIdx: s.dashActiveIdx,
					ink: s.ink,
					setIdx: (idx) => {
						clearCustom()
						setDashOverride(v, idx)
					},
					setNone: () => {
						clearCustom()
						setDashOverride(v, PATTERN_NONE)
					},
					customActive,
					onCustom: () =>
						setCustomDashOpen((prev) => ({ ...prev, [v]: true })),
				})}
				{customActive && (
					<CustomDashInput
						value={customDashOverrides[v] ?? ""}
						onChange={(raw) => {
							if (raw === "") resetCustomDashOverride(v)
							else setCustomDashOverride(v, raw)
						}}
					/>
				)}
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
					s.hasPaletteOverride || s.hasInk,
					() => {
						if (s.hasPaletteOverride) resetPaletteOverride(v)
						if (s.hasInk) resetCategoryInk(v)
					},
					display
				)}
				{renderSwatchRow(v, {
					palette: patternMode === "fill" ? activePalette : PATTERN_PALETTE,
					Glyph: patternMode === "fill" ? PatternSwatch : PatternGlyph,
					isNone: s.fillIsNone,
					activeIdx: s.fillActiveIdx,
					ink: s.ink,
					setIdx: (idx) => setPaletteOverride(v, idx),
					setNone: () => setPaletteOverride(v, PATTERN_NONE),
				})}
				{renderColorPicker(v, s.ink, s.hasInk)}
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			<StackModeRow channel="pattern" className="px-2" />
			{showFillRow &&
				(hueIsMapped ? (
					<div className="vc-help">
						Background follows hue encoding. Adjust the pattern line/dot color
						per category below.
					</div>
				) : (
					<ColorRow
						label="Background"
						className="px-2"
						value={cfg.backgroundColor}
						onChange={(c) => updateCfg({ backgroundColor: c })}
						onClear={() =>
							updateCfg({ backgroundColor: theme.defaultFill })
						}
						clearLabel="reset"
						placeholder={theme.defaultFill}
					/>
				))}
			{fieldValues &&
				fieldValues.values.length > 0 &&
				(patternMode === "compound" ? (
					// Line chart context: Pattern drives both line dash and point
					// fill. Split the two into separate subsections so each kind of
					// control reads as its own group, with every category listed
					// under it.
					<>
						<CollapsibleSubsection
							title="Line dash"
							defaultOpen
							changed={dashSubsectionChanged}
						>
							<div className="flex flex-col gap-4">
								{orderedLevels(
									fieldValues.values,
									fieldValues.type,
									fieldValues.order
								).map(({ value: v, index: i }) =>
									renderDashCategory(v, i)
								)}
								{/* No "Apply pattern to range" here: with a pattern
								 *  variable mapped, the variable itself says where each
								 *  dash applies — the two would conflict, so the range is
								 *  hidden and ignored. */}
								{gapFillRow}
							</div>
						</CollapsibleSubsection>
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
								).map(({ value: v, index: i }) =>
									renderFillCategory(v, i)
								)}
							</div>
						</CollapsibleSubsection>
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
								patternMode === "dashOnly"
									? renderDashCategory(v, i, fieldValues.labels?.[i])
									: renderFillCategory(v, i, fieldValues.labels?.[i])
							)}
							{/* Range rows are hidden with a pattern variable mapped —
							 *  see the compound branch above. */}
							{patternMode === "dashOnly" && gapFillRow}
						</div>
					</>
				))}
			{modeDef.id === "scatter" && regressionOn(configs) && (
				<RegressionDashSubsection />
			)}
		</div>
	)
}

/** Dash pattern for the scatter regression-line overlay: the same
 *  None / dash swatches / Custom row per-category lines get, but a single
 *  choice for the one overlay line (per-group fits share it). Writes
 *  `configs.x.regression.lineStyle` / `.customDasharray` — regression
 *  styling stays on the x-axis config with the rest of the regression
 *  settings, so the pattern channel's own config is untouched. Gated on
 *  scatter mode with the regression line enabled. */
const RegressionDashSubsection = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Live theme (settings edits appear immediately) — same lookup as the
	// Color panel's regression width control.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	// Keeps the custom-dasharray box open before any value is typed — an
	// empty string isn't persisted (mirrors the per-category picker).
	const [customOpen, setCustomOpen] = useState(false)
	const base: RegressionConfig =
		axisConfigFromTheme(theme, "x").regression ?? DEFAULT_REGRESSION_CONFIG
	const reg: RegressionConfig = { ...base, ...configs.x?.regression }
	const update = (next: Partial<RegressionConfig>) =>
		setConfigs((prev) => ({
			...prev,
			x: {
				...axisConfigFromTheme(theme, "x"),
				...prev.x,
				regression: { ...reg, ...next },
			},
		}))
	const hasCustom = !!reg.customDasharray
	const customActive = customOpen || hasCustom
	const isNone = reg.lineStyle === "solid" && !customActive
	const activeIdx = DASH_CYCLE.indexOf(reg.lineStyle)
	const changed =
		valueChanged(reg.lineStyle, base.lineStyle) ||
		valueChanged(reg.customDasharray, base.customDasharray) ||
		valueChanged(
			{ ...DEFAULT_DASH_RANGE, ...reg.dashRange },
			{ ...DEFAULT_DASH_RANGE, ...base.dashRange }
		)
	// None / a swatch / Custom are a single mutually-exclusive choice —
	// picking a style clears any custom dasharray.
	const pick = (style: LineDashPattern) => {
		setCustomOpen(false)
		update({ lineStyle: style, customDasharray: null })
	}
	const swatchClass = (selected: boolean) =>
		`flex h-7 items-center justify-center rounded border transition-colors ${
			selected
				? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
				: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
		}`
	return (
		<CollapsibleSubsection title="Regression line" changed={changed}>
			<div className="flex flex-col gap-1 text-sm">
				<div className="flex flex-wrap gap-1">
					<button
						type="button"
						onClick={() => pick("solid")}
						aria-pressed={isNone}
						aria-label="No dash for regression line"
						className={`${swatchClass(isNone)} px-2 text-sm`}
					>
						None
					</button>
					{DASH_CYCLE.map((style) => {
						const idx = DASH_CYCLE.indexOf(style)
						const selected = !customActive && idx === activeIdx
						return (
							<button
								key={style}
								type="button"
								onClick={() => pick(style)}
								aria-pressed={selected}
								aria-label={`Regression line dash ${style}`}
								className={`${swatchClass(selected)} w-7`}
							>
								<LineDashGlyph idx={idx} selected={selected} />
							</button>
						)
					})}
					<button
						type="button"
						onClick={() => setCustomOpen(true)}
						aria-pressed={customActive}
						aria-label="Custom dash for regression line"
						className={`${swatchClass(customActive)} px-2 text-sm`}
					>
						Custom
					</button>
				</div>
				{customActive && (
					<CustomDashInput
						value={reg.customDasharray ?? ""}
						onChange={(raw) => {
							if (raw === "") update({ customDasharray: null })
							else update({ customDasharray: raw })
						}}
					/>
				)}
				<DashRangeRows
					range={{ ...DEFAULT_DASH_RANGE, ...reg.dashRange }}
					onChange={(next) =>
						update({
							dashRange: { ...DEFAULT_DASH_RANGE, ...reg.dashRange, ...next },
						})
					}
				/>
			</div>
		</CollapsibleSubsection>
	)
}

/** "Apply pattern to range" rows: gate a line's dash to a [From, To] window
 *  along the axis the line runs along — dash inside, solid outside (the
 *  known-vs-forecast look). Shared by the connection Line-dash sections
 *  (writes `connection.dashRange`) and the Regression line subheader
 *  (writes `x.regression.dashRange`). From/To are raw text inputs, not
 *  NumberInput: time axes take date strings, and clearing must yield null
 *  (the clear-to-null convention). */
const DashRangeRows = ({
	range,
	onChange,
}: {
	range: DashRangeConfig
	onChange: (next: Partial<DashRangeConfig>) => void
}) => (
	<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				checked={range.enabled}
				onChange={(e) => onChange({ enabled: e.target.checked })}
				className="h-3 w-3"
			/>
			<span className="text-stone-600 dark:text-stone-400">
				Apply pattern to range
			</span>
		</label>
		{range.enabled && (
			<>
				{(
					[
						["min", "From"],
						["max", "To"],
					] as const
				).map(([key, label]) => (
					<div key={key} className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>
							{label}
						</span>
						<input
							type="text"
							value={String(range[key] ?? "")}
							onChange={(e) =>
								onChange({
									[key]: e.target.value === "" ? null : e.target.value,
								})
							}
							aria-label={`Pattern range ${label.toLowerCase()}`}
							className="w-24 rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
					</div>
				))}
				<p className="vc-help">
					The pattern draws only between From and To (axis values — numbers
					or dates); outside the range the line is solid. Leave a side blank
					for unbounded — e.g. set only From to the forecast start.
				</p>
			</>
		)}
	</div>
)

/** DashRangeRows wired to `configs.connection.dashRange` — the window every
 *  connection polyline and area line-mode edge shares. Theme-seeded merge on
 *  write so untouched connection fields keep matching the changed-dot
 *  baseline (mirrors ConnectionOptionsPanel's updateCfg). */
const ConnectionDashRangeRows = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const range: DashRangeConfig = {
		...DEFAULT_DASH_RANGE,
		...configs.connection?.dashRange,
	}
	const onChange = (next: Partial<DashRangeConfig>) =>
		setConfigs((prev) => ({
			...prev,
			connection: {
				...connectionConfigFromTheme(theme),
				...prev.connection,
				dashRange: { ...range, ...next },
			},
		}))
	return <DashRangeRows range={range} onChange={onChange} />
}

/** Per-category custom-dasharray text input. Empty string clears the
 *  override (caller falls back to the built-in DASH_CYCLE selection).
 *  The placeholder `"2,2"` prompts the user with the expected format;
 *  see `sanitizeCustomDasharray` in `lib/dashPatterns.ts` for parsing. */
const CustomDashInput = ({
	value,
	onChange,
}: {
	value: string
	onChange: (raw: string) => void
}) => (
	<input
		type="text"
		value={value}
		placeholder="2,2"
		// eslint-disable-next-line jsx-a11y/no-autofocus -- box only mounts on an explicit "Custom" click, so focusing it is the expected next action
		autoFocus
		aria-label="Custom dash pattern"
		onChange={(e) => onChange(e.target.value)}
		className="w-24 rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-sm placeholder:text-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-600"
	/>
)
