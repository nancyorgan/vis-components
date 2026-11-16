/** The ranges the Size menu's thickness boxes keep to. The boxes
 * (`SizeThicknessSections`) and a settings patch (`settingEffects`, the
 * path a program writes through) read the same numbers, so a thickness
 * set either way lands in the same range. A line's own thickness has only
 * a floor (`MIN_LINE_THICKNESS`). */

/** An outline: the marks' own, a violin or box's strokes, a dot map's
 *  regions. */
export const OUTLINE_THICKNESS_MAX = 10

/** A line drawn over the marks: the regression line, the density curve. */
export const OVERLAY_LINE_THICKNESS_MAX = 12
