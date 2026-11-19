import { Fragment, type ReactNode } from "react"

import type { PatternSection } from "../../../lib/patternMenu"
import { orderedLevels } from "../../../lib/smartSort"

import { StackModeRow } from "./StackModeRow"
import { RegressionDashSubsection } from "./dashControls"
import { SegmentsRow } from "./pattern/SegmentsRow"
import { ViolinFillSection } from "./pattern/ViolinFillSection"
import { FillCategory } from "./pattern/categories"
import { DashCategory, DefaultDashRow, GapFillRow } from "./pattern/dashRows"
import { FillColorRows } from "./pattern/rows"
import {
	FillSection,
	LineDashSection,
	PointOutlineSection,
	TargetFillSection,
} from "./pattern/sections"
import { DefaultSwatchRow } from "./pattern/swatchRows"
import { usePatternPanel } from "./pattern/usePatternPanel"

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/** The Pattern options. WHICH sections the chart gets, what each is titled
 *  and the order they are listed in are decided in one place — `patternMenu`
 *  (lib/patternMenu), read through `usePatternPanel` — and this panel lays
 *  out what it returns: the sections listed bare (the menu's one kind of
 *  control), then one card per titled section. Each card lives in
 *  `./pattern/`. */
export const PatternOptionsPanel = () => {
	const p = usePatternPanel()
	const { menu, patternMode, fieldValues } = p

	/** The menu's titled sections as cards, in its order — the Line's dash,
	 *  whatever there is to fill, the regression line, the violin / box. Each
	 *  card shows the default picks or the per-category ones, by whether a
	 *  Pattern variable is mapped. A section listed bare (untitled) is laid
	 *  out by its own branch below. */
	const cards: Partial<Record<PatternSection["kind"], ReactNode>> = {
		lineDash: <LineDashSection p={p} />,
		fill: <FillSection p={p} />,
		pointOutlineDash: <PointOutlineSection p={p} />,
		polygonFill: <TargetFillSection p={p} target="polygon" />,
		areaPointFill: <TargetFillSection p={p} target="areaPoint" />,
		violinFill: <ViolinFillSection p={p} />,
		regressionDash: <RegressionDashSubsection />,
	}
	const sectionCards = menu.sections
		.filter((s) => s.titled)
		.map((s, i) => (
			// eslint-disable-next-line react/no-array-index-key -- a fixed list per chart
			<Fragment key={`${s.kind}:${i}`}>{cards[s.kind]}</Fragment>
		))

	// No field mapped — show default pattern picker + ink color
	if (!p.patternFieldMapped) {
		// The labeled default row ("Line dash" / "Default pattern") is one
		// more label-column row, like the Segments row that may sit over it:
		// no divider between them (a divider never sets off a single row).
		return (
			<div className="vc-option-panel">
				<SegmentsRow p={p} />
				{/* The menu's one kind of control, where it is listed bare. */}
				{patternMode === "segmentDash" ? (
					// Thin segments: Pattern is the segment dash. No range window
					// (a segment has no "from / to").
					<>
						<div className="px-2">
							<DefaultDashRow p={p} label="Line dash" />
						</div>
						{p.dashInEffect && (
							<div className="px-2">
								<GapFillRow p={p} />
							</div>
						)}
					</>
				) : (
					patternMode === "fill" &&
					!p.ownFillTitled && (
						<>
							<div className="px-2">
								<DefaultSwatchRow
									p={p}
									label="Default pattern"
									palette={p.activePalette}
									Glyph={p.PatternSwatch}
									showNone
								/>
							</div>
							<div className="flex flex-col gap-2 px-2 empty:hidden">
								<FillColorRows p={p} />
							</div>
						</>
					)
				)}
				{sectionCards}
			</div>
		)
	}

	const hasLevels = !!fieldValues && fieldValues.values.length > 0
	const dashList = patternMode === "dashOnly" || patternMode === "segmentDash"

	return (
		<div className="vc-option-panel">
			<StackModeRow channel="pattern" className="px-2" />
			<SegmentsRow p={p} />
			{/* The menu's one kind of control, where it is listed bare (fill only,
			 *  or dash only): a flat per-category list — a header over the only
			 *  kind of control there is would be redundant. */}
			{fieldValues && fieldValues.values.length > 0 && p.listedBare && (
				<>
					<div className="flex flex-col gap-4 px-2">
						{orderedLevels(
							fieldValues.values,
							fieldValues.type,
							fieldValues.order
						).map(({ value: v, index: i }) =>
							dashList ? (
								<DashCategory
									key={v}
									p={p}
									v={v}
									i={i}
									display={fieldValues.labels?.[i]}
								/>
							) : (
								<FillCategory
									key={v}
									p={p}
									v={v}
									i={i}
									display={fieldValues.labels?.[i]}
								/>
							)
						)}
						{/* Range rows are hidden with a pattern variable mapped: the
						 *  variable itself says where each dash applies. */}
						{dashList && <GapFillRow p={p} />}
					</div>
				</>
			)}
			{/* One card per section the menu lists under a title, in its order.
			 *  With no categories to list yet, the regression line's dash (which
			 *  needs none) still shows. */}
			{hasLevels
				? sectionCards
				: p.offers("regressionDash") && <RegressionDashSubsection />}
		</div>
	)
}
