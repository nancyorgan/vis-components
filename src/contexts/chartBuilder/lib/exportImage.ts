/** The image pipeline behind Export → Export image: capture the embed
 *  page's settled layout as one SVG, inline its webfonts, and build the
 *  chosen file (SVG, DPI-stamped PNG/JPEG, or a one-page PDF). Shared by
 *  the Export dialog (its preview iframe) and the embed page's export mode
 *  (`/embed/<id>?export=…`, its own document). */

import {
	STABLE_POLLS,
	chartLayoutReady,
	serializeEmbedCapture,
	withoutDisplayScale,
} from "./captureThumbnail"
import { embedFontsInSvg } from "./fontEmbed"
import { withJpegDpi, withPngDpi } from "./imageDpi"
import { nameWeightedFaces } from "./portableSvg"

export const IMAGE_FORMATS = ["png", "jpeg", "svg", "pdf"] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]

export const DEFAULT_PIXEL_RATIO = 4

export const DEFAULT_WIDTH = 650
export const DEFAULT_HEIGHT = 400
// Shared bounds for the size inputs AND the drag-resize handles.
export const MIN_EXPORT_DIM = 50
export const MAX_EXPORT_DIM = 4096

/** Where the chart to capture lives: the Export dialog's preview iframe
 *  (its document is re-read every poll, so a reload mid-capture is
 *  followed), or a document directly — the embed page capturing itself. */
export type ExportSource = Document | HTMLIFrameElement | null

const documentOf = (source: Document | HTMLIFrameElement): Document | null =>
	"contentDocument" in source ? source.contentDocument : source

const clampExportDim = (n: number) =>
	Math.min(MAX_EXPORT_DIM, Math.max(MIN_EXPORT_DIM, Math.round(n)))

/** The size and resolution an export gets with no dialog open (the embed
 *  page's export mode). Explicit `width` / `height` / `ratio` win; otherwise
 *  the dialog's seed with nothing saved or measured — a fixed canvas size,
 *  else the 650×400 default — at the dialog's default resolution. Sizes
 *  clamp to the dialog's bounds and the ratio to what the canvas can hold,
 *  exactly as the dialog clamps them. */
export const resolveExportSize = (opts: {
	canvasSize?: { enabled?: boolean; width: number; height: number } | null
	width?: number
	height?: number
	ratio?: number
}): { width: number; height: number; pixelRatio: number } => {
	const fixed = opts.canvasSize?.enabled ? opts.canvasSize : null
	const width = clampExportDim(opts.width ?? fixed?.width ?? DEFAULT_WIDTH)
	const height = clampExportDim(opts.height ?? fixed?.height ?? DEFAULT_HEIGHT)
	const pixelRatio = clampPixelRatio(
		width,
		height,
		opts.ratio ?? DEFAULT_PIXEL_RATIO
	)
	return { width, height, pixelRatio }
}

export type RenderExportOptions = {
	/** Paint white under the chart (a JPEG always is). A picture that stands
	 *  alone on a slide wants it; a PNG download keeps its transparency. */
	opaqueBackground?: boolean
}

/** Capture the chart in `source` and build the export file. The chart must
 *  be laid out at `width × height` CSS px; `height` is the whole image's,
 *  so with an included data table (`table=image`) it is the chart's height
 *  plus the table's. `pixelRatio` is the already-clamped multiplier; a
 *  raster carries it as its DPI stamp, so a consumer that places images at
 *  physical size (PowerPoint, Word) lands it true to size. */
export const renderExport = async (
	source: ExportSource,
	format: ImageFormat,
	width: number,
	height: number,
	pixelRatio: number,
	opts: RenderExportOptions = {}
): Promise<Blob> => {
	// Inline webfont faces (Google-hosted presets + user library fonts)
	// as data: @font-face rules — the raster path loads the SVG through
	// an <img>, which can't fetch external stylesheets, and downloaded
	// SVGs must render on machines without the fonts installed.
	const captured = await waitForChartSvg(source)
	// The SVG download is opened in PowerPoint & co., which ignore
	// baselines, dy and webfonts — re-serialize the now-stable layout
	// with text flattened for them (lib/portableSvg.ts).
	const doc = source ? documentOf(source) : null
	const portable =
		format === "svg" && doc
			? serializeEmbedCapture(doc, { portable: true })
			: null
	const svgText = await embedFontsInSvg(portable ?? captured)
	return format === "svg"
		? new Blob([nameWeightedFaces(svgText)], {
				type: "image/svg+xml",
			})
		: format === "pdf"
			? await generatePdf(svgText, width, height, pixelRatio)
			: await rasterizeSvg(svgText, width, height, pixelRatio, format, opts.opaqueBackground)
}

// ---------------------------------------------------------------------------
// Image rasterization helpers
// ---------------------------------------------------------------------------

/** Poll the preview iframe for a serialised chart SVG, allowing the embed
 * page time to finish hydrating Jotai + mounting the chart. The iframe is a
 * cold-booting embed app — it spins up its own React root, hydrates Jotai,
 * loads the dataset from IndexedDB, then mounts the chart. PlotCanvas uses
 * `useMeasure`, so the SVG mounts at width=0 until ResizeObserver fires. On
 * first open this whole boot can take several seconds.
 *
 * A non-zero bounding rect is NOT enough to capture: a cold embed does
 * several layout passes (measure → solve → re-render, ResizeObserver rounds,
 * webfont swaps), and tick-label margins / title positions are measured from
 * live font metrics. Grabbing the first sized frame serializes a fallback-font
 * layout whose spacing differs slightly from the fully-settled editor — the
 * "export is off a little from the viewport" bug. So we require, mirroring the
 * thumbnail backfill's proven gating: fonts settled, EVERY panel sized, and
 * the serialized markup byte-identical for `STABLE_POLLS` consecutive polls. */
const CAPTURE_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 100

const waitForChartSvg = async (source: ExportSource): Promise<string> => {
	if (!source) {
		throw new Error("Preview not ready yet — try again in a moment.")
	}
	const deadline = Date.now() + CAPTURE_TIMEOUT_MS
	let lastSvgText: string | null = null
	let matchingPolls = 0
	while (Date.now() < deadline) {
		const doc = documentOf(source)
		// Hold off while webfonts are still streaming in — tick-label margins
		// and title offsets are measured from live font metrics, so a
		// fallback-font layout serializes cleanly but at the wrong spacing.
		const fontsSettled = !doc?.fonts || doc.fonts.status !== "loading"
		const svgText =
			doc && fontsSettled && chartLayoutReady(doc)
				? withoutDisplayScale(doc, () => serializeEmbedCapture(doc))
				: null
		if (svgText !== null && svgText === lastSvgText) {
			matchingPolls++
			// Stable across STABLE_POLLS polls → the layout has stopped
			// reflowing and matches the settled editor render.
			if (matchingPolls >= STABLE_POLLS) return svgText
		} else {
			matchingPolls = 0
		}
		lastSvgText = svgText
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, POLL_INTERVAL_MS)
		})
	}
	// Deadline hit without stability — a last-known sized frame still beats a
	// hard failure for the user.
	if (lastSvgText) return lastSvgText
	throw new Error(
		"Couldn't capture the chart — the preview took too long to render. Try changing the dimensions slightly to refresh it."
	)
}

// Ceilings for the rendered bitmap. iOS Safari refuses canvases past
// ~16.7M px² total area; most browsers cap a single edge well above 8192.
const MAX_CANVAS_EDGE = 8192
const MAX_CANVAS_AREA = 16_777_216

/** DPIs a clamped export steps down through. PowerPoint snaps a placed
 * picture to whole points and rounds inconsistently by DPI: measured on a
 * 13 in figure, 303.6 dpi placed at 12.97 in and 302/303/320/383 dpi at
 * 12.99 in, while these placed at exactly 13.00 in. */
const POWERPOINT_EXACT_DPIS = [350, 300, 254]

/** Largest usable multiplier ≤ the requested one, so width × ratio never
 * blows past canvas limits (a silently-failed canvas exports as blank).
 * When the limits force it below the request, it snaps DOWN to a DPI from
 * POWERPOINT_EXACT_DPIS, so the stamped DPI re-derives the chosen inches
 * exactly in PowerPoint/Word. */
export const clampPixelRatio = (
	width: number,
	height: number,
	ratio: number
): number => {
	const fit = Math.min(
		MAX_CANVAS_EDGE / width,
		MAX_CANVAS_EDGE / height,
		Math.sqrt(MAX_CANVAS_AREA / (width * height))
	)
	if (ratio <= fit) return Math.max(1, ratio)
	const dpi = POWERPOINT_EXACT_DPIS.find((d) => d <= fit * 96)
	return Math.max(1, (dpi ?? Math.floor(fit * 96)) / 96)
}

/** Draw the chart SVG onto a canvas at `width × height` logical px scaled by
 * `pixelRatio`. Browsers rasterize an <img> SVG at its *intrinsic* size and
 * only then bitmap-scale it in drawImage, so the SVG's width/height must be
 * rewritten to the full output resolution first — otherwise a 2× canvas just
 * holds a blurry upscale of the 1× render. */
const renderChartToCanvas = (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number,
	opaqueBackground: boolean
): Promise<HTMLCanvasElement> =>
	new Promise((resolve, reject) => {
		const pxW = Math.round(width * pixelRatio)
		const pxH = Math.round(height * pixelRatio)
		const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
		const root = doc.documentElement
		if (!root.getAttribute("viewBox")) {
			const w = root.getAttribute("width")
			const h = root.getAttribute("height")
			if (w && h) root.setAttribute("viewBox", `0 0 ${w} ${h}`)
		}
		root.setAttribute("width", String(pxW))
		root.setAttribute("height", String(pxH))
		// Fill the requested box (matching the old drawImage stretch) rather
		// than letterboxing when the capture's aspect drifts a pixel or two.
		root.setAttribute("preserveAspectRatio", "none")
		const sized = new XMLSerializer().serializeToString(root)

		const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" })
		const url = URL.createObjectURL(blob)
		const img = new Image()
		img.addEventListener("load", () => {
			try {
				const canvas = document.createElement("canvas")
				canvas.width = pxW
				canvas.height = pxH
				const ctx = canvas.getContext("2d")
				if (!ctx) {
					reject(new Error("Canvas 2D context unavailable."))
					return
				}
				if (opaqueBackground) {
					ctx.fillStyle = "#ffffff"
					ctx.fillRect(0, 0, pxW, pxH)
				}
				ctx.drawImage(img, 0, 0, pxW, pxH)
				resolve(canvas)
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)))
			} finally {
				URL.revokeObjectURL(url)
			}
		})
		img.addEventListener("error", () => {
			URL.revokeObjectURL(url)
			reject(new Error("Failed to load the chart SVG into an image."))
		})
		img.src = url
	})

const canvasToBlob = (
	canvas: HTMLCanvasElement,
	mime: string,
	quality?: number
): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) resolve(b)
				else reject(new Error("Rasterization produced no blob."))
			},
			mime,
			quality
		)
	})

const rasterizeSvg = async (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number,
	format: "png" | "jpeg",
	opaqueBackground = format === "jpeg"
): Promise<Blob> => {
	const canvas = await renderChartToCanvas(svgText, width, height, pixelRatio, opaqueBackground)
	const mime = format === "png" ? "image/png" : "image/jpeg"
	const blob = await canvasToBlob(
		canvas,
		mime,
		format === "jpeg" ? 0.92 : undefined
	)
	// Stamp the true resolution (96 css-px/in × the export multiplier) so
	// physical-size consumers (PowerPoint, Word, print layouts) insert the
	// image at the inches/cm the user chose instead of guessing a DPI —
	// without it, a 2× export lands at double size and gets shrunk-to-fit.
	const dpi = 96 * pixelRatio
	const bytes = new Uint8Array(await blob.arrayBuffer())
	const stamped = format === "png" ? withPngDpi(bytes, dpi) : withJpegDpi(bytes, dpi)
	return new Blob([stamped], { type: mime })
}

// ---------------------------------------------------------------------------
// Direct PDF generation
// ---------------------------------------------------------------------------

type PdfImage = {
	filter: "FlateDecode" | "DCTDecode"
	data: Uint8Array<ArrayBuffer>
}

/** Encode the canvas pixels for embedding in a PDF. Prefers lossless
 * zlib-compressed RGB — exactly what FlateDecode expects and what
 * CompressionStream("deflate") emits — falling back to a high-quality JPEG
 * (DCTDecode) on browsers without CompressionStream. */
const encodePdfImage = async (
	canvas: HTMLCanvasElement
): Promise<PdfImage> => {
	const ctx = canvas.getContext("2d")
	if (typeof CompressionStream !== "undefined" && ctx) {
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const rgb = new Uint8Array(canvas.width * canvas.height * 3)
		for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
			rgb[j] = data[i]
			rgb[j + 1] = data[i + 1]
			rgb[j + 2] = data[i + 2]
		}
		const stream = new Blob([rgb])
			.stream()
			.pipeThrough(new CompressionStream("deflate"))
		const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
		return { filter: "FlateDecode", data: compressed }
	}
	const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.95)
	return { filter: "DCTDecode", data: new Uint8Array(await jpeg.arrayBuffer()) }
}

/** Assemble a single-page PDF whose sole content is one image stretched to
 * the page. Hand-rolled because this fixed shape needs only five objects and
 * a cross-reference table — not worth a PDF library dependency. */
const buildImagePdf = (
	pageW: number,
	pageH: number,
	imgW: number,
	imgH: number,
	image: PdfImage
): Blob => {
	const encoder = new TextEncoder()
	const parts: Uint8Array<ArrayBuffer>[] = []
	let offset = 0
	// Byte offset of each object; index 0 is PDF's reserved free object.
	const offsets: number[] = [0]
	const push = (part: string | Uint8Array<ArrayBuffer>) => {
		const bytes = typeof part === "string" ? encoder.encode(part) : part
		parts.push(bytes)
		offset += bytes.length
	}
	const pushObj = (body: string, stream?: Uint8Array<ArrayBuffer>) => {
		offsets.push(offset)
		push(`${offsets.length - 1} 0 obj\n${body}\n`)
		if (stream) {
			push("stream\n")
			push(stream)
			push("\nendstream\n")
		}
		push("endobj\n")
	}

	push("%PDF-1.4\n")
	pushObj("<< /Type /Catalog /Pages 2 0 R >>")
	pushObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	pushObj(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
			"/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"
	)
	pushObj(
		`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
			"/ColorSpace /DeviceRGB /BitsPerComponent 8 " +
			`/Filter /${image.filter} /Length ${image.data.length} >>`,
		image.data
	)
	const contents = encoder.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im1 Do Q`)
	pushObj(`<< /Length ${contents.length} >>`, contents)

	const xrefStart = offset
	// Each xref entry must be exactly 20 bytes: 10-digit offset, space,
	// 5-digit generation, space, type, space, newline.
	push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
	for (const o of offsets.slice(1)) {
		push(`${String(o).padStart(10, "0")} 00000 n \n`)
	}
	push(
		`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\n` +
			`startxref\n${xrefStart}\n%%EOF\n`
	)
	return new Blob(parts, { type: "application/pdf" })
}

/** Rasterize the chart at the chosen resolution and wrap it in a one-page
 * PDF sized to match the on-screen dimensions (px → pt at 96 dpi), so "Save
 * PDF" downloads directly instead of routing through the print dialog. */
const generatePdf = async (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number
): Promise<Blob> => {
	const canvas = await renderChartToCanvas(svgText, width, height, pixelRatio, true)
	const image = await encodePdfImage(canvas)
	const ptW = (width * 72) / 96
	const ptH = (height * 72) / 96
	return buildImagePdf(ptW, ptH, canvas.width, canvas.height, image)
}
