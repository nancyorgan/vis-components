import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	type HueConfig,
	type ShapeConfig,
	type TextColorRule,
} from "../../../lib/channelConfig"
import { channelAccepts } from "../../../lib/channels"
import { effectiveType } from "../../../lib/fieldType"
import { buildQuantHueConfigFromTheme } from "../../../lib/hueDefaults"
import { shapeConfigFromTheme } from "../../../lib/themeConfig"
import {
	CATEGORICAL_HUE_PALETTE,
	outlinePaletteForHueType,
	parseValue,
} from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	type AtomValueType,
	themeAtom,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import {
	CategoricalSwatchList,
	PalettePickerButton,
	QuantitativePanel,
	useQuantFieldExtent,
} from "./HueOptionsPanel"

/** Field-mapping state for the `outlineHue` channel, shared by the
 *  standalone dropdown (registry panel) and the combined `OutlineColorRow`
 *  used in the Shape panel. Mirrors EncodingShelf's hue field-mapping
 *  logic: mapping a quantitative/temporal field seeds the theme-default
 *  gradient immediately; mapping a discrete field drops any leftover
 *  quantitative config so the renderer doesn't confuse the two. */
const useOutlineHueField = () => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const dataset = useCurrentDatasetView()

	const value = encodings.outlineHue?.field ?? null
	const eligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts("outlineHue", overrides[f.name] ?? f.inferredType),
	)
	const fieldOptions = [
		{ value: "", label: "— none —" },
		...eligible.map((f) => ({ value: f.name, label: f.name })),
	]

	const onChange = (fieldName: string) => {
		const newField = fieldName === "" ? null : fieldName
		setEncodings((prev) => ({ ...prev, outlineHue: { field: newField } }))
		if (newField && dataset) {
			const t = effectiveType(dataset, newField, overrides)
			const isQuant = t === "quantitative" || t === "temporal"
			setConfigs((prev) => {
				if (isQuant) {
					return prev.outlineHue?.kind === "quantitative"
						? prev
						: { ...prev, outlineHue: buildQuantHueConfigFromTheme(theme) }
				}
				return prev.outlineHue?.kind === "categorical"
					? prev
					: { ...prev, outlineHue: undefined }
			})
		}
	}

	return { value, fieldOptions, onChange, disabled: !dataset }
}

/** Field-selector for the `outlineHue` channel. Standalone form used by the
 *  channel-panel registry; the Shape panel uses `OutlineColorRow` instead,
 *  which folds this dropdown into the same row as the fallback color. */
export const OutlineHueFieldDropdown = () => {
	const { value, fieldOptions, onChange, disabled } = useOutlineHueField()
	return (
		<SelectInput
			label="Vary outline by"
			labelClassName={LABEL_COL}
			value={value ?? ""}
			options={fieldOptions}
			onChange={onChange}
			disabled={disabled}
			selectClassName="flex-1"
		/>
	)
}

/** Combined outline-color control, modeled on the Data Labels "Color" row:
 *  the universal outline color swatch sits beside a "vary by" variable
 *  dropdown, and a chevron opens a submenu with the palette / per-value
 *  color editor (when a variable is mapped) plus conditional color rules.
 *  Lives in the Shape panel; the universal swatch is the fallback the
 *  scale, rules, and per-category overrides all layer on top of. */
export const OutlineColorRow = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const { value, fieldOptions, onChange, disabled } = useOutlineHueField()
	const theme = useCurrentTheme()
	const cfg: ShapeConfig = { ...shapeConfigFromTheme(theme), ...configs.shape }
	const defaultColor = theme.outlineColor

	// Seed untouched fields from the THEME (not built-in DEFAULT_SHAPE_CONFIG) so
	// the stored slice matches the "changed" dot's theme baseline — otherwise a
	// scatter outline edit would also light a phantom Shape dot.
	const updateShape = (next: Partial<ShapeConfig>) =>
		setConfigs((prev) => ({
			...prev,
			shape: { ...shapeConfigFromTheme(theme), ...prev.shape, ...next },
		}))

	// Same shape as the color slots (Line / Rug / …): a "Vary by" selector, then
	// a single-color swatch (with reset) when unmapped, or the palette / gradient
	// editor when a field is mapped. "Single color" replaces the field dropdown's
	// "— none —".
	const varyByOptions = fieldOptions.map((o) =>
		o.value === "" ? { value: "", label: "Single color" } : o,
	)

	return (
		<div className="flex flex-col gap-2">
			<SelectInput
				label="Vary by"
				labelClassName={LABEL_COL}
				value={value ?? ""}
				options={varyByOptions}
				onChange={onChange}
				disabled={disabled}
				selectClassName="flex-1"
			/>
			{value === null ? (
				<div className="flex items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={cfg.outlineColor}
						onChange={(outlineColor) => updateShape({ outlineColor })}
						changed={cfg.outlineColor !== defaultColor}
					/>
					<PalettePickerButton
						label="Pick palette outline color"
						palette={
							// Outline's own picked palette → fill palette → theme default,
							// same precedence the outline scale uses when a field IS mapped.
							outlinePaletteForHueType("categorical", configs) ??
							theme.categoricalPalettes.find(
								(p) => p.id === theme.defaultCategoricalPaletteId,
							)?.colors ??
							CATEGORICAL_HUE_PALETTE
						}
						current={cfg.outlineColor}
						onPick={(outlineColor) => updateShape({ outlineColor })}
					/>
					{cfg.outlineColor !== defaultColor && (
						<ResetLink onClick={() => updateShape({ outlineColor: defaultColor })} />
					)}
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<OutlineHueScaleControls />
					<OutlineColorRulesRow
						rules={cfg.outlineColorRules ?? []}
						fallback={cfg.outlineColor}
						onChange={(outlineColorRules) => updateShape({ outlineColorRules })}
					/>
				</div>
			)}
		</div>
	)
}

/** Conditional outline-color rules — mirrors the Data Labels text-color
 *  rules. The user types a comparison (`> 0`, `< 50`) and picks a color;
 *  the first rule whose comparison passes for the mark's outline-variable
 *  value wins, overriding the palette. Always renders one slot so the
 *  feature is discoverable; an empty condition is a no-op. */
const OutlineColorRulesRow = ({
	rules,
	fallback,
	onChange,
}: {
	rules: readonly TextColorRule[]
	fallback: string
	onChange: (next: TextColorRule[]) => void
}) => {
	const display: TextColorRule[] =
		rules.length === 0 ? [{ condition: "", color: fallback }] : [...rules]
	const setRule = (i: number, patch: Partial<TextColorRule>) =>
		onChange(display.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
	const removeRule = (i: number) =>
		onChange(display.filter((_, idx) => idx !== i))
	const addRule = () =>
		onChange([...display, { condition: "", color: fallback }])
	return (
		<CollapsibleSubsection
			title="Outline color rules"
			boxed={false}
			changed={rules.length > 0}
		>
			<div className="flex flex-col gap-1">
				{display.map((rule, i) => (
					<div
						// Index key is stable here: rules are ordered, identity == position
						// eslint-disable-next-line react/no-array-index-key
						key={i}
						className="flex items-center gap-1.5 text-sm"
					>
						{/* Empty label-column spacer so the condition box + swatch
						 *  line up with the Fill controls (which sit after a w-24
						 *  label), matching the gradient/swatch rows above. */}
						<LabelSpacer />
						<input
							type="text"
							value={rule.condition}
							onChange={(e) => setRule(i, { condition: e.target.value })}
							placeholder="> 0"
							className="w-20 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
						<ColorInput
							label={`Outline color for rule ${i + 1}`}
							labelClassName="sr-only"
							value={rule.color}
							onChange={(color) => setRule(i, { color })}
							showHexInput={false}
						/>
						{rules.length > 0 && (
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
					Tested against the outline variable&apos;s value; first match wins and
					overrides the palette. Use <code>{">"}</code>, <code>{"<"}</code>,{" "}
					<code>{">="}</code>, <code>{"<="}</code>, <code>==</code>, or{" "}
					<code>!=</code> followed by a number.
				</p>
			</div>
		</CollapsibleSubsection>
	)
}

/** Palette / gradient editor for the mapped `outlineHue` field. Renders
 *  nothing when no field is mapped (the dropdown above is the only control
 *  in that case). Quantitative fields reuse the shared `QuantitativePanel`;
 *  discrete fields get a per-category swatch editor that mirrors the hue
 *  panel's, but stays self-contained so it never touches hue's shared
 *  palette slots (`categoricalPaletteId`, etc.). */
export const OutlineHueScaleControls = () => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const dataset = useCurrentDatasetView()

	const fieldName = encodings.outlineHue?.field ?? null
	const type =
		dataset && fieldName ? effectiveType(dataset, fieldName, overrides) : null
	// Hook — must run before the early return below.
	const dataExtent = useQuantFieldExtent(dataset?.rows, fieldName, type)
	if (!dataset || !fieldName || !type) return null

	const isQuantitative = type === "quantitative" || type === "temporal"

	const update = (next: HueConfig) =>
		setConfigs((prev) => ({ ...prev, outlineHue: next }))

	if (isQuantitative) {
		return (
			<div className="flex flex-col gap-2">
				<QuantitativePanel
					hueConfig={configs.outlineHue}
					theme={theme}
					update={update}
					dataExtent={dataExtent}
				/>
			</div>
		)
	}

	return (
		<OutlineCategoricalControls
			dataset={dataset}
			fieldName={fieldName}
			type={type}
			theme={theme}
		/>
	)
}

const OutlineCategoricalControls = ({
	dataset,
	fieldName,
	type,
	theme,
}: {
	dataset: {
		rows: Array<Record<string, string>>
	}
	fieldName: string
	type: FieldType
	theme: AtomValueType<typeof themeAtom>
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = levelOrders[fieldName]

	const cfg =
		configs.outlineHue?.kind === "categorical"
			? configs.outlineHue
			: DEFAULT_CATEGORICAL_HUE_CONFIG
	// Ordinal outline fields read the theme's ordinal (sequential) palettes;
	// categorical fields read the categorical palettes — same split as fill hue.
	const isOrdinal = type === "ordinal"
	const palettesForType = isOrdinal
		? theme.ordinalPalettes
		: theme.categoricalPalettes
	// Show outline's OWN palette selection; fall back to the fill palette id so
	// the dropdown reflects the palette actually in effect before any pick.
	const currentPaletteId = isOrdinal
		? (configs.outlineOrdinalPaletteId ??
			configs.ordinalPaletteId ??
			theme.defaultOrdinalPaletteId)
		: (configs.outlineCategoricalPaletteId ??
			configs.categoricalPaletteId ??
			theme.defaultCategoricalPaletteId)
	// Default outline color per category cycles outline's own palette (falling
	// back to the fill palette when none is picked), matching `makeHueScale` in
	// the renderer. Per-value overrides live in `outlineHue.colors`.
	const scheme =
		outlinePaletteForHueType(type, configs) ?? CATEGORICAL_HUE_PALETTE

	const uniqueValues = [
		...new Set(
			dataset.rows
				.map((r) => parseValue(r[fieldName], type))
				.filter((v) => v !== null)
				.map(String),
		),
	]

	const update = (next: HueConfig) =>
		setConfigs((prev) => ({ ...prev, outlineHue: next }))
	const setColor = (value: string, color: string) =>
		update({ ...cfg, colors: { ...cfg.colors, [value]: color } })
	const resetColor = (value: string) => {
		const { [value]: _removed, ...rest } = cfg.colors
		update({ ...cfg, colors: rest })
	}
	// Switching palette clears the per-value overrides (keyed to the old
	// palette's slots) and writes outline's OWN palette slot — never the fill's,
	// so the fill hue is left untouched.
	const changePalette = (paletteId: string) => {
		const pal = palettesForType.find((p) => p.id === paletteId)
		const colors = [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)]
		setConfigs((prev) => ({
			...prev,
			outlineHue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
			...(isOrdinal
				? { outlineOrdinalPaletteId: paletteId, outlineOrdinalPalette: colors }
				: {
						outlineCategoricalPaletteId: paletteId,
						outlineCategoricalPalette: colors,
					}),
		}))
	}
	return (
		<div className="flex flex-col gap-3">
			{palettesForType.length > 1 && (
				<SelectInput
					label="Palette"
					labelClassName={LABEL_COL}
					value={currentPaletteId}
					options={palettesForType.map((p) => ({
						value: p.id,
						label: p.name,
					}))}
					onChange={changePalette}
					selectClassName="flex-1"
				/>
			)}
			<CategoricalSwatchList
				values={uniqueValues}
				scheme={scheme}
				colors={cfg.colors}
				onSetColor={setColor}
				onResetColor={resetColor}
				labelPrefix="Outline color"
				order={levelOrder}
				orderType={type}
			/>
		</div>
	)
}

/** Standalone panel used by the channel-panel registry. The channel is
 *  hidden from the main shelf and configured inside the Shape panel, so this
 *  is rarely shown — but the registry requires a total mapping, and this
 *  keeps the channel self-sufficient (dropdown + scale controls) if it is. */
export const OutlineHueOptionsPanel = () => (
	<div className="vc-option-panel">
		<OutlineHueFieldDropdown />
		<OutlineHueScaleControls />
	</div>
)
