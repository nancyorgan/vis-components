import { DEFAULT_CAPTION_CONFIG } from "../../../chartBuilder/lib/captionConfig"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../../chartBuilder/lib/channelConfig"
import { useFontFamilyOptions } from "../../../chartBuilder/store/useFontOptions"

import {
	AlignmentRow,
	ColorInput,
	FontFamilyRow,
	FontWeightRow,
	NumberInput,
	Section,
	SectionGroup,
	SelectInput,
	StyleToggleRow,
} from "./controls"
import type { ThemeSectionProps } from "./types"

export const TextSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => {
	const familyOptions = useFontFamilyOptions()
	return (
	<SectionGroup title="Text" isReadOnly={isReadOnly}>
		<Section title="Main title">
			<p className="text-sm vc-muted">
				Family, color, and style also set the baseline every other
				title tier (subtitle, axis / facet titles, legend titles)
				falls back to.
			</p>
			<SelectInput
				label="Family"
				value={theme.titleFontFamily}
				onChange={(v) => set("titleFontFamily", v)}
				options={familyOptions}
			/>
			<ColorInput
				label="Color"
				value={theme.titleFontColor}
				onChange={(v) => set("titleFontColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.titlePrimarySize}
				onChange={(v) => set("titlePrimarySize", v)}
				min={8}
				max={48}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Weight"
				family={theme.titleFontFamily}
				value={
					theme.titleFontWeight ??
					(theme.titleFontBold ? 700 : undefined)
				}
				onChange={(w) => set("titleFontWeight", w)}
				onDefault={() => {
					set("titleFontWeight", undefined)
					set("titleFontBold", false)
				}}
			/>
			<AlignmentRow
				label="Alignment"
				value={theme.titleAlignment}
				onChange={(a) => set("titleAlignment", a)}
			/>
			<StyleToggleRow
				italic={theme.titleFontItalic ?? false}
				underline={theme.titleFontUnderline ?? false}
				onItalic={(v) => set("titleFontItalic", v)}
				onUnderline={(v) => set("titleFontUnderline", v)}
			/>
		</Section>

		<Section title="Title prefix">
			<p className="text-sm vc-muted">
				The optional run in front of the chart title (&ldquo;FIGURE
				5.&rdquo;), shown when a chart&rsquo;s Title turns on Add
				prefix. Every field falls back to the Main title font.
			</p>
			<FontFamilyRow
				label="Family"
				value={theme.titlePrefixFontFamily}
				onChange={(v) => set("titlePrefixFontFamily", v)}
				onDefault={() => set("titlePrefixFontFamily", undefined)}
			/>
			<ColorInput
				label="Color"
				value={theme.titlePrefixFontColor ?? theme.titleFontColor}
				onChange={(v) => set("titlePrefixFontColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.titlePrefixFontSize ?? theme.titlePrimarySize}
				onChange={(v) => set("titlePrefixFontSize", v)}
				min={8}
				max={48}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Weight"
				family={theme.titlePrefixFontFamily ?? theme.titleFontFamily}
				value={theme.titlePrefixFontWeight}
				onChange={(w) => set("titlePrefixFontWeight", w)}
				onDefault={() => set("titlePrefixFontWeight", undefined)}
			/>
			<StyleToggleRow
				italic={theme.titlePrefixFontItalic ?? theme.titleFontItalic ?? false}
				underline={
					theme.titlePrefixFontUnderline ?? theme.titleFontUnderline ?? false
				}
				onItalic={(v) => set("titlePrefixFontItalic", v)}
				onUnderline={(v) => set("titlePrefixFontUnderline", v)}
			/>
		</Section>

		<Section title="Subtitle">
			<FontFamilyRow
				label="Family"
				value={theme.subtitleFontFamily}
				onChange={(v) => set("subtitleFontFamily", v)}
				onDefault={() => set("subtitleFontFamily", undefined)}
			/>
			<NumberInput
				label="Size"
				value={theme.titleSubtitleSize}
				onChange={(v) => set("titleSubtitleSize", v)}
				min={8}
				max={36}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Weight"
				family={theme.subtitleFontFamily ?? theme.titleFontFamily}
				value={theme.subtitleFontWeight}
				onChange={(w) => set("subtitleFontWeight", w)}
				onDefault={() => set("subtitleFontWeight", undefined)}
			/>
			<AlignmentRow
				label="Alignment"
				value={theme.subtitleAlignment}
				onChange={(a) => set("subtitleAlignment", a)}
			/>
		</Section>

		<Section title="Axis title">
			<p className="text-sm vc-muted">
				Also styles facet titles. Family, color, and style fall back
				to the Main title font.
			</p>
			<FontFamilyRow
				label="Family"
				value={theme.axisTitleFontFamily}
				onChange={(v) => set("axisTitleFontFamily", v)}
				onDefault={() => set("axisTitleFontFamily", undefined)}
			/>
			<ColorInput
				label="Color"
				value={theme.axisTitleFontColor ?? theme.titleFontColor}
				onChange={(v) => set("axisTitleFontColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.titleSecondarySize}
				onChange={(v) => set("titleSecondarySize", v)}
				min={8}
				max={36}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Weight"
				family={theme.axisTitleFontFamily ?? theme.titleFontFamily}
				value={theme.axisTitleFontWeight}
				onChange={(w) => set("axisTitleFontWeight", w)}
				onDefault={() => set("axisTitleFontWeight", undefined)}
			/>
			<StyleToggleRow
				italic={theme.axisTitleFontItalic ?? theme.titleFontItalic ?? false}
				underline={
					theme.axisTitleFontUnderline ?? theme.titleFontUnderline ?? false
				}
				onItalic={(v) => set("axisTitleFontItalic", v)}
				onUnderline={(v) => set("axisTitleFontUnderline", v)}
			/>
		</Section>

		<Section title="Axis text">
			<p className="text-sm vc-muted">
				Axis tick labels. Legend labels follow these settings unless
				overridden in Legend text below.
			</p>
			<SelectInput
				label="Family"
				value={theme.textFontFamily}
				onChange={(v) => set("textFontFamily", v)}
				options={familyOptions}
			/>
			<ColorInput
				label="Color"
				value={theme.textFontColor}
				onChange={(v) => set("textFontColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.textFontSize}
				onChange={(v) => set("textFontSize", v)}
				min={8}
				max={24}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				family={theme.textFontFamily}
				value={
					theme.textFontWeight ??
					(theme.textFontBold ? 700 : undefined)
				}
				onChange={(w) => set("textFontWeight", w)}
				onDefault={() => {
					set("textFontWeight", undefined)
					set("textFontBold", false)
				}}
			/>
			<StyleToggleRow
				italic={theme.textFontItalic ?? false}
				underline={theme.textFontUnderline ?? false}
				onItalic={(v) => set("textFontItalic", v)}
				onUnderline={(v) => set("textFontUnderline", v)}
			/>
		</Section>

		<Section title="Legend text">
			<p className="text-sm vc-muted">
				Legend section titles and entry labels. Titles fall back to
				the Main title font (size follows the Axis title size);
				labels fall back to the Axis text font.
			</p>
			<FontFamilyRow
				label="Title family"
				value={theme.legendTitleFontFamily}
				onChange={(v) => set("legendTitleFontFamily", v)}
				onDefault={() => set("legendTitleFontFamily", undefined)}
			/>
			<ColorInput
				label="Title color"
				value={theme.legendTitleFontColor ?? theme.titleFontColor}
				onChange={(v) => set("legendTitleFontColor", v)}
			/>
			<NumberInput
				label="Title size"
				value={theme.legendTitleFontSize ?? theme.titleSecondarySize}
				onChange={(v) => set("legendTitleFontSize", v)}
				min={8}
				max={36}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Title weight"
				family={theme.legendTitleFontFamily ?? theme.titleFontFamily}
				value={theme.legendTitleFontWeight}
				onChange={(w) => set("legendTitleFontWeight", w)}
				onDefault={() => set("legendTitleFontWeight", undefined)}
			/>
			<StyleToggleRow
				italic={theme.legendTitleFontItalic ?? theme.titleFontItalic ?? false}
				underline={
					theme.legendTitleFontUnderline ?? theme.titleFontUnderline ?? false
				}
				onItalic={(v) => set("legendTitleFontItalic", v)}
				onUnderline={(v) => set("legendTitleFontUnderline", v)}
			/>
			<AlignmentRow
				label="Title alignment"
				value={theme.legendTitleAlignment}
				onChange={(a) => set("legendTitleAlignment", a)}
			/>
			<FontFamilyRow
				label="Label family"
				value={theme.legendTextFontFamily}
				onChange={(v) => set("legendTextFontFamily", v)}
				onDefault={() => set("legendTextFontFamily", undefined)}
			/>
			<ColorInput
				label="Label color"
				value={theme.legendTextColor ?? theme.textFontColor}
				onChange={(v) => set("legendTextColor", v)}
			/>
			<NumberInput
				label="Label size"
				value={theme.legendTextFontSize ?? theme.textFontSize}
				onChange={(v) => set("legendTextFontSize", v)}
				min={8}
				max={24}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Label weight"
				family={theme.legendTextFontFamily ?? theme.textFontFamily}
				value={theme.legendTextFontWeight}
				onChange={(w) => set("legendTextFontWeight", w)}
				onDefault={() => set("legendTextFontWeight", undefined)}
			/>
		</Section>

		{/* Data label defaults */}
		<Section title="Data labels">
			<p className="text-sm vc-muted">
				Initial font for the Data Labels layer, applied when a chart is
				created or re-themed.
			</p>
			<FontFamilyRow
				label="Family"
				value={
					theme.dataLabelsFontFamily ??
					DEFAULT_DATA_LABELS_CONFIG.fontFamily
				}
				onChange={(v) => set("dataLabelsFontFamily", v)}
			/>
			<ColorInput
				label="Color"
				value={
					// Same effective-value chain as `dataLabelsConfigFromTheme`:
					// unset falls to the theme's text-encoding color, so the sheet
					// shows what a fresh chart's labels will actually paint.
					theme.dataLabelsColor ??
					theme.textEncodingColor ??
					DEFAULT_DATA_LABELS_CONFIG.color
				}
				onChange={(v) => set("dataLabelsColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.dataLabelsFontSize ?? 11}
				onChange={(v) => set("dataLabelsFontSize", v)}
				min={6}
				max={48}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				family={
					theme.dataLabelsFontFamily ??
					DEFAULT_DATA_LABELS_CONFIG.fontFamily
				}
				value={theme.dataLabelsFontWeight ?? 500}
				onChange={(w) => set("dataLabelsFontWeight", w)}
			/>
			<StyleToggleRow
				italic={theme.dataLabelsItalic ?? false}
				underline={theme.dataLabelsUnderline ?? false}
				onItalic={(v) => set("dataLabelsItalic", v)}
				onUnderline={(v) => set("dataLabelsUnderline", v)}
			/>
		</Section>

		{/* Caption defaults */}
		<Section title="Caption">
			<p className="text-sm vc-muted">
				Initial text style for Caption, applied when a chart
				is created or re-themed. Family and color fall back to the
				Axis text font.
			</p>
			<FontFamilyRow
				label="Family"
				value={theme.captionFontFamily ?? theme.textFontFamily}
				onChange={(v) => set("captionFontFamily", v)}
				onDefault={() => set("captionFontFamily", undefined)}
			/>
			<ColorInput
				label="Color"
				value={theme.captionFontColor ?? theme.textFontColor}
				onChange={(v) => set("captionFontColor", v)}
			/>
			<NumberInput
				label="Size"
				value={theme.captionFontSize ?? DEFAULT_CAPTION_CONFIG.fontSize}
				onChange={(v) => set("captionFontSize", v)}
				min={6}
				max={48}
				step={1}
				suffix="pt"
			/>
			<FontWeightRow
				label="Weight"
				family={theme.captionFontFamily ?? theme.textFontFamily}
				value={theme.captionFontWeight ?? DEFAULT_CAPTION_CONFIG.fontWeight}
				onChange={(w) => set("captionFontWeight", w)}
				onDefault={() => set("captionFontWeight", undefined)}
			/>
			<AlignmentRow
				label="Alignment"
				value={theme.captionAlignment ?? DEFAULT_CAPTION_CONFIG.align}
				onChange={(a) => set("captionAlignment", a)}
			/>
		</Section>
	</SectionGroup>
	)
}
