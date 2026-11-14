/** What the options sweep records, per chart → row → control → change. */

export type ChangeResult = "changed" | "legend-only" | "unchanged" | "error"

/** A control a parent change revealed, tried from the parent's state. */
export type NestedResult = {
	section: string
	label: string
	kind: string
	describe: string
	result: ChangeResult
	detail?: string
}

/** One change tried on a control. */
export type Outcome = {
	/** What was done ("→ Region", "step up", "#ff1ee8"). */
	describe: string
	result: ChangeResult
	detail?: string
	/** How many drivable controls the change revealed. */
	revealed?: number
	nested?: NestedResult[]
}

export type ControlResult = {
	key: string
	section: string
	label: string
	kind: string
	/** `tested`: outcomes hold what happened. `disabled`: greyed out.
	 *  `current`: the already-selected choice of a group (nothing to try).
	 *  `not-driven`: a kind the sweep does not operate (an action button, a
	 *  free-text box). */
	status: "tested" | "disabled" | "current" | "not-driven"
	outcomes: Outcome[]
}

export type RowResult = {
	channel: string
	exists: boolean
	hasPanel: boolean
	/** The "Not in effect while … is mapped" note when the whole panel is
	 *  greyed out. */
	blocked: string | null
	/** Help text the panel shows. */
	notes: string[]
	controls: ControlResult[]
}

export type SweepResult = {
	chart: {
		id: string
		label: string
		/** Key into SWEEP_DATASETS. */
		dataset: string
		variation: string | null
		encodings: Record<string, string>
	}
	warnings: string[]
	pageErrors: string[]
	rows: RowResult[]
}

/** What a change did, counting the controls it revealed. A "Vary by" whose
 *  per-value levels all start equal changes nothing by itself; it counts as
 *  changing the chart if one of the levels it reveals does. */
export type Effect = "chart" | "legend" | "none"

export const outcomeEffect = (o: Outcome): Effect => {
	const results = [o.result, ...(o.nested ?? []).map((n) => n.result)]
	if (results.includes("changed")) return "chart"
	if (results.includes("legend-only")) return "legend"
	return "none"
}

/** A control's overall state across the changes tried on it.
 *    works        every change tried changed the chart
 *    partly       some did, some did not (for a "Vary by": some fields)
 *    legend-only  the legend changed but the chart never did
 *    inert        nothing changed
 *    error        the sweep could not operate it
 *    untested     not driven (disabled, an action button, the current choice) */
export type ControlVerdict = "works" | "partly" | "legend-only" | "inert" | "error" | "untested"

export const controlVerdict = (c: ControlResult): ControlVerdict => {
	if (c.status !== "tested" || c.outcomes.length === 0) return "untested"
	const effects = c.outcomes.map(outcomeEffect)
	const onChart = effects.filter((e) => e === "chart").length
	if (onChart === effects.length) return "works"
	// A number box or slider is moved a second way only when the first did
	// nothing, so any working move means the control works.
	if (onChart > 0) return c.kind === "number" || c.kind === "range" ? "works" : "partly"
	if (effects.includes("legend")) return "legend-only"
	return c.outcomes.every((o) => o.result === "error") ? "error" : "inert"
}

// ---------------------------------------------------------------------------
// Layout sweep

/** One thing that went wrong at one value of a control. */
export type LayoutIssue = {
	/** The control's value when it happened ("at rest" before it moved). */
	value: string
	/** What: an item ('title "Sales"', "legend", "plot") or "scrollbar". */
	what: string
	/** How far off the page, or how far it jumped. */
	px: number
}

/** What happened while one position control was swept across its range. */
export type KnobResult = {
	knob: string
	/** "swept", or why it could not be. */
	status: string
	steps: number
	/** Items already off the page before the control moved. */
	atRest?: LayoutIssue[]
	scrollsAtRest?: boolean
	/** Each item the sweep pushed off the page, at the first value it left. */
	offPage: LayoutIssue[]
	/** Steps at which something the sweep moved was off the page. */
	offPageCount: number
	/** The first value at which a scrollbar appeared. */
	scroll: LayoutIssue[]
	scrollCount: number
	/** The five largest single-step jumps. */
	jumps: LayoutIssue[]
	jumpCount: number
	/** The smallest the plot got, and where. */
	smallestPlot: { w: number; h: number; at: string } | null
}

export type LayoutResult = {
	chart: { id: string; label: string }
	knobs: KnobResult[]
}
