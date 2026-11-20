import { describe, expect, it } from "vitest"
import type { Dataset, Field } from "./types"
import {
	DOUBLE,
	LONG,
	LONG_ROWS,
	REPLAY_FIXTURE_RESHAPE as reshape,
	TAGGED,
	WIDE,
	chainDataset,
	chainVersions,
	double,
	tagged,
} from "./versionReplay.fixtures"
import {
	REPLAY_PIVOT_LABEL,
	REPLAY_RESHAPE_LABEL,
	describeReplayApplied,
	describeReplaySkipped,
	functionalSteps,
	importRootId,
	planReplay,
	previewImport,
	runReplayStep,
} from "./versionReplay"

const BASE = { id: "ds-chain", name: "sales", versionId: "x" }
const names = (fields: readonly Field[]) => fields.map((f) => f.name)

describe("importRootId / functionalSteps", () => {
	it("follows editedFrom to the import, and lists the computed versions oldest first", () => {
		const versions = chainVersions()
		expect(importRootId(versions, "v5")).toBe("v1")
		expect(importRootId(versions, "v1")).toBe("v1")
		expect(importRootId(versions, "nope")).toBeNull()
		expect(functionalSteps(versions, "v5").map((v) => v.id)).toEqual(["v2", "v4", "v5"])
		expect(functionalSteps(versions, "v1")).toEqual([])
	})

	it("stops at the nearest surviving ancestor when the base was deleted", () => {
		const versions = chainVersions().filter((v) => v.id !== "v1")
		expect(importRootId(versions, "v5")).toBe("v2")
		expect(functionalSteps(versions, "v5").map((v) => v.id)).toEqual(["v4", "v5"])
	})
})

describe("runReplayStep", () => {
	it("re-does a reshape over fresh wide rows and records it", () => {
		const fresh = [{ Year: "2025", Jan: "10", Feb: "20" }]
		const result = runReplayStep(BASE, { fields: WIDE, rows: fresh }, { reshape }, {})
		expect(result.applied).toEqual({ reshape })
		expect(result.skipped).toEqual([])
		expect(names(result.table.fields)).toEqual(["Year", "month", "sales"])
		expect(result.table.rows).toEqual([
			{ Year: "2025", month: "Jan", sales: "10" },
			{ Year: "2025", month: "Feb", sales: "20" },
		])
	})

	it("skips a variable whose input column the fresh data lacks, naming it", () => {
		const result = runReplayStep(
			BASE,
			{ fields: LONG, rows: LONG_ROWS },
			{ added: [tagged] },
			{}
		)
		expect(result.applied).toBeNull()
		expect(result.skipped).toEqual([{ name: "Tagged", reason: "needs “Notes”" }])
		expect(result.table.rows).toBe(LONG_ROWS)
	})

	it("skips a reshape none of whose columns are present", () => {
		const result = runReplayStep(BASE, { fields: LONG, rows: LONG_ROWS }, { reshape }, {})
		expect(result.applied).toBeNull()
		expect(result.skipped).toEqual([
			{ name: REPLAY_RESHAPE_LABEL, reason: "none of its columns (“Jan”, “Feb”) are in the data" },
		])
	})

	it("recomputes a column in place and drops a removed one", () => {
		const fields = [LONG[0]!, DOUBLE, LONG[1]!, LONG[2]!, TAGGED]
		const rows = [{ Year: "2025", Double: "0", month: "Jan", sales: "10", Tagged: "x" }]
		const tripled = { ...double, math: { formula: "{sales} * 3" } }
		const result = runReplayStep(
			BASE,
			{ fields, rows },
			{ recomputed: [tripled], removed: ["Tagged", "Gone"] },
			{}
		)
		expect(result.applied).toEqual({ removed: ["Tagged"], recomputed: [tripled] })
		expect(names(result.table.fields)).toEqual(["Year", "Double", "month", "sales"])
		expect(result.table.rows).toEqual([{ Year: "2025", Double: "30", month: "Jan", sales: "10" }])
	})

	it("adds a recomputed column whose original add never landed", () => {
		const result = runReplayStep(
			BASE,
			{ fields: LONG, rows: LONG_ROWS },
			{ recomputed: [double] },
			{}
		)
		expect(result.applied).toEqual({ recomputed: [double] })
		expect(names(result.table.fields)).toEqual(["Year", "month", "sales", "Double"])
	})
})

describe("planReplay", () => {
	it("dry-runs the chain over the fresh columns: the hand edit is not a step, its column's reader is skipped", () => {
		const plan = planReplay(BASE, functionalSteps(chainVersions(), "v5"), WIDE)
		expect(plan.steps.map((s) => [s.versionId, s.applied, s.skipped])).toEqual([
			["v2", { reshape }, []],
			["v4", { added: [double] }, []],
			["v5", null, [{ name: "Tagged", reason: "needs “Notes”" }]],
		])
		expect(names(plan.fields)).toEqual(["Year", "month", "sales", "Double"])
		expect(describeReplayApplied(plan)).toEqual([REPLAY_RESHAPE_LABEL, "“Double”"])
		expect(describeReplaySkipped(plan)).toEqual(["“Tagged” (needs “Notes”)"])
	})
})

describe("previewImport", () => {
	it("checks the upload against the import root, not the latest version, and plans the replay", () => {
		const upload = {
			fields: [...WIDE, { name: "Mar", inferredType: "quantitative" as const }],
		}
		const preview = previewImport(chainDataset(), upload)
		expect(preview.rootId).toBe("v1")
		expect(names(preview.rootFields)).toEqual(["Year", "Jan", "Feb"])
		expect(preview.compatible).toBe(true)
		expect(preview.diff.added).toEqual(["Mar"])
		expect(names(preview.rawFields)).toEqual(["Year", "Jan", "Feb", "Mar"])
		expect(preview.steps.map((s) => s.id)).toEqual(["v2", "v4", "v5"])
		expect(describeReplayApplied(preview.plan)).toEqual([REPLAY_RESHAPE_LABEL, "“Double”"])
	})

	it("still rejects a dropped root column", () => {
		const preview = previewImport(chainDataset(), { fields: WIDE.slice(0, 2) })
		expect(preview.compatible).toBe(false)
		expect(preview.diff.missing).toEqual(["Feb"])
	})

	it("has no steps for a data set of plain imports and checks against its columns", () => {
		const dataset: Dataset = {
			id: "ds-plain",
			name: "plain",
			fields: WIDE,
			versions: [
				{ id: "a", filename: "2023.csv", rows: [], createdAt: 1 },
				{ id: "b", filename: "2024.csv", rows: [], createdAt: 2 },
			],
			latestVersionId: "b",
			createdAt: 1,
		}
		const preview = previewImport(dataset, { fields: WIDE })
		expect(preview.rootId).toBe("b")
		expect(preview.steps).toEqual([])
		expect(preview.plan.steps).toEqual([])
		expect(preview.compatible).toBe(true)
	})
})

describe("runReplayStep — long → wide pivot", () => {
	const pivot = { idFields: ["Year"], keyFields: ["month"], valueFields: ["sales"] }

	it("re-does a pivot over fresh long rows and records it", () => {
		const fresh = [
			{ Year: "2025", month: "Jan", sales: "10" },
			{ Year: "2025", month: "Feb", sales: "20" },
		]
		const result = runReplayStep(BASE, { fields: LONG, rows: fresh }, { pivot }, {})
		expect(result.applied).toEqual({ pivot })
		expect(result.skipped).toEqual([])
		expect(names(result.table.fields)).toEqual(["Year", "Jan", "Feb"])
		expect(result.table.rows).toEqual([{ Year: "2025", Jan: "10", Feb: "20" }])
	})

	it("plans a pivot from the columns alone, and names it in the dialog lines", () => {
		const plan = planReplay(
			BASE,
			[{ id: "p", filename: "Reshaped data", editedFrom: "v1", transform: { pivot } }],
			LONG
		)
		expect(plan.steps[0]?.applied).toEqual({ pivot })
		// No rows, so no minted columns yet — only the kept ID survives.
		expect(names(plan.fields)).toEqual(["Year"])
		expect(describeReplayApplied(plan)).toEqual([REPLAY_PIVOT_LABEL])
	})

	it("skips a pivot whose split-out column the fresh data lacks, naming the column", () => {
		const result = runReplayStep(BASE, { fields: WIDE, rows: [] }, { pivot }, {})
		expect(result.applied).toBeNull()
		expect(result.skipped).toEqual([
			{ name: REPLAY_PIVOT_LABEL, reason: "needs “month”, “sales”" },
		])
		const plan = planReplay(
			BASE,
			[{ id: "p", filename: "Reshaped data", editedFrom: "v1", transform: { pivot } }],
			WIDE
		)
		expect(describeReplaySkipped(plan)).toEqual([
			`${REPLAY_PIVOT_LABEL} (needs “month”, “sales”)`,
		])
	})
})

describe("runReplayStep — filter", () => {
	const base = { id: "ds", name: "sales", versionId: "v" }
	const fields = [
		{ name: "city", inferredType: "categorical" as const },
		{ name: "sales", inferredType: "quantitative" as const },
	]
	const rows = [
		{ city: "Lima", sales: "$1,200" },
		{ city: "Quito", sales: "$900" },
		{ city: "Cusco", sales: "$2,000" },
	]
	const filter = [
		{ field: "city", filter: { kind: "values" as const, excluded: ["Quito"] } },
		{
			field: "sales",
			filter: {
				kind: "conditions" as const,
				as: "number" as const,
				join: "and" as const,
				conditions: [{ op: "lt" as const, value: "1500" }],
			},
		},
	]

	it("re-runs the filters over fresh rows, leaving the cells as imported", () => {
		const result = runReplayStep(base, { fields, rows }, { filter }, {})
		expect(result.table.rows).toEqual([{ city: "Lima", sales: "$1,200" }])
		expect(result.table.fields).toEqual(fields)
		expect(result.applied).toEqual({ filter })
		expect(result.skipped).toEqual([])
	})

	it("leaves out a filter whose column the fresh data lacks, naming it", () => {
		const result = runReplayStep(
			base,
			{ fields: [fields[0]!], rows: rows.map((r) => ({ city: r.city })) },
			{ filter },
			{}
		)
		expect(result.table.rows.map((r) => r.city)).toEqual(["Lima", "Cusco"])
		expect(result.applied).toEqual({ filter: [filter[0]] })
		expect(result.skipped).toEqual([
			{ name: "filter on “sales”", reason: "needs “sales”" },
		])
	})
})

describe("runReplayStep — filters removed", () => {
	it("is not a step: the fresh rows pass through and no version is made", () => {
		const rows = [{ city: "Lima" }, { city: "Quito" }]
		const result = runReplayStep(
			{ id: "ds", name: "sales", versionId: "v" },
			{ fields: [{ name: "city", inferredType: "categorical" }], rows },
			{ filter: [] },
			{}
		)
		expect(result.table.rows).toBe(rows)
		expect(result.applied).toBeNull()
		expect(result.skipped).toEqual([])
	})
})
