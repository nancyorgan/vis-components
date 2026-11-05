import { createContext, useContext } from "react"

import type { ChannelConfigs, PatternConfig } from "./channelConfig"

/**
 * Custom fill patterns — the "+" chip in the Pattern picker.
 *
 * The user uploads a black-and-white PNG / JPEG. It's squashed to a square
 * (no cropping — a non-square image is compressed along its long side) and
 * resampled to `CUSTOM_PATTERN_MASK_PX`, then stored as a grayscale
 * LUMINANCE MASK: dark pixels of the upload become white in the mask (they
 * show the pattern's INK color), light pixels black (the tile's BACKGROUND
 * shows through). Edge pixels keep their in-between gray, so curves stay
 * antialiased at any zoom instead of stair-stepping. A custom pattern
 * recolors exactly like a built-in one — ink pick, palette-paired ink,
 * background, Scale.
 *
 * Pattern references stay numeric palette indices tool-wide; an index
 * `i >= CUSTOM_PATTERN_BASE` refers to the chart's
 * `PatternConfig.customPatterns[i - CUSTOM_PATTERN_BASE]` — the same scheme
 * as custom shape glyphs (`lib/customGlyphs`). `PatternTile` reads the
 * chart's list from `CustomPatternsContext` (provided at the app / embed
 * roots), so chart defs, legend swatches and the Pattern menu's chips all
 * draw the same tile.
 */

/** A user-uploaded pattern.
 *  - `mask`: a grayscale PNG data URL, white = ink, black = background
 *    (the current format).
 *  - `size` / `bits`: an early on/off grid (row-major, `"1"` = ink) — still
 *    rendered so patterns uploaded before the mask format keep working. */
export type CustomPattern = { mask: string } | { size: number; bits: string }

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
export const CUSTOM_PATTERN_ACCEPT = "image/png,image/jpeg"

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

/** Read an uploaded PNG / JPEG into a custom pattern: squash to a square
 * `CUSTOM_PATTERN_MASK_PX` canvas, `pixelsToInk`, and encode the ink amounts
 * as a grayscale PNG mask. Rejects (with a message for the picker's inline
 * error) on other file types, decode failures, color and solid images. */
export const fileToCustomPattern = (file: File): Promise<CustomPattern> =>
	new Promise((resolve, reject) => {
		if (file.type !== "image/png" && file.type !== "image/jpeg") {
			reject(new Error("Upload a PNG or JPEG"))
			return
		}
		const url = URL.createObjectURL(file)
		const img = new Image()
		img.onload = () => {
			URL.revokeObjectURL(url)
			const side = CUSTOM_PATTERN_MASK_PX
			const canvas = document.createElement("canvas")
			canvas.width = side
			canvas.height = side
			const ctx = canvas.getContext("2d")
			if (!ctx) {
				reject(new Error("Couldn't process that image"))
				return
			}
			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"
			// Stretch to the square — a non-square upload is compressed, not
			// cropped.
			ctx.drawImage(img, 0, 0, side, side)
			try {
				const pixels = ctx.getImageData(0, 0, side, side)
				const ink = pixelsToInk(pixels.data, side, side)
				for (let i = 0; i < ink.length; i++) {
					const o = i * 4
					pixels.data[o] = ink[i]
					pixels.data[o + 1] = ink[i]
					pixels.data[o + 2] = ink[i]
					pixels.data[o + 3] = 255
				}
				ctx.putImageData(pixels, 0, 0)
				resolve({ mask: canvas.toDataURL("image/png") })
			} catch (err) {
				reject(
					err instanceof Error ? err : new Error("Couldn't process that image")
				)
			}
		}
		img.onerror = () => {
			URL.revokeObjectURL(url)
			reject(new Error("Couldn't read that image"))
		}
		img.src = url
	})

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
