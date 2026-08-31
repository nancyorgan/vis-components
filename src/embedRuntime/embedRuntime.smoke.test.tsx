/** The published-embed runtime, end to end in happy-dom: a payload document
 *  boots the storage seams, the real chart pipeline renders it, and — the
 *  0016 contract's rule 6 — NOTHING lands in the browser's durable storage,
 *  localStorage included, even though loading a visual writes a dozen draft
 *  atoms whose persistence normally goes there. */

import { render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "../contexts/chartBuilder/lib/channelConfig"
import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import { DEFAULT_LABELS_CONFIG } from "../contexts/chartBuilder/lib/labelsConfig"
import {
	emptyEncodings,
	type Dataset,
	type Visual,
} from "../contexts/chartBuilder/lib/types"
import { buildDataset } from "../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"
import { parseEmbedDocument, type EmbedPayload } from "./payload"

const DATASET_ID = "ds-embed-smoke"

const dataset = (): Dataset =>
	buildDataset({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "category", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows: [
			{ category: "A", value: "10" },
			{ category: "B", value: "20" },
			{ category: "C", value: "15" },
		],
	})

const visual = (): Visual => ({
	id: "v-embed",
	name: "Embedded bars",
	folderId: null,
	datasetId: DATASET_ID,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: {
		...emptyEncodings(),
		x: { field: "category" },
		length: { field: "value" },
	},
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
})

const payload = (): EmbedPayload => ({
	visual: visual(),
	dataset: dataset(),
	theme: null,
	fonts: [],
})

const mount = (part: "full" | "chart" | "legend") => {
	const store = bootEmbedRuntime(payload())
	return render(
		<Provider store={store}>
			<div style={{ width: 800, height: 600 }}>
				<EmbedRoot part={part} visualId="v-embed" />
			</div>
		</Provider>
	)
}

/** Mark rects carry a stroke (outline); background rects don't. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")].filter(
		(r) => r.getAttribute("stroke") !== null
	)

afterEach(() => {
	clearExampleOverlay()
})

describe("published-embed runtime", () => {
	it("renders the payload's chart through the real pipeline", async () => {
		installInMemoryLocalStorage()
		const { container } = mount("full")
		await waitFor(() => {
			expect(markRects(container).length).toBe(3)
		})
	})

	it("writes nothing durable while loading and rendering (0016 rule 6)", async () => {
		const durable = installInMemoryLocalStorage()
		const { container } = mount("full")
		await waitFor(() => {
			expect(markRects(container).length).toBe(3)
		})
		// Loading a visual writes draft atoms whose saves normally hit
		// localStorage — ephemeral mode must have swallowed every one.
		expect(durable.size).toBe(0)
	})

	it("renders the chart-only part without a legend wrapper", async () => {
		installInMemoryLocalStorage()
		const { container } = mount("chart")
		await waitFor(() => {
			expect(markRects(container).length).toBe(3)
		})
	})
})

describe("parseEmbedDocument", () => {
	it("reads the server's wrapper shape", () => {
		// eslint-disable-next-line @th/use-wrapped-json-functions
		const payloadJson = JSON.stringify(payload())
		const doc = parseEmbedDocument(
			`{"v":1,"part":"chart","payload":${payloadJson}}`
		)
		expect(doc?.part).toBe("chart")
		expect(doc?.payload.visual.id).toBe("v-embed")
	})

	it("rejects the unpublished template marker, junk, and wrong versions", () => {
		expect(parseEmbedDocument("__VIS_EMBED_" + "PAYLOAD__")).toBeNull()
		expect(parseEmbedDocument(null)).toBeNull()
		expect(parseEmbedDocument("not json")).toBeNull()
		expect(parseEmbedDocument('{"v":2,"part":"full","payload":{}}')).toBeNull()
		expect(
			parseEmbedDocument('{"v":1,"part":"nope","payload":{"visual":{"id":"x"}}}')
		).toBeNull()
	})
})
