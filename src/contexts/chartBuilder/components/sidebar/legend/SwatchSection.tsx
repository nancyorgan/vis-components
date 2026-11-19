import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import {
	LEGEND_FRIENDLY_NAME,
	legendSwatchOutlineColor,
	resolveLegendSwatchOutlineColor,
	resolveLegendSwatchSize,
	type LegendChannel,
	type SwatchShapeChannel,
} from "../../../lib/labelsConfig"
import { swatchOutlineWidthPatch, swatchShapePatch } from "../../../lib/legendEdits"
import {
	legendSwatchControls,
	resolveSectionOutlineWidth,
	resolveSectionSwatchShape,
	sectionOutlineWidthAuto,
	type SwatchMember,
} from "../../../lib/legendSwatchControls"
import { SwatchShapePicker } from "../SwatchShapePicker"
import { SwatchBreaksRows } from "./LegendBreaksRows"
import { type SwatchGroupChannel } from "./legendSwatchPlan"
import { PatternFillRows } from "./PatternFillRows"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** One swatch-drawing legend section's subsection ("Color swatch",
 *  "Brightness · Pattern swatch", "Rug swatch", …), keyed by the channel that
 *  leads the section. Renders nothing when the section has nothing to choose. */
export const SwatchSection = ({
	m,
	ch,
}: {
	m: LegendPanelModel
	ch: Exclude<SwatchShapeChannel, "shape">
}) => {
	const {
		merged,
		update,
		theme,
		groupChanged,
		encodings,
		configs,
		swatchSectionMembers,
		marksShape,
		sectionMembersOf,
		swatchCtx,
		isQuantField,
		setSwatchSize,
		setSwatchOutlineColor,
		resetSwatchOutlineColor,
		rugField,
		swatchBreakFields,
		breaksSet,
		resolvedAuxSwatchColor,
		resolvedAuxSwatchStroke,
	} = m
	// Group channels folded into this section (lead first). Drives
	// which color rows are live: pattern tiles
	// own the swatch background, so the aux Swatch-color row is
	// inert when pattern is a member (except in line context,
	// where the dash overlay strokes with the aux color), and
	// the pattern Background / Pattern-color rows surface on
	// whichever section pattern folded into (unless hue leads —
	// hue owns the tile background there).
	const members: readonly SwatchGroupChannel[] =
		ch === "rug" ? [] : swatchSectionMembers(ch)
	const patternInSection = members.includes("pattern")
	// Every channel the section's swatches depict → the rows
	// this subsection offers (see legendSwatchControls).
	const sectionField = ch === "rug" ? rugField : encodings[ch]?.field
	const swatchMembers: SwatchMember[] =
		ch === "rug" ? ["rug"] : sectionMembersOf(sectionField, ch)
	const controls = legendSwatchControls(swatchMembers, swatchCtx)
	const glyphSection = controls.shapeOptions === "glyphs"
	const outlineAuto = sectionOutlineWidthAuto(
		swatchMembers,
		isQuantField(sectionField),
		configs.shape?.outlineWidth
	)
	const outlineWidth = resolveSectionOutlineWidth(
		merged,
		theme,
		ch,
		outlineAuto
	)
	const shapeValue = resolveSectionSwatchShape(
		merged,
		theme,
		ch,
		swatchMembers,
		marksShape,
		swatchCtx
	)
	const auxColorRow =
		(ch === "opacity" ||
			ch === "saturation" ||
			ch === "brightness") &&
		(!patternInSection || !!encodings.connection?.field)
	// Nothing to choose (e.g. a Color · Length vector-field
	// legend: segments in the hue color) → no subsection.
	const breaksHere =
		!!sectionField && swatchBreakFields.has(sectionField)
	if (
		!controls.shape &&
		!controls.size &&
		!controls.outlineColor &&
		!controls.outlineWidth &&
		!auxColorRow &&
		controls.fill !== "pattern" &&
		!breaksHere
	)
		return null
	// Each swatch-drawing legend section gets its OWN collapsible
	// subsection, titled by the channels it represents — matching
	// the standalone "Shape swatch" / "Size swatch" subsections.
	const sectionName =
		ch === "rug"
			? LEGEND_FRIENDLY_NAME.rug
			: swatchMembers
					.map((c) => LEGEND_FRIENDLY_NAME[c as LegendChannel])
					.join(" · ")
	// The dot lights when ANY member channel's swatch settings
	// deviate — a combined "Brightness · Pattern" subsection also
	// hosts the pattern rows, so it tracks both channels.
	const sectionChanged =
		ch === "rug"
			? groupChanged("swatch:rug")
			: members.some((m) => groupChanged(`swatch:${m}`)) ||
				(breaksHere && breaksSet(sectionField))
	return (
		<CollapsibleSubsection
			key={ch}
			title={`${sectionName} swatch`}
			changed={sectionChanged}
		>
		<div className="flex flex-col gap-1 text-sm">
			{controls.shape && (
				<div className="flex items-start gap-2">
					<span className={`${LABEL_COL} shrink-0 pt-1 text-sm`}>
						Swatch shape
					</span>
					{/* Glyph sections (Size / Angle folded in) draw the
					 *  marks' shape by default and take glyphs only — a
					 *  rectangle or line can't show a size or rotation.
					 *  Chips start on the label's row and wrap onto the
					 *  control column (MapsSection's no-data pattern row). */}
					<SwatchShapePicker
						value={shapeValue}
						defaultShape={
							glyphSection ? marksShape : theme.legendSwatchShape
						}
						options={controls.shapeOptions}
						onChange={(shape) =>
							update(
								swatchShapePatch(
									merged,
									ch,
									shape,
									theme,
									glyphSection ? marksShape : undefined
								)
							)
						}
					/>
				</div>
			)}
			{controls.size && (
			<div className="flex items-center gap-2">
				<NumberInput
					label="Swatch size"
					labelClassName={LABEL_COL}
					value={resolveLegendSwatchSize(merged, theme, ch)}
					min={3}
					max={20}
					step={1}
					clamp
					onChange={(size) => setSwatchSize(ch, size)}
					suffix="px"
				/>
				{resolveLegendSwatchSize(merged, theme, ch) !==
					theme.legendSwatchSize && (
					<ResetLink
						onClick={() => setSwatchSize(ch, theme.legendSwatchSize)}
					/>
				)}
			</div>
			)}
			{/* Swatch color: opacity / saturation / brightness swatches
			 *  paint with the shared aux color (no hue scale to inherit
			 *  from), so its picker lives right in their group — the
			 *  same `auxLegendSwatchColor` the Length / Angle / Size
			 *  subsection edits. Resets to the theme's default. Inert
			 *  (hidden) when pattern shares the section — the tiles
			 *  paint the pattern Background instead — unless the dash
			 *  overlay (line context) strokes with this color. */}
			{auxColorRow && (
				<div className="flex flex-wrap items-center gap-2">
					<ColorInput
						label="Swatch color"
						labelClassName={LABEL_COL}
						value={resolvedAuxSwatchColor}
						onChange={(auxLegendSwatchColor) =>
							update({ auxLegendSwatchColor })
						}
						showHexInput
					/>
					{merged.auxLegendSwatchColor != null && (
						<ResetLink
							onClick={() =>
								update({ auxLegendSwatchColor: null })
							}
						/>
					)}
				</div>
			)}
			{/* No-hue pattern tiles (pattern leads, or folded into a
			 *  sat / bri / opacity-led section): the tiles default to
			 *  the Pattern menu's Background (else gray) under a
			 *  near-black ink — offer both as legend-side overrides.
			 *  Per-category ink overrides from the Pattern menu still
			 *  win in the renderer, and both rows are moot when hue
			 *  shares the field (that section is hue-led — hue owns
			 *  the tile background). */}
			{controls.fill === "pattern" && <PatternFillRows m={m} />}
			{/* Swatch outline: per-section color + width, per
			 *  legendSwatchControls — the color row hides only when an
			 *  Outline color channel is IN this section (its scale
			 *  strokes the glyphs); the width always applies, and
			 *  channels on other fields never switch either off.
			 *  Width 0 draws no outline; the width starts from the
			 *  section's auto width (sectionOutlineWidthAuto), else
			 *  the theme's. A theme without an outline color
			 *  seeds it from the marks' outline color (Color menu →
			 *  Outline) so the legend matches the chart when the
			 *  user turns the width up — except aux-painted
			 *  sections (opacity / saturation / brightness), whose
			 *  swatches aren't mark stand-ins: those seed from the
			 *  theme's legend-swatch outline, matching the
			 *  renderer. */}
			{controls.outlineColor && (
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Outline color"
							labelClassName={LABEL_COL}
							value={resolveLegendSwatchOutlineColor(
								merged,
								theme,
								ch,
								ch === "opacity" ||
									ch === "saturation" ||
									ch === "brightness"
									? resolvedAuxSwatchStroke
									: (configs.shape?.outlineColor ??
										theme.outlineColor ??
										"#cccccc")
							)}
							onChange={(color) =>
								setSwatchOutlineColor(ch, color)
							}
							showHexInput
						/>
						{legendSwatchOutlineColor(merged, ch) !== null && (
							<ResetLink onClick={() => resetSwatchOutlineColor(ch)} />
						)}
					</div>
			)}
			{controls.outlineWidth && (
					<div className="flex items-center gap-2">
						<NumberInput
							label="Outline thickness"
							labelClassName={LABEL_COL}
							value={outlineWidth}
							min={0}
							max={10}
							step={0.5}
							clamp
							onChange={(width) =>
								update(
									swatchOutlineWidthPatch(
										merged,
										ch,
										width,
										theme,
										outlineAuto
									)
								)
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{outlineWidth !==
							(outlineAuto ?? theme.legendSwatchOutlineWidth) && (
							<ResetLink
								onClick={() =>
									update(
										swatchOutlineWidthPatch(
											merged,
											ch,
											outlineAuto ?? theme.legendSwatchOutlineWidth,
											theme,
											outlineAuto
										)
									)
								}
							/>
						)}
					</div>
			)}
			{breaksHere && sectionField && (
				<SwatchBreaksRows m={m} field={sectionField} countLabel="Swatches" />
			)}
		</div>
		</CollapsibleSubsection>
	)
}
