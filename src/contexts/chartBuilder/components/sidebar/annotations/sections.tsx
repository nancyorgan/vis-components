import type { ReactNode } from "react"
import { useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import {
	coordCornerOf,
	coordSystemFor,
	coordUnitOf,
	isPercentSystem,
	isPixelSystem,
	type AnnotationCoordSystem,
	type CoordCorner,
	type CoordUnit,
} from "../../../lib/annotationPixels"
import type {
	BoxAnnotationStyle,
	RectangleTextStyle,
} from "../../../lib/annotationsConfig"
import type { FontConfig } from "../../../lib/labelsConfig"
import { currentRenderedPanelInnerDimsAtom } from "../../../store/atoms"
import { AlignmentControl, FontEditor } from "../LabelsPanel"
import { DashStylePicker } from "../channelOptions/dashControls"
import {
	convertCoord,
	toNumber,
	cleanNumber,
	type AxisInfo,
	type PlotDims,
} from "./axisInfo"
import { AxisValueInput, LayerRow } from "./controls"
import { Textarea } from "../../../../../components/ui/Input"

/** The rendered plot's size, so unit toggles can convert the stored numbers
 *  and keep the annotation where it is. */
export const usePlotDims = (): PlotDims =>
	useAtomValue(currentRenderedPanelInnerDimsAtom)

/** The "Adjust by" + "From" pair every annotation kind's Position
 *  subsection opens with: how the coordinate boxes below it are read.
 *
 *  "Adjust by" picks the UNIT:
 *  - **Values**: through the chart's position scales.
 *  - **Pixels**: whole px from a corner of the plot.
 *  - **Percent**: fractions of the plot's width / height from a corner.
 *
 *  For pixels and percent a second "From" dropdown picks the CORNER
 *  (top-left / top-right / bottom-left / bottom-right). In every corner +x
 *  is right and +y is up — only the origin moves. Pixels are the ones to use
 *  for anything placed OUTSIDE the plot: a percent past 0 or 100 is a
 *  fraction of the plot's size, so it drifts across the fixed-height chrome
 *  (panel titles, the title band) as the chart resizes, while "14px above
 *  the top-left corner" is 14px on every viewport. Pick the corner on the
 *  side the annotation hangs off.
 *
 *  Both dropdowns write ONE flat `coordSystem` (see `coordSystemFor`).
 *  Switching unit keeps the corner; coming from Values each unit starts at
 *  its original corner (percent bottom-left, pixels top-left). The caller
 *  converts its stored coordinates on change (`convertCoord`) so the new
 *  boxes show the same position in the new unit / corner. */
export const CoordSystemSelect = ({
	value,
	onChange,
	disableValues,
}: {
	value: AnnotationCoordSystem
	onChange: (next: AnnotationCoordSystem) => void
	/** Gray out "Values" on polar charts (radar / pie), which have no
	 *  cartesian axes for the coordinates to map against. */
	disableValues?: boolean
}) => {
	const unit = coordUnitOf(value)
	const corner = coordCornerOf(value)
	const emit = (next: AnnotationCoordSystem) => {
		if (next === value) return
		if (next === "values" && disableValues) return
		onChange(next)
	}
	return (
		<>
			<SelectInput
				label="Adjust by"
				labelClassName={LABEL_COL}
				value={unit}
				options={[
					{ value: "values", label: "Values", disabled: disableValues },
					{ value: "pixels", label: "Pixels" },
					{ value: "percent", label: "Percent" },
				]}
				onChange={(v) => emit(coordSystemFor(v as CoordUnit, corner))}
			/>
			{corner !== null && (
				<SelectInput
					label="From"
					labelClassName={LABEL_COL}
					value={corner}
					options={[
						{ value: "topLeft", label: "Top left" },
						{ value: "topRight", label: "Top right" },
						{ value: "bottomLeft", label: "Bottom left" },
						{ value: "bottomRight", label: "Bottom right" },
					]}
					onChange={(v) => emit(coordSystemFor(unit, v as CoordCorner))}
				/>
			)}
		</>
	)
}

const CORNER_NAMES: Record<CoordCorner, string> = {
	topLeft: "top-left",
	topRight: "top-right",
	bottomLeft: "bottom-left",
	bottomRight: "bottom-right",
}

/** The helper line for the selected unit + corner (null for Values, for
 *  every pixel unit, and for plain bottom-left Percent — the original 0–100
 *  reading needs none). */
export const coordHelpFor = (system: AnnotationCoordSystem): string | null => {
	const corner = coordCornerOf(system)
	if (corner === null || system === "percent" || isPixelSystem(system)) return null
	return `Percent of the plot's width / height from the plot's ${CORNER_NAMES[corner]} corner.`
}

/** The coordinate fields rectangles and line segments share: four edge /
 *  endpoint values plus how they're interpreted. Both annotation types store
 *  exactly these members, so one Position section serves both editors. */
type EdgeCoords = {
	coordSystem: AnnotationCoordSystem
	xMin: number | string
	xMax: number | string
	yMin: number | string
	yMax: number | string
}

/** The layer field every annotation stores: drawn under or over the chart
 *  marks. Each Position subsection ends with its toggle, under a divider. */
type LayerProps = {
	zOrder: "behind" | "front"
	onZOrderChange: (zOrder: "behind" | "front") => void
}

/** "Position" subsection for the two edge-coordinate annotation kinds
 *  (rectangle + line segment): the "Adjust by" unit toggle, the four
 *  coordinate inputs, and the layer toggle. The position
 *  math is plot-area-relative — see `annotationsConfig.ts` for the coordinate
 *  convention. The actual drawing happens in PlotCanvas, which converts the
 *  coords to pixel coords against each panel's `inner` rect. */
export const EdgePositionSection = ({
	coords,
	onChange,
	xAxis,
	yAxis,
	disableValues,
	zOrder,
	onZOrderChange,
}: {
	coords: EdgeCoords
	onChange: (patch: Partial<EdgeCoords>) => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for the edges to map against. */
	disableValues?: boolean
} & LayerProps) => {
	const dims = usePlotDims()
	const pxInput = (
		key: "xMin" | "xMax" | "yMin" | "yMax",
		label: string
	) => (
		<NumberInput
			label={label}
			labelClassName={LABEL_COL}
			value={cleanNumber(toNumber(coords[key]))}
			step={1}
			onChange={(v) => onChange({ [key]: v })}
			suffix="px"
		/>
	)
	return (
		<CollapsibleSubsection title="Position">
			<div className="flex flex-col gap-2">
				<CoordSystemSelect
					value={coords.coordSystem}
					disableValues={disableValues}
					onChange={(next) => {
						// Convert the stored coords so the new boxes show the
						// equivalent position in the target system. Without this
						// the user sees raw percents being treated as data values
						// (or vice versa).
						const cur = coords.coordSystem
						const convert = (
							val: number | string,
							ax: AxisInfo,
							dim: "x" | "y"
						) => convertCoord(val, cur, next, ax, dim, dims)
						onChange({
							coordSystem: next,
							xMin: convert(coords.xMin, xAxis, "x"),
							xMax: convert(coords.xMax, xAxis, "x"),
							yMin: convert(coords.yMin, yAxis, "y"),
							yMax: convert(coords.yMax, yAxis, "y"),
						})
					}}
				/>

				{isPercentSystem(coords.coordSystem) ? (
					<div className="flex flex-col gap-2">
						<NumberInput
							label="Left"
							labelClassName={LABEL_COL}
							value={cleanNumber(toNumber(coords.xMin) * 100)}
							step={1}
							onChange={(v) => onChange({ xMin: v / 100 })}
							suffix="%"
						/>
						<NumberInput
							label="Right"
							labelClassName={LABEL_COL}
							value={cleanNumber(toNumber(coords.xMax) * 100)}
							step={1}
							onChange={(v) => onChange({ xMax: v / 100 })}
							suffix="%"
						/>
						<NumberInput
							label="Bottom"
							labelClassName={LABEL_COL}
							value={cleanNumber(toNumber(coords.yMin) * 100)}
							step={1}
							onChange={(v) => onChange({ yMin: v / 100 })}
							suffix="%"
						/>
						<NumberInput
							label="Top"
							labelClassName={LABEL_COL}
							value={cleanNumber(toNumber(coords.yMax) * 100)}
							step={1}
							onChange={(v) => onChange({ yMax: v / 100 })}
							suffix="%"
						/>
					</div>
				) : coords.coordSystem === "values" ? (
					<div className="flex flex-col gap-2">
						<AxisValueInput
							label="Left"
							labelClassName={LABEL_COL}
							value={coords.xMin}
							axis={xAxis}
							onChange={(v) => onChange({ xMin: v })}
						/>
						<AxisValueInput
							label="Right"
							labelClassName={LABEL_COL}
							value={coords.xMax}
							axis={xAxis}
							onChange={(v) => onChange({ xMax: v })}
						/>
						<AxisValueInput
							label="Bottom"
							labelClassName={LABEL_COL}
							value={coords.yMin}
							axis={yAxis}
							onChange={(v) => onChange({ yMin: v })}
						/>
						<AxisValueInput
							label="Top"
							labelClassName={LABEL_COL}
							value={coords.yMax}
							axis={yAxis}
							onChange={(v) => onChange({ yMax: v })}
						/>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{pxInput("xMin", "Left")}
						{pxInput("xMax", "Right")}
						{pxInput("yMin", "Bottom")}
						{pxInput("yMax", "Top")}
					</div>
				)}
				{coordHelpFor(coords.coordSystem) && (
					<p className="vc-help">{coordHelpFor(coords.coordSystem)}</p>
				)}
			</div>
			<div className="vc-divider-group">
				<LayerRow zOrder={zOrder} onChange={onZOrderChange} />
			</div>
		</CollapsibleSubsection>
	)
}

/** The coordinate fields a single-anchor annotation stores. The text and
 *  image annotations use this: each is a point, not a region, because its
 *  box is sized from its content (measured text, the picture's width). */
type PointCoords = {
	coordSystem: AnnotationCoordSystem
	x: number | string
	y: number | string
}

/** "Position" subsection for point-anchored annotations: the "Adjust by" unit
 *  toggle, one x and one y input, and the layer toggle. Same coordinate
 *  convention and same conversion-on-toggle behavior as `EdgePositionSection`
 *  — see `annotationsConfig.ts`. */
export const PointPositionSection = ({
	coords,
	onChange,
	xAxis,
	yAxis,
	disableValues,
	zOrder,
	onZOrderChange,
	children,
}: {
	coords: PointCoords
	onChange: (patch: Partial<PointCoords>) => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for the anchor to map against. */
	disableValues?: boolean
	/** Extra rows between the coordinate inputs and the layer toggle — the
	 *  image annotation's anchor picker (which point of the picture sits on
	 *  x / y), a position concern that belongs in this subsection. */
	children?: ReactNode
} & LayerProps) => {
	const dims = usePlotDims()
	return (
		<CollapsibleSubsection title="Position">
			<CoordSystemSelect
				value={coords.coordSystem}
				disableValues={disableValues}
				onChange={(next) => {
					// Convert the stored coords so the new boxes show the equivalent
					// position in the target system (see EdgePositionSection).
					const cur = coords.coordSystem
					onChange({
						coordSystem: next,
						x: convertCoord(coords.x, cur, next, xAxis, "x", dims),
						y: convertCoord(coords.y, cur, next, yAxis, "y", dims),
					})
				}}
			/>
			{isPercentSystem(coords.coordSystem) ? (
				<div className="flex flex-col gap-2">
					<NumberInput
						label="X"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.x) * 100)}
						step={1}
						onChange={(v) => onChange({ x: v / 100 })}
						suffix="%"
					/>
					<NumberInput
						label="Y"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.y) * 100)}
						step={1}
						onChange={(v) => onChange({ y: v / 100 })}
						suffix="%"
					/>
				</div>
			) : coords.coordSystem === "values" ? (
				<div className="flex flex-col gap-2">
					<AxisValueInput
						label="X"
						labelClassName={LABEL_COL}
						value={coords.x}
						axis={xAxis}
						onChange={(v) => onChange({ x: v })}
					/>
					<AxisValueInput
						label="Y"
						labelClassName={LABEL_COL}
						value={coords.y}
						axis={yAxis}
						onChange={(v) => onChange({ y: v })}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<NumberInput
						label="X"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.x))}
						step={1}
						onChange={(v) => onChange({ x: v })}
						suffix="px"
					/>
					<NumberInput
						label="Y"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.y))}
						step={1}
						onChange={(v) => onChange({ y: v })}
						suffix="px"
					/>
				</div>
			)}
			{coordHelpFor(coords.coordSystem) && (
				<p className="vc-help">{coordHelpFor(coords.coordSystem)}</p>
			)}
			{children}
			<div className="vc-divider-group">
				<LayerRow zOrder={zOrder} onChange={onZOrderChange} />
			</div>
		</CollapsibleSubsection>
	)
}

/** The fill fields rectangles and circles share (from BoxAnnotationStyle). */
type FillStyle = Pick<BoxAnnotationStyle, "backgroundColor" | "backgroundOpacity">

/** "Fill" subsection shared by the two filled annotation kinds (rectangle +
 *  circle): fill color + opacity with reset links against the theme-seeded
 *  `defaults` baseline. */
export const FillSection = ({
	style,
	defaults,
	onChange,
}: {
	style: FillStyle
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: FillStyle
	onChange: (patch: Partial<FillStyle>) => void
}) => (
	<CollapsibleSubsection title="Fill">
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Fill"
					labelClassName={LABEL_COL}
					value={style.backgroundColor}
					onChange={(c) => onChange({ backgroundColor: c })}
				/>
				{style.backgroundColor !== defaults.backgroundColor && (
					<ResetLink
						onClick={() =>
							onChange({
								backgroundColor: defaults.backgroundColor,
							})
						}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Fill opacity"
					labelClassName={LABEL_COL}
					value={style.backgroundOpacity}
					step={0.05}
					min={0}
					max={1}
					onChange={(v) => onChange({ backgroundOpacity: v })}
				/>
				{style.backgroundOpacity !== defaults.backgroundOpacity && (
					<ResetLink
						onClick={() =>
							onChange({
								backgroundOpacity: defaults.backgroundOpacity,
							})
						}
					/>
				)}
			</div>
		</div>
	</CollapsibleSubsection>
)

/** The border fields rectangles and circles share (from BoxAnnotationStyle).
 *  `borderDasharray` stays optional to match the annotation types, where
 *  it's absent on shapes saved before the Custom dash choice existed. */
type BorderStyle = Pick<
	BoxAnnotationStyle,
	"borderColor" | "borderThickness" | "borderOpacity" | "borderDash"
> & {
	borderDasharray?: string | null
}

/** "Border" subsection shared by the two filled annotation kinds (rectangle +
 *  circle): stroke color / thickness / opacity plus the shared DashStylePicker
 *  (custom dasharray wins over the preset pattern). */
export const BorderSection = ({
	style,
	defaults,
	onChange,
	ariaContext,
}: {
	style: BorderStyle
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: Pick<BorderStyle, "borderColor" | "borderThickness" | "borderOpacity">
	onChange: (patch: Partial<BorderStyle>) => void
	/** Accessible-name context for the dash picker's radio group, e.g.
	 *  "rectangle border" / "circle border". */
	ariaContext: string
}) => (
	<CollapsibleSubsection title="Border">
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Color"
					labelClassName={LABEL_COL}
					value={style.borderColor}
					onChange={(c) => onChange({ borderColor: c })}
				/>
				{style.borderColor !== defaults.borderColor && (
					<ResetLink
						onClick={() =>
							onChange({ borderColor: defaults.borderColor })
						}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Thickness"
					labelClassName={LABEL_COL}
					value={style.borderThickness}
					step={0.5}
					min={0}
					onChange={(v) => onChange({ borderThickness: v })}
					suffix="px"
				/>
				{style.borderThickness !== defaults.borderThickness && (
					<ResetLink
						onClick={() =>
							onChange({
								borderThickness: defaults.borderThickness,
							})
						}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Opacity"
					labelClassName={LABEL_COL}
					value={style.borderOpacity}
					step={0.05}
					min={0}
					max={1}
					onChange={(v) => onChange({ borderOpacity: v })}
				/>
				{style.borderOpacity !== defaults.borderOpacity && (
					<ResetLink
						onClick={() =>
							onChange({ borderOpacity: defaults.borderOpacity })
						}
					/>
				)}
			</div>
			<div className="flex items-start gap-2 text-sm">
				<span className={`${LABEL_COL} shrink-0 pt-1.5`}>Dash</span>
				<DashStylePicker
					pattern={style.borderDash}
					customDasharray={style.borderDasharray ?? null}
					onChange={({ pattern, customDasharray }) =>
						onChange({
							borderDash: pattern,
							borderDasharray: customDasharray,
						})
					}
					ariaContext={ariaContext}
				/>
			</div>
		</div>
	</CollapsibleSubsection>
)

/** The text content + styling an annotation's label carries. The rectangle
 *  stores these optionally (they postdate the shape), the text annotation
 *  requires them, so the section reads through `??` fallbacks and writes the
 *  same field names for both. */
type TextStyle = Partial<RectangleTextStyle> & { text?: string }

/** The annotation's text content: a labeled, auto-sizing textarea. The
 *  rectangle keeps it inside its "Text" subsection (the label is optional
 *  there); the text annotation hoists it to the top of the card, outside any
 *  subsection, because the text IS the annotation and hiding it behind a
 *  collapsed header led users to type it into the name box instead. */
export const TextContentField = ({
	value,
	onChange,
	placeholder,
	className,
	label = "Text",
}: {
	value: string | undefined
	onChange: (text: string) => void
	/** Placeholder for the text box, naming where the label is drawn. */
	placeholder: string
	className?: string
	/** Visible caption above the box. `null` hides it (the text annotation
	 *  hoists the box to the top of its card, where a "Text" caption just
	 *  repeats the card's own kind); the textarea keeps it as its
	 *  accessible name. */
	label?: string | null
}) => (
	<label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
		{label !== null && <span className="vc-muted">{label}</span>}
		<Textarea
			aria-label={label === null ? "Text" : undefined}
			value={value ?? ""}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			rows={2}
			autoSize
		/>
	</label>
)

/** The text-to-box-edge inset row (px) with a reset link against the
 *  theme-seeded default. Rendered in the text annotation's "Box" and at the
 *  end of the rectangle's "Text" subsection. */
export const PaddingRow = ({
	value,
	defaultValue,
	onChange,
}: {
	value: number
	defaultValue: number
	onChange: (v: number) => void
}) => (
	<div className="flex items-center gap-2">
		<NumberInput
			label="Padding"
			labelClassName={LABEL_COL}
			value={value}
			min={0}
			step={1}
			onChange={onChange}
			suffix="px"
		/>
		{value !== defaultValue && (
			<ResetLink onClick={() => onChange(defaultValue)} />
		)}
	</div>
)

/** Adapter: the annotation's text style as the shared `FontEditor`'s
 *  `Partial<FontConfig>`. A field equal to its theme-seeded default reads as
 *  UNSET, so the editor shows the default as its placeholder / "(inherit)"
 *  entry and its reset links appear exactly when the old per-row resets did
 *  (value differs from the default). Italic / underline are set only when on. */
const annotationTextToFont = (
	style: TextStyle,
	defaults: RectangleTextStyle
): Partial<FontConfig> => {
	const family = style.textFontFamily ?? defaults.textFontFamily
	const size = style.textFontSize ?? defaults.textFontSize
	const color = style.textColor ?? defaults.textColor
	const weight = style.textFontWeight ?? defaults.textFontWeight
	return {
		...(family !== defaults.textFontFamily && { family }),
		...(size !== defaults.textFontSize && { size }),
		...(color !== defaults.textColor && { color }),
		...(weight !== defaults.textFontWeight && { weight }),
		...(style.textItalic && { italic: true }),
		...(style.textUnderline && { underline: true }),
	}
}

/** Inverse of `annotationTextToFont`: an unset field (the editor's reset /
 *  "(inherit)" choice) writes the default back, matching the old reset links. */
const fontToAnnotationText = (
	font: Partial<FontConfig>,
	defaults: RectangleTextStyle
): Partial<TextStyle> => ({
	textFontFamily: font.family ?? defaults.textFontFamily,
	textFontSize: font.size ?? defaults.textFontSize,
	textColor: font.color ?? defaults.textColor,
	textFontWeight: font.weight ?? defaults.textFontWeight,
	textItalic: font.italic || undefined,
	textUnderline: font.underline || undefined,
})

/** "Text" subsection shared by the rectangle's inner label and the
 *  free-standing text annotation: the optional text box, Align, then the
 *  shared `FontEditor` rows (Family · Color · Size · Weight · Style), each
 *  with a reset link against the theme-seeded `defaults` baseline. Padding
 *  lives with the box, not here. */
export const TextStyleSection = ({
	style,
	defaults,
	onChange,
	placeholder,
	title = "Text",
	showPadding = false,
}: {
	style: TextStyle
	/** Theme-seeded text baseline the reset links compare against. */
	defaults: RectangleTextStyle
	onChange: (patch: Partial<TextStyle>) => void
	/** Placeholder for the text box, naming where the label is drawn. Omit
	 *  to leave the text box out of the subsection (the caller renders a
	 *  `TextContentField` elsewhere) so this holds formatting only. */
	placeholder?: string
	/** Subsection header. */
	title?: string
	/** Keep the Padding row at the end of this subsection. Only the
	 *  rectangle wants it: its padding insets the label from the shape's
	 *  edge and it has no "Box" subsection. The text annotation's padding
	 *  lives in its Box. */
	showPadding?: boolean
}) => {
	const align = style.textAlign ?? defaults.textAlign
	return (
		<CollapsibleSubsection title={title}>
			{placeholder !== undefined && (
				<TextContentField
					value={style.text}
					onChange={(text) => onChange({ text })}
					placeholder={placeholder}
				/>
			)}
			{/* div, not label: AlignmentControl is a button group, not a form control */}
			<div className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Align</span>
				<AlignmentControl
					value={align}
					onChange={(textAlign) => onChange({ textAlign })}
				/>
			</div>
			<FontEditor
				value={annotationTextToFont(style, defaults)}
				onChange={(font) => onChange(fontToAnnotationText(font, defaults))}
				showResetFields
				baseColor={defaults.textColor}
				baseSize={defaults.textFontSize}
				baseFamily={defaults.textFontFamily}
				baseWeight={defaults.textFontWeight}
			/>
			{showPadding && (
				<PaddingRow
					value={style.textPadding ?? defaults.textPadding}
					defaultValue={defaults.textPadding}
					onChange={(textPadding) => onChange({ textPadding })}
				/>
			)}
		</CollapsibleSubsection>
	)
}
