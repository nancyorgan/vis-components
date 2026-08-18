import { DashStylePicker } from "../../../chartBuilder/components/sidebar/channelOptions/dashControls"
import { FONT_FAMILY_OPTIONS } from "../../../chartBuilder/lib/labelsConfig"
import {
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
} from "../../../chartBuilder/lib/themeConfig"

import {
	AlignmentRow,
	ColorInput,
	FontWeightRow,
	NumberInput,
	Section,
	SectionGroup,
	SelectInput,
	THEME_LABEL_CLASS,
} from "./controls"
import type { ThemeSectionProps } from "./types"

export const AnnotationsSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => {
	// Resolved values: the theme's annotation fields with the built-in seed
	// values behind them — exactly what a freshly-added annotation gets (the
	// same builders the Annotations panel seeds and resets from).
	const box = rectangleStyleFromTheme(theme)
	const line = lineAnnotationStyleFromTheme(theme)
	return (
		<SectionGroup title="Annotations" isReadOnly={isReadOnly}>
			<Section title="Rectangles &amp; circles">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Initial fill and border for newly added rectangle and circle
					annotations. Existing annotations keep their styling.
				</p>
				<ColorInput
					label="Fill color"
					value={box.backgroundColor}
					onChange={(v) => set("annotationFillColor", v)}
				/>
				<NumberInput
					label="Fill opacity"
					value={box.backgroundOpacity}
					onChange={(v) => set("annotationFillOpacity", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<ColorInput
					label="Border color"
					value={box.borderColor}
					onChange={(v) => set("annotationBorderColor", v)}
				/>
				<NumberInput
					label="Border thickness"
					value={box.borderThickness}
					onChange={(v) => set("annotationBorderThickness", v)}
					min={0}
					max={20}
					step={0.5}
					suffix="px"
				/>
				<NumberInput
					label="Border opacity"
					value={box.borderOpacity}
					onChange={(v) => set("annotationBorderOpacity", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<div className="flex items-start gap-2 text-sm">
					<span className={`${THEME_LABEL_CLASS} shrink-0 pt-1.5`}>
						Border dash
					</span>
					<DashStylePicker
						pattern={box.borderDash}
						customDasharray={box.borderDasharray}
						onChange={({ pattern, customDasharray }) => {
							set("annotationBorderDash", pattern)
							set("annotationBorderDasharray", customDasharray)
						}}
						ariaContext="annotation border"
					/>
				</div>
			</Section>

			<Section title="Rectangle text">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Initial font for the text drawn inside rectangle annotations.
				</p>
				<SelectInput
					label="Family"
					value={box.textFontFamily}
					onChange={(v) => set("annotationTextFontFamily", v)}
					options={FONT_FAMILY_OPTIONS}
				/>
				<ColorInput
					label="Color"
					value={box.textColor}
					onChange={(v) => set("annotationTextColor", v)}
				/>
				<NumberInput
					label="Size"
					value={box.textFontSize}
					onChange={(v) => set("annotationTextFontSize", v)}
					min={6}
					max={48}
					step={1}
					suffix="pt"
				/>
				<FontWeightRow
					label="Weight"
					family={box.textFontFamily}
					value={box.textFontWeight}
					onChange={(w) => set("annotationTextFontWeight", w)}
				/>
				<AlignmentRow
					label="Alignment"
					value={box.textAlign}
					onChange={(a) => set("annotationTextAlign", a)}
				/>
				<NumberInput
					label="Padding"
					value={box.textPadding}
					onChange={(v) => set("annotationTextPadding", v)}
					min={0}
					max={64}
					step={1}
					suffix="px"
				/>
			</Section>

			<Section title="Lines">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Initial stroke for newly added line annotations.
				</p>
				<ColorInput
					label="Color"
					value={line.lineColor}
					onChange={(v) => set("annotationLineColor", v)}
				/>
				<NumberInput
					label="Thickness"
					value={line.lineThickness}
					onChange={(v) => set("annotationLineThickness", v)}
					min={0}
					max={20}
					step={0.5}
					suffix="px"
				/>
				<NumberInput
					label="Opacity"
					value={line.lineOpacity}
					onChange={(v) => set("annotationLineOpacity", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<div className="flex items-start gap-2 text-sm">
					<span className={`${THEME_LABEL_CLASS} shrink-0 pt-1.5`}>
						Dash
					</span>
					<DashStylePicker
						pattern={line.lineDash}
						customDasharray={line.lineDasharray}
						onChange={({ pattern, customDasharray }) => {
							set("annotationLineDash", pattern)
							set("annotationLineDasharray", customDasharray)
						}}
						ariaContext="annotation line"
					/>
				</div>
			</Section>
		</SectionGroup>
	)
}
