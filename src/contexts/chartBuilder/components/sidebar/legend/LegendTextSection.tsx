import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SidebarJumpLink } from "../../../../../components/ui/SidebarJumpLink"
import { type FontConfig, type LabelAlignment } from "../../../lib/labelsConfig"
import { AlignmentControl, FontEditor } from "../LabelsPanel"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** "Legend text" — the labels beside each swatch (alignment + font). */
export const LegendTextSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		themeBar,
		bar,
		barValue,
		groupChanged,
		labels,
		anyGradientBar,
	} = m
	// "Legend text" — what the entry labels inherit when the per-visual
	// `textFont` leaves a field blank. Mirrors `resolveLegendTextFont`'s
	// fallback chain minus the override the editor itself writes, and stays
	// in POINTS (the font editor's unit; the resolver converts to px).
	const baseText = labels.baseFont.text
	const inheritedTextFont = {
		family: baseText.legendFamily ?? baseText.family,
		color: baseText.legendColor ?? baseText.color,
		size: baseText.legendSize ?? baseText.size,
		// Entry labels render with no weight attribute when nothing sets one,
		// so the browser's 400 is what the user actually sees inherited.
		weight: baseText.legendWeight ?? baseText.weight ?? 400,
		italic: baseText.legendItalic ?? baseText.italic ?? false,
		underline: baseText.legendUnderline ?? baseText.underline ?? false,
	}
	// The bar's break labels with no visual or theme alignment: centered
	// under a horizontal bar, left beside a vertical one.
	const breakLabelAlignAuto: LabelAlignment =
		merged.orientation === "horizontal" ? "center" : "left"
	// Left IS the historical layout (labels hug their swatches), so picking it
	// clears the setting rather than storing a redundant value — keeps the
	// config sparse and the subsection's dot honest.
	const setTextAlign = (a: LabelAlignment) =>
		update({ textAlign: a === "left" ? null : a })
	// The font editor clears a field by writing it back as `undefined`, which
	// still counts as a key — and a key is what the "changed" dot reads. Drop
	// them so clearing every field really does read as untouched.
	const setTextFont = (next: Partial<FontConfig>) => {
		const clean: Partial<FontConfig> = {}
		for (const [k, v] of Object.entries(next)) {
			if (v !== undefined) (clean as Record<string, unknown>)[k] = v
		}
		update({ textFont: clean })
	}

	return (
		<CollapsibleSubsection
				title="Legend text"
				changed={groupChanged("text")}
			>
			{/* Align leads, matching the Labels panel's title rows
			 *  (Align, then Family / Color / Size / Weight / Style). */}
			<div className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Align</span>
				<AlignmentControl
					value={merged.textAlign ?? "left"}
					onChange={setTextAlign}
				/>
				{merged.textAlign != null && (
					<ResetLink onClick={() => update({ textAlign: null })} />
				)}
			</div>
			{/* The gradient bar's break labels align on their own —
			 *  only while a bar-style gradient legend shows. */}
			{anyGradientBar && (
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>Align break labels</span>
							<AlignmentControl
								value={bar.labelAlign ?? breakLabelAlignAuto}
								onChange={(gradientBarLabelAlign) =>
									update({
										gradientBarLabelAlign: barValue(
											gradientBarLabelAlign,
											themeBar.labelAlign ?? breakLabelAlignAuto
										),
									})
								}
							/>
						</div>
					</div>
				)}
			<FontEditor
				value={merged.textFont ?? {}}
				onChange={setTextFont}
				showResetFields
				baseFamily={inheritedTextFont.family}
				baseColor={inheritedTextFont.color}
				baseSize={inheritedTextFont.size}
				baseWeight={inheritedTextFont.weight}
				baseItalic={inheritedTextFont.italic}
				baseUnderline={inheritedTextFont.underline}
			/>
			{/* The legend section TITLES live in Titles → Legend titles;
			 *  jump there rather than explain it in prose. */}
			<SidebarJumpLink
				label="Edit legend titles →"
				target={{ section: "Titles", subsection: "legend-titles" }}
			/>
		</CollapsibleSubsection>
	)
}
