/** One set of numbers for how the chrome around a plot is laid out.
 *
 *  Three pieces of code have to agree on where an axis's tick labels and
 *  title sit: the AXIS draws them (`components/viz/Axes.tsx`), the margin
 *  ESTIMATORS predict the room they take (`estimateMargins.ts`), and the
 *  layout SOLVER places titles a fixed gap from them (`facetLayoutSolver.ts`).
 *  Each used to carry its own copy of these numbers — the title-to-label gap
 *  lived in two files, the solver hard-coded the axis's label insets — so a
 *  change in one silently broke the others (a title a few pixels into its
 *  labels, a margin that fit everything but the last descender).
 *
 *  They live here once. Anything that must match what the axis draws imports
 *  it from this module; a number used in one place only stays where it is.
 *  (The page-level constants — base margins, the chart area's pad, the title
 *  bands — are in `plotLayout.ts`.) */

/** The line box of a TICK LABEL, in em: ascender + descender + a little
 *  leading. Wrapped labels stack this far apart, and a level label takes
 *  this much room below (or beside) its axis. With 1.2 the room fit only
 *  the ascender, and descenders clipped under larger fonts. */
export const TICK_LABEL_LINE_EM = 1.4

/** The line box of an AXIS TITLE, in em — the same full line box, for the
 *  same reason. */
export const AXIS_TITLE_LINE_EM = 1.4

/** Pad (px) under the x-axis title's last line, inside its reserve. */
export const X_TITLE_PAD_PX = 6

/** The distance (px) between an axis title and the rendered edge of the
 *  tick labels it sits beyond. The solver places the title this far out;
 *  the estimators reserve for it. */
export const TITLE_LABEL_GAP_PX = 25

/** Room (px) the estimators allow for a tick mark and the small gap before
 *  its label. */
export const TICK_RESERVE_PX = 10

/** Pad (px) the estimators add past the tick labels on the x side. */
export const X_TICK_LABEL_END_PAD_PX = 8

/** Pad (px) the estimators add around the y tick labels: the tick, its gap
 *  and breathing room. The outer-column margin and an interior column's
 *  chrome both use it, which is what keeps the axes of a grid with its own
 *  y axes aligned when there is no y title. */
export const Y_TICK_CHROME_PAD_PX = 24

/** How far PAST THE TICK MARK the y tick labels sit from the spine (px):
 *  the axis anchors them at `tick length + this`. */
export const Y_TICK_LABEL_INSET_PX = 4

/** The same for level x tick labels on a bottom axis… */
export const X_TICK_LABEL_INSET_PX = 12
/** …on a top axis (8, not 12: the alphabetic baseline already sits a
 *  descender's height above the ink's bottom edge)… */
export const X_TICK_LABEL_INSET_TOP_PX = 8
/** …and for rotated x tick labels, which hang from their end. */
export const X_TICK_LABEL_INSET_ROTATED_PX = 6
