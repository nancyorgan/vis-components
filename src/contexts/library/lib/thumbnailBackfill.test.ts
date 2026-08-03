import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import type { Dataset, Visual } from "../../chartBuilder/lib/types"
import { emptyEncodings } from "../../chartBuilder/lib/types"
import { backfillCandidates } from "./thumbnailBackfill"

const mkVisual = (overrides: Partial<Visual> = {}): Visual => ({
	id: "vis-1",
	name: "Kinds of Cats",
	folderId: null,
	datasetId: "ds-cats",
	createdAtVersionId: "dv-1",
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 2,
	...overrides,
})

const mkDataset = (id: string): Dataset => ({
	id,
	name: id,
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [
		{ id: "v1", filename: `${id}.csv`, rows: [{ a: "1" }], createdAt: 0 },
	],
	latestVersionId: "v1",
	createdAt: 0,
})

describe("backfillCandidates", () => {
	it("selects only thumbnail-less visuals whose dataset still exists", () => {
		const datasets = { "ds-cats": mkDataset("ds-cats") }
		const missing = mkVisual({ id: "missing" })
		const hasThumb = mkVisual({
			id: "has-thumb",
			thumbnail: "data:image/png;base64,x",
		})
		const noDataset = mkVisual({ id: "no-dataset", datasetId: null })
		const deletedDataset = mkVisual({
			id: "deleted-dataset",
			datasetId: "ds-gone",
		})
		expect(
			backfillCandidates(
				[missing, hasThumb, noDataset, deletedDataset],
				datasets
			)
		).toEqual([missing])
	})
})
