import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from "../lib/exportImage"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { emptyEncodings, type Visual } from "../lib/types"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { embedInstancesAtom, exportSizesAtom, visualsAtom } from "./atoms"
import {
	embedPictureFailuresAtom,
	type PublishCapture,
	publishSizeFor,
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

/** Stand-ins for the capture sources: the dialog's preview iframe, and the
 *  off-screen embed `withOffscreenEmbed` would boot (mocked: it hands the
 *  callback this frame at once and reports the size it was asked for). */
const PREVIEW = { preview: true } as unknown as HTMLIFrameElement
const OFFSCREEN = { offscreen: true } as unknown as HTMLIFrameElement
const offscreen = vi.fn<
	(
		visualId: string,
		versionId: string | null,
		size: { width: number; height: number },
		run: (iframe: HTMLIFrameElement) => Promise<unknown>
	) => Promise<unknown>
>()
vi.mock("../lib/offscreenEmbed", () => ({
	withOffscreenEmbed: (
		visualId: string,
		versionId: string | null,
		size: { width: number; height: number },
		run: (iframe: HTMLIFrameElement) => Promise<unknown>
	) => offscreen(visualId, versionId, size, run),
}))

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
	offscreen.mockReset().mockImplementation((_v, _ver, _size, run) => run(OFFSCREEN))
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
	const publish = (capture?: PublishCapture) =>
		act(() =>
			result.current({ visualId: "dv-1", versionId: null, split: false, capture })
		)
	const recordedUrls = () =>
		Object.values(store.get(embedInstancesAtom)).find((i) => i.visualId === "dv-1")
			?.publishedUrls
	return { publish, recordedUrls, store }
}

describe("usePublishEmbed linked pictures", () => {
	it("captures the preview at the dialog's size, 2× and opaque, and records both urls", async () => {
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls } = setup()
		await publish({ source: PREVIEW, width: 1100, height: 700 })
		expect(render).toHaveBeenCalledWith(PREVIEW, "png", 1100, 700, 2, { opaqueBackground: true })
		expect(render).toHaveBeenCalledWith(PREVIEW, "svg", 1100, 700, 1)
		expect(offscreen).not.toHaveBeenCalled()
		const [, png] = publishImage.mock.calls[0]
		expect(png.name).toBe("image.png")
		expect(png.type).toBe("image/png")
		expect(recordedUrls()).toEqual({ ...HTML_URLS, image: IMAGE_URL, vector: VECTOR_URL })
	})

	it("without a preview, boots an off-screen embed at the visual's publish size", async () => {
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls, store } = setup()
		store.set(exportSizesAtom, { "dv-1": { width: 900, height: 600, aspectLocked: true } })
		await publish()
		expect(offscreen).toHaveBeenCalledWith("dv-1", null, { width: 900, height: 600 }, expect.any(Function))
		expect(render).toHaveBeenCalledWith(OFFSCREEN, "png", 900, 600, 2, { opaqueBackground: true })
		expect(recordedUrls()).toEqual({ ...HTML_URLS, image: IMAGE_URL, vector: VECTOR_URL })
	})

	it("remembers the size a publish went out at as the visual's export size", async () => {
		render.mockResolvedValue(PNG_BLOB)
		const { publish, store } = setup()
		await publish({ source: PREVIEW, width: 1100, height: 700 })
		expect(store.get(exportSizesAtom)["dv-1"]).toEqual({ width: 1100, height: 700, aspectLocked: false })
	})

	it("a republish whose upload fails records the HTML urls without the old image", async () => {
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls } = setup()
		await publish()
		expect(recordedUrls()?.image).toBe(IMAGE_URL)
		publishImage.mockRejectedValue(new Error("HTTP 500"))
		await publish()
		expect(recordedUrls()).toEqual({ ...HTML_URLS, vector: VECTOR_URL })
	})

	it("a capture that never settles still records the publish, with no upload", async () => {
		render.mockRejectedValue(new Error("Couldn't capture the chart"))
		const { publish, recordedUrls } = setup()
		await publish()
		expect(publishImage).not.toHaveBeenCalled()
		expect(recordedUrls()).toEqual(HTML_URLS)
	})
})

describe("publishSizeFor", () => {
	const visual = (canvasSize?: { enabled: boolean; width: number; height: number }) =>
		({ id: "dv-1", channelConfigs: { ...EMPTY_CHANNEL_CONFIGS, ...(canvasSize ? { canvasSize } : {}) } }) as Parameters<typeof publishSizeFor>[0]

	it("prefers the remembered export size, then the fixed canvas, then the default", () => {
		expect(publishSizeFor(visual({ enabled: true, width: 500, height: 400 }), { "dv-1": { width: 900, height: 600, aspectLocked: false } })).toEqual({ width: 900, height: 600 })
		expect(publishSizeFor(visual({ enabled: true, width: 500, height: 400 }), {})).toEqual({ width: 500, height: 400 })
		expect(publishSizeFor(visual({ enabled: false, width: 500, height: 400 }), {})).toEqual({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
	})
})

describe("usePublishEmbed picture failure reason", () => {
	const failureFor = (store: TestStore) => store.get(embedPictureFailuresAtom)["dv-1"]

	it("records why the upload failed, and clears it when a later publish lands the picture", async () => {
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
		render.mockResolvedValue(PNG_BLOB)
		const { publish, recordedUrls, store } = setup()
		publishVector.mockRejectedValue(new Error("Publishing the picture failed (HTTP 400)."))
		await publish()
		expect(recordedUrls()).toEqual({ ...HTML_URLS, image: IMAGE_URL })
		expect(failureFor(store)).toEqual({ vector: "Publishing the picture failed (HTTP 400)." })
		const [, svg] = publishVector.mock.calls[0]
		expect(svg.name).toBe("image.svg")
		expect(svg.type).toBe("image/svg+xml")
	})

	it("names a capture that never settled, for both formats", async () => {
		render.mockRejectedValue(new Error("Couldn't capture the chart"))
		const { publish, store } = setup()
		await publish()
		expect(failureFor(store)).toEqual({
			image: "Couldn't capture the chart",
			vector: "Couldn't capture the chart",
		})
	})
})
