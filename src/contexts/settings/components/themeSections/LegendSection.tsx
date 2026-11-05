import { SwatchShapePicker } from "../../../chartBuilder/components/sidebar/SwatchShapePicker"
import {
	DEFAULT_LEGEND_CONFIG,
	LEGEND_ORIENTATION_OPTIONS,
	LEGEND_POSITION_OPTIONS,
	resolveGradientBarStyle,
	type LegendOrientation,
	type LegendPosition,
} from "../../../chartBuilder/lib/labelsConfig"
import { legendConfigFromTheme } from "../../../chartBuilder/lib/themeConfig"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { NumberInput as UiNumberInput } from "../../../../components/ui/NumberInput"
import {
	AlignmentRow,
	ColorInput,
	NumberInput,
	Section,
	SectionGroup,
	SelectInput,
	THEME_LABEL_CLASS,
} from "./controls"
import type { ThemeSectionProps } from "./types"

const GRADIENT_STYLE_OPTIONS = [
	{ value: "bar", label: "Show gradient bar" },
	{ value: "swatches", label: "Show swatches" },
]

/** Settings → Themes → Legend. Layout / Box / gradient style are SEEDED
 *  into a chart's legend config when it's created or switched onto the
 *  theme (`legendConfigFromTheme`); the gradient-bar look follows the theme
 *  LIVE (`resolveGradientBarStyle`). An unset field shows the built-in
 *  default. Labels match the sidebar's Legend panel. */
export const LegendSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => {
	const seed = legendConfigFromTheme(theme)
	const bar = resolveGradientBarStyle(DEFAULT_LEGEND_CONFIG, theme)
	// The break labels with no alignment set: centered under a horizontal
	// bar, left beside a vertical one.
	const autoLabelAlign = seed.orientation === "horizontal" ? "center" : "left"
	return (
		<SectionGroup title="Legend" isReadOnly={isReadOnly}>
			<Section title="Layout">
				<p className="text-xs vc-muted">
					Where a new chart&apos;s legend sits and how its entries flow. Copied
					in when a chart is created or switched to this theme.
				</p>
				<SelectInput
					label="Position"
					value={seed.position}
					options={[...LEGEND_POSITION_OPTIONS]}
					onChange={(v) => set("legendPosition", v as LegendPosition)}
				/>
				<SelectInput
					label="Orientation"
					value={seed.orientation}
					options={[...LEGEND_ORIENTATION_OPTIONS]}
					onChange={(v) => set("legendOrientation", v as LegendOrientation)}
				/>
			</Section>
			<Section title="Box">
				<div className="flex flex-col gap-1.5">
					<span className="text-sm vc-muted">
						Legend background
					</span>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={theme.legendBackgroundColor === null}
							onChange={() => set("legendBackgroundColor", null)}
						/>
						<span className="vc-text">
							Transparent
						</span>
					</label>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={theme.legendBackgroundColor !== null}
							onChange={() =>
								set(
									"legendBackgroundColor",
									theme.legendBackgroundColor ?? "#ffffff"
								)
							}
						/>
						<span className="vc-text">
							Custom color
						</span>
					</label>
					{theme.legendBackgroundColor !== null && (
						<ColorInput
							label="Color"
							value={theme.legendBackgroundColor}
							onChange={(v) => set("legendBackgroundColor", v)}
						/>
					)}
				</div>
				<Checkbox
					label="Border"
					checked={seed.showBorder}
					onChange={(v) => set("legendShowBorder", v)}
					className="mt-2"
				/>
				{seed.showBorder && (
					<>
						<NumberInput
							label="Corner radius"
							value={seed.borderRadius}
							min={0}
							max={50}
							step={1}
							suffix="px"
							onChange={(v) => set("legendBorderRadius", Math.max(0, v))}
						/>
						<ColorInput
							label="Border color"
							value={seed.borderColor}
							onChange={(v) => set("legendBorderColor", v)}
						/>
					</>
				)}
			</Section>
			<Section title="Swatch color">
				<p className="text-xs vc-muted">
					Default fill and outline for length / angle / area / opacity
					legend swatches when they render alongside a gradient (no hue
					color to inherit). The outline applies to the area (size)
					swatch. Per-visual overrides live in Legend.
				</p>
				<ColorInput
					label="Fill"
					value={theme.legendSwatchColor}
					onChange={(v) => set("legendSwatchColor", v)}
				/>
				<ColorInput
					label="Outline"
					value={theme.legendSwatchStroke}
					onChange={(v) => set("legendSwatchStroke", v)}
				/>
			</Section>
			<Section title="Legend swatches">
				<p className="text-xs vc-muted">
					What the discrete swatches of a color, saturation, brightness,
					pattern, opacity, or rug legend start as. A shape encoding keeps
					its own glyphs. Legend&apos;s Swatches groups override
					these per visual.
				</p>
				<div className="flex flex-col gap-1.5">
					<span className="text-sm vc-muted">Swatch shape</span>
					<SwatchShapePicker
						value={theme.legendSwatchShape}
						onChange={(shape) => set("legendSwatchShape", shape)}
					/>
				</div>
				<NumberInput
					label="Swatch size"
					value={theme.legendSwatchSize}
					min={3}
					max={20}
					step={1}
					suffix="px"
					onChange={(v) => set("legendSwatchSize", v)}
				/>
				<NumberInput
					label="Outline width"
					value={theme.legendSwatchOutlineWidth}
					min={0}
					max={10}
					step={0.5}
					suffix="px"
					onChange={(v) => set("legendSwatchOutlineWidth", v)}
				/>
				<div className="flex flex-col gap-1.5">
					<span className="text-sm vc-muted">Outline color</span>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={theme.legendSwatchOutlineColor === null}
							onChange={() => set("legendSwatchOutlineColor", null)}
						/>
						<span className="vc-text">
							Automatic (follows the marks&apos; outline)
						</span>
					</label>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={theme.legendSwatchOutlineColor !== null}
							onChange={() =>
								set(
									"legendSwatchOutlineColor",
									theme.legendSwatchOutlineColor ?? "#cccccc"
								)
							}
						/>
						<span className="vc-text">Custom color</span>
					</label>
					{theme.legendSwatchOutlineColor !== null && (
						<ColorInput
							label="Color"
							value={theme.legendSwatchOutlineColor}
							onChange={(v) => set("legendSwatchOutlineColor", v)}
						/>
					)}
				</div>
			</Section>
			<Section title="Gradient legend">
				<p className="text-xs vc-muted">
					How a quantitative color legend draws. The style is copied into new
					charts; the bar&apos;s look follows this theme on every chart that
					hasn&apos;t set its own in Legend.
				</p>
				<SelectInput
					label="Gradient legend style"
					value={seed.gradientLegendStyle ?? "bar"}
					options={GRADIENT_STYLE_OPTIONS}
					onChange={(v) =>
						set("legendGradientStyle", v === "swatches" ? "swatches" : "bar")
					}
				/>
				{/* Blank = auto (8rem minimum vertical, full legend width
				 *  horizontal) — not one fixed px value, so clear-to-null. */}
				<UiNumberInput
					label="Bar length"
					labelClassName={THEME_LABEL_CLASS}
					value={bar.length}
					placeholder="Auto"
					stepBase={128}
					min={0}
					step={1}
					suffix="px"
					onChange={(v) => set("legendGradientBarLength", Math.max(0, v))}
					onClear={() => set("legendGradientBarLength", null)}
					inputClassName="w-20"
				/>
				<NumberInput
					label="Bar thickness"
					value={bar.thickness}
					min={0}
					max={100}
					step={1}
					suffix="px"
					onChange={(v) => set("legendGradientBarThickness", Math.max(0, v))}
				/>
				<NumberInput
					label="Corner radius"
					value={bar.radius}
					min={0}
					max={50}
					step={1}
					suffix="px"
					onChange={(v) => set("legendGradientBarRadius", Math.max(0, v))}
				/>
				<NumberInput
					label="Border thickness"
					value={bar.borderWidth}
					min={0}
					max={10}
					step={0.5}
					suffix="px"
					onChange={(v) => set("legendGradientBarBorderWidth", Math.max(0, v))}
				/>
				{bar.borderWidth > 0 && (
					<ColorInput
						label="Border color"
						value={bar.borderColor}
						onChange={(v) => set("legendGradientBarBorderColor", v)}
					/>
				)}
				<NumberInput
					label="Tick length"
					value={bar.tickLength}
					min={0}
					max={20}
					step={1}
					suffix="px"
					onChange={(v) => set("legendGradientBarTickLength", Math.max(0, v))}
				/>
				{bar.tickLength > 0 && (
					<>
						<NumberInput
							label="Tick thickness"
							value={bar.tickThickness}
							min={0}
							max={10}
							step={0.5}
							suffix="px"
							onChange={(v) =>
								set("legendGradientBarTickThickness", Math.max(0, v))
							}
						/>
						<ColorInput
							label="Tick color"
							value={bar.tickColor}
							onChange={(v) => set("legendGradientBarTickColor", v)}
						/>
					</>
				)}
				<AlignmentRow
					label="Align break labels"
					value={bar.labelAlign ?? autoLabelAlign}
					onChange={(a) => set("legendGradientBarLabelAlign", a)}
				/>
			</Section>
		</SectionGroup>
	)
}
