/** The class of a run of setting rows inside a card, with or without the
 * gray divider line above it.
 *
 * The rule the dividers follow: a divider breaks a long run of settings
 * into a few general groups. It is never drawn around a single row. So a
 * plain divider has at least two rows of settings on each side; when rows
 * that come and go with the settings leave one side with a single row, the
 * divider goes too and that row joins its neighbors:
 *
 *     <div className={rowGroup(position === "inside")}>
 *
 * A group with its own heading (`vc-group-header`) keeps its divider
 * however short it is: the heading is what makes it a group. Nothing puts
 * a divider at the very top of a card, or over a lone line of help text.
 * One block is the exception: the color rules (`ColorRulesEditor`) keep the
 * line above "+ Add color rule" even before a rule exists.
 *
 * `e2e/sweep/dividers.sweep.ts` checks this in the browser on every panel
 * of every sample chart. */
export const rowGroup = (divided: boolean): string =>
	divided ? DIVIDED_ROWS : PLAIN_ROWS

/** Rows under a divider (`.vc-divider-group` owns the rule, the top
 * padding and the row gap). */
export const DIVIDED_ROWS = "vc-divider-group"

/** The same rows with no divider: the column and gap a card's rows keep. */
export const PLAIN_ROWS = "flex flex-col gap-2"
