import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type RegressionConfig,
} from "../../../lib/channelConfig"
import type { ChartMode } from "../../../lib/chartMode"
import {
	applicableColorSlots,
	colorSlotEdited,
	legacySlotColor,
	type ColorSlotDef,
} from "../../../lib/colorSlots"
import { markPartTitles } from "../../../lib/markPartTitles"
import {
	RADAR_LINE_INHERIT,
	clearLegacyRadarLine,
	legacyRadarLineSlot,
} from "../../../lib/radarLineSlot"
import { isAreaModeId } from "../../../lib/chartModes/families"
import { defaultColorSlot, isDefaultColorSlot } from "../../../lib/colorSlotDefaults"
import { effectiveType } from "../../../lib/fieldType"
import { CATEGORICAL_HUE_PALETTE } from "../../../lib/scales"
import { pickSlotPalette } from "../../../lib/paletteEdits"
import { seedColorSlot, type SlotPaletteKind } from "../../../lib/seedColorSlot"
import type { FieldType } from "../../../lib/types"
import { uniqueFieldValues } from "../../../lib/uniqueFieldValues"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { linkedCategoryColors } from "../../../lib/linkedHueColors"
import { useColorLink } from "../../../store/useColorLink"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { usePureDensityCurve } from "../../../store/usePureDensityCurve"

import {
	axisConfigFromTheme,
	explainChannelCustomization,
	resolveFillPalettePick,
	valueChanged,
} from "../../../lib/themeConfig"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { SidebarJumpText, channelJump } from "../../../../../components/ui/SidebarJumpLink"

import {
	AreaRadarOutlinePanel,
	CategoricalSwatchList,
	ColorOptionsPanel,
	QuantitativePanel,
	useQuantFieldExtent,
} from "./ColorOptionsPanel"
import { OutlineColorRow } from "./OutlineColorPanel"
import { ColorRulesEditor, markRuleHelp } from "../ColorRulesEditor"

/** The unified Color menu. Houses every color target as a subheader, scoped to
 * the current chart type:
 *   - Fill  — the primary color encoding (variable mapped via the Color shelf
 *             row); reuses the full hue palette/gradient editor.
 *   - Outline — the independent `outlineHue` color encoding.
 *   - Generic color slots (Line / Rug / Violin-Box Fill+Outline / Stem /
 *     Polygon Fill / Radar Spine) — each an independent optional color
 *     encoding.
 * Every subheader follows the same shape: None (single color) by default, or
 * map a variable → pick a palette → adjust per-level colors (categorical) or a
 * gradient (quantitative). Data labels are intentionally excluded — they keep
 * their own color controls in the Data Labels panel. */
export const ColorPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const modeDef = useChartModeDef()
	const mode = modeDef.id as ChartMode
	const allSlots = applicableColorSlots(mode, encodings, configs)
	// Area charts read Line, Area fill, Point fill, Point outline: the Point
	// fill slot renders right after the Fill, ahead of the Point outline and
	// the rest of the slot list.
	const pointFillSlot = allSlots.find((d) => d.key === "areaPointFill")
	const slots = allSlots.filter((d) => d !== pointFillSlot)
	// PURE density curve (standalone "Density" display, marks suppressed) → the
	// mark Fill / Outline groups have nothing to style and are hidden; the
	// Density Curve slots take over. Histogram + curve keeps them (bars render).
	const pureDensityCurve = usePureDensityCurve()
	// Subheader titles — "Point fill" / "Point outline" / "Connection line"
	// where the marks are points beside another part (radar polygon, violin /
	// box, a line chart's line).
	const titles = markPartTitles(modeDef, configs, encodings)
	// The area modes color the layer OUTLINE per layer by the same hue field
	// as the fill (linked), via `connection`-based palettes — the dedicated
	// `AreaRadarOutlinePanel`, in place of the independent-field
	// `OutlineColorRow` (areas draw no points). The polygon mode (radar)
	// colors its CONNECTION LINE (the polygon outline) with the Line color
	// slot instead — a Vary by like every other part, led by "Match fill" —
	// while its points keep the independent outline like scatter's.
	const isAreaMode = isAreaModeId(mode)
	const isPolygonMode = modeDef.canvas.connectionRole === "polygon"
	const useLinkedOutline = isAreaMode
	// Scatter-style independent outline (own field) for the point marks:
	// every mode but the areas, and the pure density curve, whose marks (the
	// styling target) are gone.
	const showIndependentOutline = !isAreaMode && !pureDensityCurve

	// Subsection dots — reuse the SAME change data the top-level Color dot uses
	// (so they can't disagree). The hue registry labels map to the subheaders.
	const theme = useCurrentTheme()
	const hueChanged = new Set(
		explainChannelCustomization("hue", configs, theme, !!encodings.hue?.field)
	)
	const fillChanged =
		hueChanged.has("default fill") ||
		hueChanged.has("fill scale edits") ||
		hueChanged.has("fill color rules") ||
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

	// Area charts lead with the Line (the linked outline editor), then the
	// Area fill, Point fill and Point outline.
	const areaLineSection = useLinkedOutline && (
		<CollapsibleSubsection title={titles.outline} changed={outlineAreaChanged}>
			<AreaRadarOutlinePanel />
		</CollapsibleSubsection>
	)

	return (
		<div className="vc-option-panel">
			{areaLineSection}
			{!pureDensityCurve && (
				<CollapsibleSubsection
					title={titles.fill}
					defaultOpen
					changed={fillChanged}
				>
					{/* The area modes set the color field via the Color shelf
					 *  row (fill and outline are linked to the series), so the
					 *  in-panel selector would be redundant there. */}
					<ColorOptionsPanel hideVaryBy={isAreaMode} />
				</CollapsibleSubsection>
			)}
			{showIndependentOutline && (
				<CollapsibleSubsection
					title={titles.outline}
					changed={outlineScatterChanged}
				>
					<OutlineColorRow />
				</CollapsibleSubsection>
			)}
			{pointFillSlot && <ColorSlotSubsection def={pointFillSlot} />}
			{/* Area-chart points carry the marks' own outline, the same
			 *  control (and theme defaults) as a scatter / line chart's. */}
			{pointFillSlot && !pureDensityCurve && (
				<CollapsibleSubsection title="Point outline" changed={outlineScatterChanged}>
					<OutlineColorRow />
				</CollapsibleSubsection>
			)}
			{slots.map((def) => (
				<ColorSlotSubsection
					key={def.key}
					def={
						isPolygonMode && def.key === "line"
							? { ...def, label: titles.line, inherit: RADAR_LINE_INHERIT }
							: def
					}
					// Radar polygons saved with the old Outline editor's palette /
					// per-series / single color show (and seed from) that state
					// until the slot takes over; the first edit clears it.
					legacyCfg={
						isPolygonMode && def.key === "line"
							? legacyRadarLineSlot(
									configs,
									encodings.connection?.field ?? null,
									configs.defaultFill ?? theme.defaultFill
								)
							: undefined
					}
					transformWrite={
						isPolygonMode && def.key === "line" ? clearLegacyRadarLine : undefined
					}
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
							: isPolygonMode && def.key === "line"
								? outlineAreaChanged
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
	const theme = useCurrentTheme()
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
		<div className="vc-divider-group">
			<div className="flex items-center gap-2">
				<NumberInput
					label="Line thickness"
					labelClassName={LABEL_COL}
					value={regression.strokeWidth}
					min={0}
					max={12}
					step={0.5}
					clamp
					onChange={(strokeWidth) => update({ strokeWidth })}
				/>
				{regression.strokeWidth !== themeRegression(theme).strokeWidth && (
					<ResetLink
						ariaLabel="Reset regression line thickness"
						onClick={() =>
							update({ strokeWidth: themeRegression(theme).strokeWidth })
						}
						underline
					/>
				)}
			</div>
			<p className="vc-help">
				Set the dash pattern under{" "}
				<SidebarJumpText target={channelJump("pattern", "pattern:regression")}>Pattern → Regression line</SidebarJumpText>.
			</p>
		</div>
	)
}

/** Sentinel option value for `ColorSlotControls`' "inherit" entry — an
 *  UNCONFIGURED slot (no stored config), which downstream renderers resolve
 *  to their base color chain (e.g. a data-label segment following the
 *  layer's main Color mapping). Distinct from `""` ("— none —", a stored
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
 * `inheritLabel` (with `clearSlot`) adds an "inherit" option ABOVE "— none
 * —": an undefined `slotCfg` displays as inheriting (matching how
 * renderers treat a missing slot — they fall through to the base color
 * chain), and picking it clears the stored slot via `clearSlot`. Callers
 * whose base chain is just a single color shouldn't pass it — there,
 * "— none —" (the single color) already describes the fallback truthfully. */
export const ColorSlotControls = ({
	labelPrefix,
	slotCfg,
	defaultColor,
	acceptsFieldMapping = true,
	inheritLabel,
	inheritHelp,
	clearSlot,
	defaultField,
	paletteKind = "categorical",
	updateSlot,
}: {
	labelPrefix: string
	slotCfg: ColorSlotConfig | undefined
	defaultColor: string
	acceptsFieldMapping?: boolean
	inheritLabel?: string
	/** Help prose shown while inheriting; nothing is shown when omitted. */
	inheritHelp?: React.ReactNode
	clearSlot?: () => void
	/** The variable the UNTOUCHED slot already varies by (a Color-following
	 *  slot's default, see `defaultColorSlot`). Picking it again calls
	 *  `clearSlot`, returning to that live default instead of storing a copy. */
	defaultField?: string | null
	/** Which theme palette the slot seeds and its single-color swatch's
	 *  picker leads with. Data-label slots color TEXT, so they pass `"text"`;
	 *  filled bodies (violin / box, density-curve fill) pass `"fill"`; mark
	 *  slots keep the default categorical palette. */
	paletteKind?: SlotPaletteKind
	updateSlot: (partial: Partial<ColorSlotConfig>) => void
}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const theme = useCurrentTheme()
	const dataset = useCurrentDatasetView()

	const field = slotCfg?.field ?? null
	const singleColor = slotCfg?.singleColor ?? defaultColor
	// An unconfigured slot inherits the caller's base color chain when the
	// caller exposes that as an explicit option; otherwise it displays as
	// "— none —" (the two are behaviorally identical without a scale).
	const inheriting = inheritLabel !== undefined && slotCfg === undefined
	const fieldOptions = [
		...(inheritLabel !== undefined
			? [{ value: SLOT_INHERIT_VALUE, label: inheritLabel }]
			: []),
		{ value: "", label: "— none —" },
		...(dataset?.fields ?? []).map((f) => ({ value: f.name, label: f.name })),
	]

	const setField = (fieldName: string) => {
		if (
			fieldName === SLOT_INHERIT_VALUE ||
			(defaultField && fieldName === defaultField && clearSlot)
		) {
			clearSlot?.()
			return
		}
		if (fieldName === "" || !dataset) {
			updateSlot({ field: null })
			return
		}
		updateSlot(
			seedColorSlot(
				fieldName,
				effectiveType(dataset, fieldName, overrides),
				theme,
				paletteKind
			)
		)
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
				inheritHelp ? <p className="vc-help">{inheritHelp}</p> : null
			) : field === null || !acceptsFieldMapping ? (
				<div className="flex flex-wrap items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={singleColor}
						onChange={(c) => updateSlot({ singleColor: c })}
						palette={
							paletteKind === "text"
								? undefined
								: paletteKind === "fill"
									? resolveFillPalettePick(theme).colors
									: (theme.categoricalPalettes.find(
											(p) => p.id === theme.defaultCategoricalPaletteId,
										)?.colors ?? CATEGORICAL_HUE_PALETTE)
						}
						paletteKind={paletteKind === "text" ? "text" : "categorical"}
						pickerLabel={`Pick palette color for ${labelPrefix}`}
					/>
					{singleColor !== defaultColor && (
						<ResetLink onClick={() => updateSlot({ singleColor: defaultColor })} />
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
	legacyCfg,
	transformWrite = (c) => c,
}: {
	def: ColorSlotDef
	extra?: React.ReactNode
	extraChanged?: boolean
	/** What an UNSTORED slot draws through older config fields (the radar
	 *  outline's connection palette), shown and seeded from until the first
	 *  edit. */
	legacyCfg?: ColorSlotConfig
	/** Applied to every write — clears those older fields once the slot owns
	 *  the color. */
	transformWrite?: (configs: ChannelConfigs) => ChannelConfigs
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()

	const storedCfg = configs.colorSlots?.[def.key]
	// An untouched Color-following slot (violin / box, density-curve fill)
	// varies by the Color variable — shown as exactly that, the same config
	// the renderer derives (`withColorSlotDefaults`), never persisted.
	const hueField = encodings.hue?.field ?? null
	const hueType =
		dataset && hueField ? effectiveType(dataset, hueField, overrides) : null
	const dflt = defaultColorSlot(def.key, encodings, configs, hueType, theme)
	const derivedCfg = storedCfg ? undefined : (dflt ?? legacyCfg)
	const slotCfg = storedCfg ?? derivedCfg
	// The variable the untouched slot varies by, touched or not: re-picking
	// it returns to the live default.
	const defaultField = dflt?.field ?? null
	// The single-color default for this slot: a Color-following fill's
	// single-color default (the fill-palette color analogous to the marks'),
	// else the legacy value it superseded, else the theme default for this
	// target. `reset` returns to this.
	const defaultColor =
		(dflt && dflt.field === null ? dflt.singleColor : undefined) ??
		legacySlotColor(def.key, configs) ??
		def.themeColor(theme)
	const singleColor = slotCfg?.singleColor ?? defaultColor

	// Merge a partial slot update, always carrying a concrete `singleColor` and
	// `field` so the stored slot is well-formed once created.
	const updateSlot = (partial: Partial<ColorSlotConfig>) =>
		setConfigs((prev) => {
			// The first edit of an untouched Color-following slot starts from
			// the default it displays (field + palette), so a swatch tweak
			// doesn't drop the Vary by.
			const existing = prev.colorSlots?.[def.key] ?? derivedCfg
			const base: ColorSlotConfig = {
				field: existing?.field ?? null,
				singleColor: existing?.singleColor ?? singleColor,
				...existing,
			}
			const next = { ...base, ...partial }
			// An edit that lands back on the Color-following default (a Reset,
			// "— none —" with no Color variable) stores nothing, so the slot
			// keeps tracking the live default.
			if (isDefaultColorSlot(next, dflt)) {
				const { [def.key]: _removed, ...rest } = prev.colorSlots ?? {}
				return transformWrite({ ...prev, colorSlots: rest })
			}
			return transformWrite({
				...prev,
				colorSlots: { ...prev.colorSlots, [def.key]: next },
			})
		})

	// Inherit-capable slots (regression, combo points) render the Color mapping's
	// colors while UNCONFIGURED, so they lead with an explicit "Automatic"
	// option; picking it deletes the stored slot, returning to that state.
	const clearSlot = () =>
		setConfigs((prev) => {
			if (!prev.colorSlots?.[def.key]) return transformWrite(prev)
			const { [def.key]: _removed, ...rest } = prev.colorSlots
			return transformWrite({ ...prev, colorSlots: rest })
		})

	// This slot deviates when it has a field mapped, a picked palette, or a
	// single color moved off the slot's default — shared with the top-level
	// Color dot so they can't drift.
	const slotChanged = colorSlotEdited(def.key, storedCfg, configs, theme, hueField)

	return (
		<CollapsibleSubsection
			title={def.label}
			changed={slotChanged || extraChanged}
			jumpId={`color:${def.key}`}
		>
			<ColorSlotControls
				labelPrefix={def.label}
				slotCfg={slotCfg}
				defaultColor={defaultColor}
				acceptsFieldMapping={def.acceptsFieldMapping}
				inheritLabel={def.inherit?.label}
				inheritHelp={def.inherit?.help}
				clearSlot={def.inherit || defaultField ? clearSlot : undefined}
				defaultField={defaultField}
				paletteKind={
					def.key === "violinFill" || def.key === "densityCurveFill"
						? "fill"
						: "categorical"
				}
				updateSlot={updateSlot}
			/>
			{/* Conditional line-color rules — the same "+ Add color rule" editor
			 *  Fill and Outline carry. Stored on the slot (`colorRules`), so the
			 *  first touch writes a well-formed slot and the slot owns the stroke
			 *  from then on (see `resolveConnectionStroke`). */}
			{def.key === "line" && (
				<ColorRulesEditor
					rules={slotCfg?.colorRules ?? []}
					onChange={(colorRules) => updateSlot({ colorRules })}
					defaultColor={singleColor}
					ruleLabel="line"
					help={markRuleHelp("line", slotCfg?.field ?? null)}
				/>
			)}
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
	const theme = useCurrentTheme()
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = levelOrders[fieldName]
	const colorLink = useColorLink()

	const isOrdinal = fieldType === "ordinal"
	const palettes = isOrdinal ? theme.ordinalPalettes : theme.categoricalPalettes
	const scheme =
		slotCfg?.palette && slotCfg.palette.length > 0
			? slotCfg.palette
			: CATEGORICAL_HUE_PALETTE
	const catCfg =
		slotCfg?.hue?.kind === "categorical" ? slotCfg.hue : DEFAULT_CATEGORICAL_HUE_CONFIG

	const uniqueValues = uniqueFieldValues(dataset?.rows ?? [], fieldName, {
		type: fieldType as FieldType,
	})

	const changePalette = (paletteId: string) =>
		updateSlot(pickSlotPalette(theme, paletteId, fieldType as FieldType))
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
				defaults={linkedCategoryColors(colorLink, fieldName, scheme)}
				onSetColor={setColor}
				onResetColor={resetColor}
				labelPrefix={labelPrefix}
				order={levelOrder}
				orderType={isOrdinal ? "ordinal" : "categorical"}
			/>
		</div>
	)
}
