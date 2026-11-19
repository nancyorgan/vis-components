import type { LineDashPattern } from "../../../../lib/channelConfig"
import { DASH_CYCLE, resolveDashGapFill } from "../../../../lib/dashPatterns"
import {
	DEFAULT_PATTERN_INK,
	inkForHueColor,
	PATTERN_NONE,
} from "../../../../lib/patterns"
import { orderedLevels } from "../../../../lib/smartSort"
import { valueChanged } from "../../../../lib/themeConfig"

import { Checkbox } from "../../../../../../components/ui/Checkbox"
import { ColorInput } from "../../../../../../components/ui/ColorInput"
import { LabeledChipRow } from "../../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../../components/ui/ResetLink"

import { DashStylePicker } from "../dashControls"

import { categoryState, type PatternPanel } from "./usePatternPanel"

/** Default LINE DASH row (no pattern variable) — the shared DashStylePicker
 *  (same row the per-category and regression pickers render), writing the
 *  CONNECTION config's `defaultDashPattern`, which is what the line
 *  renderers actually read (scatter connection polylines + area line-mode
 *  edges). Deliberately NOT `configs.defaultPattern`: that's the point-fill
 *  selection, and sharing one index between the two rows made picking a
 *  dash silently pick a point fill too (and the dash itself never
 *  rendered). The "Custom open" flag is the panel's state so the Reset link
 *  can close the box. "Blank" is a range-mode option (a whole-line blank
 *  would erase the line), so the swatch only renders while the range is on. */
export const DefaultDashRow = ({
	p,
	label,
}: {
	p: PatternPanel
	label: string | null
}) => {
	const { configs, connDefaultDash, updateConnectionCfg } = p
	const picker = (
		<DashStylePicker
			pattern={connDefaultDash}
			customDasharray={configs.connection?.customDashPattern ?? null}
			customOpen={p.defaultCustomDashOpen}
			onCustomOpenChange={p.setDefaultCustomDashOpen}
			showBlank={configs.connection?.dashRange?.enabled ?? false}
			onChange={({ pattern, customDasharray }) =>
				updateConnectionCfg({
					defaultDashPattern: pattern,
					customDashPattern: customDasharray,
				})
			}
			ariaContext="line"
			changed={
				valueChanged(connDefaultDash, "solid") ||
				(configs.connection?.customDashPattern ?? null) !== null
			}
			onReset={() =>
				updateConnectionCfg({ defaultDashPattern: "solid", customDashPattern: null })
			}
		/>
	)
	// Labeled ("Line dash"): the swatches start on the label's line, like
	// the fill rows (`LabeledChipRow`).
	return label ? (
		<LabeledChipRow label={label}>{picker}</LabeledChipRow>
	) : (
		<div className="flex flex-col gap-1 text-sm">{picker}</div>
	)
}

/** One category's Line-dash controls: the shared DashStylePicker (None /
 *  the dash swatches / Custom as a single mutually-exclusive choice; the
 *  custom box opens below the row). The "Custom open" flag lives in the
 *  panel's `customDashOpen` so the category's Reset link can close it;
 *  Reset also clears the dash override and the custom dasharray. The
 *  picker draws that reset after its last swatch. `display` is the name
 *  shown when the storage key isn't user-friendly (e.g. the Nesting-depth
 *  key "1" shows as "Level 1"); picks still key on `v`. */
export const DashCategory = ({
	p,
	v,
	i,
	display,
}: {
	p: PatternPanel
	v: string
	i: number
	display?: string
}) => {
	const s = categoryState(p, v, i)
	const customDash = p.customDashOverrides[v] ?? null
	const customOpen = p.customDashOpen[v] ?? false
	const setCustomOpen = (open: boolean) =>
		p.setCustomDashOpen((prev) => {
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
		<LabeledChipRow label={display ?? v}>
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
						if (customDasharray === null) p.resetCustomDashOverride(v)
						else p.setCustomDashOverride(v, customDasharray)
					}
					if (pattern !== current) {
						p.setDashOverride(
							v,
							pattern === "solid" ? PATTERN_NONE : DASH_CYCLE.indexOf(pattern)
						)
					}
				}}
				ariaContext={v}
				changed={s.hasDashOverride || customDash !== null || customOpen}
				onReset={() => {
					if (s.hasDashOverride) p.resetDashOverride(v)
					if (customDash !== null) p.resetCustomDashOverride(v)
					setCustomOpen(false)
				}}
			/>
		</LabeledChipRow>
	)
}

const GapColorRow = ({
	label,
	ariaLabel,
	override,
	fallback,
	onChange,
}: {
	label: string
	/** Names the palette picker + reset link; defaults to "Gap color for
	 *  <label>" (the single no-hue row passes plain "Gap color"). */
	ariaLabel?: string
	override: string | null
	fallback: string
	onChange: (color: string | null) => void
}) => {
	const aria = ariaLabel ?? `Gap color for ${label}`
	return (
		// Inherit mode: no override = the paired / default ink (`fallback`),
		// previewed in the swatch. flex-wrap drops the reset link under the
		// swatch when the row is squeezed.
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<ColorInput
				label={label}
				labelClassName="w-24 truncate vc-text"
				value={override}
				onChange={onChange}
				onClear={() => onChange(null)}
				placeholder={fallback}
				pickerLabel={`Pick palette ${aria.charAt(0).toLowerCase()}${aria.slice(1)}`}
				className="contents"
			/>
			{override !== null && (
				<ResetLink
					onClick={() => onChange(null)}
					ariaLabel={`Reset ${aria.charAt(0).toLowerCase()}${aria.slice(1)}`}
				/>
			)}
		</div>
	)
}

/** "Fill dash gaps" and, while it is on, the gap colors.
 *
 *  The checkbox: whether the gaps between dashes are painted (an
 *  alternate-color underlay keeps the line connected) or left empty (truly
 *  dashed). Auto default: filled, EXCEPT when pattern and hue map the same
 *  field (the dash restates the color split there, so true gaps are the
 *  default and painting is opt-in).
 *
 *  The swatches: one row per COLOR-encoding category (gap colors pair with
 *  line colors, and line colors come from hue), keyed by hue value in
 *  `connection.dashAlternateColors`. Defaults show the palette-paired
 *  pattern ink each category's gaps resolve to. With no hue encoding
 *  there's one line color → a single "Gap color" swatch
 *  (`connection.dashGapColor`). */
export const GapFillRow = ({ p }: { p: PatternPanel }) => {
	const {
		configs,
		encodings,
		theme,
		huePalette,
		palettePatternInks,
		hueOverrideColors,
		hueCategoryValues,
		themeInkFallback,
		updateConnectionCfg,
	} = p
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
		if (p.segmentContext && !p.hueIsMapped) {
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
	const gapColorRows = !gapFillOn ? null : hueFieldName && hueCategoryValues ? (
		<div className="flex flex-col gap-1">
			{orderedLevels(
				hueCategoryValues.values,
				hueCategoryValues.type,
				hueCategoryValues.order
			).map(({ value: v, index: i }) => (
				<GapColorRow
					key={v}
					label={hueCategoryValues.labels?.[i] ?? v}
					override={dashAltColors[v] ?? null}
					fallback={defaultGapColorFor(i, v)}
					onChange={(color) =>
						color === null
							? resetGapColorOverride(v)
							: setGapColorOverride(v, color)
					}
				/>
			))}
		</div>
	) : (
		<GapColorRow
			key="__single__"
			label="Gap color"
			ariaLabel="Gap color"
			override={configs.connection?.dashGapColor ?? null}
			fallback={defaultGapColorFor(0)}
			onChange={(color) => updateConnectionCfg({ dashGapColor: color })}
		/>
	)
	return (
		<div className="flex flex-col gap-2">
			<Checkbox label="Fill dash gaps" checked={gapFillOn} onChange={setGapFill} />
			{gapColorRows}
		</div>
	)
}
