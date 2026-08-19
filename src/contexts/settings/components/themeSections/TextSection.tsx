import { DEFAULT_DATA_LABELS_CONFIG } from "../../../chartBuilder/lib/channelConfig"
import { FONT_FAMILY_OPTIONS } from "../../../chartBuilder/lib/labelsConfig"

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

export const TextSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Text" isReadOnly={isReadOnly}>
		<Section title="Main title">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Family, color, and style also set the baseline every other
				title tier (subtitle, axis / facet titles, legend titles)
				falls back to.
			</p>
			<SelectInput
				label="Family"
				value={theme.titleFontFamily}
				onChange={(v) => set("titleFontFamily", v)}
				options={FONT_FAMILY_OPTIONS}
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
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Also styles facet titles. Family and color follow the Main
				title font.
			</p>
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
				family={theme.titleFontFamily}
				value={theme.axisTitleFontWeight}
				onChange={(w) => set("axisTitleFontWeight", w)}
				onDefault={() => set("axisTitleFontWeight", undefined)}
			/>
		</Section>

		<Section title="Axis text">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Axis tick labels. Legend labels follow these settings unless
				overridden in Legend text below.
			</p>
			<SelectInput
				label="Family"
				value={theme.textFontFamily}
				onChange={(v) => set("textFontFamily", v)}
				options={FONT_FAMILY_OPTIONS}
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
			<p className="text-sm text-stone-600 dark:text-stone-400">
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
			<FontWeightRow
				label="Title weight"
				family={theme.legendTitleFontFamily ?? theme.titleFontFamily}
				value={theme.legendTitleFontWeight}
				onChange={(w) => set("legendTitleFontWeight", w)}
				onDefault={() => set("legendTitleFontWeight", undefined)}
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
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Initial font for the Data Labels layer, applied when a chart is
				created or re-themed.
			</p>
			<FontFamilyRow
				label="Font family"
				value={
					theme.dataLabelsFontFamily ??
					DEFAULT_DATA_LABELS_CONFIG.fontFamily
				}
				onChange={(v) => set("dataLabelsFontFamily", v)}
			/>
			<ColorInput
				label="Font color"
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
				label="Font size"
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
	</SectionGroup>
)
