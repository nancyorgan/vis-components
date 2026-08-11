export const PLOT_SVG_ID = "vc-scatter-svg"

const SVG_NS = "http://www.w3.org/2000/svg"

// Serialize an SVG element to a base64-encoded data URL.
// btoa only handles Latin-1, so we UTF-8 encode first.
const toDataUrl = (svgText: string): string => {
	const utf8 = encodeURIComponent(svgText).replaceAll(
		/%([0-9A-F]{2})/g,
		(_, h) => String.fromCodePoint(Number.parseInt(h, 16))
	)
	// btoa is the direct base64 encoder we need for building data URLs.
	// eslint-disable-next-line no-restricted-globals
	return `data:image/svg+xml;base64,${btoa(utf8)}`
}

const cloneAsRoot = (svg: SVGSVGElement): SVGSVGElement => {
	const clone = svg.cloneNode(true) as SVGSVGElement
	if (!clone.getAttribute("xmlns")) {
		clone.setAttribute("xmlns", SVG_NS)
	}
	// PlotCanvas renders the SVG with pixel width/height but no viewBox. For
	// the thumbnail we need it to scale fluidly inside the library card's
	// <img object-contain> box, so synthesize a viewBox from the rendered
	// dimensions when one isn't already set.
	if (!clone.getAttribute("viewBox")) {
		const width = clone.getAttribute("width") ?? `${svg.clientWidth || 0}`
		const height = clone.getAttribute("height") ?? `${svg.clientHeight || 0}`
		if (Number.parseFloat(width) > 0 && Number.parseFloat(height) > 0) {
			clone.setAttribute("viewBox", `0 0 ${width} ${height}`)
		}
	}
	return clone
}

/** Compose a faceted chart's panels + labels into a single wrapper SVG and
 * return the serialized markup. Pure DOM-walk — works against any document
 * (the editor's own, or a same-origin embed iframe's). */
const serializeFacetedChart = (
	grid: HTMLElement,
	doc: Document
): string | null => {
	const svgs = [...grid.querySelectorAll<SVGSVGElement>(`#${PLOT_SVG_ID}`)]
	if (svgs.length === 0) return null

	const gridRect = grid.getBoundingClientRect()
	if (gridRect.width === 0 || gridRect.height === 0) return null

	const wrapper = doc.createElementNS(SVG_NS, "svg")
	wrapper.setAttribute("xmlns", SVG_NS)
	wrapper.setAttribute("width", String(gridRect.width))
	wrapper.setAttribute("height", String(gridRect.height))
	wrapper.setAttribute("viewBox", `0 0 ${gridRect.width} ${gridRect.height}`)

	for (const svg of svgs) {
		const r = svg.getBoundingClientRect()
		const nested = svg.cloneNode(true) as SVGSVGElement
		nested.setAttribute("x", String(r.left - gridRect.left))
		nested.setAttribute("y", String(r.top - gridRect.top))
		nested.setAttribute("width", String(r.width))
		nested.setAttribute("height", String(r.height))
		// Strip the duplicated id from each nested copy — only the wrapper
		// needs to be findable, and even that is irrelevant for serialization.
		nested.removeAttribute("id")
		wrapper.append(nested)
	}

	const view = doc.defaultView ?? globalThis
	const addText = (
		el: HTMLElement,
		opts: { fontWeight?: string; opacity?: number } = {}
	) => {
		const r = el.getBoundingClientRect()
		const style = view.getComputedStyle(el)
		const text = doc.createElementNS(SVG_NS, "text")
		text.setAttribute("x", String(r.left + r.width / 2 - gridRect.left))
		// Baseline near the visual bottom of the box.
		text.setAttribute("y", String(r.bottom - gridRect.top - 3))
		text.setAttribute("text-anchor", "middle")
		// Fallback mirrors the base text default (12pt → 16px, lib/fontUnit) —
		// computed styles are already px and pass through unchanged.
		text.setAttribute("font-size", style.fontSize || "16")
		text.setAttribute(
			"font-family",
			style.fontFamily || "system-ui, sans-serif"
		)
		text.setAttribute(
			"font-weight",
			opts.fontWeight ?? style.fontWeight ?? "400"
		)
		text.setAttribute("fill", style.color)
		if (opts.opacity !== undefined) {
			text.setAttribute("opacity", String(opts.opacity))
		}
		text.textContent = el.textContent ?? ""
		wrapper.append(text)
	}

	const title = grid.querySelector<HTMLElement>("[data-facet-title]")
	if (title) addText(title, { fontWeight: "600" })
	const subtitle = grid.querySelector<HTMLElement>("[data-facet-subtitle]")
	if (subtitle) addText(subtitle, { opacity: 0.75 })

	for (const label of grid.querySelectorAll<HTMLElement>(
		"[data-facet-label]"
	)) {
		addText(label, { fontWeight: "500" })
	}

	return new XMLSerializer().serializeToString(wrapper)
}

/** Returns the current chart serialized as standalone SVG markup, or `null`
 * if no chart is rendered yet. Walks the supplied document — defaults to
 * the editor's own document but accepts a same-origin embed iframe so the
 * Export modal can pull a render at the user's chosen dimensions. */
export const serializeChartSvg = (doc: Document = document): string | null => {
	const grid = doc.querySelector<HTMLElement>("[data-facet-grid]")
	if (grid) return serializeFacetedChart(grid, doc)
	const svg = doc.querySelector<SVGSVGElement>(`#${PLOT_SVG_ID}`)
	// Cross-realm safe: when `doc` is a same-origin iframe's document (the
	// Export modal's preview), its `SVGSVGElement` is a *different* constructor
	// than this realm's, so `svg instanceof SVGSVGElement` is always false and
	// we'd wrongly bail. Duck-type on the element's tag instead.
	if (!svg || svg.localName !== "svg") return null
	return new XMLSerializer().serializeToString(cloneAsRoot(svg))
}

// ---------------------------------------------------------------------------
// Full-page export capture (chart + legend)
// ---------------------------------------------------------------------------

const CSS_TRANSPARENT = "rgba(0, 0, 0, 0)"

const isVisibleColor = (c: string | undefined | null): boolean =>
	!!c && c !== "transparent" && c !== CSS_TRANSPARENT && c !== "none"

/** Split on commas that sit outside parentheses, so `rgb(1, 2, 3) 0%`
 * stays one piece when tearing apart a gradient's stop list. */
const splitTopLevel = (s: string): string[] => {
	const parts: string[] = []
	let depth = 0
	let current = ""
	for (const ch of s) {
		if (ch === "(") depth++
		if (ch === ")") depth--
		if (ch === "," && depth === 0) {
			parts.push(current.trim())
			current = ""
		} else {
			current += ch
		}
	}
	if (current.trim()) parts.push(current.trim())
	return parts
}

type GradientCoords = { x1: string; y1: string; x2: string; y2: string }
type ParsedGradient = {
	coords: GradientCoords
	stops: Array<{ color: string; offset: number }>
}

const GRADIENT_DIRECTIONS: Record<string, GradientCoords> = {
	"to top": { x1: "0", y1: "1", x2: "0", y2: "0" },
	"to right": { x1: "0", y1: "0", x2: "1", y2: "0" },
	"to bottom": { x1: "0", y1: "0", x2: "0", y2: "1" },
	"to left": { x1: "1", y1: "0", x2: "0", y2: "0" },
}

/** Parse a computed `linear-gradient(...)` background into SVG gradient
 * coords + stops. The legend's ramp bars only ever use the four keyword
 * directions; anything fancier returns null and the caller skips the fill.
 * Exported for tests. */
export const parseLinearGradient = (bgImage: string): ParsedGradient | null => {
	const m = /^linear-gradient\((.*)\)$/s.exec(bgImage.trim())
	if (!m) return null
	const parts = splitTopLevel(m[1])
	if (parts.length === 0) return null
	// CSS's default direction is "to bottom".
	let coords = GRADIENT_DIRECTIONS["to bottom"]
	let stopParts = parts
	const first = parts[0]
	if (first.startsWith("to ") || first.endsWith("deg")) {
		const named = GRADIENT_DIRECTIONS[first]
		if (!named) return null
		coords = named
		stopParts = parts.slice(1)
	}
	if (stopParts.length < 2) return null
	const stops = stopParts.map((p, i) => {
		const sm = /^(.*?)\s+([\d.]+)%$/.exec(p)
		return sm
			? { color: sm[1], offset: Number.parseFloat(sm[2]) / 100 }
			: { color: p, offset: i / (stopParts.length - 1) }
	})
	return { coords, stops }
}

/** Recreate the HTML legend as SVG primitives appended to `wrapper`:
 * inline swatch <svg>s are cloned wholesale (their pattern defs are
 * self-contained), colored/bordered boxes become <rect>s, CSS gradient
 * ramp bars become <linearGradient> fills, and text nodes become <text>
 * positioned by their live layout rects. A DOM-walk (vs. foreignObject)
 * because Safari can't rasterize foreignObject HTML onto a canvas. */
const appendLegendCapture = (
	legendRoot: HTMLElement,
	wrapper: SVGSVGElement,
	origin: { left: number; top: number },
	doc: Document
): void => {
	const view = doc.defaultView ?? globalThis
	let defs: SVGDefsElement | null = null
	let gradientSeq = 0
	const ensureDefs = (): SVGDefsElement => {
		if (!defs) {
			defs = doc.createElementNS(SVG_NS, "defs") as SVGDefsElement
			wrapper.append(defs)
		}
		return defs
	}

	const paintBox = (
		el: Element,
		style: CSSStyleDeclaration,
		opacity: number
	) => {
		const r = el.getBoundingClientRect()
		if (r.width <= 0 || r.height <= 0) return
		const gradient =
			style.backgroundImage && style.backgroundImage !== "none"
				? parseLinearGradient(style.backgroundImage)
				: null
		const hasBg = isVisibleColor(style.backgroundColor)
		const borderWidth = Number.parseFloat(style.borderTopWidth) || 0
		const hasBorder =
			borderWidth > 0 &&
			style.borderTopStyle !== "none" &&
			isVisibleColor(style.borderTopColor)
		if (!gradient && !hasBg && !hasBorder) return
		const rect = doc.createElementNS(SVG_NS, "rect")
		rect.setAttribute("x", String(r.left - origin.left))
		rect.setAttribute("y", String(r.top - origin.top))
		rect.setAttribute("width", String(r.width))
		rect.setAttribute("height", String(r.height))
		const radius = Number.parseFloat(style.borderTopLeftRadius) || 0
		if (radius > 0) rect.setAttribute("rx", String(radius))
		if (gradient) {
			const id = `vc-export-legend-grad-${gradientSeq++}`
			const grad = doc.createElementNS(SVG_NS, "linearGradient")
			grad.setAttribute("id", id)
			grad.setAttribute("x1", gradient.coords.x1)
			grad.setAttribute("y1", gradient.coords.y1)
			grad.setAttribute("x2", gradient.coords.x2)
			grad.setAttribute("y2", gradient.coords.y2)
			for (const s of gradient.stops) {
				const stop = doc.createElementNS(SVG_NS, "stop")
				stop.setAttribute("offset", String(s.offset))
				stop.setAttribute("stop-color", s.color)
				grad.append(stop)
			}
			ensureDefs().append(grad)
			rect.setAttribute("fill", `url(#${id})`)
		} else {
			rect.setAttribute("fill", hasBg ? style.backgroundColor : "none")
		}
		if (hasBorder) {
			rect.setAttribute("stroke", style.borderTopColor)
			rect.setAttribute("stroke-width", String(borderWidth))
		}
		if (opacity < 1) rect.setAttribute("opacity", String(opacity))
		wrapper.append(rect)
	}

	const addText = (
		node: Node,
		style: CSSStyleDeclaration,
		opacity: number
	) => {
		const content = (node.textContent ?? "").replaceAll(/\s+/g, " ").trim()
		if (!content) return
		const range = doc.createRange()
		range.selectNodeContents(node)
		const r = range.getBoundingClientRect()
		if (r.width === 0 || r.height === 0) return
		const text = doc.createElementNS(SVG_NS, "text")
		text.setAttribute("x", String(r.left - origin.left))
		text.setAttribute("y", String(r.top + r.height / 2 - origin.top))
		text.setAttribute("dominant-baseline", "central")
		text.setAttribute("font-size", style.fontSize || "16px")
		text.setAttribute(
			"font-family",
			style.fontFamily || "system-ui, sans-serif"
		)
		text.setAttribute("font-weight", style.fontWeight || "400")
		if (style.fontStyle && style.fontStyle !== "normal") {
			text.setAttribute("font-style", style.fontStyle)
		}
		if (style.textDecorationLine.includes("underline")) {
			text.setAttribute("text-decoration", "underline")
		}
		text.setAttribute("fill", style.color)
		if (opacity < 1) text.setAttribute("opacity", String(opacity))
		text.textContent = content
		wrapper.append(text)
	}

	// `inherited` accumulates ancestor opacity — computed style only reports
	// each element's own value, but visually they multiply down the tree.
	const walk = (el: Element, inherited: number) => {
		if (el.localName === "svg") {
			const r = el.getBoundingClientRect()
			if (r.width === 0 || r.height === 0) return
			const nested = el.cloneNode(true) as SVGSVGElement
			nested.setAttribute("x", String(r.left - origin.left))
			nested.setAttribute("y", String(r.top - origin.top))
			nested.setAttribute("width", String(r.width))
			nested.setAttribute("height", String(r.height))
			nested.removeAttribute("id")
			if (inherited < 1) {
				nested.setAttribute("opacity", String(inherited))
			}
			wrapper.append(nested)
			return
		}
		const style = view.getComputedStyle(el)
		if (style.display === "none" || style.visibility === "hidden") return
		const own = Number.parseFloat(style.opacity)
		const opacity = inherited * (Number.isNaN(own) ? 1 : own)
		if (opacity === 0) return
		paintBox(el, style, opacity)
		for (const child of el.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				addText(child, style, opacity)
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				walk(child as Element, opacity)
			}
		}
	}
	walk(legendRoot, 1)
}

/** Compose the full embed page — chart panels, facet titles/labels, AND the
 * HTML legend — into one standalone SVG for image export. Positions come
 * from live layout rects, so the output matches the preview iframe
 * pixel-for-pixel. Falls back to the chart-only capture when the document
 * has no export root (e.g. older embeds mid-deploy). */
export const serializeEmbedCapture = (doc: Document): string | null => {
	const root = doc.querySelector<HTMLElement>("[data-export-root]")
	if (!root) return serializeChartSvg(doc)
	const rootRect = root.getBoundingClientRect()
	if (rootRect.width === 0 || rootRect.height === 0) return null
	const svgs = [...root.querySelectorAll<SVGSVGElement>(`#${PLOT_SVG_ID}`)]
	if (svgs.length === 0) return null
	const view = doc.defaultView ?? globalThis
	const origin = { left: rootRect.left, top: rootRect.top }

	const wrapper = doc.createElementNS(SVG_NS, "svg")
	wrapper.setAttribute("xmlns", SVG_NS)
	wrapper.setAttribute("width", String(rootRect.width))
	wrapper.setAttribute("height", String(rootRect.height))
	wrapper.setAttribute("viewBox", `0 0 ${rootRect.width} ${rootRect.height}`)

	// The chart's background color lives on a wrapper div (ChartCanvas), not
	// inside the chart SVG — replicate it as a full-bleed rect so exports
	// keep the canvas color. Transparent stays transparent (PNG/SVG).
	const bgOwner = [root, root.firstElementChild].find(
		(el) => el && isVisibleColor(view.getComputedStyle(el).backgroundColor)
	)
	if (bgOwner) {
		const bg = doc.createElementNS(SVG_NS, "rect")
		bg.setAttribute("width", String(rootRect.width))
		bg.setAttribute("height", String(rootRect.height))
		bg.setAttribute("fill", view.getComputedStyle(bgOwner).backgroundColor)
		wrapper.append(bg)
	}

	for (const svg of svgs) {
		const r = svg.getBoundingClientRect()
		const nested = svg.cloneNode(true) as SVGSVGElement
		nested.setAttribute("x", String(r.left - origin.left))
		nested.setAttribute("y", String(r.top - origin.top))
		nested.setAttribute("width", String(r.width))
		nested.setAttribute("height", String(r.height))
		nested.removeAttribute("id")
		wrapper.append(nested)
	}

	// Titles, subtitles, and per-panel facet labels are all <text> inside the
	// chart SVG (see PlotCanvas), so the clone above already carries them —
	// only the HTML legend still needs recreating.
	for (const legend of root.querySelectorAll<HTMLElement>(
		"[data-legend-root]"
	)) {
		appendLegendCapture(legend, wrapper, origin, doc)
	}

	return new XMLSerializer().serializeToString(wrapper)
}

/** Longest-edge target for rasterized thumbnails. Library cards display
 *  roughly 320×240 logical px; 480 gives 1.5× headroom for hi-DPI displays
 *  while keeping each PNG under ~15KB. Thumbnails persist in IndexedDB (see
 *  storage.ts), so the ceiling is about load time, not storage quota. */
const MAX_THUMBNAIL_DIM = 480

/** Rasterize an SVG (provided as a data URL) into a PNG data URL via an
 *  offscreen canvas. Resolves `null` if the image fails to load, the SVG
 *  has zero intrinsic dimensions, or the canvas read is blocked. */
const rasterizeSvg = (svgDataUrl: string): Promise<string | null> =>
	new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			const srcW = img.naturalWidth
			const srcH = img.naturalHeight
			if (srcW === 0 || srcH === 0) {
				resolve(null)
				return
			}
			const scale = Math.min(1, MAX_THUMBNAIL_DIM / Math.max(srcW, srcH))
			const w = Math.max(1, Math.round(srcW * scale))
			const h = Math.max(1, Math.round(srcH * scale))
			const canvas = document.createElement("canvas")
			canvas.width = w
			canvas.height = h
			const ctx = canvas.getContext("2d")
			if (!ctx) {
				resolve(null)
				return
			}
			ctx.drawImage(img, 0, 0, w, h)
			try {
				// PNG keeps text/lines crisp without JPEG artifacts. Charts have
				// few colors so PNG compresses well at this size. Transparent
				// background lets the library card's bg fill show through —
				// the card already paints `channelConfigs.backgroundColor`.
				resolve(canvas.toDataURL("image/png"))
			} catch {
				// `toDataURL` throws if the canvas is tainted. Our SVGs are
				// self-contained data URLs with no external refs, so this
				// shouldn't happen, but resolve null defensively.
				resolve(null)
			}
		}
		img.onerror = () => resolve(null)
		img.src = svgDataUrl
	})

/** Rasterize already-serialized chart SVG markup into a thumbnail PNG data
 *  URL. Exposed for the thumbnail backfill, which polls `serializeChartSvg`
 *  until the output stabilizes and then needs to rasterize that exact frame
 *  (re-serializing could catch the next layout pass). */
export const thumbnailFromChartSvgText = (
	svgText: string
): Promise<string | null> => rasterizeSvg(toDataUrl(svgText))

/** Capture the chart rendered in `doc` as a small PNG data URL for use as a
 *  library thumbnail. Returns `null` if no chart is rendered or
 *  rasterization fails. Accepts a same-origin embed iframe's document so the
 *  thumbnail backfill can capture visuals rendered offscreen; rasterization
 *  always happens in this realm's canvas. */
export const captureThumbnailFromDocument = async (
	doc: Document
): Promise<string | null> => {
	const svgText = serializeChartSvg(doc)
	if (!svgText) return null
	return thumbnailFromChartSvgText(svgText)
}

/** Capture the editor's own chart — the autosave path. */
export const captureThumbnail = (): Promise<string | null> =>
	captureThumbnailFromDocument(document)
