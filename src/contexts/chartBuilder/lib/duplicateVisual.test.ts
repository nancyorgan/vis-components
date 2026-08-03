import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { duplicateVisual } from "./duplicateVisual"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import type { Visual } from "./types"
import { emptyEncodings } from "./types"

const mkVisual = (overrides: Partial<Visual> = {}): Visual => ({
	id: "vis-1",
	name: "Kinds of Cats",
	folderId: "fl-pets",
	datasetId: "ds-cats",
	createdAtVersionId: "dv-1",
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: "data:image/png;base64,abc",
	createdAt: 1,
	updatedAt: 2,
	...overrides,
})

describe("duplicateVisual", () => {
	it("gives the copy a fresh id, a (copy) name, and now-stamped timestamps", () => {
		const original = mkVisual()
		const copy = duplicateVisual(original, 999)

		expect(copy.id).not.toBe(original.id)
		expect(copy.id).toMatch(/^vs-/)
		expect(copy.name).toBe("Kinds of Cats (copy)")
		expect(copy.createdAt).toBe(999)
		expect(copy.updatedAt).toBe(999)
	})

	it("preserves folder, dataset, version, thumbnail and all config", () => {
		const original = mkVisual()
		const copy = duplicateVisual(original, 999)

		expect(copy.folderId).toBe("fl-pets")
		expect(copy.datasetId).toBe("ds-cats")
		expect(copy.createdAtVersionId).toBe("dv-1")
		expect(copy.thumbnail).toBe("data:image/png;base64,abc")
		expect(copy.encodings).toEqual(original.encodings)
		expect(copy.channelConfigs).toEqual(original.channelConfigs)
	})

	it("deep-clones nested config so editing the copy can't mutate the original", () => {
		const original = mkVisual({
			fieldTypeOverrides: { sales: "quantitative" },
		})
		const copy = duplicateVisual(original, 999)

		copy.fieldTypeOverrides.sales = "categorical"
		expect(original.fieldTypeOverrides.sales).toBe("quantitative")
		expect(copy.encodings).not.toBe(original.encodings)
	})

	it("produces unique ids when duplicating in a tight loop", () => {
		const original = mkVisual()
		const ids = new Set(
			Array.from({ length: 50 }, () => duplicateVisual(original, 999).id)
		)
		expect(ids.size).toBe(50)
	})
})
