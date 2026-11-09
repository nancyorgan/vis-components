import {
	MAX_IMAGE_ANNOTATION_DATA_URL_CHARS,
	MAX_IMAGE_ANNOTATION_PX,
} from "./annotationsConfig"

/** What an imported picture contributes to an `ImageAnnotation`: the stored
 *  data URL, its aspect ratio, and the natural width the editor fits the
 *  initial `width` to. */
export type ImportedAnnotationImage = {
	href: string
	aspect: number
	naturalWidth: number
}

/** Error the import surfaces inline. Messages are user-facing. */
export class ImageImportError extends Error {}

const TOO_LARGE_MESSAGE =
	"That image is too large to store with the chart — try a smaller or simpler one."

const readAsDataUrl = (file: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener("load", () => resolve(String(reader.result)))
		reader.addEventListener("error", () =>
			reject(new ImageImportError("Couldn't read that image"))
		)
		reader.readAsDataURL(file)
	})

const loadImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new ImageImportError("Couldn't read that image"))
		img.src = url
	})

/** True when any pixel of the canvas is not fully opaque — decides whether a
 *  too-large PNG may be re-encoded as JPEG (which drops the alpha channel). */
const hasTransparency = (ctx: CanvasRenderingContext2D, w: number, h: number): boolean => {
	const { data } = ctx.getImageData(0, 0, w, h)
	for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
	return false
}

/** Turn an uploaded file into the picture an image annotation stores.
 *
 *  - Rejects non-images.
 *  - An SVG is kept as-is (it stays crisp at any export size) when it fits
 *    the data-URL cap; it is never rasterized.
 *  - A raster already within `MAX_IMAGE_ANNOTATION_PX` on its longest side
 *    and within the cap keeps its original bytes (no re-encoding loss).
 *  - Otherwise it is downscaled onto a canvas and encoded as PNG; a PNG
 *    still over the cap is re-encoded as JPEG when it has no transparency,
 *    and rejected (with a user-facing message) when it does. */
export const fileToAnnotationImage = async (file: File): Promise<ImportedAnnotationImage> => {
	if (!file.type.startsWith("image/")) {
		throw new ImageImportError("That file isn't an image")
	}
	const original = await readAsDataUrl(file)
	const img = await loadImage(original)
	const iw = img.naturalWidth || 1
	const ih = img.naturalHeight || 1
	const aspect = iw / ih
	const isSvg = file.type === "image/svg+xml"
	if (isSvg) {
		if (original.length > MAX_IMAGE_ANNOTATION_DATA_URL_CHARS) {
			throw new ImageImportError(TOO_LARGE_MESSAGE)
		}
		return { href: original, aspect, naturalWidth: iw }
	}
	const scale = Math.min(1, MAX_IMAGE_ANNOTATION_PX / Math.max(iw, ih))
	if (scale === 1 && original.length <= MAX_IMAGE_ANNOTATION_DATA_URL_CHARS) {
		return { href: original, aspect, naturalWidth: iw }
	}
	const w = Math.max(1, Math.round(iw * scale))
	const h = Math.max(1, Math.round(ih * scale))
	const canvas = document.createElement("canvas")
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new ImageImportError("Couldn't process that image")
	ctx.drawImage(img, 0, 0, w, h)
	let href: string
	try {
		href = canvas.toDataURL("image/png")
		if (href.length > MAX_IMAGE_ANNOTATION_DATA_URL_CHARS) {
			if (hasTransparency(ctx, w, h)) throw new ImageImportError(TOO_LARGE_MESSAGE)
			href = canvas.toDataURL("image/jpeg", 0.85)
		}
	} catch (err) {
		if (err instanceof ImageImportError) throw err
		throw new ImageImportError("Couldn't process that image")
	}
	if (href.length > MAX_IMAGE_ANNOTATION_DATA_URL_CHARS) {
		throw new ImageImportError(TOO_LARGE_MESSAGE)
	}
	return { href, aspect: w / h, naturalWidth: w }
}

/** The width (px) a freshly imported picture is shown at: its natural width,
 *  capped so a large upload doesn't swamp the plot on arrival. */
export const INITIAL_IMAGE_ANNOTATION_MAX_WIDTH_PX = 200
export const initialImageAnnotationWidth = (naturalWidth: number): number =>
	Math.max(1, Math.min(INITIAL_IMAGE_ANNOTATION_MAX_WIDTH_PX, Math.round(naturalWidth)))

/** The size fields a FIRST pick writes: the picture at its own proportions,
 *  in px, capped width, aspect locked. */
export const initialImageAnnotationSize = (img: ImportedAnnotationImage) => {
	const width = initialImageAnnotationWidth(img.naturalWidth)
	return {
		href: img.href,
		aspect: img.aspect,
		naturalWidth: img.naturalWidth,
		width,
		height: roundSize(width / (img.aspect > 0 ? img.aspect : 1)),
		sizeUnit: "px" as const,
	}
}

/** Tidy a size value for storage / display: 2 decimals (≈0.4 px at 96 dpi
 *  for the physical units; sub-pixel for px and tenths of a percent). */
export const roundSize = (n: number): number => Math.round(n * 100) / 100
