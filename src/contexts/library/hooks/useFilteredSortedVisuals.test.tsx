import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import { emptyEncodings, type Visual } from "../../chartBuilder/lib/types"
import type { LibraryKind } from "../lib/libraryKind"
import {
	useFilteredSortedLandingRows,
	useFilteredSortedVisuals,
} from "./useFilteredSortedVisuals"

const mkVisual = (id: string, over: Partial<Visual> = {}): Visual => ({
	id,
	name: id,
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const visuals = [
	mkVisual("chart"),
	mkVisual("tpl", { template: { sourceFields: [], formatMemory: {} } }),
]

const base = {
	visuals,
	datasets: {},
	folders: [],
	folderId: null,
	datasetName: null,
	query: "",
	sort: "name:asc",
}

const gridIds = (kind: LibraryKind | undefined) =>
	renderHook(() => useFilteredSortedVisuals({ ...base, kind })).result.current.map(
		(d) => d.visual.id
	)

const tableIds = (kind: LibraryKind | undefined) =>
	renderHook(() =>
		useFilteredSortedLandingRows({ ...base, instances: {}, kind })
	).result.current.map((r) => r.visual.id)

describe("kind filter", () => {
	it("absent lists ordinary visuals only", () => {
		expect(gridIds(undefined)).toEqual(["chart"])
		expect(tableIds(undefined)).toEqual(["chart"])
	})
	it("templates lists templates only", () => {
		expect(gridIds("templates")).toEqual(["tpl"])
		expect(tableIds("templates")).toEqual(["tpl"])
	})
})
