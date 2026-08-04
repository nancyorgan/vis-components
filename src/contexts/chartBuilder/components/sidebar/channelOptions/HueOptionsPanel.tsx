import { useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	type HueConfig,
	type PaletteName,
} from "../../../lib/channelConfig"
import { channelAccepts } from "../../../lib/channels"
import { effectiveType } from "../../../lib/fieldType"
import {
	MEASURE_OPTION_VALUE,
	resolveHistogramMeasure,
} from "../../../lib/histogramMeasure"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import { DEFAULT_HEXBIN_BIN_COUNT } from "../../../lib/hexbins"
import {
	HEXBIN_MEASURE_OPTION_VALUE,
	hexbinDerivedOptions,
	hexbinSourceForOptionValue,
	hexbinSourceOf,
} from "../../../lib/hexbinMeasure"
import {
	flowNodeNames,
	resolveFlowEndpoints,
} from "../../../lib/buildFlowGraph"
import {
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isFlowModeId,
	isHierarchyModeId,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import { useChartModeDef } from "../../../store/useChartModeDef"
import {
	buildQuantHueConfigFromTheme,
	resolveGradientToConfig,
} from "../../../lib/hueDefaults"
import { rgb as d3Rgb } from "d3-color"
import { StackModeRow } from "./StackModeRow"
import {
	CATEGORICAL_HUE_PALETTE,
	PALETTE_INTERPOLATORS,
	parseValue,
} from "../../../lib/scales"
import type { CustomHueStop } from "../../../lib/channelConfig"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	type AtomValueType,
	type SetterOrUpdater,
	themeAtom,
	themesAtom,
} from "../../../store/atoms"
import { orderedLevels } from "../../../lib/smartSort"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../../components/ui/SelectInput"

/** Sequential (single-progression) d3 presets — render with Low + High
 * swatches in the panel; edits transition to `customLinear`. */
const LINEAR_PRESETS: PaletteName[] = [
	"viridis",
	"plasma",
	"inferno",
	"magma",
	"blues",
]

/** Diverging d3 presets — render with Low + Mid + High swatches; edits
 * transition to `customDiverging` so the mid stop survives. */
const DIVERGING_PRESETS: PaletteName[] = [
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

const isDivergingPreset = (palette: string): boolean =>
	(DIVERGING_PRESETS as readonly string[]).includes(palette)

const effectiveFieldType = (
	inferred: FieldType | undefined,
	override: FieldType | undefined,
): FieldType => override ?? inferred ?? "categorical"

/** Circular-arrow button that opens a swatch popover of the palette's
 *  colors — a quick on-palette alternative to the open-ended color picker
 *  beside it. Swatches wrap at 6 per row; picking one commits it and closes
 *  the popover. (Replaces the old step-to-next-color cycling, where
 *  overshooting a color meant clicking all the way around again.) */
export const PalettePickerButton = ({
	palette,
	current,
	onPick,
	label,
}: {
	palette: readonly string[]
	current: string
	onPick: (color: string) => void
	label: string
}) => {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	// Close when focus leaves the button + popover entirely (tab away or
	// click elsewhere); moving focus onto a swatch keeps it open. Attached
	// to each button (not the wrapper div) so the wrapper stays inert.
	const closeIfFocusLeft = (e: React.FocusEvent) => {
		if (!containerRef.current?.contains(e.relatedTarget as Node)) {
			setOpen(false)
		}
	}
	const closeOnEscape = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") setOpen(false)
	}
	if (palette.length === 0) return null
	return (
		<div ref={containerRef} className="relative flex-shrink-0">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				onBlur={closeIfFocusLeft}
				onKeyDown={closeOnEscape}
				aria-label={label}
				aria-haspopup="true"
				aria-expanded={open}
				title="Pick a palette color"
				className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
			>
				<svg
					viewBox="0 0 24 24"
					width={15}
					height={15}
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					strokeWidth={2.4}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Open ~300° arc (clear gap top-right) ending in a distinct
					 *  arrowhead so the control reads as "palette", not a closed
					 *  circle. */}
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
					<polyline points="23 4 23 10 17 10" />
				</svg>
			</button>
			{open && (
				/* w-max is load-bearing: an abs-positioned box shrink-to-fits
				 *  against its containing block — here the tiny button wrapper —
				 *  which would collapse the row to one swatch per line (a
				 *  vertical stack). max-content sizing lays the swatches out
				 *  horizontally; max-w then caps the line at exactly 6 h-5
				 *  swatches (6×1.25rem + 5×0.25rem gap + p-1.5 + border), so
				 *  longer palettes wrap at 6 per row. Anchored to the button's
				 *  right edge so it stays inside the sidebar. */
				<div className="absolute right-0 top-full z-20 mt-1 flex w-max max-w-[10rem] flex-wrap gap-1 rounded border border-stone-300 bg-white p-1.5 shadow-lg dark:border-stone-600 dark:bg-stone-800">
					{palette.map((c, i) => {
						const isCurrent = c.toLowerCase() === current.toLowerCase()
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key -- palettes may repeat a color
								key={`${i}-${c}`}
								type="button"
								onClick={() => {
									onPick(c)
									setOpen(false)
								}}
								onBlur={closeIfFocusLeft}
								onKeyDown={closeOnEscape}
								aria-label={`Use ${c}`}
								title={c}
								className={`h-5 w-5 flex-shrink-0 rounded ${
									isCurrent
										? "ring-1 ring-stone-900 dark:ring-white"
										: ""
								}`}
								style={{ backgroundColor: c }}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}

/** Per-category color rows: a swatch (ColorInput) + palette-picker button +
 *  truncated value label + per-value reset. Shared by the fill-hue panel and
 *  the outline-hue panel so both stay in lockstep. The default color for each
 *  value cycles `scheme`; `colors` holds explicit per-value overrides. */
export const CategoricalSwatchList = ({
	values,
	scheme,
	colors,
	onSetColor,
	onResetColor,
	labelPrefix,
	order,
	orderType = "categorical",
}: {
	values: string[]
	scheme: readonly string[]
	colors: Record<string, string>
	onSetColor: (value: string, color: string) => void
	onResetColor: (value: string) => void
	/** a11y label stem, e.g. "Color" → "Color for X" / "Pick palette color for X". */
	labelPrefix: string
	/** User-pinned field level order (from the Fields reorder UI). Reorders the
	 *  ROWS only; each value's palette slot stays keyed to its discovery index
	 *  so the swatch keeps matching the drawn mark. Omit for derived/override
	 *  sources with no backing field → discovery order. */
	order?: readonly string[]
	orderType?: FieldType
}) => (
	<div className="flex flex-col gap-1.5">
		{orderedLevels(values, orderType, order).map(({ value: v, index: i }) => {
			const defaultColor =
				scheme[i % scheme.length] ?? CATEGORICAL_HUE_PALETTE[0]
			const active = colors[v] ?? defaultColor
			const isOverridden = colors[v] !== undefined
			return (
				<div key={v} className="flex items-center gap-2 text-sm">
					{/* Category name acts as the row's label column (w-24, matching
					 *  the dropdowns above) so the hex input + swatch line up with
					 *  the dropdown controls. Long names truncate with a tooltip. */}
					<span
						className="w-24 flex-shrink-0 truncate text-stone-700 dark:text-stone-300"
						title={v}
					>
						{v}
					</span>
					<ColorInput
						label={`${labelPrefix} for ${v}`}
						labelClassName="sr-only"
						value={active}
						onChange={(color) => onSetColor(v, color)}
						className="contents"
					/>
					<PalettePickerButton
						label={`Pick palette ${labelPrefix.toLowerCase()} for ${v}`}
						palette={scheme}
						current={active}
						onPick={(color) => onSetColor(v, color)}
					/>
					{isOverridden && (
						<button
							type="button"
							onClick={() => onResetColor(v)}
							className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
					)}
				</div>
			)
		})}
	</div>
)

export const HueOptionsPanel = ({
	/** Hide the in-panel "Vary by" field selector. Area / filled-radar set the
	 * color field via the Color shelf row (it's the series), so the duplicate
	 * selector here is redundant. */
	hideVaryBy = false,
}: {
	hideVaryBy?: boolean
} = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const storedTheme = useAtomValue(themeAtom)
	// Prefer the LIVE theme from `themesAtom` (which the settings editor
	// writes to) so palettes added in Settings appear in the chart's
	// dropdowns immediately. Falls back to `themeAtom` when the chart's
	// theme id is missing from `themesAtom` (e.g., a deleted custom theme
	// or a fresh chart that hasn't picked a theme yet).
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId)
	const theme = liveTheme ?? storedTheme

	const dataset = useCurrentDatasetView()
	const hueFieldName = encodings.hue?.field ?? null
	// Derived sources: Fill can vary by a computed quantity instead of a
	// field — the histogram bins' Count / Density (quantitative), or packed
	// circles' Top-level group (categorical). Mutually exclusive with
	// `field` (the setter below clears one when the other is set).
	const measureSource = encodings.hue?.measureSource ?? null
	const histSource =
		measureSource === "count" || measureSource === "density"
			? measureSource
			: null
	const packedSource = packedSourceOf(encodings.hue)
	const rootGroupActive = packedSource === "rootGroup"
	// Hexbin "Point count" — quantitative, colors through the gradient.
	const hexSource = hexbinSourceOf(encodings.hue)
	const histMeasure = dataset
		? resolveHistogramMeasure(
				encodings,
				(n) => effectiveType(dataset, n, overrides),
				configs,
			)
		: null
	const modeDef = useChartModeDef()
	// Flow diagrams color by NODE over the source∪target UNION domain (see
	// useFlowScaffold) — palette slots assign by position in that union, not
	// by position in the hue column's own values. Swatch rows must list the
	// same union in the same order, or the hex shown for a category drifts
	// from the drawn arc/ribbon color.
	const flowNodeValues = (() => {
		if (!isFlowModeId(modeDef.id) || !dataset || !hueFieldName) return null
		const { sourceField, targetField } = resolveFlowEndpoints(
			encodings,
			configs.connection,
			dataset
		)
		if (!sourceField || !targetField) return null
		if (hueFieldName !== sourceField && hueFieldName !== targetField) {
			return null
		}
		return flowNodeNames(dataset.rows, sourceField, targetField)
	})()
	const packedOptions = packedDerivedOptions(
		"hue",
		isHierarchyModeId(modeDef.id),
		!!encodings.connection?.field
	)
	const hexbinOptions = hexbinDerivedOptions(
		"hue",
		encodings,
		dataset ? (n) => effectiveType(dataset, n, overrides) : undefined
	)
	const field = dataset?.fields.find((f) => f.name === hueFieldName)
	const type = hueFieldName
		? effectiveFieldType(field?.inferredType, overrides[hueFieldName])
		: "categorical"
	// Count / Density are quantitative scales; both packed derived sources
	// color through the palette machinery (Top-level group = categorical,
	// Nesting depth = ORDINAL — discrete levels, not a gradient).
	const isQuantitative =
		!!histSource ||
		!!hexSource ||
		type === "quantitative" ||
		type === "temporal"

	// Determine if quantitative hue config needs initialization from theme —
	// when a quantitative field OR a quantitative measure source is selected.
	const needsQuantInit =
		(!!hueFieldName || !!histSource || !!hexSource) &&
		isQuantitative &&
		configs.hue?.kind !== "quantitative"

	// All hooks MUST be above this line — no early returns before hooks.
	useEffect(() => {
		if (!needsQuantInit) return
		const initCfg = buildQuantConfigFromTheme(theme)
		setConfigs((prev) => ({ ...prev, hue: initCfg }))
	}, [needsQuantInit]) // eslint-disable-line react-hooks/exhaustive-deps

	const update = (next: HueConfig) => {
		setConfigs((prev) => ({ ...prev, hue: next }))
	}

	// "Vary by" selector — two-way bound to the TOP-LEVEL `hue` encoding (the
	// same field the shelf shows), so changing it here changes the shelf and
	// vice-versa. Mirrors the color slots / Outline subsections. The
	// `needsQuantInit` effect above seeds the gradient config when a
	// quantitative field is picked; the categorical panel is defensive about a
	// stale config, so just writing the field is enough.
	const eligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts("hue", overrides[f.name] ?? f.inferredType),
	)
	const varyByOptions = [
		{ value: "", label: "Single color" },
		...eligible.map((f) => ({ value: f.name, label: f.name })),
		// Histograms add ONE measure option matching the current measure mode
		// (Count or Density) — never both, so the dropdown can't disagree with
		// the measure axis.
		...(histMeasure
			? [
					{
						value: MEASURE_OPTION_VALUE[histMeasure.mode],
						label: histMeasure.mode === "density" ? "Density" : "Count",
					},
				]
			: []),
		// Packed circles add the hierarchy-derived options (Top-level group /
		// Nesting depth) — same list the encoding shelf's dropdown shows.
		...packedOptions.map(({ value, label }) => ({ value, label })),
		// Hexbins add "Point count" when x and y are both quantitative —
		// same list the encoding shelf's dropdown shows. Gating-lost
		// fallback: keep the selected option listed so the user can clear it.
		...hexbinOptions.map(({ value, label }) => ({ value, label })),
		...(hexSource && hexbinOptions.length === 0
			? [{ value: HEXBIN_MEASURE_OPTION_VALUE, label: "Point count" }]
			: []),
	]
	const setHueField = (value: string) => {
		// A derived source picked → clear the field (mutually exclusive).
		if (
			value === MEASURE_OPTION_VALUE.count ||
			value === MEASURE_OPTION_VALUE.density
		) {
			const next = value === MEASURE_OPTION_VALUE.density ? "density" : "count"
			setEncodings((prev) => ({
				...prev,
				hue: { ...prev.hue, field: null, measureSource: next },
			}))
			return
		}
		const packed = packedSourceForOptionValue(value)
		if (packed) {
			setEncodings((prev) => ({
				...prev,
				hue: { ...prev.hue, field: null, measureSource: packed },
			}))
			return
		}
		const hexbin = hexbinSourceForOptionValue(value)
		if (hexbin) {
			setEncodings((prev) => ({
				...prev,
				hue: { ...prev.hue, field: null, measureSource: hexbin },
			}))
			return
		}
		// A field (or "Single color") → clear any measure source.
		setEncodings((prev) => ({
			...prev,
			hue: {
				...prev.hue,
				field: value === "" ? null : value,
				measureSource: undefined,
			},
		}))
	}

	const varyBy = (
		<SelectInput
			label="Vary by"
			labelClassName={LABEL_COL}
			value={
				histSource
					? MEASURE_OPTION_VALUE[histSource]
					: packedSource
						? PACKED_MEASURE_OPTION_VALUE[packedSource]
						: hexSource
							? HEXBIN_MEASURE_OPTION_VALUE
							: (hueFieldName ?? "")
			}
			options={varyByOptions}
			onChange={setHueField}
			disabled={!dataset}
			selectClassName="flex-1"
		/>
	)

	// --- SINGLE COLOR (no field and no measure source mapped) ---
	if (!dataset || (!hueFieldName && !measureSource)) {
		const currentFill = configs.defaultFill ?? theme.defaultFill
		return (
			<div className="flex flex-col gap-2">
				{!hideVaryBy && varyBy}
				<div className="flex items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={currentFill}
						onChange={(defaultFill) =>
							setConfigs((prev) => ({ ...prev, defaultFill }))
						}
					/>
					{currentFill !== theme.defaultFill && (
						<button
							type="button"
							onClick={() =>
								setConfigs((prev) => ({
									...prev,
									defaultFill: theme.defaultFill,
								}))
							}
							className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
					)}
				</div>
			</div>
		)
	}

	// Stack-mode toggle is hosted by `StackModeRow`, which gates on its
	// channel being the highest-precedence MAPPED color channel (hue
	// always wins precedence when mapped) and on the chart mode
	// supporting stacking. The shared component lets non-hue panels
	// (Pattern, etc.) reuse the same control when they own layout.
	// --- FIELD MAPPED ---
	// Fill only. For area / filled-radar the OUTLINE color is a separate sibling
	// subheader (`AreaRadarOutlinePanel`, rendered by ColorPanel), not nested
	// here — so the Color menu reads "Fill" / "Outline" as peers.
	return (
		<div className="flex flex-col gap-3">
			{!hideVaryBy && varyBy}
			{/* The measure source colors a single slice per bin (no grouping
			    field), so stacking is N/A — only show the stack toggle for a
			    real field mapping. */}
			{!measureSource && <StackModeRow channel="hue" />}
			{hexSource ? (
				<>
					<QuantitativePanel
						hueConfig={configs.hue}
						theme={theme}
						update={update}
					/>
					<NumberInput
						label="Bins"
						labelClassName={LABEL_COL}
						value={configs.hexbin?.binCount ?? DEFAULT_HEXBIN_BIN_COUNT}
						onChange={(binCount) =>
							setConfigs((prev) => ({
								...prev,
								hexbin: { ...prev.hexbin, binCount },
							}))
						}
						min={2}
						max={100}
						step={1}
						clamp
						changed={
							configs.hexbin?.binCount != null &&
							configs.hexbin.binCount !== DEFAULT_HEXBIN_BIN_COUNT
						}
					/>
					<p className="vc-help">
						Each hexagon is colored by the number of points inside it.
					</p>
				</>
			) : histSource ? (
				<>
					<QuantitativePanel
						hueConfig={configs.hue}
						theme={theme}
						update={update}
					/>
					<p className="vc-help">
						Each bin is colored by its{" "}
						{histSource === "density" ? "density" : "count"}.
					</p>
				</>
			) : packedSource === "depth" ? (
				<>
					<CategoricalPanel
						dataset={dataset}
						hueFieldName={null}
						valuesOverride={hierarchyDepthLevels(
							dataset.rows,
							encodings.connection?.field ?? "",
							resolveHierarchyIdField(
								configs.connection?.hierarchyIdField,
								dataset.rows,
								dataset.fields.map((f) => f.name),
								encodings.connection?.field ?? "",
								encodings.area?.field ?? null
							),
							encodings.area?.field ?? null
						)}
						type="ordinal"
						configs={configs}
						theme={theme}
						setConfigs={setConfigs}
						update={update}
					/>
					<p className="vc-help">
						Circles are colored by nesting level (1 = outermost) through
						the ordinal palette — derived from the hierarchy, no extra
						column needed.
					</p>
				</>
			) : rootGroupActive ? (
				<>
					<CategoricalPanel
						dataset={dataset}
						hueFieldName={null}
						valuesOverride={topLevelGroupNames(
							dataset.rows,
							encodings.connection?.field ?? "",
							resolveHierarchyIdField(
								configs.connection?.hierarchyIdField,
								dataset.rows,
								dataset.fields.map((f) => f.name),
								encodings.connection?.field ?? "",
								encodings.area?.field ?? null
							),
							encodings.area?.field ?? null
						)}
						type="categorical"
						configs={configs}
						theme={theme}
						setConfigs={setConfigs}
						update={update}
					/>
					<p className="vc-help">
						Every circle takes its outermost group&apos;s color — derived
						from the hierarchy, no extra column needed. Vary Saturation,
						Brightness, or Opacity by Nesting depth to distinguish levels.
					</p>
				</>
			) : isQuantitative ? (
				<QuantitativePanel
					hueConfig={configs.hue}
					theme={theme}
					update={update}
				/>
			) : (
				<CategoricalPanel
					dataset={dataset}
					hueFieldName={hueFieldName}
					valuesOverride={flowNodeValues ?? undefined}
					type={type}
					configs={configs}
					theme={theme}
					setConfigs={setConfigs}
					update={update}
				/>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Categorical sub-component (no hooks of its own — safe to render conditionally)
// ---------------------------------------------------------------------------

const CategoricalPanel = ({
	dataset,
	hueFieldName,
	valuesOverride,
	type,
	configs,
	theme,
	setConfigs,
	update,
}: {
	dataset: {
		rows: Array<Record<string, string>>
		fields: Array<{ name: string }>
	}
	/** Null only when `valuesOverride` supplies the category list (the
	 * derived "Top-level group" source has no backing field). */
	hueFieldName: string | null
	/** Category list for DERIVED sources (packed circles' top-level group
	 * names) — the per-value override grid and palette cycling key on
	 * these instead of a field's values. */
	valuesOverride?: string[]
	type: FieldType
	configs: AtomValueType<typeof currentChannelConfigsAtom>
	theme: AtomValueType<typeof themeAtom>
	setConfigs: SetterOrUpdater<AtomValueType<typeof currentChannelConfigsAtom>>
	update: (next: HueConfig) => void
}) => {
	const cfg =
		configs.hue?.kind === "categorical"
			? configs.hue
			: DEFAULT_CATEGORICAL_HUE_CONFIG
	const uniqueValues =
		valuesOverride ??
		(hueFieldName
			? [
					...new Set(
						dataset.rows
							.map((r) => parseValue(r[hueFieldName], type))
							.filter((v) => v !== null)
							.map(String),
					),
				]
			: [])
	// Ordinal hue values read from the theme's ordinal palette list first
	// (sequential / ordered ramps read as ordered), but the categorical
	// palettes are OFFERED too — an ordered variable with few levels (e.g.
	// packed circles' nesting depth) often wants distinct hues rather than
	// a ramp. The chosen palette's colors are snapshotted into
	// `ordinalPalette` either way, so the renderer doesn't care which list
	// it came from. Categorical fields use the categorical list alone.
	// The per-value override grid is the same for both.
	const isOrdinal = type === "ordinal"
	const palettesForType = isOrdinal
		? [...theme.ordinalPalettes, ...theme.categoricalPalettes]
		: theme.categoricalPalettes
	const currentPaletteId = isOrdinal
		? (configs.ordinalPaletteId ?? theme.defaultOrdinalPaletteId)
		: (configs.categoricalPaletteId ?? theme.defaultCategoricalPaletteId)
	const resolvedPalette = palettesForType.find((p) => p.id === currentPaletteId)
	const scheme =
		resolvedPalette?.colors ??
		(isOrdinal ? configs.ordinalPalette : configs.categoricalPalette) ??
		CATEGORICAL_HUE_PALETTE

	// Derived sources (packed-circles group names via `valuesOverride`) have no
	// backing field, so there's no pinned order to follow — discovery order.
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder =
		valuesOverride || !hueFieldName ? undefined : levelOrders[hueFieldName]

	const setColor = (value: string, color: string) => {
		update({ ...cfg, colors: { ...cfg.colors, [value]: color } })
	}
	const resetColor = (value: string) => {
		const { [value]: _removed, ...rest } = cfg.colors
		update({ ...cfg, colors: rest })
	}
	const inksFor = (
		pal: { colors: string[]; patternInks?: Array<string | null> } | undefined,
		fallbackColors: readonly string[],
	): Array<string | null> => {
		const colors = pal?.colors ?? fallbackColors
		const inks = pal?.patternInks ?? []
		return colors.map((_, i) => inks[i] ?? null)
	}
	const changePalette = (paletteId: string) => {
		const pal = palettesForType.find((p) => p.id === paletteId)
		if (isOrdinal) {
			setConfigs((prev) => ({
				...prev,
				hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
				ordinalPaletteId: paletteId,
				ordinalPalette: [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)],
				ordinalPalettePatternInks: inksFor(pal, CATEGORICAL_HUE_PALETTE),
			}))
		} else {
			setConfigs((prev) => ({
				...prev,
				hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
				categoricalPaletteId: paletteId,
				categoricalPalette: [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)],
				categoricalPalettePatternInks: inksFor(pal, CATEGORICAL_HUE_PALETTE),
			}))
		}
	}
	const FillPaletteDropdown = palettesForType.length > 1 && (
		<SelectInput
			label="Palette"
			labelClassName={LABEL_COL}
			value={currentPaletteId}
			options={palettesForType.map((p) => ({
				value: p.id,
				label: p.name,
			}))}
			onChange={(id) => changePalette(id)}
			selectClassName="flex-1"
		/>
	)

	const FillSwatches = (
		<CategoricalSwatchList
			values={uniqueValues}
			scheme={scheme}
			colors={cfg.colors}
			onSetColor={setColor}
			onResetColor={resetColor}
			labelPrefix="Color"
			order={levelOrder}
			orderType={type}
		/>
	)

	// Fill controls only. The OUTLINE editor for area / filled-radar lives in a
	// sibling "Outline" subheader (`AreaRadarOutlinePanel`, rendered by
	// ColorPanel) so the two read as peers — not Outline nested under Fill.
	return (
		<div className="flex flex-col gap-3">
			{FillPaletteDropdown}
			{FillSwatches}
		</div>
	)
}

/** Outline (line-stroke) color editor for AREA and filled-RADAR charts.
 *  ColorPanel renders this in its OWN "Outline" subheader, a sibling of "Fill"
 *  (not nested under it). The outline is colored per layer/polygon by the SAME
 *  hue field as the fill (one layer = one hue value), so there is no
 *  independent "Vary by" — fill and outline are linked. The user picks a
 *  palette (default "Match fill", which inherits each layer's fill color) plus
 *  optional per-value overrides. Storage lives on `connection.linePalette` /
 *  `connection.lineColors`, which AreaPlot/RadarPlot already read. Renders
 *  nothing unless a categorical/ordinal hue field is mapped (the per-value grid
 *  only makes sense then — mirrors the Fill swatch editor). */
export const AreaRadarOutlinePanel = () => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const dataset = useCurrentDatasetView()

	const hueFieldName = encodings.hue?.field ?? null
	const field = dataset?.fields.find((f) => f.name === hueFieldName)
	const type = hueFieldName
		? effectiveFieldType(field?.inferredType, overrides[hueFieldName])
		: "categorical"
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = hueFieldName ? levelOrders[hueFieldName] : undefined
	const setStrokeColor = (strokeColor: string | null) =>
		setConfigs((prev) => ({
			...prev,
			connection: {
				...(prev.connection ?? DEFAULT_CONNECTION_CONFIG),
				strokeColor,
				// Per-layer outline overrides (a separate line palette / per-value
				// colors) out-rank `strokeColor` in the renderer. Without a
				// categorical hue they're vestigial — left over from a hue that was
				// mapped, given an outline palette, then unmapped — so a single
				// color set here would silently do nothing. Clear them so the
				// single color is authoritative.
				linePaletteId: null,
				linePalette: null,
				lineColors: {},
			},
		}))

	// Per-value outline colors only make sense over discrete categories — same
	// gate as the fill swatch grid. Without a discrete hue field (no field, or a
	// quantitative/temporal one) there are no per-layer categories to color, so
	// fall back to a single outline color that applies to every layer's stroke —
	// mirroring the Fill subheader's single-color swatch. `connection.strokeColor`
	// is `null` by default, which inherits each layer's fill ("match fill"); a
	// concrete value overrides every stroke uniformly.
	const hasCategoricalHue =
		!!dataset &&
		!!hueFieldName &&
		type !== "quantitative" &&
		type !== "temporal"
	if (!hasCategoricalHue) {
		const defaultFill = configs.defaultFill ?? theme.defaultFill
		const strokeColor = configs.connection?.strokeColor ?? null
		return (
			<div className="flex items-center gap-2">
				<ColorInput
					label="Color"
					labelClassName={LABEL_COL}
					value={strokeColor ?? defaultFill}
					onChange={(c) => setStrokeColor(c)}
				/>
				{strokeColor !== null && (
					<button
						type="button"
						onClick={() => setStrokeColor(null)}
						className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
					>
						match fill
					</button>
				)}
			</div>
		)
	}

	const cfg =
		configs.hue?.kind === "categorical"
			? configs.hue
			: DEFAULT_CATEGORICAL_HUE_CONFIG
	const uniqueValues = [
		...new Set(
			dataset.rows
				.map((r) => parseValue(r[hueFieldName], type))
				.filter((v) => v !== null)
				.map(String),
		),
	]
	const isOrdinal = type === "ordinal"
	const palettesForType = isOrdinal
		? theme.ordinalPalettes
		: theme.categoricalPalettes
	const currentPaletteId = isOrdinal
		? (configs.ordinalPaletteId ?? theme.defaultOrdinalPaletteId)
		: (configs.categoricalPaletteId ?? theme.defaultCategoricalPaletteId)
	const resolvedPalette = palettesForType.find((p) => p.id === currentPaletteId)
	const scheme =
		resolvedPalette?.colors ??
		(isOrdinal ? configs.ordinalPalette : configs.categoricalPalette) ??
		CATEGORICAL_HUE_PALETTE

	const lineColors = configs.connection?.lineColors ?? {}
	const setLineColor = (value: string, color: string) =>
		setConfigs((prev) => ({
			...prev,
			connection: {
				...(prev.connection ?? DEFAULT_CONNECTION_CONFIG),
				lineColors: { ...(prev.connection?.lineColors ?? {}), [value]: color },
			},
		}))
	const resetLineColor = (value: string) =>
		setConfigs((prev) => {
			const current = prev.connection?.lineColors ?? {}
			const { [value]: _removed, ...rest } = current
			return {
				...prev,
				connection: prev.connection
					? { ...prev.connection, lineColors: rest }
					: prev.connection,
			}
		})

	// "Match fill" (default) clears the line palette so each outline inherits its
	// layer's fill color; a named palette colors the outlines from it instead.
	const linePaletteOptions = [
		{ value: "", label: "Match fill" },
		...theme.categoricalPalettes.map((p) => ({ value: p.id, label: p.name })),
	]

	return (
		<div className="flex flex-col gap-1.5">
			<SelectInput
				label="Palette"
				labelClassName={LABEL_COL}
				value={configs.connection?.linePaletteId ?? ""}
				options={linePaletteOptions}
				onChange={(id) =>
					setConfigs((prev) => {
						const pal = id
							? (theme.categoricalPalettes.find((p) => p.id === id) ?? null)
							: null
						return {
							...prev,
							connection: {
								...(prev.connection ?? DEFAULT_CONNECTION_CONFIG),
								linePaletteId: id || null,
								linePalette: pal?.colors ?? null,
							},
						}
					})
				}
				selectClassName="flex-1"
			/>
			{orderedLevels(uniqueValues, type, levelOrder).map(({ value: v, index: i }) => {
				const linePaletteColors = configs.connection?.linePalette ?? null
				const paletteLineColor = linePaletteColors
					? (linePaletteColors[i % linePaletteColors.length] ?? null)
					: null
				const fillDefault = cfg.colors[v] ?? scheme[i % scheme.length]
				const lineColor = lineColors[v] ?? paletteLineColor ?? fillDefault
				const isOverridden = lineColors[v] !== undefined
				return (
					<div key={v} className="flex items-center gap-2 text-sm">
						<ColorInput
							label={`Line color for ${v}`}
							labelClassName="sr-only"
							value={lineColor}
							onChange={(color) => setLineColor(v, color)}
							className="contents"
						/>
						<PalettePickerButton
							label={`Pick palette line color for ${v}`}
							palette={linePaletteColors ?? scheme}
							current={lineColor}
							onPick={(color) => setLineColor(v, color)}
						/>
						<span
							className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300"
							title={v}
						>
							{v}
						</span>
						{isOverridden && (
							<button
								type="button"
								onClick={() => resetLineColor(v)}
								className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							>
								reset
							</button>
						)}
					</div>
				)
			})}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Quantitative sub-component (no hooks — safe to render conditionally)
// ---------------------------------------------------------------------------

/** Build the panel's local QuantitativePanel cfg fallback. Thin wrapper
 * around the shared lib helper to keep the in-file references concise. */
const buildQuantConfigFromTheme = buildQuantHueConfigFromTheme

/** Convert d3-color "rgb(...)" output to a hex string the <input
 * type="color"> element accepts. d3 interpolators emit rgb-style; the
 * native picker insists on #rrggbb. */
const toHex = (rgbString: string): string => {
	const c = d3Rgb(rgbString)
	if (!c || Number.isNaN(c.r)) return "#000000"
	return c.formatHex()
}

/** How many swatch rows to show for each linear preset. Sequential
 * palettes like viridis/plasma/inferno pass through several distinct
 * hues — surfacing only 2 endpoint swatches hides the interior colors
 * the user is actually picking the preset for. Five stops at t = 0,
 * 0.25, 0.5, 0.75, 1 captures the typical inflection points. Override
 * per-palette by adding an entry here. */
const LINEAR_PRESET_STOP_COUNT: Record<string, number> = {
	viridis: 5,
	plasma: 5,
	inferno: 5,
	magma: 5,
	blues: 3,
}

/** Sample a preset interpolator at evenly-spaced t values. Returns hex
 * colors suitable for `<input type="color">` swatches. */
const samplePresetStops = (palette: string, count: number): string[] => {
	const interp =
		PALETTE_INTERPOLATORS[palette as keyof typeof PALETTE_INTERPOLATORS]
	if (!interp) return []
	if (count === 1) return [toHex(interp(0.5))]
	return Array.from({ length: count }, (_, i) => toHex(interp(i / (count - 1))))
}

/** Sample the preset's endpoint + midpoint colors for diverging
 * presets. Linear presets get N stops via `samplePresetStops` instead;
 * this helper just covers the diverging case. */
const presetEndpoints = (
	palette: string,
): { low: string; mid: string; high: string } | null => {
	const interp =
		PALETTE_INTERPOLATORS[palette as keyof typeof PALETTE_INTERPOLATORS]
	if (!interp || !isDivergingPreset(palette)) return null
	return {
		low: toHex(interp(0)),
		mid: toHex(interp(0.5)),
		high: toHex(interp(1)),
	}
}

type PaletteMode = "preset" | "customLinear" | "customDiverging" | "custom"

export const QuantitativePanel = ({
	hueConfig,
	theme,
	update,
}: {
	/** The color-scale config this editor reads/writes. Hue passes
	 * `configs.hue`; the outline-color channel passes `configs.outlineHue`.
	 * Both are `HueConfig`-shaped, so the editor is channel-agnostic. */
	hueConfig: HueConfig | undefined
	theme: AtomValueType<typeof themeAtom>
	update: (next: HueConfig) => void
}) => {
	const cfg =
		hueConfig?.kind === "quantitative"
			? hueConfig
			: buildQuantConfigFromTheme(theme)

	const paletteMode: PaletteMode =
		cfg.palette === "custom"
			? "custom"
			: cfg.palette === "customLinear"
				? "customLinear"
				: cfg.palette === "customDiverging"
					? "customDiverging"
					: "preset"

	const updateQ = (
		patch: Partial<Extract<HueConfig, { kind: "quantitative" }>>,
	) => {
		update({ ...cfg, ...patch })
	}

	// Track which gradient ID is active — either a preset name, a saved
	// gradient ID, or "custom". Prefer the explicit `sourcePaletteId`
	// (set on dropdown pick) over color-matching, so a user who edited a
	// preset's swatches still sees that preset's name in the dropdown.
	const activeGradientId = (() => {
		if (cfg.sourcePaletteId) return cfg.sourcePaletteId
		if (cfg.palette === "custom") return "custom"
		if (cfg.palette === "customLinear" || cfg.palette === "customDiverging") {
			for (const g of theme.linearGradients) {
				if (cfg.lowColor === g.low && cfg.highColor === g.high && !cfg.midColor)
					return g.id
			}
			for (const g of theme.divergingGradients) {
				if (
					cfg.lowColor === g.low &&
					cfg.midColor === g.mid &&
					cfg.highColor === g.high
				)
					return g.id
			}
			return cfg.palette
		}
		return cfg.palette
	})()

	const onPaletteChange = (value: string) => {
		if (value === "custom") {
			// Seed `customStops` with a clean 2-stop white→black baseline.
			// Users add more steps via the + button below.
			updateQ({
				palette: "custom",
				customStops: [
					{ color: "#ffffff", value: null },
					{ color: "#000000", value: null },
				],
				sourcePaletteId: "custom",
			})
		} else {
			const resolved = resolveGradientToConfig(value, theme)
			update(resolved)
		}
	}

	/** Restore the colors of the currently-selected palette to its
	 * originating defaults — does NOT switch palettes. Re-resolves from
	 * `sourcePaletteId` (the dropdown's last pick) so an edited viridis
	 * goes back to viridis colors, an edited Brand Gradient goes back to
	 * its saved low/high, and an edited Custom (manual stops) goes back
	 * to the white→black baseline. */
	const resetColors = () => {
		const sourceId = cfg.sourcePaletteId ?? cfg.palette
		if (sourceId === "custom") {
			updateQ({
				palette: "custom",
				customStops: [
					{ color: "#ffffff", value: null },
					{ color: "#000000", value: null },
				],
				sourcePaletteId: "custom",
			})
			return
		}
		const resolved = resolveGradientToConfig(sourceId, theme)
		update(resolved)
	}

	// Preset endpoint colors — used to seed swatches when a preset is
	// active. Diverging presets get Low/Mid/High (and transition to
	// `customDiverging` on edit, preserving the mid stop). Linear presets
	// get N "Step 1..N" rows (sampled from the interpolator) and
	// transition to `custom` with `customStops` populated so the user's
	// edit lives in a true N-stop gradient.
	const presetColors =
		paletteMode === "preset" && isDivergingPreset(cfg.palette)
			? presetEndpoints(cfg.palette)
			: null
	const linearPresetStops =
		paletteMode === "preset" && !isDivergingPreset(cfg.palette)
			? samplePresetStops(
					cfg.palette,
					LINEAR_PRESET_STOP_COUNT[cfg.palette] ?? 5,
				)
			: null

	return (
		<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Palette</span>
				<select
					value={activeGradientId}
					onChange={(e) => onPaletteChange(e.target.value)}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				>
					<optgroup label="Linear presets">
						{LINEAR_PRESETS.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</optgroup>
					<optgroup label="Diverging presets">
						{DIVERGING_PRESETS.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</optgroup>
					{theme.linearGradients.length > 0 && (
						<optgroup label="Linear gradients">
							{theme.linearGradients.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</optgroup>
					)}
					{theme.divergingGradients.length > 0 && (
						<optgroup label="Diverging gradients">
							{theme.divergingGradients.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</optgroup>
					)}
					<optgroup label="Manual">
						<option value="custom">Custom (manual stops)</option>
					</optgroup>
				</select>
			</label>
			<button
				type="button"
				onClick={resetColors}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>

			{/* Linear preset mode: N rows sampled from the interpolator,
			 *  labeled Step 1..N. Editing any color or value transitions
			 *  to `palette: "custom"` with `customStops` pre-populated, so
			 *  the chart follows the user's edits AND they can add more
			 *  stops from there. */}
			{paletteMode === "preset" && linearPresetStops && (
				<>
					{linearPresetStops.map((c, i) => (
						<CustomStopRow
							key={`linear-${i}`} // eslint-disable-line react/no-array-index-key -- positional swatches
							label={`Step ${i + 1}`}
							color={c}
							value={null}
							onColor={(newColor) => {
								const next = linearPresetStops.map((color, j) => ({
									color: j === i ? newColor : color,
									value: null,
								}))
								updateQ({ palette: "custom", customStops: next })
							}}
							onValue={(v) => {
								const next = linearPresetStops.map((color, j) => ({
									color,
									value: j === i ? v : null,
								}))
								updateQ({ palette: "custom", customStops: next })
							}}
						/>
					))}
					<div className="vc-help">
						Editing transitions to a custom gradient with all{" "}
						{linearPresetStops.length} stops in place.
					</div>
				</>
			)}

			{/* Diverging preset mode: Low + Mid + High (mid sampled at
			 *  t = 0.5). Editing any swatch transitions to `customDiverging`
			 *  so the mid stop survives. */}
			{paletteMode === "preset" && presetColors && (
				<>
					<CustomStopRow
						label="Low"
						color={presetColors.low}
						value={null}
						onColor={(c) =>
							updateQ({
								palette: "customDiverging",
								lowColor: c,
								midColor: presetColors.mid,
								highColor: presetColors.high,
							})
						}
						onValue={(v) =>
							updateQ({
								palette: "customDiverging",
								lowColor: presetColors.low,
								lowValue: v,
								midColor: presetColors.mid,
								highColor: presetColors.high,
							})
						}
					/>
					<CustomStopRow
						label="Mid"
						color={presetColors.mid}
						value={null}
						onColor={(c) =>
							updateQ({
								palette: "customDiverging",
								lowColor: presetColors.low,
								midColor: c,
								highColor: presetColors.high,
							})
						}
						onValue={(v) =>
							updateQ({
								palette: "customDiverging",
								lowColor: presetColors.low,
								midColor: presetColors.mid,
								midValue: v,
								highColor: presetColors.high,
							})
						}
					/>
					<CustomStopRow
						label="High"
						color={presetColors.high}
						value={null}
						onColor={(c) =>
							updateQ({
								palette: "customDiverging",
								lowColor: presetColors.low,
								midColor: presetColors.mid,
								highColor: c,
							})
						}
						onValue={(v) =>
							updateQ({
								palette: "customDiverging",
								lowColor: presetColors.low,
								midColor: presetColors.mid,
								highColor: presetColors.high,
								highValue: v,
							})
						}
					/>
					<div className="vc-help">
						Editing endpoints switches to a custom diverging gradient.
					</div>
				</>
			)}

			{/* Saved linear gradient: just Low + High. No `+ add midpoint`
			 *  button — linear gradients are 2-stop by definition. */}
			{paletteMode === "customLinear" && (
				<>
					<CustomStopRow
						label="Low"
						color={cfg.lowColor}
						value={cfg.lowValue}
						onColor={(c) => updateQ({ lowColor: c })}
						onValue={(v) => updateQ({ lowValue: v })}
					/>
					<CustomStopRow
						label="High"
						color={cfg.highColor}
						value={cfg.highValue}
						onColor={(c) => updateQ({ highColor: c })}
						onValue={(v) => updateQ({ highValue: v })}
					/>
					<div className="vc-help">
						Empty value = use data {`{`}min|max{`}`}.
					</div>
				</>
			)}

			{/* Saved diverging gradient: Low + Mid + High. Mid stays put —
			 *  diverging gradients are 3-stop by definition, so no `remove`
			 *  button on the mid row. */}
			{paletteMode === "customDiverging" && (
				<>
					<CustomStopRow
						label="Low"
						color={cfg.lowColor}
						value={cfg.lowValue}
						onColor={(c) => updateQ({ lowColor: c })}
						onValue={(v) => updateQ({ lowValue: v })}
					/>
					<CustomStopRow
						label="Mid"
						color={cfg.midColor ?? "#ffffff"}
						value={cfg.midValue}
						onColor={(c) => updateQ({ midColor: c })}
						onValue={(v) => updateQ({ midValue: v })}
					/>
					<CustomStopRow
						label="High"
						color={cfg.highColor}
						value={cfg.highValue}
						onColor={(c) => updateQ({ highColor: c })}
						onValue={(v) => updateQ({ highValue: v })}
					/>
					<div className="vc-help">
						Empty value = use data {`{`}min|mid|max{`}`}.
					</div>
				</>
			)}

			{/* Free-form Custom (manual stops): N stops, defaulting to two
			 *  white→black anchors. User adds more via `+ add a new step`.
			 *  Stops are labeled Step 1 .. Step N in order. */}
			{paletteMode === "custom" && (
				<CustomStopsList cfg={cfg} updateQ={updateQ} />
			)}
		</div>
	)
}

/** N-step custom gradient editor. Uses `cfg.customStops` as the source of
 * truth and supports inserting / removing stops. Each row is labelled
 * Step 1 .. Step N. The first and last stops can't be deleted (they
 * anchor the gradient at the data endpoints); intermediate stops show a
 * remove button. */
const CustomStopsList = ({
	cfg,
	updateQ,
}: {
	cfg: Extract<HueConfig, { kind: "quantitative" }>
	updateQ: (
		patch: Partial<Extract<HueConfig, { kind: "quantitative" }>>,
	) => void
}) => {
	const stops: CustomHueStop[] =
		cfg.customStops && cfg.customStops.length >= 2
			? cfg.customStops
			: [
					{ color: "#ffffff", value: null },
					{ color: "#000000", value: null },
				]

	const setStops = (next: CustomHueStop[]) => updateQ({ customStops: next })

	const updateAt = (idx: number, patch: Partial<CustomHueStop>) =>
		setStops(stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)))

	const removeAt = (idx: number) => setStops(stops.filter((_, i) => i !== idx))

	const addStop = () => {
		// Insert before the last stop so the new step lands "in the middle"
		// of the gradient rather than at the end (the last stop is the
		// gradient's high anchor — bumping it would surprise users).
		const last = stops[stops.length - 1]
		const beforeLast = stops[stops.length - 2]
		const interpColor = (a: string, b: string): string => {
			const ca = d3Rgb(a)
			const cb = d3Rgb(b)
			if (!ca || !cb) return "#888888"
			return d3Rgb(
				(ca.r + cb.r) / 2,
				(ca.g + cb.g) / 2,
				(ca.b + cb.b) / 2,
			).formatHex()
		}
		const newStop: CustomHueStop = {
			color: interpColor(beforeLast.color, last.color),
			value: null,
		}
		setStops([...stops.slice(0, -1), newStop, last])
	}

	return (
		<>
			{stops.map((s, i) => (
				<CustomStopRow
					key={i} // eslint-disable-line react/no-array-index-key -- stable as long as user doesn't reorder
					label={`Step ${i + 1}`}
					color={s.color}
					value={s.value}
					onColor={(c) => updateAt(i, { color: c })}
					onValue={(v) => updateAt(i, { value: v })}
					trailing={
						// Anchor stops (first + last) define the gradient's
						// endpoints; removing one would silently re-anchor to
						// the next stop in line. Block that surprise — the user
						// can still drag the color toward white/black if they
						// want a near-invisible anchor.
						i !== 0 && i !== stops.length - 1 ? (
							<button
								type="button"
								onClick={() => removeAt(i)}
								className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							>
								remove
							</button>
						) : undefined
					}
				/>
			))}
			<button
				type="button"
				onClick={addStop}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				+ Add a new step
			</button>
			<div className="vc-help">
				Empty value = auto-position evenly between the anchor stops.
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Custom stop row
// ---------------------------------------------------------------------------

type StopRowProps = {
	label: string
	color: string
	value: number | null
	onColor: (c: string) => void
	onValue: (v: number | null) => void
	trailing?: React.ReactNode
}

const CustomStopRow = ({
	label,
	color,
	value,
	onColor,
	onValue,
	trailing,
}: StopRowProps) => {
	return (
		<div className="flex items-center gap-2 text-sm">
			{/* `contents` dissolves the ColorInput wrapper so the label, hex
			 *  input, and swatch sit directly in this row's flex flow. */}
			<ColorInput
				label={label}
				labelClassName={LABEL_COL}
				value={color}
				onChange={onColor}
				className="contents"
			/>
			{/* Stays a raw input: a blank field commits `null` ("auto" — position
			 *  the stop evenly / use the data extent), which the NumberInput
			 *  primitive can't express. No visible label of its own, so an
			 *  aria-label carries the association. */}
			<input
				type="number"
				value={value ?? ""}
				onChange={(e) =>
					onValue(e.target.value === "" ? null : Number(e.target.value))
				}
				placeholder="auto"
				aria-label={`${label} stop value`}
				className="no-spinner w-12 min-w-0 flex-shrink rounded border border-stone-300 bg-white px-0.5 py-0.5 text-center text-xs dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			/>
			{trailing}
		</div>
	)
}
