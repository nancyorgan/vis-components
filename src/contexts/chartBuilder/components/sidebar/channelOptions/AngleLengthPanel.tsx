import { useAtom, useAtomValue } from "jotai"
import {
	AUTO_BAR_GAP_FRACTION,
	DEFAULT_ANGLE,
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_DONUT_HOLE_RADIUS,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_SPINE_CONFIG,
	type AngleConfig,
} from "../../../lib/channelConfig"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { angleConfigFromTheme } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import type { Theme } from "../../../lib/types"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SpineControls } from "./AxisOptionsPanel"

// ---------------------------------------------------------------------------
// Angle
// ---------------------------------------------------------------------------
export const AngleOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldMapped = !!encodings.angle?.field

	const currentAngle = configs.defaultAngle ?? DEFAULT_ANGLE
	// The theme's angle defaults — used both as the live fallback and as the
	// "reset" target / "is this default?" reference, so the panel's notion of
	// default matches the "changed" dot's baseline (which is theme-derived).
	const themeAngle = angleConfigFromTheme(theme)
	const cfg = configs.angle ?? themeAngle

	// Radar mode owns the perimeter spokes + tick labels around the dial,
	// so when the chart resolves to radar AND both r + angle are mapped,
	// surface axis-style controls (tick count, spine color/thickness,
	// label angle, tick marks) below the data-range min/max boxes.
	const modeId = useChartModeDef().id
	const isRadarMode = modeId === "radar"
	const showRadarAxisControls = isRadarMode && fieldMapped

	// Pie/Donut toggle lives in the Angle panel for the three pie modes
	// (the only modes PiePlot renders). The donut hole is a percentage of
	// the pie radius: 0 → solid pie, >0 → donut. The toggle's "Donut"
	// state is derived from that value rather than a separate boolean, so
	// there's a single source of truth (matches the Line/Area toggle's
	// non-redundant design).
	const isPieMode =
		modeId === "pies" || modeId === "pies-x" || modeId === "pies-y"
	const holeRadius = cfg.donutHoleRadius ?? 0
	const isDonut = holeRadius > 0

	const updateCfg = (next: Partial<AngleConfig>) => {
		// Seed from the THEME's full angle config (which carries the radar-axis
		// fields) so the stored slice matches the "changed" dot's baseline —
		// otherwise resetting min/max can't clear the dot (the extra default
		// fields the panel writes aren't in the baseline).
		setConfigs((prev) => ({
			...prev,
			angle: { ...angleConfigFromTheme(theme), ...prev.angle, ...next },
		}))
	}

	if (fieldMapped) {
		return (
			<div className="vc-option-panel">
				{isPieMode && (
					<PieDonutControls
						isDonut={isDonut}
						holeRadius={holeRadius}
						updateCfg={updateCfg}
					/>
				)}
				<div className="flex items-center gap-2">
					<NumberInput
						label="Min"
						labelClassName={LABEL_COL}
						value={cfg.minAngle}
						min={-360}
						max={360}
						step={5}
						onChange={(minAngle) => updateCfg({ minAngle })}
						inputClassName="w-20"
						suffix="°"
					/>
					{cfg.minAngle !== themeAngle.minAngle && (
						<ResetLink
							onClick={() => updateCfg({ minAngle: themeAngle.minAngle })}
							underline
						/>
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Max"
						labelClassName={LABEL_COL}
						value={cfg.maxAngle}
						min={-360}
						max={360}
						step={5}
						onChange={(maxAngle) => updateCfg({ maxAngle })}
						inputClassName="w-20"
						suffix="°"
					/>
					{cfg.maxAngle !== themeAngle.maxAngle && (
						<ResetLink
							onClick={() => updateCfg({ maxAngle: themeAngle.maxAngle })}
							underline
						/>
					)}
				</div>
				<div className="vc-help">
					{isRadarMode
						? "Sweep around the dial. Defaults: 0° → 360° (full circle starting at 12 o'clock)."
						: isPieMode
							? "Angular sweep of the pie. Defaults to a full circle; narrow the range (e.g. -90° – 90°) to make a gauge."
							: `Defaults: ${themeAngle.minAngle}° – ${themeAngle.maxAngle}°`}
				</div>
				{showRadarAxisControls && (
					<RadarAxisControls
						cfg={cfg}
						updateCfg={updateCfg}
						theme={theme}
					/>
				)}
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			<div className="flex items-center gap-2">
				<NumberInput
					label="Angle"
					labelClassName={LABEL_COL}
					value={currentAngle}
					min={-360}
					max={360}
					step={5}
					onChange={(n) =>
						setConfigs((prev) => ({
							...prev,
							defaultAngle: n,
						}))
					}
					inputClassName="w-20"
					suffix="°"
				/>
				{currentAngle !== 0 && (
					<ResetLink
						onClick={() =>
							setConfigs((prev) => ({
								...prev,
								defaultAngle: 0,
							}))
						}
					/>
				)}
			</div>
		</div>
	)
}

/** Pie ↔ Donut toggle plus the donut hole-radius input, styled to match
 *  the Line/Area "Chart type" toggle in ConnectionOptionsPanel. "Donut"
 *  sets the hole to a sensible default; "Pie" zeroes it. The hole-radius
 *  input only shows in donut mode and is a percentage of the pie radius. */
const PieDonutControls = ({
	isDonut,
	holeRadius,
	updateCfg,
}: {
	isDonut: boolean
	holeRadius: number
	updateCfg: (next: Partial<AngleConfig>) => void
}) => {
	const buttonClass = (active: boolean) =>
		active
			? "bg-brand-500 px-2 py-1 text-sm text-white"
			: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"

	return (
		<>
			<div className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Chart type</span>
				<div
					role="group"
					aria-label="Chart type"
					className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
				>
					<button
						type="button"
						onClick={() => updateCfg({ donutHoleRadius: 0 })}
						className={buttonClass(!isDonut)}
						aria-pressed={!isDonut}
					>
						Pie
					</button>
					<button
						type="button"
						onClick={() =>
							updateCfg({ donutHoleRadius: DEFAULT_DONUT_HOLE_RADIUS })
						}
						className={buttonClass(isDonut)}
						aria-pressed={isDonut}
					>
						Donut
					</button>
				</div>
			</div>
			{isDonut && (
				<NumberInput
					label="Hole radius"
					labelClassName={LABEL_COL}
					value={holeRadius}
					min={5}
					max={90}
					step={5}
					clamp
					onChange={(n) => updateCfg({ donutHoleRadius: n })}
					inputClassName="w-16"
					suffix="%"
				/>
			)}
		</>
	)
}

/** Radar-mode axis chrome controls — number of spokes (tick count),
 *  perimeter label rotation, spoke (spine) color/thickness, and the
 *  tick-mark notches at each spoke. Only mounted when the active mode
 *  resolves to radar AND a field is mapped to angle. */
const RadarAxisControls = ({
	cfg,
	updateCfg,
	theme,
}: {
	cfg: AngleConfig
	updateCfg: (next: Partial<AngleConfig>) => void
	theme: Theme
}) => {
	const tickCount = cfg.tickCount ?? DEFAULT_ANGLE_CONFIG.tickCount ?? 6
	const tickLabelAngle =
		cfg.tickLabelAngle ?? DEFAULT_ANGLE_CONFIG.tickLabelAngle ?? 0

	return (
		<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
			<div className="text-sm text-stone-700 dark:text-stone-300">
				Spokes
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Spokes"
					labelClassName={LABEL_COL}
					value={tickCount}
					min={2}
					max={36}
					step={1}
					clamp
					onChange={(n) => updateCfg({ tickCount: n })}
					inputClassName="w-16"
				/>
				{tickCount !== (DEFAULT_ANGLE_CONFIG.tickCount ?? 6) && (
					<ResetLink
						onClick={() =>
							updateCfg({ tickCount: DEFAULT_ANGLE_CONFIG.tickCount })
						}
						underline
					/>
				)}
			</div>
			<p className="vc-help">
				Quantitative / temporal angle only. Categorical angle always shows one
				spoke per category.
			</p>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Label angle"
					labelClassName={LABEL_COL}
					value={tickLabelAngle}
					min={-90}
					max={90}
					step={1}
					clamp
					onChange={(n) => updateCfg({ tickLabelAngle: n })}
					inputClassName="w-20"
					suffix="°"
				/>
				{tickLabelAngle !== (DEFAULT_ANGLE_CONFIG.tickLabelAngle ?? 0) && (
					<ResetLink
						onClick={() =>
							updateCfg({ tickLabelAngle: DEFAULT_ANGLE_CONFIG.tickLabelAngle })
						}
						underline
					/>
				)}
			</div>
			{/* Spoke styling reuses the x/y axis Spine control (same labels, same
			    ranges). The color row is dropped — spoke color lives in the Color
			    menu's "Radar Spine" slot — and the "changed" dots stay off. */}
			<span className="text-sm text-stone-600 dark:text-stone-400">Spokes</span>
			<p className="vc-help">
				Set spoke color under the <strong>Color</strong> menu →{" "}
				<strong>Radar Spine</strong>.
			</p>
			<SpineControls
				spine={cfg.spine ?? DEFAULT_SPINE_CONFIG}
				onChange={(s) => updateCfg({ spine: s })}
				theme={theme}
				hideColorRow
				showChanged={false}
			/>
		</div>
	)
}

/** Bar charts' gap-between-bars knob, in PIXELS; bar width is whatever
 *  remains of each category slot, so one input controls both. Auto (null)
 *  is the proportional 15%-of-slot gap — not a fixed px value — so this is
 *  a clear-to-null raw input (NumberInput can't emit null), mirroring the
 *  panel's default-length input below. */
const BarGapControl = ({
	barGapPx,
	onChange,
}: {
	barGapPx: number | null
	onChange: (next: number | null) => void
}) => (
	<>
		<div className="flex items-center gap-2">
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Bar gap</span>
				<input
					type="number"
					min={0}
					step={1}
					value={barGapPx ?? ""}
					placeholder="auto"
					onChange={(e) =>
						onChange(
							e.target.value === ""
								? null
								: Math.max(0, Number(e.target.value))
						)
					}
					className="w-20 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
				/>
				<span className="text-sm text-stone-600">px</span>
			</label>
			{barGapPx !== null && (
				<ResetLink
					onClick={() => onChange(null)}
					underline
				/>
			)}
		</div>
		<p className="vc-help">
			Gap between bars in pixels — the bars split what&apos;s left, so this
			sets bar width and gap together. Clear for the automatic gap (
			{AUTO_BAR_GAP_FRACTION * 100}% of each category slot).
		</p>
	</>
)

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------
export const LengthOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const fieldMapped = !!encodings.length?.field

	const currentLength = configs.defaultLength ?? null
	const cfg = configs.length ?? DEFAULT_LENGTH_CONFIG

	// In bar-family (and geo) modes the mapped variable IS the mark length —
	// it goes through the position scale, not the px min/max range — so the
	// range inputs are inert. Same per-mode flag the legend uses to suppress
	// the length ramp.
	const modeDef = useChartModeDef()
	const rangeInert = modeDef.legend.hideLengthInThisMode
	// Bar charts get the band-gap knob instead: percent of each category slot
	// left as gap between bars (bar width is the remainder, so one value
	// controls both). Bars only — the other range-inert modes (areas, geo)
	// have no band scale to pad.
	const isBarMode = modeDef.id === "bars-x" || modeDef.id === "bars-y"

	if (fieldMapped && rangeInert) {
		return (
			<div className="vc-option-panel">
				{isBarMode && (
					<BarGapControl
						barGapPx={configs.length?.barGapPx ?? null}
						onChange={(barGapPx) =>
							setConfigs((prev) => ({
								...prev,
								length: {
									...(prev.length ?? DEFAULT_LENGTH_CONFIG),
									barGapPx,
								},
							}))
						}
					/>
				)}
				<div className="vc-help">
					In this chart type, length comes straight from the mapped variable
					via the axis scale — there is no separate length range to set.
				</div>
			</div>
		)
	}

	if (fieldMapped) {
		return (
			<div className="vc-option-panel">
				<div className="flex items-center gap-2">
					<NumberInput
						label="Min"
						labelClassName={LABEL_COL}
						value={cfg.minLength}
						min={1}
						max={200}
						step={1}
						onChange={(n) =>
							setConfigs((prev) => ({
								...prev,
								length: {
									...(prev.length ?? DEFAULT_LENGTH_CONFIG),
									minLength: n,
								},
							}))
						}
						inputClassName="w-20"
						suffix="px"
					/>
					{cfg.minLength !== DEFAULT_LENGTH_CONFIG.minLength && (
						<ResetLink
							onClick={() =>
								setConfigs((prev) => ({
									...prev,
									length: {
										...(prev.length ?? DEFAULT_LENGTH_CONFIG),
										minLength: DEFAULT_LENGTH_CONFIG.minLength,
									},
								}))
							}
							underline
						/>
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Max"
						labelClassName={LABEL_COL}
						value={cfg.maxLength}
						min={1}
						max={200}
						step={1}
						onChange={(n) =>
							setConfigs((prev) => ({
								...prev,
								length: {
									...(prev.length ?? DEFAULT_LENGTH_CONFIG),
									maxLength: n,
								},
							}))
						}
						inputClassName="w-20"
						suffix="px"
					/>
					{cfg.maxLength !== DEFAULT_LENGTH_CONFIG.maxLength && (
						<ResetLink
							onClick={() =>
								setConfigs((prev) => ({
									...prev,
									length: {
										...(prev.length ?? DEFAULT_LENGTH_CONFIG),
										maxLength: DEFAULT_LENGTH_CONFIG.maxLength,
									},
								}))
							}
							underline
						/>
					)}
				</div>
				<div className="text-sm text-stone-600">
					Defaults: {DEFAULT_LENGTH_CONFIG.minLength}px –{" "}
					{DEFAULT_LENGTH_CONFIG.maxLength}px
				</div>
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Length</span>
				<input
					type="number"
					min={2}
					max={200}
					step={1}
					value={currentLength ?? ""}
					placeholder="—"
					onChange={(e) =>
						setConfigs((prev) => ({
							...prev,
							defaultLength:
								e.target.value === "" ? null : Number(e.target.value),
						}))
					}
					className="w-20 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
				<span className="text-sm text-stone-600">px</span>
			</label>
			<div className="vc-help">
				Set a length to render all marks as line segments. Clear to use shapes.
			</div>
			<ResetLink
				onClick={() =>
					setConfigs((prev) => ({
						...prev,
						defaultLength: null,
					}))
				}
				underline
				className="self-start"
			/>
		</div>
	)
}
