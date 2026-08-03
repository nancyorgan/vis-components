import { describe, expect, it } from "vitest"

import {
	removeInstance,
	removeInstancesForVisual,
	upsertEmbedInstance,
} from "./embedInstances"
import type { EmbedInstance } from "./types"

const mkInstance = (overrides: Partial<EmbedInstance>): EmbedInstance => ({
	id: "ei-default",
	visualId: "v1",
	versionId: null,
	createdAt: 1000,
	lastExportedAt: 1000,
	...overrides,
})

describe("upsertEmbedInstance", () => {
	it("inserts a new instance when none exists for the (visualId, versionId) pair", () => {
		const result = upsertEmbedInstance({}, "v1", null, 1000, () => "ei-1")
		expect(Object.keys(result)).toEqual(["ei-1"])
		expect(result["ei-1"]).toMatchObject({
			id: "ei-1",
			visualId: "v1",
			versionId: null,
			createdAt: 1000,
			lastExportedAt: 1000,
		})
	})

	it("bumps lastExportedAt on an existing instance instead of duplicating", () => {
		const initial = {
			"ei-existing": mkInstance({
				id: "ei-existing",
				visualId: "v1",
				versionId: "dv-3",
				createdAt: 500,
				lastExportedAt: 500,
			}),
		}
		const result = upsertEmbedInstance(
			initial,
			"v1",
			"dv-3",
			1234,
			() => "ei-new"
		)
		expect(Object.keys(result)).toEqual(["ei-existing"])
		expect(result["ei-existing"]!.lastExportedAt).toBe(1234)
		expect(result["ei-existing"]!.createdAt).toBe(500)
	})

	it("treats Live (versionId=null) and pinned versions as distinct instances", () => {
		const initial = {
			"ei-live": mkInstance({
				id: "ei-live",
				visualId: "v1",
				versionId: null,
			}),
		}
		const result = upsertEmbedInstance(
			initial,
			"v1",
			"dv-3",
			2000,
			() => "ei-pinned"
		)
		expect(Object.keys(result).sort()).toEqual(["ei-live", "ei-pinned"])
	})

	it("treats different pinned versions as distinct instances", () => {
		const initial = {
			"ei-v3": mkInstance({ id: "ei-v3", visualId: "v1", versionId: "dv-3" }),
		}
		const result = upsertEmbedInstance(
			initial,
			"v1",
			"dv-4",
			2000,
			() => "ei-v4"
		)
		expect(Object.keys(result).sort()).toEqual(["ei-v3", "ei-v4"])
	})

	it("treats different visuals as distinct even on the same version id", () => {
		const initial = {
			"ei-a": mkInstance({ id: "ei-a", visualId: "v1", versionId: "dv-1" }),
		}
		const result = upsertEmbedInstance(
			initial,
			"v2",
			"dv-1",
			2000,
			() => "ei-b"
		)
		expect(Object.keys(result).sort()).toEqual(["ei-a", "ei-b"])
	})
})

describe("removeInstancesForVisual", () => {
	it("drops every instance belonging to the given visual", () => {
		const instances = {
			a: mkInstance({ id: "a", visualId: "v1" }),
			b: mkInstance({ id: "b", visualId: "v1" }),
			c: mkInstance({ id: "c", visualId: "v2" }),
		}
		const result = removeInstancesForVisual(instances, "v1")
		expect(Object.keys(result)).toEqual(["c"])
	})

	it("is a no-op when no instances match", () => {
		const instances = { a: mkInstance({ id: "a", visualId: "v1" }) }
		expect(removeInstancesForVisual(instances, "v999")).toEqual(instances)
	})
})

describe("removeInstance", () => {
	it("removes a single instance by id", () => {
		const instances = {
			a: mkInstance({ id: "a" }),
			b: mkInstance({ id: "b" }),
		}
		expect(Object.keys(removeInstance(instances, "a"))).toEqual(["b"])
	})

	it("is a no-op when the id isn't present", () => {
		const instances = { a: mkInstance({ id: "a" }) }
		expect(removeInstance(instances, "missing")).toBe(instances)
	})
})
