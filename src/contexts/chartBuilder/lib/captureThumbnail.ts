import { embedFontsInSvg } from "./fontEmbed"
import { dropInvisiblePaints, flattenTextBaselines, stampResolvedFonts } from "./portableSvg"

export const PLOT_SVG_ID = "vc-scatter-svg"

const SVG_NS = "http://www.w3.org/2000/svg"

/** PlotCanvas stamps the figure's short accessible title (chart title, else
 *  visual name) here; exports turn it into a real `<title>`. */
const A11Y_TITLE_ATTR = "data-a11y-title"

/** Give an exported SVG the chart's accessible name. The live plot SVG
 *  carries `role="img"`, a `<desc>` (the screen-reader description) and the
 *  title in `data-a11y-title` — no live `<title>`, which would pop a native
 *  tooltip over every mark. In a standalone file a `<title>` is what
 *  readers expect, so the export root gets `<title>` + `<desc>` as its first
 *  children, `role="img"`, `aria-labelledby` (title) and `aria-describedby`
 *  (desc). `source` is the svg holding the live markup (the root itself, or
 *  the first nested plot clone in a composed export); every `nested` clone
 *  is stripped of it so the file carries ONE name and no duplicate ids. */
const applyExportAccessibleName = (
	doc: Document,
	root: Element,
	nested: Element[] = []
): void => {
	const source = nested[0] ?? root
	const titleText = (source.getAttribute(A11Y_TITLE_ATTR) ?? "").trim()
	const liveDesc = [...source.children].find((c) => c.localName === "desc")
	const descText = (liveDesc?.textContent ?? "").trim()
	for (const el of [root, ...nested]) {
		el.removeAttribute(A11Y_TITLE_ATTR)
		el.removeAttribute("role")
		el.removeAttribute("aria-label")
		el.removeAttribute("aria-labelledby")
		for (const c of [...el.children]) {
			if (c.localName === "desc" && c.id.startsWith("vc-chart-desc-")) c.remove()
		}
	}
	if (!titleText && !descText) return
	root.setAttribute("role", "img")
	const first = root.firstChild
	if (titleText) {
		const t = doc.createElementNS(SVG_NS, "title")
		t.setAttribute("id", "vc-export-title")
		t.textContent = titleText
		root.insertBefore(t, first)
		root.setAttribute("aria-labelledby", "vc-export-title")
	}
	if (descText) {
		const d = doc.createElementNS(SVG_NS, "desc")
		d.setAttribute("id", "vc-export-desc")
		d.textContent = descText
		root.insertBefore(d, first)
		if (titleText) root.setAttribute("aria-describedby", "vc-export-desc")
		else root.setAttribute("aria-labelledby", "vc-export-desc")
	}
}

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

	const nestedClones: SVGSVGElement[] = []
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
		nestedClones.push(nested)
	}
	applyExportAccessibleName(doc, wrapper, nestedClones)

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
	const clone = cloneAsRoot(svg)
	applyExportAccessibleName(doc, clone)
	return new XMLSerializer().serializeToString(clone)
}

// ---------------------------------------------------------------------------
// Settle detection — shared by every offscreen-embed capture poller
// ---------------------------------------------------------------------------

/** How many consecutive polls the serialized chart must be byte-identical
 *  before we trust it. A cold embed does several layout passes (measure →
 *  solve → re-render, ResizeObserver rounds, font swaps); capturing at
 *  first-nonzero-size grabs a mid-layout frame — facet panels stacked at the
 *  origin under giant title text. Three matching polls ≈ 300ms of layout
 *  silence. */
export const STABLE_POLLS = 3

/** PlotCanvas stamps this on the plot SVG while its container has not been
 *  measured yet (0×0 bounds: the frame between mount and the first
 *  ResizeObserver report, or a hidden host). The solver then has no room
 *  to lay out in and collapses the canvas to its chrome — a ~150px box with
 *  full-size text — which a capture must never mistake for the chart. */
export const UNMEASURED_ATTR = "data-unmeasured"

const panelSized = (panel: Element): boolean => {
	if (panel.hasAttribute(UNMEASURED_ATTR)) return false
	const r = panel.getBoundingClientRect()
	return r.width > 0 && r.height > 0
}

/** True once the chart's layout is worth serializing: the capture target
 *  exists with a real size, was solved for a MEASURED container (see
 *  `UNMEASURED_ATTR`), and — for faceted charts — EVERY panel has one (the
 *  grid gets its size before the individual panels finish mounting). */
export const chartLayoutReady = (doc: Document): boolean => {
	const grid = doc.querySelector<HTMLElement>("[data-facet-grid]")
	if (grid) {
		const gridRect = grid.getBoundingClientRect()
		if (gridRect.width === 0 || gridRect.height === 0) return false
		const panels = [...grid.querySelectorAll<SVGSVGElement>(`#${PLOT_SVG_ID}`)]
		return panels.length > 0 && panels.every(panelSized)
	}
	const svg = doc.querySelector<SVGSVGElement>(`#${PLOT_SVG_ID}`)
	return !!svg && panelSized(svg)
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

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const

/** Recreate an HTML subtree — the legend, or the data table an export
 * includes — as SVG primitives appended to `wrapper`: inline swatch <svg>s
 * are cloned wholesale (their pattern defs are self-contained),
 * colored/bordered boxes become <rect>s (a border on only some sides —
 * the table's row rules — becomes an edge <rect> per side), CSS gradient
 * ramp bars become <linearGradient> fills, and text nodes become <text>
 * positioned by their live layout rects. A DOM-walk (vs. foreignObject)
 * because Safari can't rasterize foreignObject HTML onto a canvas. */
const appendHtmlCapture = (
	htmlRoot: HTMLElement,
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
		const borders = BORDER_SIDES.map((side) => {
			const width =
				Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
			const color = style.getPropertyValue(`border-${side}-color`)
			return width > 0 &&
				style.getPropertyValue(`border-${side}-style`) !== "none" &&
				isVisibleColor(color)
				? { side, width, color }
				: null
		})
		// The same border all round strokes the box itself (rounded corners
		// kept); a border on only some sides — the data table's row rules —
		// paints each of those sides as its own edge rect instead.
		const [first] = borders
		const uniform =
			first !== null &&
			borders.every((b) => b?.width === first.width && b.color === first.color)
		const edges = uniform ? [] : borders.filter((b) => b !== null)
		if (gradient || hasBg || uniform) {
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
			if (uniform) {
				rect.setAttribute("stroke", first.color)
				rect.setAttribute("stroke-width", String(first.width))
			}
			if (opacity < 1) rect.setAttribute("opacity", String(opacity))
			wrapper.append(rect)
		}
		// After the fill, so a rule sits on top of its own cell's background.
		for (const edge of edges) {
			const line = doc.createElementNS(SVG_NS, "rect")
			const horizontal = edge.side === "top" || edge.side === "bottom"
			const x = edge.side === "right" ? r.right - edge.width : r.left
			const y = edge.side === "bottom" ? r.bottom - edge.width : r.top
			line.setAttribute("x", String(x - origin.left))
			line.setAttribute("y", String(y - origin.top))
			line.setAttribute("width", String(horizontal ? r.width : edge.width))
			line.setAttribute("height", String(horizontal ? edge.width : r.height))
			line.setAttribute("fill", edge.color)
			if (opacity < 1) line.setAttribute("opacity", String(opacity))
			wrapper.append(line)
		}
	}

	// A text node that WRAPS (fixed-width legends let labels flow onto extra
	// lines) spans several line boxes. Emitting one <text> for the whole node
	// would print the full label on one overlong line at the block's vertical
	// center, so split it into its rendered lines: walk the characters, group
	// consecutive ones by line-box top, and union each group's rects. Single-
	// line text (the common case, and any environment without per-range
	// client rects) takes the one-rect fast path.
	const renderedLines = (
		node: Node,
		content: string
	): Array<{ text: string; rect: DOMRect }> => {
		const range = doc.createRange()
		range.selectNodeContents(node)
		const whole = range.getBoundingClientRect()
		const single = [{ text: content, rect: whole }]
		if (node.nodeType !== Node.TEXT_NODE) return single
		const raw = node.textContent ?? ""
		const lineRects =
			typeof range.getClientRects === "function"
				? range.getClientRects()
				: undefined
		if (!lineRects || lineRects.length <= 1) return single
		const lines: Array<{
			chars: string[]
			left: number
			right: number
			top: number
			bottom: number
		}> = []
		for (let i = 0; i < raw.length; i++) {
			range.setStart(node, i)
			range.setEnd(node, i + 1)
			const r = range.getBoundingClientRect()
			// Collapsed whitespace at a wrap point has no box; attach it to the
			// current line so word spacing inside a line is preserved.
			if (r.width === 0 && r.height === 0) {
				lines.at(-1)?.chars.push(raw[i])
				continue
			}
			const last = lines.at(-1)
			if (last && Math.abs(last.top - r.top) < 1) {
				last.chars.push(raw[i])
				last.left = Math.min(last.left, r.left)
				last.right = Math.max(last.right, r.right)
				last.bottom = Math.max(last.bottom, r.bottom)
			} else {
				lines.push({
					chars: [raw[i]],
					left: r.left,
					right: r.right,
					top: r.top,
					bottom: r.bottom,
				})
			}
		}
		const out = lines
			.map((l) => ({
				text: l.chars.join("").replaceAll(/\s+/g, " ").trim(),
				rect: new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top),
			}))
			.filter((l) => l.text !== "")
		return out.length > 0 ? out : single
	}

	const addText = (
		node: Node,
		style: CSSStyleDeclaration,
		opacity: number
	) => {
		const content = (node.textContent ?? "").replaceAll(/\s+/g, " ").trim()
		if (!content) return
		for (const line of renderedLines(node, content)) {
			const r = line.rect
			if (r.width === 0 || r.height === 0) continue
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
			text.textContent = line.text
			wrapper.append(text)
		}
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
	walk(htmlRoot, 1)
}

/** Compose the full embed page — chart panels, facet titles/labels, AND the
 * HTML legend — into one standalone SVG for image export. Positions come
 * from live layout rects, so the output matches the preview iframe
 * pixel-for-pixel. Falls back to the chart-only capture when the document
 * has no export root (e.g. older embeds mid-deploy).
 *
 * `portable` (the SVG download) additionally rewrites text for renderers
 * that ignore baselines, `dy` and webfonts — PowerPoint et al. See
 * lib/portableSvg.ts. */
export const serializeEmbedCapture = (
	doc: Document,
	opts: { portable?: boolean; root?: HTMLElement | null } = {}
): string | null => {
	// `root` captures one subtree instead of the page (tests, callers that
	// see ChartCanvas) with the same composition an embed page gets from
	// `[data-export-root]`.
	const root = opts.root ?? doc.querySelector<HTMLElement>("[data-export-root]")
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

	const nestedClones: SVGSVGElement[] = []
	for (const svg of svgs) {
		const r = svg.getBoundingClientRect()
		const nested = svg.cloneNode(true) as SVGSVGElement
		nested.setAttribute("x", String(r.left - origin.left))
		nested.setAttribute("y", String(r.top - origin.top))
		nested.setAttribute("width", String(r.width))
		nested.setAttribute("height", String(r.height))
		nested.removeAttribute("id")
		wrapper.append(nested)
		nestedClones.push(nested)
	}
	// The figure's accessible name moves from the plot clone to the root.
	applyExportAccessibleName(doc, wrapper, nestedClones)

	// Titles, subtitles, and per-panel facet labels are all <text> inside the
	// chart SVG (see PlotCanvas), so the clone above already carries them —
	// only the HTML legend still needs recreating.
	for (const legend of root.querySelectorAll<HTMLElement>(
		"[data-legend-root]"
	)) {
		appendHtmlCapture(legend, wrapper, origin, doc)
	}
	// The data table under the chart — present only when the Export modal's
	// "Include data table" loaded the embed with `table=image`.
	for (const table of root.querySelectorAll<HTMLElement>(
		"[data-data-table]"
	)) {
		appendHtmlCapture(table, wrapper, origin, doc)
	}

	if (opts.portable) {
		// Measuring needs live layout: mount the composed SVG off-screen
		// beside the live chart, so text that inherits its font from page CSS
		// resolves exactly as it does in the preview.
		wrapper.setAttribute(
			"style",
			"position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none"
		)
		const host = svgs[0].parentElement ?? doc.body
		host.append(wrapper)
		try {
			stampResolvedFonts(wrapper)
			flattenTextBaselines(wrapper)
			dropInvisiblePaints(wrapper)
		} finally {
			wrapper.remove()
			wrapper.removeAttribute("style")
		}
	}

	return new XMLSerializer().serializeToString(wrapper)
}

/** Longest-edge target for rasterized thumbnails. Library cards display
 *  roughly 320×240 logical px; 480 gives 1.5× headroom for hi-DPI displays
 *  while keeping each PNG under ~15KB. Thumbnails persist in IndexedDB (see
 *  storage.ts), so the ceiling is about load time, not storage quota. The
 *  capture only ever scales DOWN, so a stored thumbnail's longest edge is
 *  exactly this unless the chart itself was smaller — which is how the
 *  library spots a capture of a collapsed frame (`thumbnailBackfill`). */
export const MAX_THUMBNAIL_DIM = 480

/** Options shared by the capture entry points. Defaults reproduce the
 *  library-thumbnail capture exactly: 480px longest edge, cache-only fonts.
 *  (The published picture is not a thumbnail: it renders through the export
 *  pipeline, `lib/exportImage.ts`.) */
export type CaptureOptions = {
	/** Longest-edge ceiling in px. */
	maxDim?: number
	/** Let webfont embedding fetch uncached faces from the network. */
	allowNetwork?: boolean
}

/** The canvas size a `srcW`×`srcH` SVG rasterizes to: scaled down so the
 *  longest edge fits `maxDim`, never up. */
export const rasterTargetSize = (
	srcW: number,
	srcH: number,
	maxDim: number = MAX_THUMBNAIL_DIM
): { w: number; h: number } => {
	const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
	return {
		w: Math.max(1, Math.round(srcW * scale)),
		h: Math.max(1, Math.round(srcH * scale)),
	}
}

/** Rasterize an SVG (provided as a data URL) into a PNG data URL via an
 *  offscreen canvas. Resolves `null` if the image fails to load, the SVG
 *  has zero intrinsic dimensions, or the canvas read is blocked. */
const rasterizeSvg = (
	svgDataUrl: string,
	maxDim: number = MAX_THUMBNAIL_DIM
): Promise<string | null> =>
	new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			const srcW = img.naturalWidth
			const srcH = img.naturalHeight
			if (srcW === 0 || srcH === 0) {
				resolve(null)
				return
			}
			const { w, h } = rasterTargetSize(srcW, srcH, maxDim)
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
				// background (the default) lets the library card's bg fill show
				// through — the card already paints `channelConfigs.backgroundColor`.
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
 *  (re-serializing could catch the next layout pass). Webfont faces embed
 *  from the local cache only by default — a thumbnail autosave must never
 *  wait on Google Fonts; uncached faces fall back (and warm the cache for
 *  next time). The background backfill passes `allowNetwork: true` so its
 *  captures always get the real face. */
export const thumbnailFromChartSvgText = async (
	svgText: string,
	opts: CaptureOptions = {}
): Promise<string | null> =>
	rasterizeSvg(
		toDataUrl(
			await embedFontsInSvg(svgText, {
				allowNetwork: opts.allowNetwork ?? false,
			})
		),
		opts.maxDim ?? MAX_THUMBNAIL_DIM
	)

/** Capture the chart rendered in `doc` as a small PNG data URL for use as a
 *  library thumbnail. Returns `null` if no chart is rendered or
 *  rasterization fails. Accepts a same-origin embed iframe's document so the
 *  thumbnail backfill can capture visuals rendered offscreen; rasterization
 *  always happens in this realm's canvas. */
/** On narrow screens the editor shrinks a fixed-size canvas with a
 *  display-only CSS transform (EditorLayout). Every rect this module reads
 *  is in screen space, so lift the transform for the synchronous DOM walk
 *  and put it straight back — no paint happens in between. */
export const withoutDisplayScale = <T>(doc: Document, fn: () => T): T => {
	const el = doc.querySelector<HTMLElement>("[data-editor-chart-viewport]")
	const prev = el?.style.transform ?? ""
	if (el && prev) el.style.transform = "none"
	try {
		return fn()
	} finally {
		if (el && prev) el.style.transform = prev
	}
}

const captureThumbnailFromDocument = async (
	doc: Document,
	opts: CaptureOptions = {}
): Promise<string | null> => {
	// Same readiness bar as the offscreen pollers. Autosave fires 800ms
	// after an edit, which on a slow data-set load is exactly when the chart
	// has just mounted and painted its one unmeasured frame; capturing that
	// stored a collapsed, giant-text preview with a current stamp, which the
	// library's refresh then trusted. Null keeps the old picture and the
	// old stamp, so the refresh re-renders it offscreen instead.
	const svgText = withoutDisplayScale(doc, () =>
		chartLayoutReady(doc) ? serializeChartSvg(doc) : null
	)
	if (!svgText) return null
	return thumbnailFromChartSvgText(svgText, opts)
}

/** Capture the editor's own chart for its library thumbnail (the autosave
 *  path; the backfill lifts the cap and lets fonts hit the network). */
export const captureThumbnail = (
	opts: CaptureOptions = {}
): Promise<string | null> => captureThumbnailFromDocument(document, opts)
