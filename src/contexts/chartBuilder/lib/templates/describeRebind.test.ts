import { describe, expect, it } from "vitest"
import { describeRebind } from "./describeRebind"

describe("describeRebind", () => {
	it("lists renamed pairs and unmatched slots by channel label", () => {
		expect(
			describeRebind({
				mapping: { Date: "Period", Spend: "Rate", Region: null, Keep: "Keep" },
				unmatched: [{ field: "Region", channels: ["facet"] }],
			}),
		).toBe(
			"Template applied: Date → Period, Spend → Rate · Facet: no match — pick a field",
		)
	})

	it("says so when every field matched by name", () => {
		expect(describeRebind({ mapping: { A: "A", B: "B" }, unmatched: [] })).toBe(
			"Template applied: all fields matched by name",
		)
		expect(describeRebind({ mapping: {}, unmatched: [] })).toBe(
			"Template applied: all fields matched by name",
		)
	})

	it("lists only the missing slots when nothing was renamed", () => {
		expect(
			describeRebind({
				mapping: { A: "A", S: null, T: null },
				unmatched: [
					{ field: "S", channels: ["shape", "pattern"] },
					{ field: "T", channels: ["shape"] },
				],
			}),
		).toBe("Template applied · Shape, Pattern: no match — pick a field")
	})

	it("doesn't name fields that held no encoding slot", () => {
		expect(
			describeRebind({
				mapping: { A: "B", Note: null },
				unmatched: [{ field: "Note", channels: [] }],
			}),
		).toBe("Template applied: A → B")
		expect(
			describeRebind({
				mapping: { A: "A", Note: null },
				unmatched: [{ field: "Note", channels: [] }],
			}),
		).toBe("Template applied")
	})
})
