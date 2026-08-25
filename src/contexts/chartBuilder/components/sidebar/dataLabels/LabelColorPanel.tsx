import {
	DATA_LABELS_SINGLE_COLOR_ID,
	type ColorSlotConfig,
	type DataLabelsConfig,
	type PaletteName,
	type TextColorRule,
} from "../../../lib/channelConfig"
import { CATEGORICAL_HUE_PALETTE, parseValue } from "../../../lib/scales"
import type { DatasetView, FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	type AtomValueType,
	themeAtom,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LabelSpacer,
} from "../../../../../components/ui/LabeledField"
import { ColorSlotControls } from "../channelOptions/ColorPanel"
import {
	CategoricalSwatchList,
} from "../channelOptions/ColorOptionsPanel"

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
}) => {
	// Prefer the LIVE theme from `themesAtom` (which the settings editor
	// writes to) so palettes added / edited in Settings appear here with
	// their current colors. Falls back to `themeAtom` when the chart's
	// theme id is missing from `themesAtom` (e.g., a deleted custom theme
	// or a fresh chart that hasn't picked a theme yet).
	const theme = useCurrentTheme()
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
					{!hueFieldMapped && (
						<p className="vc-help">
							Map a field to <strong>Color</strong> above to drive label colors
							by that field&apos;s values. The fallback color below is used
							until then.
						</p>
					)}
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
					 *  advanced text-color rules drop below it. The circular-arrow
					 *  palette picker rides along like every other single-color
					 *  swatch (theme's default categorical palette). */}
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
						pickerLabel="Pick palette color for label text"
					/>
					<TextColorRulesRow cfg={cfg} onChange={onChange} theme={theme} />
				</>
			)}
			{multiFields.length > 0 && (
				<div
					className={
						perVariableColor
							? "flex flex-col gap-2"
							: "flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700"
					}
				>
					{multiFields.map((name) => (
						<CollapsibleSubsection
							key={name}
							title={name}
							changed={cfg.fieldColors?.[name] != null}
						>
							<ColorSlotControls
								labelPrefix={name}
								slotCfg={cfg.fieldColors?.[name]}
								defaultColor={cfg.color}
								// With a field mapped on the Color channel above, an
								// unconfigured variable's segments follow that mapping
								// (the renderer falls through to the label's base fill)
								// — surface that as the explicit default option so the
								// dropdown matches what actually renders. Without a
								// mapping, base fill IS the single color, so the plain
								// "Single color" default already tells the truth.
								inheritLabel={
									hueFieldMapped
										? `Main Color mapping${hueField ? ` (${hueField})` : ""}`
										: undefined
								}
								clearSlot={() => {
									const next = { ...(cfg.fieldColors ?? {}) }
									delete next[name]
									onChange({ fieldColors: next })
								}}
								updateSlot={(partial) => {
									const existing = cfg.fieldColors?.[name]
									const base: ColorSlotConfig = {
										field: existing?.field ?? null,
										singleColor: existing?.singleColor ?? cfg.color,
										...existing,
									}
									onChange({
										fieldColors: {
											...(cfg.fieldColors ?? {}),
											[name]: { ...base, ...partial },
										},
									})
								}}
							/>
						</CollapsibleSubsection>
					))}
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
	if (!dataset || (!hueField && !valuesOverride)) return null
	const values =
		valuesOverride ??
		(hueField
			? [
					...new Set(
						dataset.rows
							.map((r) => parseValue(r[hueField], hueFieldType))
							.filter((v) => v !== null)
							.map(String)
					),
				]
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
 *  first matching rule wins. Always renders at least one slot so the
 *  feature is discoverable; an empty condition is a no-op. */
const TextColorRulesRow = ({
	cfg,
	onChange,
	theme,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	theme: AtomValueType<typeof themeAtom>
}) => {
	const stored = cfg.textColorRules ?? []
	const display: TextColorRule[] =
		stored.length === 0 ? [{ condition: "", color: cfg.color }] : stored
	const update = (next: TextColorRule[]) => onChange({ textColorRules: next })
	const setRule = (i: number, patch: Partial<TextColorRule>) => {
		const merged = display.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
		update(merged)
	}
	const removeRule = (i: number) =>
		update(display.filter((_, idx) => idx !== i))
	const addRule = () =>
		update([...display, { condition: "", color: cfg.color }])
	// Same palette the base label-color swatch offers (theme default
	// categorical) so a rule color can be picked on-palette like every
	// other swatch; the popover's chevron reaches the other palettes.
	const palette =
		theme.categoricalPalettes.find(
			(p) => p.id === theme.defaultCategoricalPaletteId
		)?.colors ?? CATEGORICAL_HUE_PALETTE
	return (
		<CollapsibleSubsection
			title="Text color rules"
			changed={stored.length > 0}
		>
			{display.map((rule, i) => (
				<div
					// Index key is stable here: rules are ordered, identity == position
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					className="flex items-center gap-2 text-sm"
				>
					{/* Empty leading column so the condition box lines up under the
					 *  w-24-labeled text boxes above (Palette / Gradient, Color). */}
					<LabelSpacer />
					<input
						type="text"
						value={rule.condition}
						onChange={(e) => setRule(i, { condition: e.target.value })}
						placeholder="> 0"
						aria-label={`Condition for rule ${i + 1}`}
						className="w-24 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					/>
					<ColorInput
						label={`Color for rule ${i + 1}`}
						labelClassName="sr-only"
						value={rule.color}
						onChange={(color) => setRule(i, { color })}
						showHexInput={false}
						palette={palette}
						pickerLabel={`Pick palette color for rule ${i + 1}`}
					/>
					{stored.length > 0 && (
						<button
							type="button"
							onClick={() => removeRule(i)}
							className="rounded px-1 text-stone-600 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Remove rule ${i + 1}`}
						>
							×
						</button>
					)}
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				className="self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add rule
			</button>
			<p className="vc-help">
				First matching rule wins. Use <code>{">"}</code>, <code>{"<"}</code>,{" "}
				<code>{">="}</code>, <code>{"<="}</code>, <code>==</code>, or{" "}
				<code>!=</code> followed by a number.
			</p>
		</CollapsibleSubsection>
	)
}

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
		const pal = theme.categoricalPalettes.find((p) => p.id === paletteId)
		if (!pal) return
		onChange({ paletteId, palette: [...pal.colors], colorOverrides: {} })
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
				<select
					value={currentSelection}
					onChange={(e) => onPickPalette(e.target.value)}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
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
				</select>
			</label>
			<p className="vc-help">
				<em>Match chart colors</em> inherits the chart&apos;s palette so labels
				match their marks. <em>None (single color)</em> paints every label
				with the color below. Either way, the swatches under the dropdown
				override individual categories.
			</p>
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
			<select
				value={currentSelection}
				onChange={(e) => onPickGradient(e.target.value)}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
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
			</select>
		</label>
	)
}
