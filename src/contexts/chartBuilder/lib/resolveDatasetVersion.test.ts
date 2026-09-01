import { describe, expect, it } from "vitest"
import { resolveDatasetView } from "./resolveDatasetVersion"
import type { Dataset, DatasetVersion, Field } from "./types"

const version = (
	id: string,
	rows: Array<Record<string, string>>
): DatasetVersion => ({ id, filename: `${id}.csv`, rows, createdAt: 0 })

const dataset = (fields: Field[], versions: DatasetVersion[]): Dataset => ({
	id: "ds-1",
	name: "test",
	fields,
	versions,
	latestVersionId: versions.at(-1)?.id ?? "none",
	createdAt: 0,
})

describe("resolveDatasetView row remapping for renamed fields", () => {
	it("returns the version's rows untouched when no field has former names", () => {
		const rows = [{ x: "1" }]
		const view = resolveDatasetView(
			dataset([{ name: "x", inferredType: "quantitative" }], [
				version("v1", rows),
			]),
			null
		)
		expect(view?.rows).toBe(rows)
	})

	it("surfaces a former-name column under the current name", () => {
		const d = dataset(
			[
				{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] },
				{ name: "region", inferredType: "categorical" },
			],
			[version("v1", [{ rev: "10", region: "east" }])]
		)
		const view = resolveDatasetView(d, null)
		expect(view?.rows[0]?.["Revenue"]).toBe("10")
		expect(view?.rows[0]?.["region"]).toBe("east")
	})

	it("remaps per version: old-key and new-key uploads both resolve", () => {
		const d = dataset(
			[{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] }],
			[
				version("v1", [{ rev: "10" }]),
				version("v2", [{ Revenue: "20" }]),
			]
		)
		expect(resolveDatasetView(d, "v1")?.rows[0]?.["Revenue"]).toBe("10")
		expect(resolveDatasetView(d, "v2")?.rows[0]?.["Revenue"]).toBe("20")
	})

	it("the current-name key wins when a row carries both", () => {
		const d = dataset(
			[{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] }],
			[version("v1", [{ rev: "old", Revenue: "new" }])]
		)
		expect(resolveDatasetView(d, null)?.rows[0]?.["Revenue"]).toBe("new")
	})

	it("uses the earliest present alias after repeated renames", () => {
		const d = dataset(
			[{ name: "C", inferredType: "quantitative", sourceNames: ["A", "B"] }],
			[version("v1", [{ B: "b-val" }])]
		)
		expect(resolveDatasetView(d, null)?.rows[0]?.["C"]).toBe("b-val")
	})

	it("keeps the alias key readable (an old-named column re-added as its own field)", () => {
		// After renaming rev → Revenue, a later upload legitimately added a
		// NEW column also named "rev". Old versions carry one "rev" column
		// that both fields descend from — both read it.
		const d = dataset(
			[
				{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] },
				{ name: "rev", inferredType: "quantitative" },
			],
			[version("v1", [{ rev: "10" }])]
		)
		const row = resolveDatasetView(d, null)?.rows[0]
		expect(row?.["Revenue"]).toBe("10")
		expect(row?.["rev"]).toBe("10")
	})

	it("a version's keyAliases pin beats a shadowing current-name column", () => {
		// Upload-time type tiebreak: the version carries BOTH columns, and the
		// former-name column won the match — the pin makes the view read it
		// even though a current-name key exists.
		const d = dataset(
			[{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] }],
			[
				{
					...version("v1", [{ Revenue: "wrong-type", rev: "10" }]),
					keyAliases: { Revenue: "rev" },
				},
			]
		)
		expect(resolveDatasetView(d, null)?.rows[0]?.["Revenue"]).toBe("10")
	})

	it("leaves a row untouched when neither name is present (short row)", () => {
		const d = dataset(
			[{ name: "Revenue", inferredType: "quantitative", sourceNames: ["rev"] }],
			[version("v1", [{ other: "x" }])]
		)
		expect(resolveDatasetView(d, null)?.rows[0]).toEqual({ other: "x" })
	})
})
