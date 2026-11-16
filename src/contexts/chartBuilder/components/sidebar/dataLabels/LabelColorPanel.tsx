import { Fragment } from "react"

import {
	DATA_LABELS_SINGLE_COLOR_ID,
	type ColorSlotConfig,
	type DataLabelsConfig,
	type PaletteName,
	type TextColorRule,
} from "../../../lib/channelConfig"
import { labelEntry, withLabelEntry } from "../../../lib/labelPieces"
import { pickLabelPalette } from "../../../lib/paletteEdits"
import { CATEGORICAL_HUE_PALETTE } from "../../../lib/scales"
import { uniqueFieldValues } from "../../../lib/uniqueFieldValues"
import { dataLabelsConfigFromTheme, resolveTextPickerPalette } from "../../../lib/themeConfig"
import type { DatasetView, FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	type AtomValueType,
	themeAtom,
} from "../../../store/atoms"
import { linkedCategoryColors } from "../../../lib/linkedHueColors"
import { useColorLink } from "../../../store/useColorLink"
import { useCurrentTheme } from "../../../store/useCurrentTheme"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { ColorSlotControls } from "../channelOptions/ColorPanel"
import {
	CategoricalSwatchList,
} from "../channelOptions/ColorOptionsPanel"
import { ColorRulesEditor } from "../ColorRulesEditor"
import { Select } from "../../../../../components/ui/Select"

const PALETTE_PRESET_NAMES: PaletteName[] = [
	"viridis",
	"plasma",
	"inferno",
	"magma",
	"blues",
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

// ---------------------------------------------------------------------------
// Hue / color panel — branches on the hue field's effective type so the
// user picks a CATEGORICAL palette for discrete fields and a GRADIENT for
// continuous fields, matching the main hue panel UX.
// ---------------------------------------------------------------------------
export const LabelColorPanel = ({
	cfg,
	onChange,
	hueField,
	hueFieldType,
	dataset,
	chartConfigs,
	valuesOverride,
	multiFields = [],
	titles,
	splitToggle,
	keysFor,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	hueField: string | null
	hueFieldType: FieldType | null
	dataset: DatasetView | undefined
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom>
	/** Swatch values for a hierarchy-DERIVED color source (group names /
	 *  depth levels) — there's no dataset column to enumerate. */
	valuesOverride?: string[]
	/** Multi-field label variables (empty in single-field mode). When
	 *  non-empty, each gets its own color slot below the base color — one
	 *  color target per shown variable, mirroring the mark fill/outline/line
	 *  slots. */
	multiFields?: string[]
	/** Section titles by key (see `SizePanel`). */
	titles?: Record<string, string>
	/** The "Split into individual variables" toggle for one label (see
	 *  `SizePanel`). */
	splitToggle?: (key: string) => React.ReactNode
	/** The keys one label's slots write to: just the label, or one per
	 *  variable when its Color is split. */
	keysFor?: (key: string) => string[]
}) => {
	// Prefer the LIVE theme from `themesAtom` (which the settings editor
	// writes to) so palettes added / edited in Settings appear here with
	// their current colors. Falls back to `themeAtom` when the chart's
	// theme id is missing from `themesAtom` (e.g., a deleted custom theme
	// or a fresh chart that hasn't picked a theme yet).
	const theme = useCurrentTheme()
	// The label color a new chart starts with on this theme: what the color's
	// reset goes back to.
	const themeLabelColor = dataLabelsConfigFromTheme(theme).color
	const hueFieldMapped = hueFieldType !== null
	const isQuantitative =
		hueFieldType === "quantitative" || hueFieldType === "temporal"
	const singleColor = cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
	// Is a palette / gradient scale coloring the labels? Decides whether the
	// swatch below IS the label color or just the fallback for unmatched
	// values. Categorical fields color through a palette unless the user
	// explicitly picked "None (single color)" — with no pick, the layer
	// inherits the chart's palette.
	const usesScale =
		hueFieldMapped && (isQuantitative ? cfg.gradientId !== null : !singleColor)

	// With more than one variable in the label, every variable carries its own
	// color slot below — the single base palette / swatch / fallback would be a
	// redundant, do-nothing set of pickers, so hide it and show only the
	// per-variable slots.
	const perVariableColor = multiFields.length > 1

	return (
		<div className="flex flex-col gap-2">
			{!perVariableColor && (
				<>
						{hueFieldMapped && !isQuantitative && (
							<>
								<CategoricalPaletteRow cfg={cfg} onChange={onChange} theme={theme} />
								<LabelSwatchList
									cfg={cfg}
									onChange={onChange}
									hueField={hueField}
									hueFieldType={hueFieldType}
									dataset={dataset}
									chartConfigs={chartConfigs}
									valuesOverride={valuesOverride}
								/>
						</>
					)}
					{hueFieldMapped && isQuantitative && (
						<GradientRow cfg={cfg} onChange={onChange} theme={theme} />
					)}
					{/* The single color swatch sits directly under the palette/gradient
					 *  dropdown so it's immediately reachable when "None (single
					 *  color)" is selected (no scale → this IS the label color). The
					 *  advanced text-color rules drop below it. The palette-icon
					 *  palette picker rides along like every other single-color
					 *  swatch (theme's default categorical palette). */}
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label={
								(cfg.textColorRules?.length ?? 0) > 0
									? "Else (fallback)"
									: usesScale
										? "Fallback"
										: "Color"
							}
							labelClassName={LABEL_COL}
							value={cfg.color}
							onChange={(color) => onChange({ color })}
							paletteKind="text"
							pickerLabel="Pick palette color for label text"
						/>
						{cfg.color.toLowerCase() !== themeLabelColor.toLowerCase() && (
							<ResetLink
								ariaLabel="Reset label color"
								onClick={() => onChange({ color: themeLabelColor })}
							/>
						)}
					</div>
					<TextColorRulesRow
						rules={cfg.textColorRules ?? []}
						onChange={(textColorRules) => onChange({ textColorRules })}
						defaultColor={cfg.color}
						theme={theme}
					/>
				</>
			)}
			{multiFields.length > 0 && (
				<div
					className={
						perVariableColor
							? "flex flex-col gap-2"
							: "vc-divider-group"
					}
				>
					{multiFields.map((name) => {
						const keys = keysFor?.(name) ?? [name]
						const split = keys.length > 1 || keys[0] !== name
						return (
							<CollapsibleSubsection
								key={name}
								title={titles?.[name] ?? name}
								changed={keys.some(
									(k) =>
										labelEntry(cfg, "fieldColors", k) != null ||
										(labelEntry(cfg, "fieldColorRules", k)?.length ?? 0) > 0
								)}
							>
								{splitToggle?.(name)}
								{keys.map((key) => {
									const ownSlot = labelEntry(cfg, "fieldColors", key)
									const ownRules = labelEntry(cfg, "fieldColorRules", key)
									const slotBlock = (
										<>
											<ColorSlotControls
												labelPrefix={titles?.[key] ?? key}
												paletteKind="text"
												slotCfg={ownSlot}
												defaultColor={cfg.color}
												// With a field mapped on the Color channel above, an
												// unconfigured variable's segments follow that mapping
												// (the renderer falls through to the label's base fill)
												// — surface that as the explicit default option so the
												// dropdown matches what actually renders. Without a
												// mapping, base fill IS the single color, so the plain
												// "— none —" default already tells the truth.
												inheritLabel={
													hueFieldMapped
														? `Main Color mapping${hueField ? ` (${hueField})` : ""}`
														: undefined
												}
												clearSlot={() =>
													onChange(withLabelEntry(cfg, "fieldColors", key, undefined))
												}
												updateSlot={(partial) => {
													const base: ColorSlotConfig = {
														field: ownSlot?.field ?? null,
														singleColor: ownSlot?.singleColor ?? cfg.color,
														...ownSlot,
													}
													onChange(
														withLabelEntry(cfg, "fieldColors", key, {
															...base,
															...partial,
														})
													)
												}}
											/>
											{/* The label's (or variable's) own conditional rules,
											 *  compared against ITS value; the slot above is the
											 *  "else". */}
											<TextColorRulesRow
												rules={ownRules ?? []}
												onChange={(rules) =>
													onChange(
														withLabelEntry(
															cfg,
															"fieldColorRules",
															key,
															rules.length === 0 ? undefined : rules
														)
													)
												}
												defaultColor={ownSlot?.singleColor ?? cfg.color}
												theme={theme}
												ruleLabel={titles?.[key] ?? key}
											/>
										</>
									)
									return split ? (
										<CollapsibleSubsection
											key={key}
											title={titles?.[key] ?? key}
											boxed={false}
											defaultOpen
											changed={
												ownSlot != null || (ownRules?.length ?? 0) > 0
											}
										>
											{slotBlock}
										</CollapsibleSubsection>
									) : (
										<Fragment key={key}>{slotBlock}</Fragment>
									)
							})}
						</CollapsibleSubsection>
						)
					})}
				</div>
			)}
		</div>
	)
}

/** Per-category swatch rows for the Data Labels color panel — one editable
 *  swatch per distinct value of the mapped hue field, defaulting to the
 *  palette slot the renderer will use (labels' own palette, else the chart's
 *  inherited palette, else the single label color in "None (single color)"
 *  mode). Edits store per-value overrides in `cfg.colorOverrides`, which win
 *  over the hue scale in `DataLabelsLayer`. Values enumerate in dataset row
 *  order — the same order `makeHueScale` builds its ordinal domain — so the
 *  swatch defaults line up with the rendered label colors. */
const LabelSwatchList = ({
	cfg,
	onChange,
	hueField,
	hueFieldType,
	dataset,
	chartConfigs,
	valuesOverride,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	hueField: string | null
	hueFieldType: FieldType
	dataset: DatasetView | undefined
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom>
	valuesOverride?: string[]
}) => {
	const colorLink = useColorLink()
	if (!dataset || (!hueField && !valuesOverride)) return null
	const values =
		valuesOverride ??
		(hueField
			? uniqueFieldValues(dataset.rows, hueField, { type: hueFieldType })
			: [])
	if (values.length === 0) return null
	// Default color per row mirrors the layer's palette resolution: the
	// labels' own palette when picked; otherwise the chart's palette
	// (ordinal palette for ordinal fields); every row shows the single
	// label color in "None (single color)" mode.
	const chartPalette =
		hueFieldType === "ordinal"
			? (chartConfigs.ordinalPalette ?? chartConfigs.categoricalPalette)
			: chartConfigs.categoricalPalette
	const scheme =
		cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
			? [cfg.color]
			: cfg.palette.length > 0
				? cfg.palette
				: (chartPalette ?? CATEGORICAL_HUE_PALETTE)
	return (
		<CategoricalSwatchList
			values={values}
			scheme={scheme}
			colors={cfg.colorOverrides}
			// Labels varying by the Color variable take each value's palette
			// position from the Color mapping — as `DataLabelsLayer` draws.
			defaults={
				cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
					? undefined
					: linkedCategoryColors(colorLink, hueField, scheme)
			}
			onSetColor={(value, color) =>
				onChange({
					colorOverrides: { ...cfg.colorOverrides, [value]: color },
				})
			}
			onResetColor={(value) => {
				const { [value]: _removed, ...rest } = cfg.colorOverrides
				onChange({ colorOverrides: rest })
			}}
			labelPrefix="Label color"
		/>
	)
}

/** Conditional text-color rules — primarily for heatmaps, where a single
 *  fallback color can't read against every cell in the gradient. The user
 *  types a comparison expression (`> 0`, `< 50`) and picks a color; the
 *  first matching rule wins. Shared by the layer-wide rules
 *  (`textColorRules`) and each variable's own rules
 *  (`fieldColorRules[field]`), which differ only in which value they
 *  compare against.
 *
 *  Sits under its own hairline below the color swatches, showing just the
 *  right-aligned "+ Add text color rule" link until a rule exists — the
 *  swatches above are the primary control, the rules the exception path,
 *  and both a collapsed subsection and a standing header gave them more
 *  room than that earns (the link names itself instead). Same shape as
 *  `PositionRulesEditor`, their positional sibling: the link stays under
 *  the rows, so adding keeps adding. */
const TextColorRulesRow = ({
	rules,
	onChange,
	defaultColor,
	theme,
	ruleLabel,
}: {
	rules: TextColorRule[]
	onChange: (rules: TextColorRule[]) => void
	/** Seed color for a new rule — the color the rules fall back to. */
	defaultColor: string
	theme: AtomValueType<typeof themeAtom>
	/** Distinguishes the a11y labels when several rule lists share a panel
	 *  (one per variable). */
	ruleLabel?: string
}) => (
	<ColorRulesEditor
		rules={rules}
		onChange={onChange}
		defaultColor={defaultColor}
		// Same palette the base label-color swatch offers — the theme's TEXT
		// palette, since a rule colors label TEXT; the popover's chevron
		// reaches the other palettes.
		palette={resolveTextPickerPalette(theme)}
		addLabel="+ Add text color rule"
		ruleLabel={ruleLabel}
	/>
)

const CategoricalPaletteRow = ({
	cfg,
	onChange,
	theme,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	theme: AtomValueType<typeof themeAtom>
}) => {
	// Every pick clears the per-value overrides (mirroring the main hue
	// panel's palette switch) so stale overrides from the previous palette
	// don't mask the new one.
	const onPickPalette = (paletteId: string) => {
		if (paletteId === "__match__") {
			// Inherit the chart's palette — the renderer's default when the
			// user hasn't picked a labels-specific palette.
			onChange({ paletteId: null, palette: [], colorOverrides: {} })
			return
		}
		if (paletteId === DATA_LABELS_SINGLE_COLOR_ID) {
			onChange({
				paletteId: DATA_LABELS_SINGLE_COLOR_ID,
				palette: [],
				colorOverrides: {},
			})
			return
		}
		if (!theme.categoricalPalettes.some((p) => p.id === paletteId)) return
		onChange(pickLabelPalette(theme, paletteId))
	}
	const currentSelection: string =
		cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
			? DATA_LABELS_SINGLE_COLOR_ID
			: cfg.paletteId &&
				  theme.categoricalPalettes.some((p) => p.id === cfg.paletteId)
				? cfg.paletteId
				: "__match__"
	return (
		<>
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Palette</span>
				<Select
					value={currentSelection}
					onChange={(e) => onPickPalette(e.target.value)}
					className="flex-1"
				>
					<option value="__match__">Match chart colors</option>
					<option value={DATA_LABELS_SINGLE_COLOR_ID}>
						None (single color)
					</option>
					{theme.categoricalPalettes.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</Select>
			</label>
		</>
	)
}

const GradientRow = ({
	cfg,
	onChange,
	theme,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	theme: AtomValueType<typeof themeAtom>
}) => {
	const onPickGradient = (gradientId: string) => {
		if (gradientId === "__none__") {
			onChange({ gradientId: null, gradientColors: null })
			return
		}
		// Saved linear gradient → snapshot low/high.
		const lin = theme.linearGradients.find((g) => g.id === gradientId)
		if (lin) {
			onChange({
				gradientId,
				gradientColors: { low: lin.low, mid: null, high: lin.high },
			})
			return
		}
		// Saved diverging gradient → snapshot low/mid/high.
		const div = theme.divergingGradients.find((g) => g.id === gradientId)
		if (div) {
			onChange({
				gradientId,
				gradientColors: { low: div.low, mid: div.mid, high: div.high },
			})
			return
		}
		// Falls through to a d3 preset name — no resolved colors needed; the
		// renderer looks up the interpolator at render time.
		onChange({ gradientId, gradientColors: null })
	}
	const currentSelection: string = cfg.gradientId ?? "__none__"
	return (
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Gradient</span>
			<Select
				value={currentSelection}
				onChange={(e) => onPickGradient(e.target.value)}
				className="flex-1"
			>
				<option value="__none__">None</option>
				<optgroup label="Presets">
					{PALETTE_PRESET_NAMES.map((p) => (
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
			</Select>
		</label>
	)
}
