import { useId } from "react"
import { useAtom, useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL, LabelSpacer } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Toggle } from "../../../../components/ui/Toggle"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
	type CaptionUnit,
} from "../../lib/captionConfig"
import { FONT_FAMILY_OPTIONS } from "../../lib/labelsConfig"
import { AlignmentControl } from "./LabelsPanel"
import {
	currentCaptionConfigAtom,
	currentRenderedCaptionBoxAtom,
} from "../../store/atoms"


/** Small inline "reset" link, rendered only when a control differs from its
 *  default. Matches the LabelsPanel / OpacityOptionsPanel idiom. */
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

/** SelectInput is generic over a string union; font weights are numeric, so
 *  we stringify at the boundary and convert back in onChange. */
const WEIGHT_OPTIONS = [
	{ value: "300", label: "Light" },
	{ value: "400", label: "Regular" },
	{ value: "500", label: "Medium" },
	{ value: "600", label: "Semibold" },
	{ value: "700", label: "Bold" },
] as const
type WeightOptionValue = (typeof WEIGHT_OPTIONS)[number]["value"]

const UNIT_SELECT_CLASS =
	"rounded-sm border border-stone-300 bg-white px-1 py-1 text-sm text-stone-700 outline-none hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"

/** A NumberInput with a trailing px/% unit selector — used for the position
 *  offsets, which sensibly start stepping from 0. */
const OffsetField = ({
	label,
	value,
	unit,
	onValue,
	onUnit,
}: {
	label: string
	value: number
	unit: CaptionUnit
	onValue: (v: number) => void
	onUnit: (u: CaptionUnit) => void
}) => (
	<NumberInput
		label={label}
		labelClassName={LABEL_COL}
		value={value}
		onChange={onValue}
		step={1}
		suffix={
			<select
				aria-label={`${label} unit`}
				value={unit}
				onChange={(e) => onUnit(e.target.value as CaptionUnit)}
				className={UNIT_SELECT_CLASS}
			>
				<option value="px">px</option>
				<option value="%">%</option>
			</select>
		}
	/>
)

/** Sidebar panel for the Caption subsystem. Drives `CaptionConfig` — a single
 *  free-floating text box rendered inside the plot SVG. The figure reserves a
 *  band at the bottom and shrinks to fit the caption (it never pushes content
 *  past the viewport). Position offsets nudge the box from its default
 *  (centered, pinned to the bottom of the canvas); width/height each carry a
 *  px/% unit and step from the current rendered size. */
export const CaptionPanel = () => {
	const [cfg, setCfg] = useAtom(currentCaptionConfigAtom)
	const renderedBox = useAtomValue(currentRenderedCaptionBoxAtom)
	// Id base for the Width / Height inputs so their visible labels associate
	// via htmlFor (the inputs stay raw — blank means "auto", which the shared
	// NumberInput can't express).
	const dimIdBase = useId()
	const merged: CaptionConfig = { ...DEFAULT_CAPTION_CONFIG, ...cfg }

	const update = (next: Partial<CaptionConfig>) => setCfg({ ...merged, ...next })

	// The size the corresponding input should START stepping from. A stored
	// value wins; otherwise we fall back to the current rendered box size
	// (converted to percent when that unit is selected) so the first arrow
	// press nudges from what's on screen rather than from 0/1.
	const resolveDimStart = (dim: "width" | "height", unit: CaptionUnit): number => {
		const stored = dim === "width" ? merged.width : merged.height
		if (stored > 0) return stored
		if (!renderedBox) return unit === "%" ? 100 : dim === "width" ? 400 : 60
		const px = dim === "width" ? renderedBox.widthPx : renderedBox.heightPx
		const basis =
			dim === "width" ? renderedBox.canvasWidth : renderedBox.canvasHeight
		if (unit === "%") return basis > 0 ? Math.round((px / basis) * 100) : 100
		return Math.round(px)
	}

	// Convert a concrete stored value between px and % using the canvas basis,
	// so toggling the unit keeps the box roughly the same size instead of
	// reinterpreting "400" as "400%".
	const convertDim = (
		dim: "width" | "height",
		value: number,
		from: CaptionUnit,
		to: CaptionUnit
	): number => {
		if (value <= 0 || from === to || !renderedBox) return value
		const basis =
			dim === "width" ? renderedBox.canvasWidth : renderedBox.canvasHeight
		if (basis <= 0) return value
		const px = from === "%" ? (value / 100) * basis : value
		return to === "%" ? Math.round((px / basis) * 100) : Math.round(px)
	}

	const renderDimField = (dim: "width" | "height", label: string) => {
		const value = dim === "width" ? merged.width : merged.height
		const unit = dim === "width" ? merged.widthUnit : merged.heightUnit
		const valueKey = dim
		const unitKey = dim === "width" ? "widthUnit" : "heightUnit"
		const setValue = (v: number) =>
			update({ [valueKey]: v } as Partial<CaptionConfig>)
		const step = (dir: 1 | -1) => {
			const start = value > 0 ? value : resolveDimStart(dim, unit)
			setValue(Math.max(0, start + dir))
		}
		return (
			<div className="flex items-center gap-2 text-sm">
				<label htmlFor={`${dimIdBase}-${dim}`} className={LABEL_COL}>
					{label}
				</label>
				<input
					id={`${dimIdBase}-${dim}`}
					type="number"
					min={0}
					step={1}
					value={value > 0 ? value : ""}
					placeholder={
						renderedBox ? String(resolveDimStart(dim, unit)) : "auto"
					}
					// Seed the field with the current rendered size on focus so the
					// native spinner / arrow keys step from it rather than from 0.
					onFocus={() => {
						if (value <= 0) setValue(resolveDimStart(dim, unit))
					}}
					onKeyDown={(e) => {
						if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
						e.preventDefault()
						step(e.key === "ArrowUp" ? 1 : -1)
					}}
					onChange={(e) => {
						const raw = e.target.value.trim()
						if (raw === "") {
							setValue(0)
							return
						}
						const n = Number(raw)
						if (Number.isFinite(n) && n >= 0) setValue(n)
					}}
					className="w-20 rounded-sm border border-stone-300 bg-white px-1.5 py-1 text-sm text-stone-900 outline-none hover:border-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
				/>
				<select
					aria-label={`${label} unit`}
					value={unit}
					onChange={(e) => {
						const nextUnit = e.target.value as CaptionUnit
						update({
							[unitKey]: nextUnit,
							[valueKey]: convertDim(dim, value, unit, nextUnit),
						} as Partial<CaptionConfig>)
					}}
					className={UNIT_SELECT_CLASS}
				>
					<option value="px">px</option>
					<option value="%">%</option>
				</select>
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			{/* px-2 keeps this bare row aligned with the rows inside the p-2
			 * subsection cards below. */}
			<label className="flex items-center gap-2 px-2 text-sm">
				<input
					type="checkbox"
					checked={merged.enabled}
					onChange={(e) => update({ enabled: e.target.checked })}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">Show caption</span>
			</label>

			{merged.enabled && (
				<>
					<label className="flex flex-col gap-1 text-sm">
						<span className="text-stone-600 dark:text-stone-400">
							Caption text
						</span>
						<textarea
							value={merged.text}
							onChange={(e) => update({ text: e.target.value })}
							placeholder="A short caption shown below the x-axis title…"
							rows={4}
							className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
						<span className="vc-help">
							Long text wraps to the box width. Press Enter for a manual line
							break.
						</span>
					</label>

					<CollapsibleSubsection title="Position">
						<div className="flex flex-col gap-2">
							<p className="vc-help">
								Nudges the caption from its default spot (centered, below the
								chart). 0 = default.
							</p>
							<OffsetField
								label="X offset"
								value={merged.offsetX}
								unit={merged.offsetXUnit}
								onValue={(v) => update({ offsetX: v })}
								onUnit={(u) => update({ offsetXUnit: u })}
							/>
							<OffsetField
								label="Y offset"
								value={merged.offsetY}
								unit={merged.offsetYUnit}
								onValue={(v) => update({ offsetY: v })}
								onUnit={(u) => update({ offsetYUnit: u })}
							/>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Size">
						<div className="flex flex-col gap-2">
							{renderDimField("width", "Width")}
							{renderDimField("height", "Height")}
							<p className="vc-help">
								Blank = auto (width spans the chart; height fits the text).
								Arrows step from the current size.
							</p>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Text">
						<div className="flex flex-col gap-2">
							<SelectInput
								label="Font family"
								labelClassName={LABEL_COL}
								value={merged.fontFamily}
								options={FAMILY_OPTIONS}
								onChange={(fontFamily) => update({ fontFamily })}
								selectClassName="flex-1"
							/>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Font size"
									labelClassName={LABEL_COL}
									value={merged.fontSize}
									onChange={(v) => update({ fontSize: v })}
									min={1}
									step={1}
									suffix="px"
								/>
								{merged.fontSize !== DEFAULT_CAPTION_CONFIG.fontSize && (
									<ResetLink
										onClick={() =>
											update({ fontSize: DEFAULT_CAPTION_CONFIG.fontSize })
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<SelectInput<WeightOptionValue>
									label="Font weight"
									labelClassName={LABEL_COL}
									value={String(merged.fontWeight) as WeightOptionValue}
									options={WEIGHT_OPTIONS}
									onChange={(w) => update({ fontWeight: Number(w) })}
								/>
								{merged.fontWeight !== DEFAULT_CAPTION_CONFIG.fontWeight && (
									<ResetLink
										onClick={() =>
											update({ fontWeight: DEFAULT_CAPTION_CONFIG.fontWeight })
										}
									/>
								)}
							</div>
							{/* div, not label: AlignmentControl is a button group, not a form control */}
							<div className="flex items-center gap-2 text-sm">
								<span className={LABEL_COL}>Align</span>
								<AlignmentControl
									value={merged.align}
									onChange={(align) => update({ align })}
								/>
							</div>
							<div className="flex items-center gap-2">
								<ColorInput
									label="Text color"
									labelClassName={LABEL_COL}
									value={merged.textColor}
									onChange={(c) => update({ textColor: c })}
								/>
								{merged.textColor !== DEFAULT_CAPTION_CONFIG.textColor && (
									<ResetLink
										onClick={() =>
											update({ textColor: DEFAULT_CAPTION_CONFIG.textColor })
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Padding"
									labelClassName={LABEL_COL}
									value={merged.padding}
									onChange={(v) => update({ padding: v })}
									min={0}
									step={1}
									suffix="px"
								/>
								{merged.padding !== DEFAULT_CAPTION_CONFIG.padding && (
									<ResetLink
										onClick={() =>
											update({ padding: DEFAULT_CAPTION_CONFIG.padding })
										}
									/>
								)}
							</div>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Box">
						<div className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<ColorInput
									label="Background"
									labelClassName={LABEL_COL}
									value={merged.backgroundColor}
									onChange={(c) => update({ backgroundColor: c })}
								/>
								{merged.backgroundColor !==
									DEFAULT_CAPTION_CONFIG.backgroundColor && (
									<ResetLink
										onClick={() =>
											update({
												backgroundColor:
													DEFAULT_CAPTION_CONFIG.backgroundColor,
											})
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Opacity"
									labelClassName={LABEL_COL}
									value={merged.backgroundOpacity}
									onChange={(v) => update({ backgroundOpacity: v })}
									min={0}
									max={1}
									step={0.05}
									clamp
								/>
								{merged.backgroundOpacity !==
									DEFAULT_CAPTION_CONFIG.backgroundOpacity && (
									<ResetLink
										onClick={() =>
											update({
												backgroundOpacity:
													DEFAULT_CAPTION_CONFIG.backgroundOpacity,
											})
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Border radius"
									labelClassName={LABEL_COL}
									value={merged.borderRadius}
									onChange={(v) => update({ borderRadius: v })}
									min={0}
									step={1}
									suffix="px"
								/>
								{merged.borderRadius !==
									DEFAULT_CAPTION_CONFIG.borderRadius && (
									<ResetLink
										onClick={() =>
											update({
												borderRadius: DEFAULT_CAPTION_CONFIG.borderRadius,
											})
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<LabelSpacer />
								<Toggle
									label="Border"
									checked={merged.borderEnabled}
									onChange={(on) => update({ borderEnabled: on })}
								/>
							</div>
							{merged.borderEnabled && (
								<>
									<div className="flex items-center gap-2">
										<ColorInput
											label="Border color"
											labelClassName={LABEL_COL}
											value={merged.borderColor}
											onChange={(c) => update({ borderColor: c })}
										/>
										{merged.borderColor !==
											DEFAULT_CAPTION_CONFIG.borderColor && (
											<ResetLink
												onClick={() =>
													update({
														borderColor:
															DEFAULT_CAPTION_CONFIG.borderColor,
													})
												}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Border width"
											labelClassName={LABEL_COL}
											value={merged.borderWidth}
											onChange={(v) => update({ borderWidth: v })}
											min={0}
											step={0.5}
											suffix="px"
										/>
										{merged.borderWidth !==
											DEFAULT_CAPTION_CONFIG.borderWidth && (
											<ResetLink
												onClick={() =>
													update({
														borderWidth:
															DEFAULT_CAPTION_CONFIG.borderWidth,
													})
												}
											/>
										)}
									</div>
								</>
							)}
							<p className="vc-help">
								Background opacity 0 = transparent.
							</p>
						</div>
					</CollapsibleSubsection>
				</>
			)}
		</div>
	)
}
