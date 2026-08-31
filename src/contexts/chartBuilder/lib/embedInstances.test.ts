import { describe, expect, it } from "vitest"

import {
	clearEmbedPublish,
	recordEmbedPublish,
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

describe("recordEmbedPublish", () => {
	const publish = {
		publishId: "01234567-89ab-4cde-8f01-23456789abcd",
		publishedAt: 5000,
		publishedParts: ["full" as const],
		publishedUrls: { full: "https://embeds.example.com/embeds/x/index.html" },
		publishedVersionId: "dv-2",
	}

	it("creates the instance and stamps the publish fields", () => {
		const result = recordEmbedPublish({}, "v1", null, publish, 5000, () => "ei-p")
		expect(result["ei-p"].publishId).toBe(publish.publishId)
		expect(result["ei-p"].publishedUrls).toEqual(publish.publishedUrls)
		expect(result["ei-p"].publishedVersionId).toBe("dv-2")
		expect(result["ei-p"].versionId).toBeNull()
	})

	it("republish updates the existing instance in place", () => {
		const first = recordEmbedPublish({}, "v1", null, publish, 5000, () => "ei-p")
		const second = recordEmbedPublish(
			first,
			"v1",
			null,
			{ ...publish, publishedAt: 9000, publishedVersionId: "dv-3" },
			9000
		)
		expect(Object.keys(second)).toEqual(["ei-p"])
		expect(second["ei-p"].publishedAt).toBe(9000)
		expect(second["ei-p"].publishedVersionId).toBe("dv-3")
	})
})

describe("clearEmbedPublish", () => {
	it("strips every publish field but keeps the row", () => {
		const published = recordEmbedPublish(
			{},
			"v1",
			"dv-1",
			{
				publishId: "01234567-89ab-4cde-8f01-23456789abcd",
				publishedAt: 5000,
				publishedParts: ["full"],
				publishedUrls: { full: "https://x/index.html" },
				publishedVersionId: "dv-1",
			},
			5000,
			() => "ei-p"
		)
		const cleared = clearEmbedPublish(published, "ei-p")
		expect(cleared["ei-p"].publishId).toBeUndefined()
		expect(cleared["ei-p"].publishedUrls).toBeUndefined()
		expect(cleared["ei-p"].publishedAt).toBeUndefined()
		expect(cleared["ei-p"].visualId).toBe("v1")
	})

	it("is a no-op for an unknown instance", () => {
		expect(clearEmbedPublish({}, "nope")).toEqual({})
	})
})
