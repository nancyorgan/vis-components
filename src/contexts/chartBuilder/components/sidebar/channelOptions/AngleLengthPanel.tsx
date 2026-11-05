import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_ANGLE,
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_DONUT_HOLE_RADIUS,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_SEGMENT_THICKNESS,
	type AngleConfig,
	type LengthConfig,
} from "../../../lib/channelConfig"
import { MIN_LINE_THICKNESS } from "../../../lib/connectionThickness"
import { fieldLevels, thicknessByLevel } from "../../../lib/thicknessVaryBy"
import {
	isBarModeId,
	isComboModeId,
	isPieModeId,
} from "../../../lib/chartModes/families"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { angleConfigFromTheme, valueChanged } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import type { FieldType } from "../../../lib/types"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Segmented } from "../../../../../components/ui/Segmented"
import { SidebarJumpText, channelJump } from "../../../../../components/ui/SidebarJumpLink"
import { combine as c } from "../../../../../lib/cls"
import { TickFormatControl, ordinalSuffix } from "./AxisOptionsPanel"

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

	// A polar mode that draws its angle axis (radar — declared as
	// `canvas.polarAxes.angle`) owns the perimeter spokes + labels around
	// the dial, so when the chart resolves to one AND both r + angle are
	// mapped, surface the Spokes / Spoke Labels sections below the Angle
	// Extent section.
	const modeDef = useChartModeDef()
	const modeId = modeDef.id
	const isRadarMode = modeDef.canvas.polarAxes?.angle === true
	const showRadarAxisControls = isRadarMode && fieldMapped

	// Pie/Donut toggle lives in the Angle panel for the three pie modes
	// (the only modes PiePlot renders). The donut hole is a percentage of
	// the pie radius: 0 → solid pie, >0 → donut. The toggle's "Donut"
	// state is derived from that value rather than a separate boolean, so
	// there's a single source of truth (matches the Line/Area toggle's
	// non-redundant design).
	const isPieMode = isPieModeId(modeId)
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
		const extentChanged =
			valueChanged(cfg.minAngle, themeAngle.minAngle) ||
			valueChanged(cfg.maxAngle, themeAngle.maxAngle)
		const extent = (
			<AngleExtentControls
				cfg={cfg}
				themeAngle={themeAngle}
				updateCfg={updateCfg}
			/>
		)
		// Mark-rotation angle (scatter etc.): the extent range is the only
		// control, and a lone section needs no header — keep it flat.
		if (!isRadarMode && !isPieMode) {
			return <div className="vc-option-panel">{extent}</div>
		}
		// Polar modes (radar, pies) group the controls under collapsible
		// subsections so the panel opens as a compact list of headers.
		return (
			<div className="vc-option-panel">
				{isPieMode && (
					<PieDonutControls
						isDonut={isDonut}
						holeRadius={holeRadius}
						updateCfg={updateCfg}
					/>
				)}
				<CollapsibleSubsection title="Angle extent" changed={extentChanged}>
					{extent}
				</CollapsibleSubsection>
				{showRadarAxisControls && (
					<>
						<RadarSpokesSection
							cfg={cfg}
							themeAngle={themeAngle}
							updateCfg={updateCfg}
						/>
						<RadarSpokeLabelsSection
							cfg={cfg}
							themeAngle={themeAngle}
							updateCfg={updateCfg}
						/>
					</>
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

/** Min / Max sweep bounds (degrees). Shared by the flat mark-rotation layout
 *  and the polar modes' "Angle Extent" subsection so the rows are identical
 *  either way. */
const AngleExtentControls = ({
	cfg,
	themeAngle,
	updateCfg,
}: {
	cfg: AngleConfig
	themeAngle: AngleConfig
	updateCfg: (next: Partial<AngleConfig>) => void
}) => (
	<>
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
	</>
)

const PIE_DONUT_SEGMENTS = [
	{ key: "pie", label: "Pie" },
	{ key: "donut", label: "Donut" },
] as const

const LINE_CAP_SEGMENTS = [
	{ key: "round", label: "Round" },
	{ key: "square", label: "Square" },
] as const

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
	return (
		<>
			<div className="flex items-center gap-2 text-sm">
				<span className={`shrink-0 ${LABEL_COL}`}>Chart type</span>
				<Segmented
					ariaLabel="Chart type"
					value={isDonut ? "donut" : "pie"}
					segments={PIE_DONUT_SEGMENTS}
					onChange={(kind) =>
						updateCfg({
							donutHoleRadius: kind === "donut" ? DEFAULT_DONUT_HOLE_RADIUS : 0,
						})
					}
				/>
			</div>
			{isDonut && (
				<div className="flex items-center gap-2">
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
					{holeRadius !== DEFAULT_DONUT_HOLE_RADIUS && (
						<ResetLink
							onClick={() =>
								updateCfg({ donutHoleRadius: DEFAULT_DONUT_HOLE_RADIUS })
							}
							underline
						/>
					)}
				</div>
			)}
		</>
	)
}

/** Radar "Spokes" subsection — the number of spokes (quantitative /
 *  temporal angle only). Their line styling (color, thickness, opacity) is
 *  the R position menu's Spine section. Only mounted when the active mode
 *  resolves to radar AND a field is mapped to angle. */
const RadarSpokesSection = ({
	cfg,
	themeAngle,
	updateCfg,
}: {
	cfg: AngleConfig
	themeAngle: AngleConfig
	updateCfg: (next: Partial<AngleConfig>) => void
}) => {
	const defaultTickCount = themeAngle.tickCount ?? DEFAULT_ANGLE_CONFIG.tickCount ?? 6
	const tickCount = cfg.tickCount ?? defaultTickCount
	const changed = valueChanged(cfg.tickCount, themeAngle.tickCount)

	return (
		<CollapsibleSubsection title="Spokes" changed={changed}>
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
				{tickCount !== defaultTickCount && (
					<ResetLink
						onClick={() => updateCfg({ tickCount: defaultTickCount })}
						underline
					/>
				)}
			</div>
			<p className="vc-help">
				Style the spokes under{" "}
				<SidebarJumpText target={channelJump("r", "r:spine")}>R position → Spine</SidebarJumpText>.
			</p>
		</CollapsibleSubsection>
	)
}

/** Radar "Spoke Labels" subsection — the perimeter labels at each spoke:
 *  rotation, number / date format, label stride (every Nth spoke), and
 *  radial distance from the chart. */
const RadarSpokeLabelsSection = ({
	cfg,
	themeAngle,
	updateCfg,
}: {
	cfg: AngleConfig
	themeAngle: AngleConfig
	updateCfg: (next: Partial<AngleConfig>) => void
}) => {
	const defaultLabelAngle = themeAngle.tickLabelAngle ?? 0
	const tickLabelAngle = cfg.tickLabelAngle ?? defaultLabelAngle
	const defaultEvery = themeAngle.tickLabelEvery ?? 1
	const labelEvery = cfg.tickLabelEvery ?? defaultEvery
	const defaultDistance = themeAngle.tickLabelDistance ?? 0
	const labelDistance = cfg.tickLabelDistance ?? defaultDistance
	const formatChanged = valueChanged(cfg.customFormat, themeAngle.customFormat)
	const changed =
		valueChanged(cfg.tickLabelAngle, themeAngle.tickLabelAngle) ||
		formatChanged ||
		valueChanged(cfg.tickLabelEvery, themeAngle.tickLabelEvery) ||
		valueChanged(cfg.tickLabelDistance, themeAngle.tickLabelDistance)

	return (
		<CollapsibleSubsection title="Spoke labels" changed={changed}>
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
				{tickLabelAngle !== defaultLabelAngle && (
					<ResetLink
						onClick={() => updateCfg({ tickLabelAngle: defaultLabelAngle })}
						underline
					/>
				)}
			</div>
			<TickFormatControl
				value={cfg.customFormat ?? ""}
				changed={formatChanged}
				onChange={(customFormat) => updateCfg({ customFormat })}
			/>
			<div className="flex items-center gap-2 text-sm">
				<NumberInput
					label="Label every"
					labelClassName={LABEL_COL}
					value={labelEvery}
					min={1}
					max={36}
					step={1}
					clamp
					onChange={(tickLabelEvery) => updateCfg({ tickLabelEvery })}
					inputClassName="w-20"
				/>
				<span className="text-sm vc-muted">
					{labelEvery > 1 ? `${ordinalSuffix(labelEvery)} spoke` : "spoke"}
				</span>
				{labelEvery !== defaultEvery && (
					<ResetLink
						onClick={() => updateCfg({ tickLabelEvery: defaultEvery })}
						underline
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Distance"
					labelClassName={LABEL_COL}
					value={labelDistance}
					min={-200}
					max={200}
					step={1}
					onChange={(tickLabelDistance) => updateCfg({ tickLabelDistance })}
					inputClassName="w-20"
					suffix="px"
				/>
				{labelDistance !== defaultDistance && (
					<ResetLink
						onClick={() => updateCfg({ tickLabelDistance: defaultDistance })}
						underline
					/>
				)}
			</div>
		</CollapsibleSubsection>
	)
}

/** Bar charts' gap-between-bars knob, in PIXELS; bar width is whatever
 *  remains of each category slot, so one input controls both. Auto (null)
 *  is the proportional 15%-of-slot gap — not a fixed px value — so this is
 *  a clear-to-null input (`onClear`), mirroring the panel's default-length
 *  input below. */
const BarGapControl = ({
	barGapPx,
	onChange,
}: {
	barGapPx: number | null
	onChange: (next: number | null) => void
}) => (
	<>
		<div className="flex items-center gap-2">
			<NumberInput
				label="Bar gap"
				labelClassName={LABEL_COL}
				min={0}
				step={1}
				value={barGapPx}
				placeholder="Auto"
				onChange={(next) => onChange(Math.max(0, next))}
				onClear={() => onChange(null)}
				suffix="px"
			/>
			{barGapPx !== null && (
				<ResetLink
					onClick={() => onChange(null)}
					underline
				/>
			)}
		</div>
	</>
)

/** The two readings of `x + y + length` (`LengthConfig.render`). */
const DRAW_AS_SEGMENTS = [
	{ key: "segments", label: "Segments" },
	{ key: "bars", label: "Bars" },
] as const

/** Length → "Draw as": with BOTH positions and Length mapped the chart can
 *  be the line-segment scatter (default) or a bar + marks combo — Length as
 *  bars on the measure axis, the other position variable as marks on that
 *  same axis (a line when Connection is mapped). Shown only for that
 *  signature: plain bars and lone segments have one reading. */
const DrawAsControl = ({
	value,
	onChange,
}: {
	value: "segments" | "bars"
	onChange: (next: "segments" | "bars") => void
}) => (
	<>
		<div className="flex items-center gap-2 text-sm">
			<span
				className={c(
					"shrink-0",
					LABEL_COL,
					value === "bars" && "font-semibold !text-vc-section-header"
				)}
			>
				Draw as
			</span>
			<Segmented
				ariaLabel="Draw length as"
				value={value}
				segments={DRAW_AS_SEGMENTS}
				onChange={onChange}
			/>
		</div>
		{value === "segments" && (
			<p className="vc-help">
				Each point draws as a line segment of that length. Choose Bars for a
				bar chart with the other position variable as a line or points over
				it.
			</p>
		)}
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
	const setRender = (render: "segments" | "bars") =>
		setConfigs((prev) => ({
			...prev,
			length: {
				...(prev.length ?? DEFAULT_LENGTH_CONFIG),
				// Segments is the default: store it as absent so an untouched
				// chart stays byte-identical.
				render: render === "bars" ? "bars" : undefined,
			},
		}))

	// What length MEANS here is a declared mode trait (`canvas.lengthRole`),
	// branched on BEFORE the field check: a histogram is a bar mode with no
	// length field mapped, and used to fall through to the scatter-style
	// "default length" control — inert there (only scatter marks read it)
	// and captioned for line segments.
	const modeDef = useChartModeDef()
	const { lengthRole } = modeDef.canvas
	// Bar charts get the band-gap knob: pixels of each category slot left as
	// gap between bars (bar width is the remainder, so one value controls
	// both). Bars only — areas have no band scale to pad — and only with a
	// length field: a bar mode WITHOUT one is a histogram, whose bins abut
	// by design (BarPlot forces zero padding), so the knob would be inert.
	const showBarGap = isBarModeId(modeDef.id) && fieldMapped
	// "Draw as" applies to the one signature with two readings: both
	// positions + Length (no angle / r). Offered on the segment scatter that
	// signature renders by default, and on the combo it turns into.
	const comboSignature =
		fieldMapped &&
		!!encodings.x?.field &&
		!!encodings.y?.field &&
		!encodings.angle?.field &&
		!encodings.r?.field
	const showDrawAs =
		isComboModeId(modeDef.id) || (comboSignature && lengthRole === "mark")
	const drawAs = (
		<DrawAsControl
			value={cfg.render === "bars" ? "bars" : "segments"}
			onChange={setRender}
		/>
	)

	if (lengthRole === "none") {
		return (
			<div className="vc-option-panel">
				<div className="vc-help">This chart type doesn&apos;t draw length.</div>
			</div>
		)
	}

	if (lengthRole === "measure") {
		// A histogram (bar mode, no length field) offers neither control:
		// render nothing rather than an empty panel.
		if (!showDrawAs && !showBarGap) return null
		return (
			<div className="vc-option-panel">
				{showDrawAs && drawAs}
				{showBarGap && (
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
			</div>
		)
	}

	if (fieldMapped) {
		return (
			<div className="vc-option-panel">
				{showDrawAs && drawAs}
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
				<div className="text-sm vc-muted">
					Defaults: {DEFAULT_LENGTH_CONFIG.minLength}px –{" "}
					{DEFAULT_LENGTH_CONFIG.maxLength}px
				</div>
				<SegmentPropertiesSection />
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			<NumberInput
				label="Length"
				labelClassName={LABEL_COL}
				min={2}
				max={200}
				step={1}
				value={currentLength}
				placeholder="—"
				onChange={(defaultLength) =>
					setConfigs((prev) => ({ ...prev, defaultLength }))
				}
				onClear={() => setConfigs((prev) => ({ ...prev, defaultLength: null }))}
				suffix="px"
			/>
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
			{currentLength !== null && <SegmentPropertiesSection />}
		</div>
	)
}

/** Variable types the segment-thickness "Vary by" offers — discrete levels
 *  only; a quantitative column would list one row per distinct number. */
const SEGMENT_VARY_BY_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
	"categorical",
	"ordinal",
])

/** Length → "Segment properties": stroke styling for the line segments a
 *  scatter draws when Length is mapped (or a default length is set).
 *  Thickness mirrors Connection → Line properties: a single width, or a
 *  "Vary by" variable with one width per level. The dropdown position is
 *  the stored `segmentThicknessField` itself — no separate mode flag. */
const SegmentPropertiesSection = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()

	const length = configs.length ?? DEFAULT_LENGTH_CONFIG
	const thickness = length.segmentThickness ?? DEFAULT_SEGMENT_THICKNESS
	const lineCap = length.segmentLineCap ?? "round"
	const updateLength = (next: Partial<LengthConfig>) =>
		setConfigs((prev) => ({
			...prev,
			length: { ...(prev.length ?? DEFAULT_LENGTH_CONFIG), ...next },
		}))

	const typeOf = (name: string): FieldType =>
		fieldOverrides[name] ??
		dataset?.fields.find((f) => f.name === name)?.inferredType ??
		"categorical"
	const varyByFields = (dataset?.fields ?? [])
		.map((f) => f.name)
		.filter((name) => SEGMENT_VARY_BY_TYPES.has(typeOf(name)))
	// A stored field that's gone from the data set renders as single level
	// (the resolver finds no matching cells), so the dropdown reads that way.
	const storedField = length.segmentThicknessField ?? null
	const varyField =
		storedField && dataset?.fields.some((f) => f.name === storedField)
			? storedField
			: null
	// Distinct levels of a field, in the Fields panel's pinned order —
	// parsed through the effective type so keys match the drawn rows.
	const levelsOf = (name: string): string[] =>
		dataset ? fieldLevels(dataset.rows, name, typeOf(name), levelOrders[name]) : []
	const levels = varyField ? levelsOf(varyField) : []

	const ch = {
		thickness: thickness !== DEFAULT_SEGMENT_THICKNESS || !!varyField,
		lineCap: lineCap !== "round",
	}

	// Picking a variable SEEDS every level at the single width (renders
	// identically until a row is edited); "— none —" clears both.
	const setVaryBy = (next: string) => {
		if (next === "") {
			updateLength({ segmentThicknessField: null, segmentThicknessByValue: {} })
			return
		}
		updateLength({ segmentThicknessField: next, segmentThicknessByValue: thicknessByLevel(levelsOf(next), thickness) })
	}
	const setThicknessFor = (value: string, n: number) => {
		if (n < 0) return
		updateLength({
			segmentThicknessByValue: { ...(length.segmentThicknessByValue ?? {}), [value]: n },
		})
	}

	return (
		<CollapsibleSubsection
			title="Segment properties"
			changed={ch.thickness || ch.lineCap}
		>
			<div className="flex flex-col gap-2">
				<SelectInput
					label="Vary by"
					labelClassName={LABEL_COL}
					changed={!!varyField}
					value={varyField ?? ""}
					options={[
						{ value: "", label: "— none —" },
						...varyByFields.map((name) => ({ value: name, label: name })),
					]}
					onChange={setVaryBy}
					selectClassName="flex-1"
				/>
				{varyField ? (
					<div className="flex flex-col gap-1.5">
						{levels.map((v) => {
							const rowValue = length.segmentThicknessByValue?.[v] ?? thickness
							return (
								<div key={v} className="flex items-center gap-2 text-sm">
									<span className="w-24 shrink-0 truncate vc-text" title={v}>
										{v}
									</span>
									<NumberInput
										label={`Segment thickness for ${v}`}
										labelClassName="sr-only"
										value={rowValue}
										min={MIN_LINE_THICKNESS}
										step={0.5}
										onChange={(n) => setThicknessFor(v, n)}
										inputClassName="w-16"
										suffix="px"
									/>
									{rowValue !== thickness && (
										// Back to the single width WITHOUT deleting the key.
										<ResetLink onClick={() => setThicknessFor(v, thickness)} />
									)}
								</div>
							)
						})}
						{levels.length === 0 && (
							<p className="vc-help">No {varyField} values in the data yet.</p>
						)}
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							changed={ch.thickness}
							value={thickness}
							min={MIN_LINE_THICKNESS}
							step={0.5}
							onChange={(n) => {
								// Negative typed input is ignored; 0 hides the segments.
								if (n >= 0) updateLength({ segmentThickness: n })
							}}
							inputClassName="w-16"
							suffix="px"
						/>
						{thickness !== DEFAULT_SEGMENT_THICKNESS && (
							<ResetLink
								onClick={() =>
									updateLength({ segmentThickness: DEFAULT_SEGMENT_THICKNESS })
								}
							/>
						)}
					</div>
				)}
				<div className="flex items-center gap-2 text-sm">
					<span
						className={c(
							"shrink-0",
							LABEL_COL,
							ch.lineCap && "font-semibold !text-vc-section-header"
						)}
					>
						Line cap
					</span>
					<Segmented
						ariaLabel="Line cap"
						value={lineCap}
						segments={LINE_CAP_SEGMENTS}
						onChange={(segmentLineCap) => updateLength({ segmentLineCap })}
					/>
				</div>
			</div>
		</CollapsibleSubsection>
	)
}
