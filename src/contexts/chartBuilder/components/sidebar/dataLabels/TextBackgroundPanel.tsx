import { useEffect, useRef } from "react"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
	type LabelBackgroundOverrides,
} from "../../../lib/channelConfig"
import { DEFAULT_BG_BORDER_COLOR } from "../../../lib/dataLabelsStyle"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Checkbox } from "../../../../../components/ui/Checkbox"

/** What the controls emit: concrete values only (never null), so one
 *  patch type satisfies both the layer config and a variable's entry. */
type BackgroundPatch = {
	textBackground?: boolean
	textBackgroundColor?: string
	textBackgroundRadius?: number
	textBackgroundPadX?: number
	textBackgroundPadY?: number
	textBackgroundBorderColor?: string
	textBackgroundBorderWidth?: number
}

/** Thickness the Border toggle turns on with when no earlier non-zero
 *  thickness is remembered. */
const DEFAULT_BORDER_WIDTH = 1

/** The resolved values one background block shows and the writes it makes.
 *  The layer-wide panel and each per-variable block render the same
 *  controls; `reset*` renders a control's reset link when it returns a
 *  handler. */
const BackgroundControls = ({
	enabled,
	color,
	radius,
	padX,
	padY,
	borderColor,
	borderWidth,
	onChange,
	resetColor,
	resetRadius,
	resetPadX,
	resetPadY,
	resetBorderWidth,
	resetBorderColor,
	colorHelp,
	toggleId,
}: {
	enabled: boolean
	color: string
	radius: number
	padX: number
	padY: number
	borderColor: string
	borderWidth: number
	onChange: (p: BackgroundPatch) => void
	resetColor: (() => void) | null
	resetRadius: (() => void) | null
	resetPadX: (() => void) | null
	resetPadY: (() => void) | null
	resetBorderWidth: (() => void) | null
	resetBorderColor: (() => void) | null
	colorHelp?: React.ReactNode
	toggleId?: string
}) => {
	// The Border toggle IS the thickness: off writes 0, on restores the last
	// non-zero thickness seen this session (or 1px).
	const lastBorderWidth = useRef(
		borderWidth > 0 ? borderWidth : DEFAULT_BORDER_WIDTH
	)
	useEffect(() => {
		if (borderWidth > 0) lastBorderWidth.current = borderWidth
	}, [borderWidth])
	const borderOn = borderWidth > 0
	return (
		<>
			<Checkbox
				id={toggleId}
				label="Show text background"
				checked={enabled}
				onChange={(textBackground) => onChange({ textBackground })}
			/>
			{enabled && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Background"
							labelClassName={LABEL_COL}
							value={color}
							onChange={(textBackgroundColor) =>
								onChange({ textBackgroundColor })
							}
						/>
						{resetColor && (
							<ResetLink ariaLabel="Reset background" onClick={resetColor} />
						)}
					</div>
					{colorHelp != null && <p className="vc-help">{colorHelp}</p>}
					<div className="flex items-center gap-2">
						<NumberInput
							label="Corner radius"
							labelClassName={LABEL_COL}
							value={radius}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundRadius) =>
								onChange({ textBackgroundRadius })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{resetRadius && <ResetLink onClick={resetRadius} />}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Horizontal padding"
							labelClassName={LABEL_COL}
							value={padX}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundPadX) =>
								onChange({ textBackgroundPadX })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{resetPadX && <ResetLink onClick={resetPadX} />}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Vertical padding"
							labelClassName={LABEL_COL}
							value={padY}
							min={0}
							max={32}
							step={0.5}
							onChange={(textBackgroundPadY) =>
								onChange({ textBackgroundPadY })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{resetPadY && <ResetLink onClick={resetPadY} />}
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							label="Border"
							checked={borderOn}
							onChange={(on) =>
								onChange({
									textBackgroundBorderWidth: on ? lastBorderWidth.current : 0,
								})
							}
						/>
						{resetBorderWidth && <ResetLink onClick={resetBorderWidth} />}
					</div>
					{borderOn && (
						<>
							<div className="flex flex-wrap items-center gap-2">
								<ColorInput
									label="Border color"
									labelClassName={LABEL_COL}
									value={borderColor}
									onChange={(textBackgroundBorderColor) =>
										onChange({ textBackgroundBorderColor })
									}
								/>
								{resetBorderColor && (
									<ResetLink ariaLabel="Reset border color" onClick={resetBorderColor} />
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Border thickness"
									labelClassName={LABEL_COL}
									value={borderWidth}
									min={0}
									step={0.5}
									onChange={(textBackgroundBorderWidth) =>
										onChange({ textBackgroundBorderWidth })
									}
									inputClassName="w-16"
									suffix="px"
								/>
								{/* The thickness's own default is the one the Border
								    switch turns on at. */}
								{borderWidth !== DEFAULT_BORDER_WIDTH && (
									<ResetLink
										ariaLabel="Reset border thickness"
										onClick={() =>
											onChange({ textBackgroundBorderWidth: DEFAULT_BORDER_WIDTH })
										}
									/>
								)}
							</div>
						</>
					)}
				</>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Box panel (text background) — draws a filled rounded rect behind each label so
// the text doesn't collide with gridlines / dense marks. The color defaults
// to the visualization's own background so labels blend into the canvas
// while masking whatever they sit over. With two or more label variables
// the layer-wide controls stand down and each variable gets its own
// collapsible block (like the Color panel's slots) with the same toggle +
// styling, showing the variable's effective values and writing its entry.
// ---------------------------------------------------------------------------
export const TextBackgroundPanel = ({
	cfg,
	onChange,
	vizBackground,
	multiFields = [],
	titles,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	vizBackground: string
	/** Multi-field label variables (two or more). Each gets its own
	 *  background block in place of the layer-wide one; empty in
	 *  single-field mode. */
	multiFields?: string[]
	/** Section titles by key (see `SizePanel`). */
	titles?: Record<string, string>
}) => {
	const D = DEFAULT_DATA_LABELS_CONFIG
	// `null` background color means "inherit the viz background" — resolve it
	// to the concrete color so the swatch shows the effective fill.
	const layerColor = cfg.textBackgroundColor ?? vizBackground
	const layerRadius = cfg.textBackgroundRadius ?? 0
	const layerPadX = cfg.textBackgroundPadX ?? 0
	const layerPadY = cfg.textBackgroundPadY ?? 0
	const layerBorderColor =
		cfg.textBackgroundBorderColor ?? DEFAULT_BG_BORDER_COLOR
	const layerBorderWidth = cfg.textBackgroundBorderWidth ?? 0
	if (multiFields.length === 0) {
		return (
			<div className="flex flex-col gap-2">
				<BackgroundControls
					enabled={cfg.textBackground === true}
					color={layerColor}
					radius={layerRadius}
					padX={layerPadX}
					padY={layerPadY}
					borderColor={layerBorderColor}
					borderWidth={layerBorderWidth}
					onChange={(p) => onChange(p)}
					resetColor={
						cfg.textBackgroundColor != null
							? () => onChange({ textBackgroundColor: null })
							: null
					}
					resetBorderColor={
						layerBorderColor.toLowerCase() !== DEFAULT_BG_BORDER_COLOR.toLowerCase()
							? () => onChange({ textBackgroundBorderColor: undefined })
							: null
					}
					resetRadius={
						layerRadius !== D.textBackgroundRadius
							? () => onChange({ textBackgroundRadius: D.textBackgroundRadius })
							: null
					}
					resetPadX={
						layerPadX !== D.textBackgroundPadX
							? () => onChange({ textBackgroundPadX: D.textBackgroundPadX })
							: null
					}
					resetPadY={
						layerPadY !== D.textBackgroundPadY
							? () => onChange({ textBackgroundPadY: D.textBackgroundPadY })
							: null
					}
					resetBorderWidth={null}
				/>
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			{multiFields.map((name) => {
				const own: LabelBackgroundOverrides = cfg.fieldBackgrounds?.[name] ?? {}
				const enabled = own.textBackground ?? cfg.textBackground ?? false
				const write = (next: LabelBackgroundOverrides) => {
					const map = { ...(cfg.fieldBackgrounds ?? {}) }
					if (Object.keys(next).length === 0) delete map[name]
					else map[name] = next
					onChange({ fieldBackgrounds: map })
				}
				const unset = (key: keyof LabelBackgroundOverrides) => {
					const next = { ...own }
					delete next[key]
					write(next)
				}
				return (
					<CollapsibleSubsection
						key={name}
						title={titles?.[name] ?? name}
						changed={own.textBackground != null}
					>
						<BackgroundControls
							enabled={enabled}
							color={own.textBackgroundColor ?? layerColor}
							radius={own.textBackgroundRadius ?? layerRadius}
							padX={own.textBackgroundPadX ?? layerPadX}
							padY={own.textBackgroundPadY ?? layerPadY}
							borderColor={own.textBackgroundBorderColor ?? layerBorderColor}
							borderWidth={own.textBackgroundBorderWidth ?? layerBorderWidth}
							onChange={(p) => write({ ...own, ...p })}
							resetColor={
								own.textBackgroundColor != null
									? () => unset("textBackgroundColor")
									: null
							}
							resetBorderColor={
								own.textBackgroundBorderColor != null
									? () => unset("textBackgroundBorderColor")
									: null
							}
							resetRadius={
								own.textBackgroundRadius != null
									? () => unset("textBackgroundRadius")
									: null
							}
							resetPadX={
								own.textBackgroundPadX != null
									? () => unset("textBackgroundPadX")
									: null
							}
							resetPadY={
								own.textBackgroundPadY != null
									? () => unset("textBackgroundPadY")
									: null
							}
							resetBorderWidth={
								own.textBackgroundBorderWidth != null
									? () => unset("textBackgroundBorderWidth")
									: null
							}
							colorHelp={
								<>
									Behind <strong>{name}</strong> only. Defaults to the
									visualization&apos;s background color; variables next to each
									other with the same background share one box.
								</>
							}
						/>
					</CollapsibleSubsection>
				)
			})}
		</div>
	)
}
