import type { MouseEventHandler } from "react"
import type { CustomGlyph } from "./channelConfig"
import { SHAPE_PALETTE, symbolPath } from "./scales"

/**
 * Custom mark glyphs — the "Custom" option in the Shape picker.
 *
 * Shape references stay numeric palette indices tool-wide; an index
 * `i >= SHAPE_PALETTE.length` refers to the chart's
 * `ShapeConfig.customGlyphs[i - SHAPE_PALETTE.length]` entry (a short text
 * string or an uploaded image stored as a small data URL). `resolveGlyph`
 * turns any index into a renderable descriptor, and `GlyphMark` is the one
 * place that knows how each kind renders — used by chart marks, legend
 * swatches, and the picker chips alike.
 */

export type ResolvedGlyph =
	| { kind: "symbol"; idx: number }
	| { kind: "text"; text: string; dx?: number; dy?: number }
	| { kind: "image"; href: string; aspect: number }

/** Max characters in a text glyph (unicode code points, so one emoji = 1). */
export const MAX_TEXT_GLYPH_CHARS = 3

/** Longest side of a stored image glyph, px. Marks render at ~4–30 px
 * radius, so 128 px is ample while keeping each glyph a few KB inside the
 * localStorage visual blob. */
export const MAX_IMAGE_GLYPH_PX = 128

/** First shape index that refers into `customGlyphs` (one past the
 * built-in symbol palette). */
export const CUSTOM_GLYPH_BASE = SHAPE_PALETTE.length

/** Resolve a shape index to a renderable glyph. Built-in indices map to
 * their symbol; custom indices look up the chart's glyph list. Tombstoned
 * (null) or out-of-range custom references fall back to the circle so a
 * deleted glyph degrades gracefully instead of vanishing marks. */
export const resolveGlyph = (
	idx: number,
	customGlyphs?: ReadonlyArray<CustomGlyph | null>
): ResolvedGlyph => {
	if (idx >= 0 && idx < SHAPE_PALETTE.length) return { kind: "symbol", idx }
	const custom = customGlyphs?.[idx - CUSTOM_GLYPH_BASE]
	if (!custom) return { kind: "symbol", idx: 0 }
	return custom
}

/** Drop a text glyph's position nudge so it renders centered. Chip
 * previews and legend swatches use this — a nudged glyph floating
 * off-center in a small swatch box reads as a bug (and can clip); only
 * chart marks apply the nudge. */
export const stripNudge = (glyph: ResolvedGlyph): ResolvedGlyph =>
	glyph.kind === "text" && (glyph.dx || glyph.dy)
		? { kind: "text", text: glyph.text }
		: glyph

/** Split into user-perceived characters: grapheme clusters when
 * `Intl.Segmenter` exists (so a skin-tone or ZWJ-sequence emoji counts
 * ONCE), else code points (surrogate pairs still count once). */
const graphemes = (text: string): string[] => {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		return [...new Intl.Segmenter().segment(text)].map((s) => s.segment)
	}
	return Array.from(text)
}

/** User-perceived character count — one emoji = 1, however many code
 * points compose it. */
export const glyphCharCount = (text: string): number => graphemes(text).length

/** Cap a text-glyph input to `MAX_TEXT_GLYPH_CHARS` user-perceived
 * characters. Spaces are kept and count — a lone space is a deliberate
 * blank mark, and " _" / "_" / "_ " are three different glyphs. */
export const sanitizeGlyphText = (raw: string): string =>
	graphemes(raw).slice(0, MAX_TEXT_GLYPH_CHARS).join("")

/** Font size that fits `text` into a mark of circle-equivalent radius `r`.
 * A single character draws at ~2.4r for visual parity with the filled
 * symbols (a glyph's ink box is smaller than its em box); longer strings
 * shrink so the whole string spans the mark's 2r-wide box, assuming ~0.6em
 * average character width. */
export const textGlyphFontSize = (text: string, r: number): number => {
	const chars = Math.max(1, glyphCharCount(text))
	return Math.min(2.4 * r, (2 * r) / (0.6 * chars))
}

/** Downscale an uploaded image to `MAX_IMAGE_GLYPH_PX` on its longest side
 * and encode it as a PNG data URL. Rejects on non-image files or decode
 * failures so the picker can show an inline error. */
export const fileToGlyph = (file: File): Promise<CustomGlyph> =>
	new Promise((resolve, reject) => {
		if (!file.type.startsWith("image/")) {
			reject(new Error("That file isn't an image"))
			return
		}
		const url = URL.createObjectURL(file)
		const img = new Image()
		img.onload = () => {
			URL.revokeObjectURL(url)
			const iw = img.naturalWidth || 1
			const ih = img.naturalHeight || 1
			const scale = Math.min(1, MAX_IMAGE_GLYPH_PX / Math.max(iw, ih))
			const w = Math.max(1, Math.round(iw * scale))
			const h = Math.max(1, Math.round(ih * scale))
			const canvas = document.createElement("canvas")
			canvas.width = w
			canvas.height = h
			const ctx = canvas.getContext("2d")
			if (!ctx) {
				reject(new Error("Couldn't process that image"))
				return
			}
			ctx.drawImage(img, 0, 0, w, h)
			try {
				resolve({
					kind: "image",
					href: canvas.toDataURL("image/png"),
					aspect: w / h,
				})
			} catch {
				reject(new Error("Couldn't process that image"))
			}
		}
		img.onerror = () => {
			URL.revokeObjectURL(url)
			reject(new Error("Couldn't read that image"))
		}
		img.src = url
	})

/** Render one mark glyph. Symbols keep today's exact `<path>` output; text
 * draws centered, tinted by `fill` with the outline behind the letterforms
 * (`paintOrder: stroke`); images render as-is — fill / stroke / pattern
 * don't apply, and the mark's fill opacity folds into the element opacity
 * so encoded opacity still fades the image like any other mark. The caller
 * owns positioning via `transform` (glyphs center on the local origin,
 * matching `symbolPath`); a text glyph's creation-time `dx`/`dy` nudge
 * shifts its ink off that origin — preview/legend callers pass the glyph
 * through `stripNudge` to stay centered. */
export const GlyphMark = ({
	glyph,
	r,
	fill,
	fillOpacity,
	stroke,
	strokeWidth,
	strokeOpacity,
	transform,
	opacity,
	onMouseEnter,
}: {
	glyph: ResolvedGlyph
	/** Circle-equivalent mark radius in px — the value `symbolPath` takes. */
	r: number
	fill: string
	fillOpacity?: number
	stroke?: string
	strokeWidth?: number
	strokeOpacity?: number
	transform?: string
	opacity?: number
	onMouseEnter?: MouseEventHandler<SVGElement>
}) => {
	if (glyph.kind === "image") {
		const w = glyph.aspect >= 1 ? 2 * r : 2 * r * glyph.aspect
		const h = glyph.aspect >= 1 ? (2 * r) / glyph.aspect : 2 * r
		return (
			<image
				href={glyph.href}
				x={-w / 2}
				y={-h / 2}
				width={w}
				height={h}
				preserveAspectRatio="xMidYMid meet"
				transform={transform}
				opacity={(opacity ?? 1) * (fillOpacity ?? 1)}
				onMouseEnter={onMouseEnter}
			/>
		)
	}
	if (glyph.kind === "text") {
		return (
			<text
				textAnchor="middle"
				dominantBaseline="central"
				// Creation-time nudge, in multiples of r so it scales with the
				// mark (a px nudge would drift under size encodings).
				x={(glyph.dx ?? 0) * r}
				y={(glyph.dy ?? 0) * r}
				fontSize={textGlyphFontSize(glyph.text, r)}
				transform={transform}
				fill={fill}
				fillOpacity={fillOpacity}
				stroke={strokeWidth ? stroke : undefined}
				strokeWidth={strokeWidth || undefined}
				strokeOpacity={strokeOpacity}
				opacity={opacity}
				paintOrder="stroke"
				// SVG collapses leading/trailing whitespace by default; keep it
				// so " _", "_" and "_ " center differently and " " stays blank.
				xmlSpace="preserve"
				style={{ userSelect: "none", whiteSpace: "pre" }}
				onMouseEnter={onMouseEnter}
			>
				{glyph.text}
			</text>
		)
	}
	return (
		<path
			d={symbolPath(glyph.idx, r)}
			transform={transform}
			fill={fill}
			fillOpacity={fillOpacity}
			stroke={stroke}
			strokeWidth={strokeWidth}
			strokeOpacity={strokeOpacity}
			opacity={opacity}
			onMouseEnter={onMouseEnter}
		/>
	)
}
