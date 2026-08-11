import { useAtom, useAtomValue } from "jotai"
import { type TextConfig } from "../../../lib/channelConfig"
import { FONT_FAMILY_OPTIONS } from "../../../lib/labelsConfig"
import { textConfigFromTheme } from "../../../lib/themeConfig"
import { parseValue } from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../../components/ui/SelectInput"

/** Inline "reset" link — renders only when a value differs from its theme
 *  default; clicking restores the default via the caller's update fn. */
const ResetLink = ({ onClick }: { onClick: () => void }) => (
	<button
		type="button"
		onClick={onClick}
		className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
	>
		reset
	</button>
)

const FAMILY_OPTIONS = FONT_FAMILY_OPTIONS.map((opt) => ({
	value: opt.value,
	label: opt.label,
}))

/** SelectInput is generic over a string union — font weights are
 *  numeric, so we stringify them at the boundary and convert back in
 *  onChange. */
const WEIGHT_OPTIONS = (["400", "500", "600", "700"] as const).map((w) => ({
	value: w,
	label: w,
}))
type WeightOptionValue = (typeof WEIGHT_OPTIONS)[number]["value"]

const effectiveType = (
	inferred: FieldType | undefined,
	override: FieldType | undefined
): FieldType => override ?? inferred ?? "categorical"

/** Synthetic option values for the palette select. Real palette ids
 *  collide with neither, so this is safe. */
const PALETTE_NONE = "__none__"
const PALETTE_CUSTOM = "__custom__"

export const TextOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	// Live theme first (themesAtom[currentThemeId]); the legacy `themeAtom`
	// snapshot only as fallback — it's frozen at the last theme APPLY, so
	// reset baselines computed from it go stale the moment the user edits
	// the theme sheet (mirrors EncodingShelf/LegendPanel).
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const dataset = useCurrentDatasetView()

	// Theme-derived defaults: each top-level control resets to the value the
	// theme would seed (matching `updateCfg`'s baseline), so a reset link only
	// shows when the stored value diverges from that baseline.
	const themeCfg = textConfigFromTheme(theme)
	const cfg: TextConfig = { ...themeCfg, ...configs.text }

	const updateCfg = (next: Partial<TextConfig>) => {
		// Seed untouched fields from the THEME's text config so the stored slice
		// matches the "changed" dot's theme baseline; seeding from the built-in
		// `DEFAULT_TEXT_CONFIG` would diverge in the theme-driven font/color
		// fields and light the dot on the first edit.
		setConfigs((prev) => ({
			...prev,
			text: { ...textConfigFromTheme(theme), ...prev.text, ...next },
		}))
	}

	const setOverride = (value: string, color: string) =>
		updateCfg({ colorOverrides: { ...cfg.colorOverrides, [value]: color } })

	const clearOverride = (value: string) => {
		const { [value]: _removed, ...rest } = cfg.colorOverrides
		updateCfg({ colorOverrides: rest })
	}

	const fieldName = encodings.text?.field ?? null
	const field = fieldName
		? dataset?.fields.find((f) => f.name === fieldName)
		: undefined
	const type = effectiveType(field?.inferredType, overrides[fieldName ?? ""])

	const isDiscrete = type === "categorical" || type === "ordinal"
	const categories =
		isDiscrete && fieldName && dataset
			? [
					...new Set(
						dataset.rows
							.map((r) => parseValue(r[fieldName], type))
							.filter((v) => v !== null)
							.map(String)
					),
				]
			: []

	// Detect which saved palette (if any) matches the current cfg.palette.
	// Falls back to PALETTE_CUSTOM when the colors don't match any saved one.
	const paletteSelectValue = (() => {
		if (cfg.palette.length === 0) return PALETTE_NONE
		const match = theme.categoricalPalettes.find(
			(p) =>
				p.colors.length === cfg.palette.length &&
				p.colors.every((c, i) => c === cfg.palette[i])
		)
		return match?.id ?? PALETTE_CUSTOM
	})()

	const paletteOptions = [
		{ value: PALETTE_NONE, label: "None" },
		...theme.categoricalPalettes.map((p) => ({
			value: p.id,
			label: p.name,
		})),
	]

	return (
		<div className="vc-option-panel">
			<div className="flex items-center gap-2">
				<SelectInput
					label="Font family"
					labelClassName={LABEL_COL}
					value={cfg.fontFamily}
					options={FAMILY_OPTIONS}
					onChange={(fontFamily) => updateCfg({ fontFamily })}
					selectClassName="flex-1"
				/>
				{cfg.fontFamily !== themeCfg.fontFamily && (
					<ResetLink
						onClick={() => updateCfg({ fontFamily: themeCfg.fontFamily })}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Size"
					labelClassName={LABEL_COL}
					value={cfg.fontSize}
					min={6}
					max={48}
					step={1}
					onChange={(fontSize) => updateCfg({ fontSize })}
					suffix="pt"
					inputClassName="w-16"
				/>
				{cfg.fontSize !== themeCfg.fontSize && (
					<ResetLink
						onClick={() => updateCfg({ fontSize: themeCfg.fontSize })}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<SelectInput
					label="Weight"
					labelClassName={LABEL_COL}
					value={String(cfg.fontWeight) as WeightOptionValue}
					options={WEIGHT_OPTIONS}
					onChange={(w) =>
						updateCfg({
							fontWeight: Number(w) as TextConfig["fontWeight"],
						})
					}
					selectClassName="flex-1"
				/>
				{cfg.fontWeight !== themeCfg.fontWeight && (
					<ResetLink
						onClick={() => updateCfg({ fontWeight: themeCfg.fontWeight })}
					/>
				)}
			</div>
			{type === "quantitative" && (
				<div className="flex items-center gap-2">
					<NumberInput
						label="Decimals"
						labelClassName={LABEL_COL}
						value={cfg.decimals ?? 0}
						min={0}
						max={6}
						step={1}
						onChange={(decimals) => updateCfg({ decimals })}
						inputClassName="w-16"
					/>
					{(cfg.decimals ?? 0) !== (themeCfg.decimals ?? 0) && (
						<ResetLink
							onClick={() => updateCfg({ decimals: themeCfg.decimals })}
						/>
					)}
				</div>
			)}
			<hr className="border-stone-200 dark:border-stone-700" />
			{isDiscrete && categories.length > 0 && (
				<SelectInput
					label="Palette"
					labelClassName={LABEL_COL}
					value={paletteSelectValue}
					options={paletteOptions}
					onChange={(next) => {
						if (next === PALETTE_NONE) {
							updateCfg({ palette: [] })
							return
						}
						const pal = theme.categoricalPalettes.find((p) => p.id === next)
						if (pal) updateCfg({ palette: [...pal.colors] })
					}}
					selectClassName="flex-1"
				/>
			)}
			<div className="flex items-center gap-2">
				<ColorInput
					label={cfg.palette.length > 0 ? "Fallback" : "Color"}
					labelClassName={LABEL_COL}
					value={cfg.color}
					onChange={(color) => updateCfg({ color })}
				/>
				{cfg.color !== themeCfg.color && (
					<ResetLink onClick={() => updateCfg({ color: themeCfg.color })} />
				)}
			</div>
			{isDiscrete && categories.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-sm text-stone-600 dark:text-stone-400">
						Per-value override
					</span>
					{categories.map((cat) => {
						const overrideColor = cfg.colorOverrides[cat]
						return (
							<div key={cat} className="flex items-center gap-2 text-sm">
								<span
									className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300"
									title={cat}
								>
									{cat}
								</span>
								<ColorInput
									label=""
									value={overrideColor ?? cfg.color}
									onChange={(color) => setOverride(cat, color)}
									showHexInput={false}
									className="gap-0"
									labelClassName="sr-only"
								/>
								{overrideColor ? (
									<button
										type="button"
										onClick={() => clearOverride(cat)}
										className="text-sm text-stone-600 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-white"
									>
										reset
									</button>
								) : (
									<span className="w-10" />
								)}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
