import { describe, expect, it } from "vitest"
import type { DerivedVariable } from "./derivedVariables"
import type { VersionTransform } from "./types"
import {
	derivedVariablesOfVersion,
	describeVersionOrigin,
	renameFieldInTransform,
} from "./versionTransforms"

const math = (id: string, name: string, formula: string): DerivedVariable => ({
	id,
	name,
	kind: "math",
	math: { formula },
})

describe("describeVersionOrigin", () => {
	it("tags hand edits, reshapes and each kind of derived change", () => {
		expect(describeVersionOrigin({})).toBeNull()
		expect(describeVersionOrigin({ editedFrom: "v1" })).toBe("edited by hand")
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: {
					reshape: { idFields: [], meltFields: ["a"], variableName: "c", valueName: "v" },
				},
			})
		).toBe("reshaped (wide → long)")
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: { added: [math("1", "total", "{a}+{b}"), math("2", "sign", "{a}")] },
			})
		).toBe("added “total”, “sign”")
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: { recomputed: [math("1", "total", "{a}")] },
			})
		).toBe("recomputed “total”")
		expect(
			describeVersionOrigin({ editedFrom: "v1", transform: { removed: ["total"] } })
		).toBe("removed “total”")
		// A reshape that folded live variables in says both.
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: {
					reshape: { idFields: [], meltFields: ["a"], variableName: "c", valueName: "v" },
					added: [math("1", "total", "{a}")],
				},
			})
		).toBe("reshaped (wide → long) · added “total”")
	})
})

describe("derivedVariablesOfVersion", () => {
	const versions = [
		{ id: "v1" },
		{ id: "v2", editedFrom: "v1", transform: { added: [math("t", "total", "{a}+{b}")] } },
		{ id: "v3", editedFrom: "v2" },
		{ id: "v4", editedFrom: "v3", transform: { recomputed: [math("t", "total", "{a}*2")] } },
		{ id: "v5", editedFrom: "v4", transform: { removed: ["total"] } },
		{ id: "v6", editedFrom: "v5", transform: { added: [math("u", "total", "{b}")] } },
	]

	it("walks the chain nearest-first: a recompute shadows, a removal stops, a re-add restarts", () => {
		expect(derivedVariablesOfVersion(versions, "v1").size).toBe(0)
		expect(derivedVariablesOfVersion(versions, "v2").get("total")?.math?.formula).toBe(
			"{a}+{b}"
		)
		// Through a hand edit.
		expect(derivedVariablesOfVersion(versions, "v3").get("total")?.math?.formula).toBe(
			"{a}+{b}"
		)
		expect(derivedVariablesOfVersion(versions, "v4").get("total")?.math?.formula).toBe(
			"{a}*2"
		)
		expect(derivedVariablesOfVersion(versions, "v5").has("total")).toBe(false)
		expect(derivedVariablesOfVersion(versions, "v6").get("total")?.id).toBe("u")
	})

	it("survives a dangling link and a cycle", () => {
		const dangling = versions.filter((v) => v.id !== "v1")
		expect(derivedVariablesOfVersion(dangling, "v3").get("total")?.id).toBe("t")
		const cyclic = [
			{ id: "a", editedFrom: "b", transform: { added: [math("1", "x", "1")] } },
			{ id: "b", editedFrom: "a" },
		]
		expect(derivedVariablesOfVersion(cyclic, "b").get("x")?.id).toBe("1")
	})
})

describe("renameFieldInTransform", () => {
	const t: VersionTransform = {
		reshape: {
			idFields: ["store", "total"],
			meltFields: ["monday"],
			variableName: "day",
			valueName: "sales",
		},
		added: [math("t", "total", "{monday} + {tuesday}")],
		recomputed: [math("r", "ratio", "{total} / {monday}")],
		removed: ["old"],
	}

	it("renames the column a variable made, the tokens that mention it, the reshape's lists and minted names", () => {
		const next = renameFieldInTransform(t, "total", "sum")
		expect(next.added?.[0]?.name).toBe("sum")
		expect(next.recomputed?.[0]?.math?.formula).toBe("{sum} / {monday}")
		expect(next.reshape?.idFields).toEqual(["store", "sum"])
		expect(renameFieldInTransform(t, "day", "weekday").reshape?.variableName).toBe("weekday")
		expect(renameFieldInTransform(t, "old", "older").removed).toEqual(["older"])
	})

	it("returns the same reference when nothing mentions the old name", () => {
		expect(renameFieldInTransform(t, "nothing", "x")).toBe(t)
	})

	it("reaches a second group's columns and minted names", () => {
		const grouped: VersionTransform = {
			reshape: {
				...t.reshape!,
				extraGroups: [{ meltFields: ["tuesday"], variableName: "k", valueName: "v" }],
			},
		}
		expect(renameFieldInTransform(grouped, "tuesday", "tue").reshape?.extraGroups).toEqual([
			{ meltFields: ["tue"], variableName: "k", valueName: "v" },
		])
		expect(renameFieldInTransform(grouped, "v", "val").reshape?.extraGroups).toEqual([
			{ meltFields: ["tuesday"], variableName: "k", valueName: "val" },
		])
		expect(renameFieldInTransform(grouped, "nothing", "x")).toBe(grouped)
	})
})

describe("a replay's skipped parts", () => {
	it("are tagged in the trail after what was re-applied", () => {
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: { added: [math("d", "Double", "{sales} * 2")], skipped: ["Tagged"] },
			})
		).toBe("added “Double” · couldn't re-apply “Tagged”")
	})

	it("follow a rename of the variable they name", () => {
		const t = { added: [math("d", "Double", "{sales} * 2")], skipped: ["Tagged"] }
		expect(renameFieldInTransform(t, "Tagged", "Tag").skipped).toEqual(["Tag"])
		expect(renameFieldInTransform(t, "Other", "X")).toBe(t)
	})
})

describe("long → wide pivot transforms", () => {
	const pivot = { idFields: ["store"], keyFields: ["day"], valueFields: ["sales"] }

	it("tags a pivoted version", () => {
		expect(describeVersionOrigin({ editedFrom: "v1", transform: { pivot } })).toBe(
			"reshaped (long → wide)"
		)
	})

	it("renames the pivot's columns, and keeps the reference when nothing matches", () => {
		const t: VersionTransform = { pivot }
		expect(renameFieldInTransform(t, "day", "weekday").pivot).toEqual({
			idFields: ["store"],
			keyFields: ["weekday"],
			valueFields: ["sales"],
		})
		expect(renameFieldInTransform(t, "store", "shop").pivot?.idFields).toEqual(["shop"])
		expect(renameFieldInTransform(t, "nothing", "x")).toBe(t)
	})

	it("reaches a second group's columns", () => {
		const t: VersionTransform = {
			pivot: { ...pivot, extraGroups: [{ keyFields: ["region"], valueFields: ["cost"] }] },
		}
		expect(renameFieldInTransform(t, "cost", "spend").pivot?.extraGroups).toEqual([
			{ keyFields: ["region"], valueFields: ["spend"] },
		])
		expect(renameFieldInTransform(t, "nothing", "x")).toBe(t)
	})
})

describe("filter versions", () => {
	const filter = [
		{ field: "city", filter: { kind: "values" as const, excluded: ["Quito"] } },
	]
	it("says what each filter removed or kept in the version list", () => {
		expect(describeVersionOrigin({ editedFrom: "v1", transform: { filter } })).toBe(
			"filtered: “city” without Quito"
		)
		const many = Array.from({ length: 10 }, (_, i) => (i === 0 ? "" : `c${i}`))
		expect(
			describeVersionOrigin({
				editedFrom: "v1",
				transform: {
					filter: [
						{ field: "city", filter: { kind: "values", excluded: many } },
						{
							field: "sales",
							filter: {
								kind: "conditions",
								as: "number",
								join: "or",
								conditions: [
									{ op: "lt", value: "$1,000" },
									{ op: "gte", value: "$5,000" },
								],
							},
						},
					],
				},
			})
		).toBe(
			"filtered: “city” without (blank), c1, c2, c3, c4, c5, c6, c7 and 2 more; “sales” < $1,000 OR ≥ $5,000"
		)
	})
	it("follows a field rename", () => {
		const t = { filter }
		expect(renameFieldInTransform(t, "sales", "revenue")).toBe(t)
		expect(renameFieldInTransform(t, "city", "town").filter?.[0]?.field).toBe("town")
	})
})

describe("unfiltered versions", () => {
	it("says the filters were removed", () => {
		expect(describeVersionOrigin({ editedFrom: "v1", transform: { filter: [] } })).toBe(
			"filters removed"
		)
	})
})
