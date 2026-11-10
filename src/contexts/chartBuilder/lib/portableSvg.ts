/** Make a downloaded chart SVG render the same outside a browser.
 *
 * PowerPoint (and other Office/desktop SVG importers) honor a much smaller
 * SVG subset than browsers. Measured in PowerPoint for Mac:
 *
 * - `dominant-baseline` is ignored — every `<text>` sits on its alphabetic
 *   baseline, so "middle"/"central" labels jump up ~⅓em and "hanging" ones
 *   ~¾em.
 * - `dy` is ignored — multi-line tspans collapse onto one line.
 * - `@font-face` is ignored and only Regular/Bold of an installed family are
 *   selectable: weights 300/500 render Regular, 600 renders Bold. Installed
 *   static faces ARE reachable by their legacy family name ("DM Sans
 *   Medium").
 *
 * So the SVG download (1) bakes every baseline shift and `dy` into absolute
 * `y` coordinates, measured from the live layout so it's exact for any font,
 * and (2) names non-Regular/Bold weights' faces explicitly at the head of the
 * font stack. Browsers render the result identically: the `y`s are what they
 * computed anyway, and a named face that isn't installed falls through to the
 * original stack. Raster/PDF exports skip this — they render in the browser. */

/** Values that leave text on its alphabetic baseline (no shift to bake). */
const ALPHABETIC_BASELINES = new Set(["", "auto", "alphabetic"])

const round = (n: number): string => String(Math.round(n * 1000) / 1000)

/** Bake `dominant-baseline` and `dy` into absolute `y` coordinates for every
 * `<text>` under `root`. `root` must be attached to a rendered document —
 * the shifts are read from live layout (`getBBox`, glyph positions). */
export const flattenTextBaselines = (root: Element): void => {
	const view = root.ownerDocument.defaultView ?? globalThis
	const texts = [...root.querySelectorAll<SVGTextElement>("text")]

	// Pass 1 — measure everything while the inherited baselines are intact
	// (pass 2 strips them from ancestor <g>s too).
	const plans: Array<{ text: SVGTextElement; writes: Array<[Element, number]> }> =
		[]
	for (const text of texts) {
		const n = text.getNumberOfChars()
		if (n === 0) continue
		const tspans = [...text.querySelectorAll("tspan")]
		const baseline = view.getComputedStyle(text).dominantBaseline
		const hasDy = text.hasAttribute("dy") || tspans.some((t) => t.hasAttribute("dy"))
		if (ALPHABETIC_BASELINES.has(baseline) && !hasDy) continue

		// Glyph start positions include `dy` but not the baseline shift; the
		// shift is the bbox delta against an alphabetic baseline.
		let shift = 0
		if (!ALPHABETIC_BASELINES.has(baseline)) {
			const shifted = text.getBBox().y
			text.style.setProperty("dominant-baseline", "alphabetic")
			shift = shifted - text.getBBox().y
			text.style.removeProperty("dominant-baseline")
		}

		const writes: Array<[Element, number]> = [
			[text, text.getStartPositionOfChar(0).y + shift],
		]
		// A tspan that starts a new line (own y/dy) gets its own absolute y;
		// one that only restyles a run continues the current line untouched.
		let index = 0
		for (const tspan of tspans) {
			const count = tspan.getNumberOfChars()
			if (
				count > 0 &&
				(tspan.hasAttribute("y") || tspan.hasAttribute("dy"))
			) {
				writes.push([tspan, text.getStartPositionOfChar(index).y + shift])
			}
			// Nested tspans' chars are already counted by their parent.
			if (tspan.parentNode === text) index += count
		}
		plans.push({ text, writes })
	}

	// Pass 2 — write, then strip what non-browser renderers would misread.
	for (const { writes } of plans) {
		for (const [el, y] of writes) {
			el.setAttribute("y", round(y))
			el.removeAttribute("dy")
		}
	}
	for (const el of root.querySelectorAll("[dominant-baseline]")) {
		el.removeAttribute("dominant-baseline")
	}
}

/** Pin each `<text>`'s resolved font onto it as attributes, so the
 * standalone file doesn't depend on inheritance from page CSS — and so
 * {@link nameWeightedFaces} can read the weight off the element after the
 * markup leaves the DOM. `root` must be attached to a rendered document. */
export const stampResolvedFonts = (root: Element): void => {
	const view = root.ownerDocument.defaultView ?? globalThis
	for (const text of root.querySelectorAll<SVGTextElement>("text, tspan")) {
		const style = view.getComputedStyle(text)
		// Single quotes: computed stacks quote names with `"`, which
		// collectFontUsage's attribute regex reads as an empty stack.
		if (style.fontFamily) {
			text.setAttribute("font-family", style.fontFamily.replaceAll('"', "'"))
		}
		if (style.fontWeight) text.setAttribute("font-weight", style.fontWeight)
		if (style.fontSize) text.setAttribute("font-size", style.fontSize)
		if (style.fontStyle && style.fontStyle !== "normal") {
			text.setAttribute("font-style", style.fontStyle)
		}
	}
}

/** Rewrite paints the chart uses for invisible geometry into their SVG
 * spelling. The hover hit-areas are wide lines painted `transparent` — a
 * CSS colour every browser accepts but SVG importers outside the browser
 * (PowerPoint, and its PDF export) don't know, so they fall back to black
 * and the picture grows 12px black bars. `none` renders identically here
 * and is what every importer understands. `pointer-events` goes too: it
 * means nothing in a picture and trips strict parsers. */
export const dropInvisiblePaints = (root: Element): void => {
	for (const el of root.querySelectorAll<Element>("[fill], [stroke], [pointer-events]")) {
		for (const attr of ["fill", "stroke"]) {
			if (el.getAttribute(attr)?.trim().toLowerCase() === "transparent") {
				el.setAttribute(attr, "none")
			}
		}
		el.removeAttribute("pointer-events")
	}
}

/** Legacy (OpenType nameID 1) suffixes static font families use for weights
 * outside the Regular/Bold pair — what Office matches a face by. */
const WEIGHT_FACE_NAMES: Record<number, string> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	500: "Medium",
	600: "SemiBold",
	800: "ExtraBold",
	900: "Black",
}

const unquote = (s: string): string => s.trim().replaceAll(/^['"]|['"]$/g, "")

/** Prepend the weight-named face ("DM Sans Medium") to the font stack of
 * every `<text>`/`<tspan>` whose weight Office can't select by number.
 * String → string; run AFTER `embedFontsInSvg`, which reads each stack's
 * FIRST family to decide what to inline. Returns the input unchanged on any
 * parse failure. */
export const nameWeightedFaces = (svgText: string): string => {
	const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
	const root = doc.querySelector("svg")
	if (!root || doc.querySelector("parsererror")) return svgText
	let changed = false
	for (const el of root.querySelectorAll("text[font-weight], tspan[font-weight]")) {
		const suffix = WEIGHT_FACE_NAMES[Number(el.getAttribute("font-weight"))]
		const stack = el.getAttribute("font-family")
		if (!suffix || !stack) continue
		const first = unquote(stack.split(",")[0])
		if (!first || first.endsWith(` ${suffix}`)) continue
		el.setAttribute("font-family", `'${first} ${suffix}', ${stack}`)
		changed = true
	}
	return changed ? new XMLSerializer().serializeToString(root) : svgText
}
