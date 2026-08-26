import type { ReactNode } from "react"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import type {
	BoxAnnotationStyle,
	RectangleTextStyle,
} from "../../../lib/annotationsConfig"
import { fontWeightOptionsFor } from "../../../lib/labelsConfig"
import {
	useFontFamilyOptions,
	useUserFontWeights,
} from "../../../store/useFontOptions"
import { AlignmentControl } from "../LabelsPanel"
import { DashStylePicker } from "../channelOptions/dashControls"
import {
	percentToValue,
	toNumber,
	valueToPercent,
	cleanNumber,
	type AxisInfo,
} from "./axisInfo"
import { AxisValueInput } from "./controls"

/** The coordinate fields rectangles and line segments share: four edge /
 *  endpoint values plus how they're interpreted. Both annotation types store
 *  exactly these members, so one Position section serves both editors. */
type EdgeCoords = {
	coordSystem: "percent" | "values"
	xMin: number | string
	xMax: number | string
	yMin: number | string
	yMax: number | string
}

/** "Position" subsection for the two edge-coordinate annotation kinds
 *  (rectangle + line segment): the percent↔values "Adjust by" toggle plus the
 *  four coordinate inputs. The position math is plot-area-normalized — see
 *  `annotationsConfig.ts` for the coordinate convention. The actual drawing
 *  happens in PlotCanvas, which converts the percent coords to pixel coords
 *  against each panel's `inner` rect. */
export const EdgePositionSection = ({
	coords,
	onChange,
	xAxis,
	yAxis,
	disableValues,
}: {
	coords: EdgeCoords
	onChange: (patch: Partial<EdgeCoords>) => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for the edges to map against. */
	disableValues?: boolean
}) => (
	<CollapsibleSubsection title="Position">
		<div className="flex flex-col gap-2">
			<SelectInput
				label="Adjust by"
				labelClassName={LABEL_COL}
				value={coords.coordSystem}
				options={[
					{ value: "percent", label: "Percent (0–100)" },
					{
						value: "values",
						label: "Values (data units)",
						disabled: disableValues,
					},
				]}
				onChange={(v) => {
					const nextSystem = v as "percent" | "values"
					if (nextSystem === coords.coordSystem) return
					if (nextSystem === "values" && disableValues) return
					// Convert the stored coords so the new boxes show the
					// equivalent position in the target system. Without
					// this the user sees raw percents being treated as data
					// values (or vice versa).
					const convert =
						nextSystem === "values"
							? (val: number | string, ax: AxisInfo) =>
									percentToValue(toNumber(val), ax)
							: (val: number | string, ax: AxisInfo) =>
									valueToPercent(val, ax)
					onChange({
						coordSystem: nextSystem,
						xMin: convert(coords.xMin, xAxis),
						xMax: convert(coords.xMax, xAxis),
						yMin: convert(coords.yMin, yAxis),
						yMax: convert(coords.yMax, yAxis),
					})
				}}
			/>

			{coords.coordSystem === "percent" ? (
				<div className="flex flex-col gap-2">
					<NumberInput
						label="left %"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.xMin) * 100)}
						step={1}
						onChange={(v) => onChange({ xMin: v / 100 })}
						suffix="%"
					/>
					<NumberInput
						label="right %"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.xMax) * 100)}
						step={1}
						onChange={(v) => onChange({ xMax: v / 100 })}
						suffix="%"
					/>
					<NumberInput
						label="bottom %"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.yMin) * 100)}
						step={1}
						onChange={(v) => onChange({ yMin: v / 100 })}
						suffix="%"
					/>
					<NumberInput
						label="top %"
						labelClassName={LABEL_COL}
						value={cleanNumber(toNumber(coords.yMax) * 100)}
						step={1}
						onChange={(v) => onChange({ yMax: v / 100 })}
						suffix="%"
					/>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<AxisValueInput
						label="left"
						labelClassName={LABEL_COL}
						value={coords.xMin}
						axis={xAxis}
						onChange={(v) => onChange({ xMin: v })}
					/>
					<AxisValueInput
						label="right"
						labelClassName={LABEL_COL}
						value={coords.xMax}
						axis={xAxis}
						onChange={(v) => onChange({ xMax: v })}
					/>
					<AxisValueInput
						label="bottom"
						labelClassName={LABEL_COL}
						value={coords.yMin}
						axis={yAxis}
						onChange={(v) => onChange({ yMin: v })}
					/>
					<AxisValueInput
						label="top"
						labelClassName={LABEL_COL}
						value={coords.yMax}
						axis={yAxis}
						onChange={(v) => onChange({ yMax: v })}
					/>
				</div>
			)}
		</div>
	</CollapsibleSubsection>
)

/** The coordinate fields a single-anchor annotation stores. Only the text
 *  annotation uses this today: it's a point, not a region, because its box is
 *  auto-sized to the text. */
type PointCoords = {
	coordSystem: "percent" | "values"
	x: number | string
	y: number | string
}

/** "Position" subsection for point-anchored annotations: the percent↔values
 *  "Adjust by" toggle plus one x and one y input. Same coordinate convention
 *  and same conversion-on-toggle behavior as `EdgePositionSection` — see
 *  `annotationsConfig.ts`. */
export const PointPositionSection = ({
	coords,
	onChange,
	xAxis,
	yAxis,
	disableValues,
	help,
}: {
	coords: PointCoords
	onChange: (patch: Partial<PointCoords>) => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for the anchor to map against. */
	disableValues?: boolean
	/** Helper prose explaining what the anchor point means for this kind. */
	help?: string
}) => (
	<CollapsibleSubsection title="Position">
		<SelectInput
			label="Adjust by"
			labelClassName={LABEL_COL}
			value={coords.coordSystem}
			options={[
				{ value: "percent", label: "Percent (0–100)" },
				{
					value: "values",
					label: "Values (data units)",
					disabled: disableValues,
				},
			]}
			onChange={(v) => {
				const nextSystem = v as "percent" | "values"
				if (nextSystem === coords.coordSystem) return
				if (nextSystem === "values" && disableValues) return
				// Convert the stored coords so the new boxes show the equivalent
				// position in the target system (see EdgePositionSection).
				if (nextSystem === "values") {
					onChange({
						coordSystem: "values",
						x: percentToValue(toNumber(coords.x), xAxis),
						y: percentToValue(toNumber(coords.y), yAxis),
					})
				} else {
					onChange({
						coordSystem: "percent",
						x: valueToPercent(coords.x, xAxis),
						y: valueToPercent(coords.y, yAxis),
					})
				}
			}}
		/>
		{coords.coordSystem === "percent" ? (
			<div className="flex flex-col gap-2">
				<NumberInput
					label="x %"
					labelClassName={LABEL_COL}
					value={cleanNumber(toNumber(coords.x) * 100)}
					step={1}
					onChange={(v) => onChange({ x: v / 100 })}
					suffix="%"
				/>
				<NumberInput
					label="y %"
					labelClassName={LABEL_COL}
					value={cleanNumber(toNumber(coords.y) * 100)}
					step={1}
					onChange={(v) => onChange({ y: v / 100 })}
					suffix="%"
				/>
			</div>
		) : (
			<div className="flex flex-col gap-2">
				<AxisValueInput
					label="x"
					labelClassName={LABEL_COL}
					value={coords.x}
					axis={xAxis}
					onChange={(v) => onChange({ x: v })}
				/>
				<AxisValueInput
					label="y"
					labelClassName={LABEL_COL}
					value={coords.y}
					axis={yAxis}
					onChange={(v) => onChange({ y: v })}
				/>
			</div>
		)}
		{help && <p className="vc-help">{help}</p>}
	</CollapsibleSubsection>
)

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
			<div className="flex items-center gap-2">
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
	children,
}: {
	style: BorderStyle
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: Pick<BorderStyle, "borderColor" | "borderThickness" | "borderOpacity">
	onChange: (patch: Partial<BorderStyle>) => void
	/** Accessible-name context for the dash picker's radio group, e.g.
	 *  "rectangle border" / "circle border". */
	ariaContext: string
	/** Extra rows appended after the dash picker — the text annotation's
	 *  corner-radius control, which only that kind has. */
	children?: ReactNode
}) => (
	<CollapsibleSubsection title="Border">
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
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
			{children}
		</div>
	</CollapsibleSubsection>
)

/** The text content + styling an annotation's label carries. The rectangle
 *  stores these optionally (they postdate the shape), the text annotation
 *  requires them, so the section reads through `??` fallbacks and writes the
 *  same field names for both. */
type TextStyle = Partial<RectangleTextStyle> & { text?: string }

/** "Text" subsection shared by the rectangle's inner label and the
 *  free-standing text annotation: the text box plus font family / size /
 *  color / weight / alignment / padding, each with a reset link against the
 *  theme-seeded `defaults` baseline. */
export const TextStyleSection = ({
	style,
	defaults,
	onChange,
	placeholder,
	alignmentHelp,
}: {
	style: TextStyle
	/** Theme-seeded text baseline the reset links compare against. */
	defaults: RectangleTextStyle
	onChange: (patch: Partial<TextStyle>) => void
	/** Placeholder for the text box, naming where the label is drawn. */
	placeholder: string
	/** Extra prose under the Alignment row — the text annotation's alignment
	 *  also picks which edge of the box lands on the anchor point. */
	alignmentHelp?: string
}) => {
	const familyOptions = useFontFamilyOptions()
	const userFontWeights = useUserFontWeights()
	const fontFamily = style.textFontFamily ?? defaults.textFontFamily
	const fontSize = style.textFontSize ?? defaults.textFontSize
	const color = style.textColor ?? defaults.textColor
	const weight = style.textFontWeight ?? defaults.textFontWeight
	const align = style.textAlign ?? defaults.textAlign
	const padding = style.textPadding ?? defaults.textPadding
	return (
		<CollapsibleSubsection title="Text">
			<label className="flex flex-col gap-1 text-sm">
				<span className="text-stone-600 dark:text-stone-400">Text</span>
				<textarea
					value={style.text ?? ""}
					onChange={(e) => onChange({ text: e.target.value })}
					placeholder={placeholder}
					rows={2}
					className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
			</label>
			<SelectInput
				label="Font"
				labelClassName={LABEL_COL}
				value={fontFamily}
				options={familyOptions}
				onChange={(textFontFamily) => onChange({ textFontFamily })}
				selectClassName="flex-1"
			/>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Size"
					labelClassName={LABEL_COL}
					value={fontSize}
					min={1}
					step={1}
					onChange={(v) => onChange({ textFontSize: v })}
					suffix="pt"
				/>
				{fontSize !== defaults.textFontSize && (
					<ResetLink
						onClick={() => onChange({ textFontSize: defaults.textFontSize })}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<ColorInput
					label="Color"
					labelClassName={LABEL_COL}
					value={color}
					onChange={(c) => onChange({ textColor: c })}
					paletteKind="text"
				/>
				{color !== defaults.textColor && (
					<ResetLink
						onClick={() => onChange({ textColor: defaults.textColor })}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<SelectInput
					label="Weight"
					labelClassName={LABEL_COL}
					value={String(weight)}
					options={fontWeightOptionsFor(
						fontFamily,
						weight,
						userFontWeights
					).map((w) => ({ value: String(w.value), label: w.label }))}
					onChange={(w) => onChange({ textFontWeight: Number(w) })}
				/>
				{weight !== defaults.textFontWeight && (
					<ResetLink
						onClick={() =>
							onChange({ textFontWeight: defaults.textFontWeight })
						}
					/>
				)}
			</div>
			{/* div, not label: AlignmentControl is a button group, not a form control */}
			<div className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Alignment</span>
				<AlignmentControl
					value={align}
					onChange={(textAlign) => onChange({ textAlign })}
				/>
			</div>
			{alignmentHelp && <p className="vc-help">{alignmentHelp}</p>}
			<div className="flex items-center gap-2">
				<NumberInput
					label="Padding"
					labelClassName={LABEL_COL}
					value={padding}
					min={0}
					step={1}
					onChange={(v) => onChange({ textPadding: v })}
					suffix="px"
				/>
				{padding !== defaults.textPadding && (
					<ResetLink
						onClick={() => onChange({ textPadding: defaults.textPadding })}
					/>
				)}
			</div>
		</CollapsibleSubsection>
	)
}
