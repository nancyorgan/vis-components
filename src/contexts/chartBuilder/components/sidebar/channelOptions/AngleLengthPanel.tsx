import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_ANGLE,
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_DONUT_HOLE_RADIUS,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_SPINE_CONFIG,
	type AngleConfig,
	type SpineConfig,
} from "../../../lib/channelConfig"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { angleConfigFromTheme } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	themeAtom,
} from "../../../store/atoms"
import type { Theme } from "../../../lib/types"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"

// ---------------------------------------------------------------------------
// Angle
// ---------------------------------------------------------------------------
export const AngleOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useAtomValue(themeAtom)
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
						<button
							type="button"
							onClick={() => updateCfg({ minAngle: themeAngle.minAngle })}
							className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
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
						<button
							type="button"
							onClick={() => updateCfg({ maxAngle: themeAngle.maxAngle })}
							className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
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
					<button
						type="button"
						onClick={() =>
							setConfigs((prev) => ({
								...prev,
								defaultAngle: 0,
							}))
						}
						className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
					>
						reset
					</button>
				)}
			</div>
			<div className="vc-help">
				Rotates shapes (e.g. triangles) or line segments.
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
					<button
						type="button"
						onClick={() =>
							updateCfg({ tickCount: DEFAULT_ANGLE_CONFIG.tickCount })
						}
						className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
					>
						reset
					</button>
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
					<button
						type="button"
						onClick={() =>
							updateCfg({ tickLabelAngle: DEFAULT_ANGLE_CONFIG.tickLabelAngle })
						}
						className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
					>
						reset
					</button>
				)}
			</div>
			<SpineControls
				spine={cfg.spine ?? DEFAULT_SPINE_CONFIG}
				onChange={(s) => updateCfg({ spine: s })}
				theme={theme}
			/>
		</div>
	)
}

/** Spoke color + thickness. Mirrors `AxisOptionsPanel`'s SpineControls so
 *  radar's spoke styling reads like x/y axis styling — same labels,
 *  same number ranges. */
const SpineControls = ({
	spine,
	onChange,
	theme,
}: {
	spine: SpineConfig
	onChange: (s: SpineConfig) => void
	theme: Theme
}) => {
	const set = (next: Partial<SpineConfig>) => onChange({ ...spine, ...next })
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm text-stone-600 dark:text-stone-400">Spokes</span>
			<p className="vc-help">
				Set spoke color under the <strong>Color</strong> menu →{" "}
				<strong>Radar Spine</strong>.
			</p>
			<NumberInput
				label="Thickness"
				labelClassName={LABEL_COL}
				value={spine.thickness}
				min={0}
				max={5}
				step={0.5}
				onChange={(thickness) => set({ thickness })}
				inputClassName="w-16"
				suffix="px"
			/>
			<button
				type="button"
				onClick={() =>
					onChange({
						color: theme.spineColor || DEFAULT_SPINE_CONFIG.color,
						thickness: theme.spineThickness || DEFAULT_SPINE_CONFIG.thickness,
					})
				}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------
export const LengthOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const fieldMapped = !!encodings.length?.field

	const currentLength = configs.defaultLength ?? null
	const cfg = configs.length ?? DEFAULT_LENGTH_CONFIG

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
						<button
							type="button"
							onClick={() =>
								setConfigs((prev) => ({
									...prev,
									length: {
										...(prev.length ?? DEFAULT_LENGTH_CONFIG),
										minLength: DEFAULT_LENGTH_CONFIG.minLength,
									},
								}))
							}
							className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
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
						<button
							type="button"
							onClick={() =>
								setConfigs((prev) => ({
									...prev,
									length: {
										...(prev.length ?? DEFAULT_LENGTH_CONFIG),
										maxLength: DEFAULT_LENGTH_CONFIG.maxLength,
									},
								}))
							}
							className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
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
			<button
				type="button"
				onClick={() =>
					setConfigs((prev) => ({
						...prev,
						defaultLength: null,
					}))
				}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>
		</div>
	)
}
