import type { ChartMode } from "./chartMode"

/** Decide whether a faceted panel renderer should receive the full
 *  dataset's rows for ITS category axis ("share categories" mode). The
 *  rule is mode-aware because different modes put the category axis on
 *  different positions:
 *
 *  - `bars-x` / `areas-x` (vertical bars / vertical areas): category is
 *    on x → sharing categories means `shareX` is on.
 *  - `bars-y` / `areas-y` (horizontal bars / horizontal areas): category
 *    is on y → sharing categories means `shareY` is on.
 *  - Other modes (scatter, pies, tile) don't use the legacy
 *    `scalesRowsOverride` for a single category axis; they handle X / Y
 *    independently via `scalesRowsOverrideX` / `scalesRowsOverrideY`.
 *
 *  Returns true when the bar/area panel should see `dataset.rows` for
 *  category-list construction. The previous bug was a `shareX || shareY`
 *  check that fired even when the user only wanted the measure axis
 *  shared, silently dragging the category axis along too. */
export const shouldShareCategoryRowsForBarMode = (
	modeId: ChartMode,
	shareX: boolean,
	shareY: boolean
): boolean => {
	if (modeId === "bars-x" || modeId === "areas-x") return shareX
	if (modeId === "bars-y" || modeId === "areas-y") return shareY
	// Non-bar / non-area modes don't use this prop — return false so
	// the caller defaults to per-panel rows.
	return false
}
