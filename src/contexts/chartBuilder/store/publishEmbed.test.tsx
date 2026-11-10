import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { emptyEncodings, type Visual } from "../lib/types"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { embedInstancesAtom, visualsAtom } from "./atoms"
import {
	embedPictureFailuresAtom,
	PICTURE_NO_FIGURE,
	usePublishEmbed,
} from "./publishEmbed"

/** The linked picture is a best-effort second step of a publish: success
 *  adds `image` to the recorded urls; a failed capture or upload still
 *  records the HTML publish, without a stale `image` from before. It
 *  renders through the export pipeline (`renderExport`), mocked here. */

const PNG_BLOB = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })

const render = vi.fn<(...args: unknown[]) => Promise<Blob>>()
vi.mock("../lib/exportImage", async (importOriginal) => ({
	...(await importOriginal<typeof import("../lib/exportImage")>()),
	renderExport: (...args: unknown[]) => render(...args),
}))

/** The editor's figure root, sized as layout would size it. */
const mountFigure = (width = 1100, height = 700): HTMLElement => {
	const root = document.createElement("div")
	root.setAttribute("data-chart-root", "")
	Object.defineProperty(root, "offsetWidth", { value: width })
	Object.defineProperty(root, "offsetHeight", { value: height })
	document.body.appendChild(root)
	return root
}
const publishHtml = vi.fn()
const publishImage = vi.fn<(id: string, png: File) => Promise<string>>()
const publishVector = vi.fn<(id: string, svg: File) => Promise<string>>()
vi.mock("../lib/embedPublish", async (importOriginal) => ({
	...(await importOriginal<typeof import("../lib/embedPublish")>()),
	collectEmbedFonts: async () => [],
	publishEmbedRequest: (...args: unknown[]) => publishHtml(...args),
	publishEmbedImageRequest: (id: string, png: File) => publishImage(id, png),
	publishEmbedVectorRequest: (id: string, svg: File) => publishVector(id, svg),
}))

const VISUAL: Visual = {
	id: "dv-1",
	name: "Sales",
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
}

const HTML_URLS = { full: "https://x/embeds/p/index.html" }
const IMAGE_URL = "https://x/embeds/p/image.png"
const VECTOR_URL = "https://x/embeds/p/image.svg"

beforeEach(() => {
	installInMemoryLocalStorage()
	document.body.innerHTML = ""
	render.mockReset()
	publishHtml.mockReset().mockResolvedValue(HTML_URLS)
	publishImage.mockReset().mockResolvedValue(IMAGE_URL)
	publishVector.mockReset().mockResolvedValue(VECTOR_URL)
})

const setup = () => {
	let store!: TestStore
	const wrapper = ({ children }: { children: ReactNode }) => (
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(visualsAtom, [VISUAL])
			}}
		>
			{children}
		</TestProvider>
	)
	const { result } = renderHook(() => usePublishEmbed(), { wrapper })
	const publish = () =>
		act(() => result.current({ visualId: "dv-1", versionId: null, split: false }))
	const recordedUrls = () =>
		Object.values(store.get(embedInstancesAtom)).find((i) => i.visualId === "dv-1")
			?.publishedUrls
	return { publish, recordedUrls, store }
}

describe("usePublishEmbed linked picture", () => {
	it("renders the figure root at its laid-out size, 2× and opaque, and records the image url", async () => {
		const root = mountFigure(1100, 700)
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls } = setup()
		await publish()
		expect(render).toHaveBeenCalledWith(document, "png", 1100, 700, 2, { root, opaqueBackground: true })
		const [, png] = publishImage.mock.calls[0]
		expect(png.name).toBe("image.png")
		expect(png.type).toBe("image/png")
		expect(recordedUrls()).toEqual({ ...HTML_URLS, image: IMAGE_URL, vector: VECTOR_URL })
	})

	it("a republish whose upload fails records the HTML urls without the old image", async () => {
		mountFigure()
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls } = setup()
		await publish()
		expect(recordedUrls()?.image).toBe(IMAGE_URL)
		publishImage.mockRejectedValue(new Error("HTTP 500"))
		await publish()
		expect(recordedUrls()).toEqual({ ...HTML_URLS, vector: VECTOR_URL })
	})

	it("a capture that never settles still records the publish, with no upload", async () => {
		mountFigure()
		render.mockRejectedValue(new Error("Couldn't capture the chart"))
		const { publish, recordedUrls } = setup()
		await publish()
		expect(publishImage).not.toHaveBeenCalled()
		expect(recordedUrls()).toEqual(HTML_URLS)
	})

	it("no figure on screen: nothing to render, the publish still lands", async () => {
		const { publish, recordedUrls } = setup()
		await publish()
		expect(render).not.toHaveBeenCalled()
		expect(publishImage).not.toHaveBeenCalled()
		expect(recordedUrls()).toEqual(HTML_URLS)
	})
})

describe("usePublishEmbed picture failure reason", () => {
	const failureFor = (store: TestStore) => store.get(embedPictureFailuresAtom)["dv-1"]

	it("records why the upload failed, and clears it when a later publish lands the picture", async () => {
		mountFigure()
		render.mockResolvedValue(PNG_BLOB)
		const { publish, store } = setup()
		publishImage.mockRejectedValue(new Error("Publishing the picture failed (HTTP 403)."))
		await publish()
		expect(failureFor(store)).toEqual({ image: "Publishing the picture failed (HTTP 403)." })
		publishImage.mockResolvedValue(IMAGE_URL)
		await publish()
		expect(failureFor(store)).toBeUndefined()
	})

	it("a refused vector keeps the PNG url and names only the vector", async () => {
		mountFigure()
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls, store } = setup()
		publishVector.mockRejectedValue(new Error("Publishing the picture failed (HTTP 400)."))
		await publish()
		expect(recordedUrls()).toEqual({ ...HTML_URLS, image: IMAGE_URL })
		expect(failureFor(store)).toEqual({ vector: "Publishing the picture failed (HTTP 400)." })
		const [, svg] = publishVector.mock.calls[0]
		expect(svg.name).toBe("image.svg")
		expect(svg.type).toBe("image/svg+xml")
		// The SVG is captured through the same pipeline, at 1× (vectors have no raster scale).
		const svgRender = render.mock.calls.find((c) => c[1] === "svg")
		expect(svgRender?.[4]).toBe(1)
	})

	it("names the missing figure when nothing is on screen to capture", async () => {
		const { publish, store } = setup()
		await publish()
		expect(failureFor(store)).toEqual({ image: PICTURE_NO_FIGURE, vector: PICTURE_NO_FIGURE })
	})
})
