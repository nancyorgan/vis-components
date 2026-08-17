import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	type ColorSlotConfig,
	type RegressionConfig,
} from "../../../lib/channelConfig"
import type { ChartMode } from "../../../lib/chartMode"
import {
	applicableColorSlots,
	legacySlotColor,
	type ColorSlotDef,
} from "../../../lib/colorSlots"
import { effectiveType } from "../../../lib/fieldType"
import { buildQuantHueConfigFromTheme } from "../../../lib/hueDefaults"
import { CATEGORICAL_HUE_PALETTE, parseValue } from "../../../lib/scales"
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

import {
	axisConfigFromTheme,
	explainChannelCustomization,
	valueChanged,
} from "../../../lib/themeConfig"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../../components/ui/SelectInput"

import {
	AreaRadarOutlinePanel,
	CategoricalSwatchList,
	HueOptionsPanel,
	PalettePickerButton,
	QuantitativePanel,
	useQuantFieldExtent,
} from "./HueOptionsPanel"
import { OutlineColorRow } from "./OutlineHuePanel"

/** The unified Color menu. Houses every color target as a subheader, scoped to
 * the current chart type:
 *   - Fill  — the primary color encoding (variable mapped via the Color shelf
 *             row); reuses the full hue palette/gradient editor.
 *   - Outline — the independent `outlineHue` color encoding.
 *   - Generic color slots (Line / Rug / Violin-Box Fill+Outline / Stem / Radar
 *     Spine) — each an independent optional color encoding.
 * Every subheader follows the same shape: None (single color) by default, or
 * map a variable → pick a palette → adjust per-level colors (categorical) or a
 * gradient (quantitative). Data labels are intentionally excluded — they keep
 * their own color controls in the Data Labels panel. */
export const ColorPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const mode = useChartModeDef().id as ChartMode
	const slots = applicableColorSlots(mode, encodings, configs)
	// Area / filled-radar color the OUTLINE per layer by the same hue field as
	// the fill (linked), via `connection`-based palettes — so they get the
	// dedicated `AreaRadarOutlinePanel` instead of the independent-field
	// `OutlineColorRow`. Radar only shows it when the polygon is filled.
	const isAreaMode = mode === "areas-x" || mode === "areas-y"
	const isRadarFilled = mode === "radar" && configs.connection?.fillPolygon === true
	const useLinkedOutline = isAreaMode || isRadarFilled
	// Scatter-style independent outline (own field) for every other mode.
	const showIndependentOutline =
		mode !== "areas-x" && mode !== "areas-y" && mode !== "radar"

	// Subsection dots — reuse the SAME change data the top-level Color dot uses
	// (so they can't disagree). The hue registry labels map to the subheaders.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const hueChanged = new Set(
		explainChannelCustomization("hue", configs, theme, !!encodings.hue?.field)
	)
	const fillChanged =
		hueChanged.has("default fill") ||
		hueChanged.has("fill scale edits") ||
		hueChanged.has("palette pick")
	const outlineAreaChanged = hueChanged.has("outline color")
	const outlineScatterChanged =
		valueChanged(configs.shape?.outlineColor, theme.outlineColor) ||
		valueChanged(configs.shape?.outlineWidth, theme.outlineWidth) ||
		explainChannelCustomization(
			"outlineHue",
			configs,
			theme,
			!!encodings.outlineHue?.field
		).length > 0

	return (
		<div className="vc-option-panel">
			<CollapsibleSubsection title="Fill" defaultOpen changed={fillChanged}>
				<HueOptionsPanel hideVaryBy={useLinkedOutline} />
			</CollapsibleSubsection>
			{useLinkedOutline && (
				<CollapsibleSubsection title="Outline" changed={outlineAreaChanged}>
					<AreaRadarOutlinePanel />
				</CollapsibleSubsection>
			)}
			{showIndependentOutline && (
				<CollapsibleSubsection title="Outline" changed={outlineScatterChanged}>
					<OutlineColorRow />
				</CollapsibleSubsection>
			)}
			{slots.map((def) => (
				<ColorSlotSubsection
					key={def.key}
					def={def}
					// The Regression line subheader also owns the line's WIDTH (it
					// lives on `configs.x.regression`, not the slot). The dash
					// pattern moved to the Pattern menu's "Regression line"
					// subheader, alongside every other line-dash control.
					extra={
						def.key === "regressionStroke" ? (
							<RegressionLineStyleControls />
						) : undefined
					}
					extraChanged={
						def.key === "regressionStroke"
							? valueChanged(
									configs.x?.regression?.strokeWidth,
									themeRegression(theme).strokeWidth
								)
							: false
					}
				/>
			))}
		</div>
	)
}

/** The theme-seeded regression slice — the "unchanged" baseline for the
 * width / dash controls (same builder the X-axis panel uses). */
const themeRegression = (
	theme: Parameters<typeof axisConfigFromTheme>[0]
): RegressionConfig =>
	axisConfigFromTheme(theme, "x").regression ?? DEFAULT_REGRESSION_CONFIG

/** Width for the regression line, rendered inside the Color panel's
 * "Regression line" subheader. Writes to `configs.x.regression` with the
 * same theme-seeding merge the X-axis panel uses (so untouched fields keep
 * matching the changed-dot baseline). The dash pattern lives in the Pattern
 * menu's "Regression line" subheader. */
const RegressionLineStyleControls = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const regression: RegressionConfig = {
		...themeRegression(theme),
		...configs.x?.regression,
	}
	const update = (next: Partial<RegressionConfig>) =>
		setConfigs((prev) => ({
			...prev,
			x: {
				...axisConfigFromTheme(theme, "x"),
				...prev.x,
				regression: { ...regression, ...next },
			},
		}))
	return (
		<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
			<NumberInput
				label="Width"
				labelClassName={LABEL_COL}
				value={regression.strokeWidth}
				min={0}
				max={12}
				step={0.5}
				clamp
				onChange={(strokeWidth) => update({ strokeWidth })}
			/>
			<p className="vc-help">
				Set the dash pattern under the <strong>Pattern</strong> menu →{" "}
				<strong>Regression line</strong>.
			</p>
		</div>
	)
}

/** Sentinel option value for `ColorSlotControls`' "inherit" entry — an
 *  UNCONFIGURED slot (no stored config), which downstream renderers resolve
 *  to their base color chain (e.g. a data-label segment following the
 *  layer's main Color mapping). Distinct from `""` ("Single color", a stored
 *  `field: null` config). */
const SLOT_INHERIT_VALUE = "__inherit__"

/** The uniform "None + single color | map a variable → palette → per-level /
 * gradient" control, decoupled from where the slot config is stored. Reused
 * for the mark color slots (below) AND the per-variable data-label colors, so
 * both share one mental model. `updateSlot` owns persistence (merging a
 * partial into wherever the slot lives); this component only reads `slotCfg`
 * and emits partial updates. `defaultColor` is the single-color reset target;
 * `labelPrefix` labels the per-value swatches.
 *
 * `inheritLabel` (with `clearSlot`) adds an "inherit" option ABOVE "Single
 * color": an undefined `slotCfg` displays as inheriting (matching how
 * renderers treat a missing slot — they fall through to the base color
 * chain), and picking it clears the stored slot via `clearSlot`. Callers
 * whose base chain is just a single color shouldn't pass it — there,
 * "Single color" already describes the fallback truthfully. */
export const ColorSlotControls = ({
	labelPrefix,
	slotCfg,
	defaultColor,
	acceptsFieldMapping = true,
	inheritLabel,
	clearSlot,
	updateSlot,
}: {
	labelPrefix: string
	slotCfg: ColorSlotConfig | undefined
	defaultColor: string
	acceptsFieldMapping?: boolean
	inheritLabel?: string
	clearSlot?: () => void
	updateSlot: (partial: Partial<ColorSlotConfig>) => void
}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const dataset = useCurrentDatasetView()

	const field = slotCfg?.field ?? null
	const singleColor = slotCfg?.singleColor ?? defaultColor
	// An unconfigured slot inherits the caller's base color chain when the
	// caller exposes that as an explicit option; otherwise it displays as
	// "Single color" (the two are behaviorally identical without a scale).
	const inheriting = inheritLabel !== undefined && slotCfg === undefined
	const fieldOptions = [
		...(inheritLabel !== undefined
			? [{ value: SLOT_INHERIT_VALUE, label: inheritLabel }]
			: []),
		{ value: "", label: "Single color" },
		...(dataset?.fields ?? []).map((f) => ({ value: f.name, label: f.name })),
	]

	const setField = (fieldName: string) => {
		if (fieldName === SLOT_INHERIT_VALUE) {
			clearSlot?.()
			return
		}
		if (fieldName === "" || !dataset) {
			updateSlot({ field: null })
			return
		}
		const t = effectiveType(dataset, fieldName, overrides)
		const isQuantField = t === "quantitative" || t === "temporal"
		if (isQuantField) {
			updateSlot({ field: fieldName, hue: buildQuantHueConfigFromTheme(theme) })
		} else {
			const isOrdinal = t === "ordinal"
			const pal = isOrdinal
				? theme.ordinalPalettes.find((p) => p.id === theme.defaultOrdinalPaletteId)
				: theme.categoricalPalettes.find(
						(p) => p.id === theme.defaultCategoricalPaletteId
					)
			updateSlot({
				field: fieldName,
				hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
				paletteId: pal?.id ?? null,
				palette: [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)],
			})
		}
	}

	const fieldType = dataset && field ? effectiveType(dataset, field, overrides) : null
	const isQuant = fieldType === "quantitative" || fieldType === "temporal"
	const dataExtent = useQuantFieldExtent(dataset?.rows, field, fieldType)

	return (
		<div className="flex flex-col gap-2">
			{acceptsFieldMapping ? (
				<SelectInput
					label="Vary by"
					labelClassName={LABEL_COL}
					value={inheriting ? SLOT_INHERIT_VALUE : (field ?? "")}
					options={fieldOptions}
					onChange={setField}
					disabled={!dataset}
					selectClassName="flex-1"
				/>
			) : null}
			{inheriting && acceptsFieldMapping ? (
				<p className="vc-help">
					Follows the <strong>Color</strong> mapping above.
				</p>
			) : field === null || !acceptsFieldMapping ? (
				<div className="flex items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={singleColor}
						onChange={(c) => updateSlot({ singleColor: c })}
					/>
					<PalettePickerButton
						label={`Pick palette color for ${labelPrefix}`}
						palette={
							theme.categoricalPalettes.find(
								(p) => p.id === theme.defaultCategoricalPaletteId,
							)?.colors ?? CATEGORICAL_HUE_PALETTE
						}
						current={singleColor}
						onPick={(c) => updateSlot({ singleColor: c })}
					/>
					{singleColor !== defaultColor && (
						<button
							type="button"
							onClick={() => updateSlot({ singleColor: defaultColor })}
							className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
					)}
				</div>
			) : isQuant ? (
				<QuantitativePanel
					hueConfig={slotCfg?.hue}
					theme={theme}
					update={(next) => updateSlot({ hue: next })}
					dataExtent={dataExtent}
				/>
			) : (
				<SlotCategoricalControls
					labelPrefix={labelPrefix}
					slotCfg={slotCfg}
					fieldName={field}
					fieldType={fieldType ?? "categorical"}
					dataset={dataset}
					updateSlot={updateSlot}
				/>
			)}
		</div>
	)
}

/** One color-slot subheader: `ColorSlotControls` writing to
 * `channelConfigs.colorSlots[def.key]`. `extra` renders slot-specific controls
 * beneath the uniform block (e.g. the regression line's width); `extraChanged`
 * folds their deviation into the subheader dot. */
const ColorSlotSubsection = ({
	def,
	extra,
	extraChanged = false,
}: {
	def: ColorSlotDef
	extra?: React.ReactNode
	extraChanged?: boolean
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Prefer the live theme so settings-edited palettes appear immediately.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme

	const slotCfg = configs.colorSlots?.[def.key]
	const field = slotCfg?.field ?? null
	// The single-color default for this slot: the legacy value it superseded,
	// else the theme default for this target. `reset` returns to this.
	const defaultColor = legacySlotColor(def.key, configs) ?? def.themeColor(theme)
	const singleColor = slotCfg?.singleColor ?? defaultColor

	// Merge a partial slot update, always carrying a concrete `singleColor` and
	// `field` so the stored slot is well-formed once created.
	const updateSlot = (partial: Partial<ColorSlotConfig>) =>
		setConfigs((prev) => {
			const existing = prev.colorSlots?.[def.key]
			const base: ColorSlotConfig = {
				field: existing?.field ?? null,
				singleColor: existing?.singleColor ?? singleColor,
				...existing,
			}
			return {
				...prev,
				colorSlots: { ...prev.colorSlots, [def.key]: { ...base, ...partial } },
			}
		})

	// This slot deviates when it has a field mapped, a picked palette, or a
	// single color moved off the slot's default.
	const slotChanged =
		slotCfg != null &&
		(field != null ||
			slotCfg.paletteId != null ||
			(slotCfg.singleColor != null && slotCfg.singleColor !== defaultColor))

	return (
		<CollapsibleSubsection title={def.label} changed={slotChanged || extraChanged}>
			<ColorSlotControls
				labelPrefix={def.label}
				slotCfg={slotCfg}
				defaultColor={defaultColor}
				acceptsFieldMapping={def.acceptsFieldMapping}
				updateSlot={updateSlot}
			/>
			{extra}
		</CollapsibleSubsection>
	)
}

/** Per-category palette + swatch editor for a categorically-mapped slot.
 * Mirrors the outline panel's categorical control but writes the slot's own
 * `palette` (scheme) and `hue.colors` (per-value overrides). */
const SlotCategoricalControls = ({
	labelPrefix,
	slotCfg,
	fieldName,
	fieldType,
	dataset,
	updateSlot,
}: {
	labelPrefix: string
	slotCfg: ColorSlotConfig | undefined
	fieldName: string
	fieldType: string
	dataset: ReturnType<typeof useCurrentDatasetView>
	updateSlot: (partial: Partial<ColorSlotConfig>) => void
}) => {
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = levelOrders[fieldName]

	const isOrdinal = fieldType === "ordinal"
	const palettes = isOrdinal ? theme.ordinalPalettes : theme.categoricalPalettes
	const scheme =
		slotCfg?.palette && slotCfg.palette.length > 0
			? slotCfg.palette
			: CATEGORICAL_HUE_PALETTE
	const catCfg =
		slotCfg?.hue?.kind === "categorical" ? slotCfg.hue : DEFAULT_CATEGORICAL_HUE_CONFIG

	const uniqueValues = [
		...new Set(
			(dataset?.rows ?? [])
				.map((r) => parseValue(r[fieldName], fieldType as never))
				.filter((v) => v !== null)
				.map(String)
		),
	]

	const changePalette = (paletteId: string) => {
		const pal = palettes.find((p) => p.id === paletteId)
		updateSlot({
			paletteId,
			palette: [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)],
			hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
		})
	}
	const setColor = (value: string, color: string) =>
		updateSlot({ hue: { ...catCfg, colors: { ...catCfg.colors, [value]: color } } })
	const resetColor = (value: string) => {
		const { [value]: _removed, ...rest } = catCfg.colors
		updateSlot({ hue: { ...catCfg, colors: rest } })
	}

	return (
		<div className="flex flex-col gap-3">
			{palettes.length > 1 && (
				<SelectInput
					label="Palette"
					labelClassName={LABEL_COL}
					value={slotCfg?.paletteId ?? palettes[0]?.id ?? ""}
					options={palettes.map((p) => ({ value: p.id, label: p.name }))}
					onChange={changePalette}
					selectClassName="flex-1"
				/>
			)}
			<CategoricalSwatchList
				values={uniqueValues}
				scheme={scheme}
				colors={catCfg.colors}
				onSetColor={setColor}
				onResetColor={resetColor}
				labelPrefix={labelPrefix}
				order={levelOrder}
				orderType={isOrdinal ? "ordinal" : "categorical"}
			/>
		</div>
	)
}
