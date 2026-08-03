import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import { deriveLandingRows } from "./landingRows"
import type { Dataset, DatasetVersion, EmbedInstance, Visual } from "./types"
import { emptyEncodings } from "./types"

const mkVisual = (overrides: Partial<Visual>): Visual => ({
	id: "vis-1",
	name: "Kinds of Cats",
	folderId: null,
	datasetId: "ds-cats",
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
})

const mkVersion = (overrides: Partial<DatasetVersion>): DatasetVersion => ({
	id: "dv-1",
	filename: "cats.csv",
	rows: [],
	createdAt: 1,
	...overrides,
})

const mkDataset = (overrides: Partial<Dataset>): Dataset => ({
	id: "ds-cats",
	name: "catsdata",
	fields: [],
	versions: [mkVersion({ id: "dv-1" })],
	latestVersionId: "dv-1",
	createdAt: 1,
	...overrides,
})

const mkInstance = (overrides: Partial<EmbedInstance>): EmbedInstance => ({
	id: "ei-1",
	visualId: "vis-1",
	versionId: null,
	createdAt: 10,
	lastExportedAt: 10,
	...overrides,
})

describe("deriveLandingRows", () => {
	it("emits one 'unexported' row for a Visual with no instances", () => {
		const rows = deriveLandingRows(
			[mkVisual({})],
			{},
			{ "ds-cats": mkDataset({}) }
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.kind).toBe("unexported")
		expect(rows[0]!.pinState).toBe("unexported")
	})

	it("emits one 'instance' row per EmbedInstance of a Visual", () => {
		const rows = deriveLandingRows(
			[mkVisual({})],
			{
				a: mkInstance({ id: "a", versionId: null, createdAt: 5 }),
				b: mkInstance({ id: "b", versionId: "dv-1", createdAt: 10 }),
			},
			{ "ds-cats": mkDataset({}) }
		)
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.kind === "instance")).toBe(true)
	})

	it("assigns pinState='live' for instances with versionId=null", () => {
		const rows = deriveLandingRows(
			[mkVisual({})],
			{ a: mkInstance({ versionId: null }) },
			{ "ds-cats": mkDataset({}) }
		)
		expect(rows[0]!.pinState).toBe("live")
		if (rows[0]!.kind === "instance") {
			expect(rows[0]!.versionLabel).toBe("latest")
		}
	})

	it("assigns pinState='pinned' and labels the version by its 1-based index", () => {
		const dataset = mkDataset({
			versions: [
				mkVersion({ id: "dv-1" }),
				mkVersion({ id: "dv-2" }),
				mkVersion({ id: "dv-3" }),
			],
			latestVersionId: "dv-3",
		})
		const rows = deriveLandingRows(
			[mkVisual({})],
			{ a: mkInstance({ versionId: "dv-2" }) },
			{ "ds-cats": dataset }
		)
		expect(rows[0]!.pinState).toBe("pinned")
		if (rows[0]!.kind === "instance") {
			expect(rows[0]!.versionLabel).toBe("v2")
		}
	})

	it("assigns pinState='dangling' when the pinned version is gone from the dataset", () => {
		const rows = deriveLandingRows(
			[mkVisual({})],
			{ a: mkInstance({ versionId: "dv-deleted" }) },
			{ "ds-cats": mkDataset({}) }
		)
		expect(rows[0]!.pinState).toBe("dangling")
		if (rows[0]!.kind === "instance") {
			expect(rows[0]!.versionLabel).toContain("deleted")
		}
	})

	it("assigns pinState='dangling' when the whole dataset is gone", () => {
		const rows = deriveLandingRows(
			[mkVisual({ datasetId: "ds-missing" })],
			{ a: mkInstance({ versionId: "dv-1" }) },
			{}
		)
		expect(rows[0]!.pinState).toBe("dangling")
	})

	it("sorts instance rows for a visual by their createdAt ascending", () => {
		const rows = deriveLandingRows(
			[mkVisual({})],
			{
				later: mkInstance({ id: "later", createdAt: 200 }),
				earlier: mkInstance({
					id: "earlier",
					versionId: "dv-1",
					createdAt: 100,
				}),
			},
			{ "ds-cats": mkDataset({}) }
		)
		expect(
			rows.map((r) => (r.kind === "instance" ? r.instance.id : null))
		).toEqual(["earlier", "later"])
	})

	it("preserves the visual order from the input list", () => {
		const rows = deriveLandingRows(
			[
				mkVisual({ id: "v-a", name: "A" }),
				mkVisual({ id: "v-b", name: "B" }),
				mkVisual({ id: "v-c", name: "C" }),
			],
			{},
			{ "ds-cats": mkDataset({}) }
		)
		expect(rows.map((r) => r.visual.id)).toEqual(["v-a", "v-b", "v-c"])
	})

	it("emits no rows for an EmbedInstance whose visual has been deleted", () => {
		const rows = deriveLandingRows(
			[mkVisual({ id: "v-present" })],
			{ orphan: mkInstance({ visualId: "v-deleted" }) },
			{ "ds-cats": mkDataset({}) }
		)
		// The orphan instance simply never gets iterated because its visual
		// isn't in the visuals list.
		expect(rows).toHaveLength(1)
		expect(rows[0]!.kind).toBe("unexported")
		expect(rows[0]!.visual.id).toBe("v-present")
	})
})
