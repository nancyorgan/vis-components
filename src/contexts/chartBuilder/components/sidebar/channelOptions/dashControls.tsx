import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_DASH_RANGE,
	DEFAULT_REGRESSION_CONFIG,
	type DashRangeConfig,
	type LineDashPattern,
	type RegressionConfig,
} from "../../../lib/channelConfig"
import { DASH_CYCLE } from "../../../lib/dashPatterns"
import {
	axisConfigFromTheme,
	connectionConfigFromTheme,
	valueChanged,
} from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "../../../store/atoms"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"

import { LineDashGlyph, swatchChipClass } from "./glyphShared"
import { Input } from "../../../../../components/ui/Input"

/** The None / dash swatches / Custom button row every single-choice dash
 *  picker shares (the Pattern panel's default + per-category Line dash rows,
 *  regression line, annotation borders + lines). The states are mutually
 *  exclusive: picking a swatch clears any custom dasharray, and Custom opens
 *  the dasharray text box, which stays open while empty via the "custom
 *  open" flag — local state by default, or the caller's via `customOpen` +
 *  `onCustomOpenChange` when a reset link outside the row has to close it.
 *  `pattern: "solid"` doubles as None; a non-null `customDasharray` wins
 *  over `pattern` at render time. `showBlank` adds the range-mode "Blank"
 *  swatch (`pattern: "blank"`). `ariaContext` names the owning control in
 *  the buttons' aria-labels (e.g. "regression line" → "No dash for
 *  regression line" / "Regression line dash dotted"). */
export const DashStylePicker = ({
	pattern,
	customDasharray,
	onChange,
	ariaContext,
	customOpen: customOpenProp,
	onCustomOpenChange,
	showBlank = false,
}: {
	pattern: LineDashPattern
	customDasharray: string | null
	onChange: (next: {
		pattern: LineDashPattern
		customDasharray: string | null
	}) => void
	ariaContext: string
	/** Controlled "Custom box open" flag (see above). Omit for local state. */
	customOpen?: boolean
	onCustomOpenChange?: (open: boolean) => void
	/** Offers "Blank" after the dash swatches. */
	showBlank?: boolean
}) => {
	const [localCustomOpen, setLocalCustomOpen] = useState(false)
	const customOpen = customOpenProp ?? localCustomOpen
	const setCustomOpen = (open: boolean) => {
		setLocalCustomOpen(open)
		onCustomOpenChange?.(open)
	}
	const customActive = customOpen || !!customDasharray
	const isNone = pattern === "solid" && !customActive
	const isBlank = pattern === "blank" && !customActive
	const activeIdx = DASH_CYCLE.indexOf(pattern)
	const capped = ariaContext.charAt(0).toUpperCase() + ariaContext.slice(1)
	const pick = (style: LineDashPattern) => {
		setCustomOpen(false)
		onChange({ pattern: style, customDasharray: null })
	}
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap gap-1">
				<button
					type="button"
					onClick={() => pick("solid")}
					aria-pressed={isNone}
					aria-label={`No dash for ${ariaContext}`}
					className={swatchChipClass(isNone, "px-2 text-sm")}
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
							aria-label={`${capped} dash ${style}`}
							className={swatchChipClass(selected, "w-7")}
						>
							<LineDashGlyph idx={idx} selected={selected} />
						</button>
					)
				})}
				{showBlank && (
					<button
						type="button"
						onClick={() => pick("blank")}
						aria-pressed={isBlank}
						aria-label={`${capped} dash blank`}
						className={swatchChipClass(isBlank, "px-2 text-sm")}
					>
						Blank
					</button>
				)}
				<button
					type="button"
					onClick={() => setCustomOpen(true)}
					aria-pressed={customActive}
					aria-label={`Custom dash for ${ariaContext}`}
					className={swatchChipClass(customActive, "px-2 text-sm")}
				>
					Custom
				</button>
			</div>
			{customActive && (
				<CustomDashInput
					value={customDasharray ?? ""}
					onChange={(raw) =>
						onChange({
							pattern,
							customDasharray: raw === "" ? null : raw,
						})
					}
				/>
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
export const RegressionDashSubsection = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Live theme (settings edits appear immediately) — same lookup as the
	// Color panel's regression width control.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
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
	const changed =
		valueChanged(reg.lineStyle, base.lineStyle) ||
		valueChanged(reg.customDasharray, base.customDasharray) ||
		valueChanged(
			{ ...DEFAULT_DASH_RANGE, ...reg.dashRange },
			{ ...DEFAULT_DASH_RANGE, ...base.dashRange }
		)
	return (
		<CollapsibleSubsection title="Regression line" changed={changed}>
			<div className="flex flex-col gap-1 text-sm">
				<DashStylePicker
					pattern={reg.lineStyle}
					customDasharray={reg.customDasharray ?? null}
					onChange={({ pattern, customDasharray }) =>
						update({ lineStyle: pattern, customDasharray })
					}
					ariaContext="regression line"
				/>
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
	<div className="vc-divider-group">
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				checked={range.enabled}
				onChange={(e) => onChange({ enabled: e.target.checked })}
				className="h-3 w-3"
			/>
			<span className="vc-muted">
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
						<Input
							type="text"
							value={String(range[key] ?? "")}
							onChange={(e) =>
								onChange({
									[key]: e.target.value === "" ? null : e.target.value,
								})
							}
							aria-label={`Pattern range ${label.toLowerCase()}`}
							className="w-24 font-mono"
						/>
					</div>
				))}
			</>
		)}
	</div>
)

/** DashRangeRows wired to `configs.connection.dashRange` — the window every
 *  connection polyline and area line-mode edge shares. Theme-seeded merge on
 *  write so untouched connection fields keep matching the changed-dot
 *  baseline (mirrors ConnectionOptionsPanel's updateCfg). */
export const ConnectionDashRangeRows = () => {
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
				// A "Blank" dash pick only exists inside the range window (its
				// swatch hides with the rows) — turning the range off retires
				// it back to solid so no invisible pick lingers in the config.
				...(next.enabled === false &&
				prev.connection?.defaultDashPattern === "blank"
					? { defaultDashPattern: "solid" as const }
					: {}),
			},
		}))
	return <DashRangeRows range={range} onChange={onChange} />
}

/** Per-category custom-dasharray text input. Empty string clears the
 *  override (caller falls back to the built-in DASH_CYCLE selection).
 *  The placeholder `"2,2"` prompts the user with the expected format;
 *  see `sanitizeCustomDasharray` in `lib/dashPatterns.ts` for parsing. */
export const CustomDashInput = ({
	value,
	onChange,
}: {
	value: string
	onChange: (raw: string) => void
}) => (
	<Input
		type="text"
		value={value}
		placeholder="2,2"
		// eslint-disable-next-line jsx-a11y/no-autofocus -- box only mounts on an explicit "Custom" click, so focusing it is the expected next action
		autoFocus
		aria-label="Custom dash pattern"
		onChange={(e) => onChange(e.target.value)}
		className="w-24 font-mono"
	/>
)

