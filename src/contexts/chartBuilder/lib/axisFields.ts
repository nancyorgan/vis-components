import type { ChartMode } from "./chartMode"
import type { Encodings } from "./types"

/** Resolve which encoding field drives each axis for a given chart mode.
 *  `null` means that axis doesn't exist in this mode (e.g. y in pies-x)
 *  OR that the relevant encoding isn't mapped.
 *
 *  Per mode:
 *    - bars-x / areas-x:  x ← x encoding, y ← length encoding (measure)
 *    - bars-y / areas-y:  x ← length encoding (measure), y ← y encoding
 *    - pies-x:            x ← x encoding, y ← null
 *    - pies-y:            x ← null, y ← y encoding
 *    - pies (single):     both null
 *    - scatter / tile:    x ← x encoding, y ← y encoding
 *
 *  This is the single source of truth for "what field is the x-axis
 *  reading from?" — used for shared axis titles, annotation scale
 *  lookup, and any other code that needs to map mode → axis field. */
export const axisFieldsFor = (
	mode: ChartMode,
	encodings: Encodings,
): { xField: string | null; yField: string | null } => {
	// Radar has no cartesian axes (just polar `r` and `angle`), so both
	// fields are null. Callers checking `hasXAxis` / `hasYAxis` skip
	// rendering shared cartesian titles for radar anyway.
	if (mode === "radar") return { xField: null, yField: null }

	let xField: string | null
	if (mode === "pies-y" || mode === "pies") xField = null
	else if (mode === "bars-y" || mode === "areas-y")
		xField = encodings.length?.field ?? null
	else xField = encodings.x?.field ?? null

	let yField: string | null
	if (mode === "pies-x" || mode === "pies") yField = null
	else if (mode === "bars-x" || mode === "areas-x")
		yField = encodings.length?.field ?? null
	else yField = encodings.y?.field ?? null

	return { xField, yField }
}

/** True when this chart mode renders an x-axis at all. False for pies-y,
 *  single-pie, and radar modes — they don't draw a cartesian x-axis
 *  regardless of encoding mapping. */
export const hasXAxis = (mode: ChartMode): boolean =>
	mode !== "pies-y" && mode !== "pies" && mode !== "radar"

/** True when this chart mode renders a y-axis at all. False for pies-x,
 *  single-pie, and radar modes. */
export const hasYAxis = (mode: ChartMode): boolean =>
	mode !== "pies-x" && mode !== "pies" && mode !== "radar"
