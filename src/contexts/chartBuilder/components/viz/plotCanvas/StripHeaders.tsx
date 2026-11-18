import type { FacetLayoutSpec } from "../../../lib/facetLayoutSolver"
import { facetTitleColorOf, type LabelsConfig } from "../../../lib/labelsConfig"
import { renderMultilineTspans } from "../../../lib/multilineText"
import type { resolveFacetTitleStyles } from "./facetTitleStyles"
import { TITLE_FILL_FALLBACK } from "./SharedText"

/** Grid-mode column / row header strips. Empty in wrap and single modes
 *  (solver returns empty arrays). The corner intersection between strips is
 *  intentionally blank — strips don't span it. Was inline in PlotCanvas's
 *  SVG, drawn after the panels (so a strip nudged into the plot area paints
 *  over the marks) and before the caption; the column strip still precedes
 *  the row strip in document order. */
export const StripHeaders = ({
	spec,
	labels,
	facetTitles,
}: {
	spec: Pick<FacetLayoutSpec, "columnHeaders" | "rowHeaders">
	/** Only the "Color by facet" lookups (`facetTitleColorOf`) read this. */
	labels: Pick<LabelsConfig, "facetTitleColorByValue" | "facetTitleColors">
	facetTitles: Pick<
		ReturnType<typeof resolveFacetTitleStyles>,
		| "facetColTitleFont"
		| "facetRowTitleFont"
		| "facetColTitleAngle"
		| "facetRowTitleAngle"
	>
}) => {
	const {
		facetColTitleFont,
		facetRowTitleFont,
		facetColTitleAngle,
		facetRowTitleAngle,
	} = facetTitles
	return (
		<>
			{spec.columnHeaders.map((h) => {
				// "Color by facet": a per-value color wins over the strip's font
				// color. Keyed by the facet VALUE — `h.text` is the drawn form,
				// which "Wrap text" may have broken onto lines.
				const colHdrFill =
					facetTitleColorOf(labels, h.value) ?? facetColTitleFont.color
				return (
					<text
						key={`colhdr-${h.value}`}
						data-column-header
						pointerEvents="none"
						x={h.x}
						y={h.y}
						textAnchor={h.textAnchor}
						transform={
							facetColTitleAngle
								? `rotate(${facetColTitleAngle}, ${h.x}, ${h.y})`
								: undefined
						}
						fontFamily={facetColTitleFont.family}
						fontSize={facetColTitleFont.size}
						fontWeight={facetColTitleFont.weight ?? 500}
						fontStyle={facetColTitleFont.italic ? "italic" : undefined}
						textDecoration={facetColTitleFont.underline ? "underline" : undefined}
						fill={colHdrFill}
						dominantBaseline="middle"
						className={colHdrFill ? undefined : TITLE_FILL_FALLBACK}
					>
						{/* A wrapped title's block centers on y, in the band the
						    solver grew for its lines. */}
						{renderMultilineTspans(h.text, h.x, { verticallyCentered: true })}
					</text>
				)
			})}
			{spec.rowHeaders.map((h) => {
				const rowHdrFill =
					facetTitleColorOf(labels, h.value) ?? facetRowTitleFont.color
				return (
					<text
						key={`rowhdr-${h.value}`}
						data-row-header
						pointerEvents="none"
						x={h.x}
						y={h.y}
						textAnchor={h.textAnchor}
						transform={
							facetRowTitleAngle
								? `rotate(${facetRowTitleAngle}, ${h.x}, ${h.y})`
								: undefined
						}
						fontFamily={facetRowTitleFont.family}
						fontSize={facetRowTitleFont.size}
						fontWeight={facetRowTitleFont.weight ?? 500}
						fontStyle={facetRowTitleFont.italic ? "italic" : undefined}
						textDecoration={facetRowTitleFont.underline ? "underline" : undefined}
						fill={rowHdrFill}
						dominantBaseline={
							h.verticalAnchor === "top"
								? "hanging"
								: h.verticalAnchor === "bottom"
									? "auto"
									: "middle"
						}
						className={rowHdrFill ? undefined : TITLE_FILL_FALLBACK}
					>
						{/* A wrapped title keeps the edge it is anchored to: lines
						    hang below a top anchor, stack up from a bottom one, and
						    center on a middle one. */}
						{renderMultilineTspans(h.text, h.x, {
							verticallyCentered: h.verticalAnchor === undefined || h.verticalAnchor === "middle",
							growUp: h.verticalAnchor === "bottom",
							fontSize: facetRowTitleFont.size,
						})}
					</text>
				)
			})}
		</>
	)
}
