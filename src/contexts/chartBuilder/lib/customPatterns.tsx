import { createContext, useContext } from "react"

import type { ChannelConfigs, CustomPattern, PatternConfig } from "./channelConfig"

/**
 * Custom fill patterns — the "+" chip in the Pattern picker.
 *
 * The user uploads a black-and-white SVG, PNG or JPEG. Either way the tile
 * is drawn through an SVG LUMINANCE MASK over an ink-colored rect, so a
 * custom pattern recolors exactly like a built-in one — ink pick,
 * palette-paired ink, background, Scale — and a non-square upload is
 * squashed to the square tile (no cropping).
 *
 * - An SVG is stored AS-IS (its own data URL) and painted into the mask
 *   through an invert filter (black ink → white = ink in the mask;
 *   white / transparent → black = background). It stays vector, so the
 *   tile is crisp at any Scale, zoom and export DPI.
 * - A PNG / JPEG is resampled to `CUSTOM_PATTERN_MASK_PX` and stored as a
 *   grayscale mask PNG: dark pixels become white (ink), light pixels black
 *   (background). Edge pixels keep their in-between gray, so curves stay
 *   antialiased at any zoom instead of stair-stepping.
 *
 * Pattern references stay numeric palette indices tool-wide; an index
 * `i >= CUSTOM_PATTERN_BASE` refers to the chart's
 * `PatternConfig.customPatterns[i - CUSTOM_PATTERN_BASE]` — the same scheme
 * as custom shape glyphs (`lib/customGlyphs`). `PatternTile` reads the
 * chart's list from `CustomPatternsContext` (provided at the app / embed
 * roots), so chart defs, legend swatches and the Pattern menu's chips all
 * draw the same tile.
 */

/** A user-uploaded pattern. The type lives in `channelConfig.ts` (its only
 *  structural home, `PatternConfig.customPatterns`) so the pure-lib / mcp
 *  typecheck never has to read this React-bound file; re-exported here for
 *  the editor and tests. */
export type { CustomPattern }

/** First pattern index that refers into `customPatterns`. A fixed constant
 * far past the built-in palette, so appending a built-in pattern never
 * shifts saved custom references. */
export const CUSTOM_PATTERN_BASE = 1000

/** Side (px) of a stored mask. 8× the ×1 tile, so the pattern stays sharp
 * at Scale ×4 on a 2× (retina) screen; a rings-style mask PNG-compresses to
 * a few KB. */
export const CUSTOM_PATTERN_MASK_PX = 256

/** Side (px) a custom pattern's tile draws at ×1 — the Scale control
 * zooms from here. Larger than the built-ins' 8–10 px because an upload
 * usually carries more detail per tile. */
export const CUSTOM_PATTERN_TILE_PX = 32

/** Image types the upload accepts. */
export const CUSTOM_PATTERN_ACCEPT = "image/svg+xml,image/png,image/jpeg"

/** Longest SVG data URL a custom pattern stores (same cap as an image
 * annotation). A pattern tile is a small drawing; this only stops a
 * megabyte-scale export from being written into every save. */
export const CUSTOM_PATTERN_SVG_MAX_CHARS = 400 * 1024

/** Levels applied to the ink amount: at or below `INK_LO` reads as pure
 * background, at or above `INK_HI` as pure ink, linear between. Cleans JPEG
 * noise and off-white paper while keeping the antialiased edge ramp. */
const INK_LO = 48
const INK_HI = 208

/** A pixel counts as COLORED (not black / white / gray) when its RGB
 * channels spread by more than this. JPEG noise and antialiasing stay well
 * under it. */
const COLOR_CHROMA = 60
/** Share of colored pixels above which an upload is rejected as not
 * black-and-white. Small, so a stray colored speck doesn't block an
 * otherwise monochrome image. */
const MAX_COLORED_SHARE = 0.02

export const isCustomPatternIdx = (idx: number): boolean =>
	idx >= CUSTOM_PATTERN_BASE

/** The custom pattern at palette index `idx`, or null (a built-in index, a
 * tombstoned slot, or one out of range). */
export const resolveCustomPattern = (
	idx: number,
	customPatterns: ReadonlyArray<CustomPattern | null> | undefined
): CustomPattern | null =>
	isCustomPatternIdx(idx)
		? (customPatterns?.[idx - CUSTOM_PATTERN_BASE] ?? null)
		: null

/** The chart's custom pattern list, for `PatternTile`. Absent outside a
 * provider (the theme sampler, tests) — custom indices then fall back to
 * the first built-in pattern. */
export const CustomPatternsContext = createContext<
	ReadonlyArray<CustomPattern | null> | undefined
>(undefined)

export const useCustomPatterns = () => useContext(CustomPatternsContext)

/** SVG path covering a legacy grid pattern's ink cells, in cell units (one
 * cell = 1 user unit; scale it to the tile). Horizontal runs merge into one
 * rectangle each, and it's ONE path so adjacent cells antialias without
 * seams. Empty string when the pattern has no ink. */
export const customPatternPath = (p: { size: number; bits: string }): string => {
	const parts: string[] = []
	for (let y = 0; y < p.size; y++) {
		let x = 0
		while (x < p.size) {
			if (p.bits[y * p.size + x] !== "1") {
				x++
				continue
			}
			const start = x
			while (x < p.size && p.bits[y * p.size + x] === "1") x++
			parts.push(`M${start},${y}h${x - start}v1h${start - x}z`)
		}
	}
	return parts.join("")
}

/** Validate a stored value (saved visuals, imports) as a custom pattern. */
export const isCustomPattern = (v: unknown): v is CustomPattern => {
	if (!v || typeof v !== "object") return false
	if ("svg" in v) {
		const { svg } = v as { svg: unknown }
		return (
			typeof svg === "string" &&
			svg.startsWith("data:image/svg+xml") &&
			svg.length <= CUSTOM_PATTERN_SVG_MAX_CHARS
		)
	}
	if ("mask" in v) {
		const { mask } = v as { mask: unknown }
		return typeof mask === "string" && mask.startsWith("data:image/png;base64,")
	}
	const { size, bits } = v as { size: unknown; bits: unknown }
	return (
		typeof size === "number" &&
		typeof bits === "string" &&
		bits.length === size ** 2 &&
		/^[01]*$/.test(bits)
	)
}

/** Per-pixel INK AMOUNT (0 = background … 255 = ink) of raw RGBA pixels:
 * transparency composited over white, luminance inverted, then levelled
 * (`INK_LO` / `INK_HI`). Throws when the image isn't black-and-white, or
 * comes out a single solid color. Pure, so it's unit-testable without a
 * canvas. */
export const pixelsToInk = (
	data: Uint8ClampedArray,
	width: number,
	height: number
): Uint8ClampedArray => {
	const n = width * height
	const ink = new Uint8ClampedArray(n)
	let colored = 0
	let anyInk = false
	let anyBg = false
	for (let i = 0; i < n; i++) {
		const o = i * 4
		const a = data[o + 3] / 255
		const r = data[o] * a + 255 * (1 - a)
		const g = data[o + 1] * a + 255 * (1 - a)
		const b = data[o + 2] * a + 255 * (1 - a)
		if (Math.max(r, g, b) - Math.min(r, g, b) > COLOR_CHROMA) colored++
		const dark = 255 - (0.299 * r + 0.587 * g + 0.114 * b)
		const v = Math.round(((dark - INK_LO) / (INK_HI - INK_LO)) * 255)
		ink[i] = v
		if (ink[i] > 127) anyInk = true
		else anyBg = true
	}
	if (colored > MAX_COLORED_SHARE * n) {
		throw new Error("Use a black-and-white image — this one has color in it")
	}
	if (!anyInk || !anyBg) {
		throw new Error("This image is a single solid color — it needs both black and white")
	}
	return ink
}

const TOO_LARGE_MESSAGE =
	"That SVG is too large to store with the chart — try a simpler one."

const readAsDataUrl = (file: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener("load", () => resolve(String(reader.result)))
		reader.addEventListener("error", () =>
			reject(new Error("Couldn't read that image"))
		)
		reader.readAsDataURL(file)
	})

const loadImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error("Couldn't read that image"))
		img.src = url
	})

/** Draw `img` squashed onto a square `CUSTOM_PATTERN_MASK_PX` canvas and
 * return its ink amounts (`pixelsToInk`, which throws for color / solid
 * images) together with the canvas. */
const rasterizeToInk = (
	img: HTMLImageElement
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; ink: Uint8ClampedArray } => {
	const side = CUSTOM_PATTERN_MASK_PX
	const canvas = document.createElement("canvas")
	canvas.width = side
	canvas.height = side
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Couldn't process that image")
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = "high"
	// Stretch to the square — a non-square upload is compressed, not
	// cropped.
	ctx.drawImage(img, 0, 0, side, side)
	const pixels = ctx.getImageData(0, 0, side, side)
	return { canvas, ctx, ink: pixelsToInk(pixels.data, side, side) }
}

/** Read an uploaded image into a custom pattern.
 *
 * - SVG: kept as its own data URL (`{ svg }`), so the tile stays vector. It
 *   is still rasterized once, to a scratch canvas, for the same
 *   black-and-white / not-solid check the raster path applies.
 * - PNG / JPEG: squashed to a square `CUSTOM_PATTERN_MASK_PX` canvas,
 *   `pixelsToInk`, and the ink amounts encoded as a grayscale PNG mask
 *   (`{ mask }`).
 *
 * Rejects (with a message for the picker's inline error) on other file
 * types, decode failures, color and solid images, and oversize SVGs. */
export const fileToCustomPattern = async (file: File): Promise<CustomPattern> => {
	const isSvg = file.type === "image/svg+xml"
	if (!isSvg && file.type !== "image/png" && file.type !== "image/jpeg") {
		throw new Error("Upload an SVG, PNG or JPEG")
	}
	const dataUrl = await readAsDataUrl(file)
	if (isSvg && dataUrl.length > CUSTOM_PATTERN_SVG_MAX_CHARS) {
		throw new Error(TOO_LARGE_MESSAGE)
	}
	const img = await loadImage(dataUrl)
	let raster: ReturnType<typeof rasterizeToInk>
	try {
		raster = rasterizeToInk(img)
	} catch (err) {
		throw err instanceof Error ? err : new Error("Couldn't process that image")
	}
	if (isSvg) return { svg: dataUrl }
	const { canvas, ctx, ink } = raster
	const side = CUSTOM_PATTERN_MASK_PX
	const pixels = ctx.getImageData(0, 0, side, side)
	for (let i = 0; i < ink.length; i++) {
		const o = i * 4
		pixels.data[o] = ink[i]
		pixels.data[o + 1] = ink[i]
		pixels.data[o + 2] = ink[i]
		pixels.data[o + 3] = 255
	}
	ctx.putImageData(pixels, 0, 0)
	return { mask: canvas.toDataURL("image/png") }
}

// ----- Config edits ---------------------------------------------------------

/** Store `pattern` in the first tombstoned slot (else append) and return the
 * palette index it's now referenced by. Pure — the caller writes `list`
 * back to `PatternConfig.customPatterns`. */
export const insertCustomPattern = (
	existing: ReadonlyArray<CustomPattern | null> | undefined,
	pattern: CustomPattern
): { list: Array<CustomPattern | null>; idx: number } => {
	const list = [...(existing ?? [])]
	let slot = list.indexOf(null)
	if (slot === -1) {
		slot = list.length
		list.push(pattern)
	} else {
		list[slot] = pattern
	}
	return { list, idx: CUSTOM_PATTERN_BASE + slot }
}

/** The per-category pick maps and the no-variable default picks that can
 * reference a custom pattern. */
const PICK_MAP_KEYS = ["overrides", "polygonOverrides", "violinOverrides"] as const
const PICK_DEFAULT_KEYS = ["defaultPolygonPattern", "defaultViolinPattern"] as const

/** Delete the custom pattern in `slot`: tombstone it (never splice, so the
 * other slots' indices stay stable) and drop every pick that pointed at it
 * — those categories / defaults go back to their un-picked state (the
 * auto-cycled or "none" pattern) rather than silently showing something
 * else. */
export const removeCustomPattern = (
	configs: ChannelConfigs,
	slot: number
): ChannelConfigs => {
	const pattern = configs.pattern
	if (!pattern?.customPatterns) return configs
	const idx = CUSTOM_PATTERN_BASE + slot
	const next: PatternConfig = {
		...pattern,
		customPatterns: pattern.customPatterns.map((p, i) => (i === slot ? null : p)),
	}
	for (const key of PICK_MAP_KEYS) {
		const map = pattern[key]
		if (!map) continue
		next[key] = Object.fromEntries(
			Object.entries(map).filter(([, v]) => v !== idx)
		) as PatternConfig[typeof key] & {}
	}
	for (const key of PICK_DEFAULT_KEYS) {
		if (pattern[key] === idx) next[key] = null
	}
	return {
		...configs,
		pattern: next,
		...(configs.defaultPattern === idx ? { defaultPattern: null } : {}),
	}
}
