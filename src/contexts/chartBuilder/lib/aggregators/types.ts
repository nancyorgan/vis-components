import type { FieldType } from "../types"

/** Common error shape for any aggregator. */
export type AggregatorError = { kind: "error"; message: string }

/** Re-export the existing stack types from stacks.ts so consumers have a
 * single import point. The actual types are defined alongside the
 * `aggregateStacks` function in stacks.ts. */
export type { Stack, StackSlice, GroupChannel, GroupEncoding } from "./stacks"

/** Result of `aggregateStacks`: a list of stacks (one per category) each
 * containing slices (one per group tuple). Used by bar, pie, and future
 * stacked-area charts. */
export type StacksAggregatorResult =
	| AggregatorError
	| {
			kind: "stacks"
			stacks: Array<import("./stacks").Stack>
			categories: string[]
	  }

/** Future — per-row rendering (scatter, heatmap, table). Not wired yet. */
export type RowsAggregatorResult =
	| AggregatorError
	| { kind: "rows"; rows: Array<Record<string, unknown>> }

/** Future — distribution summaries (box, violin). Not wired yet. */
export type DistributionSlice = {
	category: string
	min: number
	q1: number
	median: number
	q3: number
	max: number
	outliers: number[]
	// (violin-specific density samples may be added later)
}
export type DistributionsAggregatorResult =
	| AggregatorError
	| { kind: "distributions"; slices: DistributionSlice[] }

/** Common input shape. Specific aggregators may extend this — see
 * AggregateStacksInput in stacks.ts. */
export type AggregatorInput = {
	rows: Array<Record<string, unknown>>
	categoryField: string
	categoryType: FieldType
}
