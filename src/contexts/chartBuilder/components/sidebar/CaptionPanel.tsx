import { useId } from "react"
import { useAtom, useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL, LabelSpacer } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { Checkbox } from "../../../../components/ui/Checkbox"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
	type CaptionUnit,
} from "../../lib/captionConfig"
import type { FontConfig } from "../../lib/labelsConfig"
import { captionConfigFromTheme } from "../../lib/themeConfig"
import { AlignmentControl, FontEditor } from "./LabelsPanel"
import {
	currentCaptionConfigAtom,
	currentRenderedCaptionBoxAtom,
} from "../../store/atoms"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { Select } from "../../../../components/ui/Select"
import { Textarea } from "../../../../components/ui/Input"

/** A NumberInput with a trailing px/% unit selector — used for the position
 *  offsets, which sensibly start stepping from 0. `onReset` (passed only
 *  while the offset differs from its default) shows the row's reset link. */
const OffsetField = ({
	label,
	value,
	unit,
	onValue,
	onUnit,
	onReset,
}: {
	label: string
	value: number
	unit: CaptionUnit
	onValue: (v: number) => void
	onUnit: (u: CaptionUnit) => void
	onReset?: () => void
}) => (
	<div className="flex items-center gap-2">
	<NumberInput
		label={label}
		labelClassName={LABEL_COL}
		value={value}
		onChange={onValue}
		step={1}
		suffix={
			<Select
				aria-label={`${label} unit`}
				value={unit}
				onChange={(e) => onUnit(e.target.value as CaptionUnit)}
			>
				<option value="px">px</option>
				<option value="%">%</option>
			</Select>
		}
	/>
	{onReset && (
		<ResetLink ariaLabel={`Reset ${label}`} onClick={onReset} />
	)}
	</div>
)

/** Adapter: the caption's text styling as the shared `FontEditor`'s
 *  `Partial<FontConfig>`. A field equal to the LIVE theme's caption default
 *  reads as unset, so the editor shows the theme value as its placeholder /
 *  "(…)" entry (italic / underline: the `baseItalic` / `baseUnderline`
 *  toggle state) and offers a reset exactly when the value deviates. */
const captionToFont = (
	cfg: CaptionConfig,
	theme: CaptionConfig
): Partial<FontConfig> => ({
	...(cfg.fontFamily !== theme.fontFamily && { family: cfg.fontFamily }),
	...(cfg.fontSize !== theme.fontSize && { size: cfg.fontSize }),
	...(cfg.textColor !== theme.textColor && { color: cfg.textColor }),
	...(cfg.fontWeight !== theme.fontWeight && { weight: cfg.fontWeight }),
	...(!!cfg.italic !== !!theme.italic && { italic: !!cfg.italic }),
	...(!!cfg.underline !== !!theme.underline && { underline: !!cfg.underline }),
})

/** Inverse of `captionToFont`: an unset field (reset / "(…)" choice) writes
 *  the live theme value back — the same reset target the old per-row links
 *  used (`captionConfigFromTheme`). */
const fontToCaption = (
	font: Partial<FontConfig>,
	theme: CaptionConfig
): Partial<CaptionConfig> => ({
	fontFamily: font.family ?? theme.fontFamily,
	fontSize: font.size ?? theme.fontSize,
	textColor: font.color ?? theme.textColor,
	fontWeight: font.weight ?? theme.fontWeight,
	// Sparse like the seed: absent = off.
	italic: (font.italic ?? !!theme.italic) || undefined,
	underline: (font.underline ?? !!theme.underline) || undefined,
})

/** Sidebar panel for the Caption subsystem. Drives `CaptionConfig` — a single
 *  free-floating text box rendered inside the plot SVG. The figure reserves a
 *  band at the bottom and shrinks to fit the caption (it never pushes content
 *  past the viewport). Position offsets nudge the box from its default
 *  (centered, pinned to the bottom of the canvas); the figure only grows (and
 *  scrolls) when what the caption DRAWS — its text, or the box when it has a
 *  background or border — is nudged past the canvas edge. Width/height each
 *  carry a px/% unit and step from the current rendered size. */
export const CaptionPanel = () => {
	const [cfg, setCfg] = useAtom(currentCaptionConfigAtom)
	const renderedBox = useAtomValue(currentRenderedCaptionBoxAtom)
	// Id base for the Width / Height inputs so their visible labels associate
	// via htmlFor (the inputs stay raw — blank means "auto", which the shared
	// NumberInput can't express).
	const dimIdBase = useId()
	const merged: CaptionConfig = { ...DEFAULT_CAPTION_CONFIG, ...cfg }
	// Resolve the LIVE theme so the text and box reset links compare
	// against — and reset to — the theme's Caption defaults (Settings →
	// Themes → Text → Caption / Caption box) rather than the hardcoded
	// constants. Everything the theme doesn't seed (position, size) still
	// compares against DEFAULT_CAPTION_CONFIG, which `captionConfigFromTheme`
	// passes through.
	const theme = useCurrentTheme()
	const themeDefaults = captionConfigFromTheme(theme)

	const update = (next: Partial<CaptionConfig>) => setCfg({ ...merged, ...next })

	// Subsection "changed" dots — light when any control inside deviates from
	// the baseline the reset links restore (the theme seed, which is
	// DEFAULT_CAPTION_CONFIG for everything the theme doesn't set). Unit
	// picks alone don't count: 0px and 0% (or auto) render identically, so a
	// unit is only a change once its value is set.
	const d = themeDefaults
	const positionChanged = merged.offsetX !== d.offsetX || merged.offsetY !== d.offsetY
	const sizeChanged = merged.width > 0 || merged.height > 0
	const textChanged =
		merged.fontFamily !== d.fontFamily ||
		merged.fontSize !== d.fontSize ||
		merged.fontWeight !== d.fontWeight ||
		merged.align !== d.align ||
		merged.textColor !== d.textColor ||
		!!merged.italic !== !!d.italic ||
		!!merged.underline !== !!d.underline
	// Border color/width only count while the border toggle shows them.
	const boxChanged =
		merged.padding !== d.padding ||
		merged.backgroundColor !== d.backgroundColor ||
		merged.backgroundOpacity !== d.backgroundOpacity ||
		merged.borderRadius !== d.borderRadius ||
		merged.borderEnabled !== d.borderEnabled ||
		(merged.borderEnabled &&
			(merged.borderColor !== d.borderColor ||
				merged.borderWidth !== d.borderWidth))

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
		return (
			<div className="flex items-center gap-2">
				{/* Blank (0) = auto. The placeholder shows the current rendered
				 *  size, and the first spinner click / arrow key steps from that
				 *  displayed number rather than from 0; `stepBase` covers the
				 *  window before any box has rendered. */}
				<NumberInput
					id={`${dimIdBase}-${dim}`}
					label={label}
					labelClassName={LABEL_COL}
					min={0}
					step={1}
					value={value > 0 ? value : null}
					placeholder={
						renderedBox ? String(resolveDimStart(dim, unit)) : "Auto"
					}
					stepBase={resolveDimStart(dim, unit)}
					onChange={(n) => {
						if (n >= 0) setValue(n)
					}}
					onClear={() => setValue(0)}
					inputClassName="w-20"
				/>
				<Select
					aria-label={`${label} unit`}
					value={unit}
					onChange={(e) => {
						const nextUnit = e.target.value as CaptionUnit
						update({
							[unitKey]: nextUnit,
							[valueKey]: convertDim(dim, value, unit, nextUnit),
						} as Partial<CaptionConfig>)
					}}
				>
					<option value="px">px</option>
					<option value="%">%</option>
				</Select>
				{value > 0 && (
					<ResetLink ariaLabel={`Reset ${label}`} onClick={() => setValue(0)} />
				)}
			</div>
		)
	}

	return (
		<div className="vc-option-panel">
			{/* px-2 keeps this bare row aligned with the rows inside the p-2
			 * subsection cards below. */}
			<Checkbox
				className="px-2"
				label="Show caption"
				checked={merged.enabled}
				onChange={(enabled) => update({ enabled })}
			/>

			{merged.enabled && (
				<>
					<label className="flex flex-col gap-1 text-sm">
						<span className="vc-text">
							Caption text
						</span>
						<Textarea
							value={merged.text}
							onChange={(e) => update({ text: e.target.value })}
							placeholder="A short caption shown below the x-axis title…"
							rows={2}
							autoSize
						/>
					</label>

					<CollapsibleSubsection title="Adjust position" changed={positionChanged}>
						<div className="flex flex-col gap-2">
							<OffsetField
								label="X"
								value={merged.offsetX}
								unit={merged.offsetXUnit}
								onValue={(v) => update({ offsetX: v })}
								onUnit={(u) => update({ offsetXUnit: u })}
								onReset={
									merged.offsetX !== d.offsetX
										? () => update({ offsetX: d.offsetX })
										: undefined
								}
							/>
							{/* Y shows math convention (positive = up); the stored value
							 * stays in screen coords (positive = down), so the sign flips
							 * here in both directions. */}
							<OffsetField
								label="Y"
								value={-merged.offsetY}
								unit={merged.offsetYUnit}
								onValue={(v) => update({ offsetY: -v })}
								onUnit={(u) => update({ offsetYUnit: u })}
								onReset={
									merged.offsetY !== d.offsetY
										? () => update({ offsetY: d.offsetY })
										: undefined
								}
							/>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Size" changed={sizeChanged}>
						<div className="flex flex-col gap-2">
							{renderDimField("width", "Width")}
							{renderDimField("height", "Height")}
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Text" changed={textChanged}>
						<div className="flex flex-col gap-2">
							{/* div, not label: AlignmentControl is a button group, not a form control */}
							<div className="flex items-center gap-2 text-sm">
								<span className={LABEL_COL}>Align</span>
								<AlignmentControl
									value={merged.align}
									onChange={(align) => update({ align })}
								/>
							</div>
							<FontEditor
								value={captionToFont(merged, themeDefaults)}
								onChange={(font) =>
									update(fontToCaption(font, themeDefaults))
								}
								showResetFields
								baseColor={themeDefaults.textColor}
								baseSize={themeDefaults.fontSize}
								baseFamily={themeDefaults.fontFamily}
								baseWeight={themeDefaults.fontWeight}
								baseItalic={!!themeDefaults.italic}
								baseUnderline={!!themeDefaults.underline}
							/>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection title="Box" changed={boxChanged}>
						<div className="flex flex-col gap-2">
							<div className="flex flex-wrap items-center gap-2">
								<ColorInput
									label="Background"
									labelClassName={LABEL_COL}
									value={merged.backgroundColor}
									onChange={(c) => update({ backgroundColor: c })}
								/>
								{merged.backgroundColor !== d.backgroundColor && (
									<ResetLink
										onClick={() =>
											update({ backgroundColor: d.backgroundColor })
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
								{merged.backgroundOpacity !== d.backgroundOpacity && (
									<ResetLink
										onClick={() =>
											update({ backgroundOpacity: d.backgroundOpacity })
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Corner radius"
									labelClassName={LABEL_COL}
									value={merged.borderRadius}
									onChange={(v) => update({ borderRadius: v })}
									min={0}
									step={1}
									suffix="px"
								/>
								{merged.borderRadius !== d.borderRadius && (
									<ResetLink
										onClick={() =>
											update({ borderRadius: d.borderRadius })
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
								{merged.padding !== d.padding && (
									<ResetLink
										onClick={() =>
											update({ padding: d.padding })
										}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<LabelSpacer />
								<Checkbox
									label="Border"
									checked={merged.borderEnabled}
									onChange={(on) => update({ borderEnabled: on })}
								/>
							</div>
							{merged.borderEnabled && (
								<>
									<div className="flex flex-wrap items-center gap-2">
										<ColorInput
											label="Border color"
											labelClassName={LABEL_COL}
											value={merged.borderColor}
											onChange={(c) => update({ borderColor: c })}
										/>
										{merged.borderColor !== d.borderColor && (
											<ResetLink
												onClick={() =>
													update({ borderColor: d.borderColor })
												}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Border thickness"
											labelClassName={LABEL_COL}
											value={merged.borderWidth}
											onChange={(v) => update({ borderWidth: v })}
											min={0}
											step={0.5}
											suffix="px"
										/>
										{merged.borderWidth !== d.borderWidth && (
											<ResetLink
												onClick={() =>
													update({ borderWidth: d.borderWidth })
												}
											/>
										)}
									</div>
								</>
							)}
						</div>
					</CollapsibleSubsection>
				</>
			)}
		</div>
	)
}
