import {
	layerFacetOverride,
	resolveTitleFont,
	type LabelAlignment,
	type LabelsConfig,
	type VerticalAlignment,
} from "../../../lib/labelsConfig"
import type { Encodings } from "../../../lib/types"

/** Resolve every facet-title style slot (font / align / offset / vertical
 *  align / angle for the shared `facetTitle` plus the per-strip col/row and
 *  per-panel variants) from the labels config. Pure derivation — PlotCanvas
 *  calls it unmemoized once per render, exactly as the inline block it
 *  replaces did. */
export const resolveFacetTitleStyles = (
	labels: LabelsConfig,
	encodings: Encodings,
) => {
	// Facet titles share the "secondary" title tier with the axis titles, so
	// by default they match — but they carry their own override slot so users
	// can style them independently (family / color / size / B-I-U / offset).
	const facetTitleFont = resolveTitleFont(
		labels.baseFont,
		"secondary",
		labels.fontOverrides?.facetTitle
	)
	const facetTitleOffset = {
		x: labels.titleOffsets?.facetTitle?.x ?? 0,
		y: labels.titleOffsets?.facetTitle?.y ?? 0,
	}
	const facetTitleAlign: LabelAlignment =
		(labels.titleAlignments?.facetTitle as LabelAlignment) ?? "center"
	// When BOTH facetCol and facetRow are mapped, the grid's top (column) and
	// left (row) header strips can be styled independently. Each per-strip slot
	// layers on top of the shared `facetTitle` styling. When only one facet axis
	// is mapped (or wrap mode), there's a single strip styled by the unified
	// `facetTitle` — any leftover per-strip override from a previous both-mapped
	// state is intentionally ignored, so the lone strip never surprises the user.
	const facetGridSplit =
		Boolean(encodings.facetCol?.field) && Boolean(encodings.facetRow?.field)
	const facetColTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetColTitle
				)
			)
		: facetTitleFont
	const facetRowTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetRowTitle
				)
			)
		: facetTitleFont
	const facetColTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetColTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	const facetRowTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetRowTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	// Vertical placement of the row-title within each row's own plot rect (rows
	// can differ in height). Mirrors the horizontal-align resolution: in a
	// both-axes grid the `facetRowTitle` slot layers over `facetTitle`; in a
	// row-only facet the lone strip is styled by `facetTitle` directly. Any
	// leftover `facetRowTitle` value from a previous both-mapped state is
	// intentionally ignored in the non-split case so the lone strip never
	// surprises the user. Defaults to the legacy centered behavior.
	const facetTitleVAlign: VerticalAlignment =
		labels.titleVerticalAlignments?.facetTitle ?? "middle"
	const facetRowTitleVAlign: VerticalAlignment = facetGridSplit
		? (labels.titleVerticalAlignments?.facetRowTitle ??
			labels.titleVerticalAlignments?.facetTitle ??
			"middle")
		: facetTitleVAlign
	const facetColTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetColTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetColTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	const facetRowTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetRowTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetRowTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	// Hide-empty compaction's per-panel title bands (grid mode only — both
	// facet axes mapped) get their own style slot, layered over `facetTitle`
	// exactly like the per-strip slots above. Wrap-mode per-panel titles keep
	// `facetTitle` directly (the non-split fallback keeps them byte-identical).
	const facetPanelTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetPanelTitle
				)
			)
		: facetTitleFont
	const facetPanelTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetPanelTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	const facetPanelTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetPanelTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetPanelTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	// Facet-title rotation (degrees, about the anchor point). Mirrors the
	// alignment / offset resolution: per-strip and per-panel slots layer over
	// the shared `facetTitle` angle in a both-axes grid; otherwise the lone
	// strip / wrap panel titles read `facetTitle` directly. The rotation is a
	// paint-time transform only — the solver's band reserve doesn't grow for
	// the rotated extent, so steep angles pair with an offset (same contract
	// as facet-title offsets).
	const facetTitleAngle = labels.titleAngles?.facetTitle ?? 0
	const facetColTitleAngle = facetGridSplit
		? (labels.titleAngles?.facetColTitle ??
			labels.titleAngles?.facetTitle ??
			0)
		: facetTitleAngle
	const facetRowTitleAngle = facetGridSplit
		? (labels.titleAngles?.facetRowTitle ??
			labels.titleAngles?.facetTitle ??
			0)
		: facetTitleAngle
	const facetPanelTitleAngle = facetGridSplit
		? (labels.titleAngles?.facetPanelTitle ??
			labels.titleAngles?.facetTitle ??
			0)
		: facetTitleAngle
	return {
		facetTitleFont,
		facetTitleOffset,
		facetTitleAlign,
		facetColTitleFont,
		facetRowTitleFont,
		facetColTitleAlign,
		facetRowTitleAlign,
		facetTitleVAlign,
		facetRowTitleVAlign,
		facetColTitleOffset,
		facetRowTitleOffset,
		facetPanelTitleFont,
		facetPanelTitleAlign,
		facetPanelTitleOffset,
		facetTitleAngle,
		facetColTitleAngle,
		facetRowTitleAngle,
		facetPanelTitleAngle,
	}
}
