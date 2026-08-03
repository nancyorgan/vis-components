/** Minimum line thickness in pixels — mirrors the `min` on the
 *  ConnectionOptionsPanel thickness input so a stored per-value override can't
 *  push a line below the same floor the single-value control enforces. */
export const MIN_LINE_THICKNESS = 0.5

export type ConnectionThicknessArgs = {
	/** Key into `byValue` for this line/layer — the connection-field value for
	 *  scatter lines and radar polygons, the hue value in area mode (matching
	 *  `resolveConnectionStroke`). `null` skips the per-value lookup. */
	groupKey: string | null
	/** The single global thickness, and the fallback for any group without a
	 *  per-value override. */
	thickness: number
	/** Per-value thickness overrides (`connection.thicknessByValue`). Absent /
	 *  empty renders identically to a single global thickness. */
	byValue: Record<string, number> | undefined
}

/** Single source of truth for a connection line / layer-edge / radar-polygon
 *  thickness. Precedence:
 *   1. `byValue[groupKey]` — per-value override (clamped to the input floor).
 *   2. `thickness` — the single global value.
 *  An empty / absent `byValue` therefore behaves exactly like the pre-existing
 *  single-thickness code, which is what keeps the "Vary by" dropdown's
 *  "Single level" option byte-identical to before. */
export const resolveConnectionThickness = ({
	groupKey,
	thickness,
	byValue,
}: ConnectionThicknessArgs): number => {
	const override = groupKey == null ? undefined : byValue?.[groupKey]
	if (override === undefined) return thickness
	return Math.max(MIN_LINE_THICKNESS, override)
}
