/** How big a picture is drawn, and how it is squeezed into the reply.
 *
 *  The page reports raw layout measurements (`MEASURE_SCRIPT`); everything
 *  decided from them is a pure function here, so it is testable without a
 *  browser. Every page script starts with a `/*vc:<name>*\/` tag, which the
 *  test stub browser answers by. */

/** One categorical / quantitative axis of one panel, as drawn. */
export type AxisMeasure = {
	/** Tick labels drawn. */
	n: number
	/** Distance between the first and last label centers (CSS px). */
	span: number
	/** The widest / tallest label's own (unrotated) text box. */
	textW: number
	textH: number
}

export type PanelMeasure = {
	/** The plot SVG's box relative to the capture root (CSS px). */
	left: number
	top: number
	width: number
	height: number
	/** How much of that box is on the picture (px²): clipped by the root
	 *  and by any scrolling / clipping box between. */
	visible: number
	x: AxisMeasure | null
	y: AxisMeasure | null
}

export type Measure = { rootWidth: number; rootHeight: number; panels: PanelMeasure[] }

export type Size = { width: number; height: number }

/** The app's default export size (`lib/exportImage.ts`), where an unsized
 *  chart starts. */
export const DEFAULT_SIZE: Size = { width: 650, height: 400 }
/** Never grow a picture past this edge. */
export const MAX_PICTURE_EDGE = 3000
/** Give at most this many levels on one axis their own room. */
export const MAX_LEVELS = 140
/** Base64 characters a picture may carry. */
export const MAX_PICTURE_CHARS = 120_000
/** Long edge (px) the picture aims for before squeezing: about what a
 *  reader sees; more is downsampled anyway. */
export const TARGET_LONG_EDGE = 1600

const MAX_ASPECT = 2.5

const cap = (n: number) => Math.min(MAX_PICTURE_EDGE, Math.ceil(n))

/** Distinct values, within a pixel: how many panel columns / rows. */
const distinct = (values: number[]): number => {
	const sorted = values.slice().sort((a, b) => a - b)
	let count = 0
	let last = Number.NEGATIVE_INFINITY
	for (const v of sorted) {
		if (v - last > 1) count++
		last = v
	}
	return count
}

/** Room one level of an x axis wants: its label's width (plus a gap) when
 *  short; a long label is expected to angle, needing about two lines. */
const xRoom = (a: AxisMeasure) => Math.max(16, Math.min(a.textW + 12, Math.max(28, 2 * a.textH)))
/** Room one level of a y axis wants: a line and a half. */
const yRoom = (a: AxisMeasure) => Math.max(16, a.textH * 1.5)

/** How much longer an axis must get so each level has room for its label
 *  (0 when it already has). */
const axisShortfall = (a: AxisMeasure | null, room: (a: AxisMeasure) => number): number => {
	if (!a || a.n < 2 || a.span <= 0) return 0
	const length = (a.span * a.n) / (a.n - 1)
	const need = Math.min(a.n, MAX_LEVELS) * room(a)
	return Math.max(0, need - length)
}

/** The size that gives each axis level room for its label, from a drawing
 *  at `current`: never smaller than `current`, never past 3,000 px. */
export const sizeForLabels = (m: Measure, current: Size): Size => {
	let extraX = 0
	let extraY = 0
	const lefts: number[] = []
	const tops: number[] = []
	for (const p of m.panels) {
		extraX = Math.max(extraX, axisShortfall(p.x, xRoom))
		extraY = Math.max(extraY, axisShortfall(p.y, yRoom))
		lefts.push(p.left)
		tops.push(p.top)
	}
	const columns = Math.max(1, distinct(lefts))
	const rows = Math.max(1, distinct(tops))
	let width = Math.max(current.width, cap(current.width + extraX * columns))
	let height = Math.max(current.height, cap(current.height + extraY * rows))
	// A chart grown along one axis grows along the other too, up to a
	// 2.5 : 1 shape, so the picture isn't a sliver once scaled to fit.
	if (width > current.width) height = Math.max(height, cap(width / MAX_ASPECT))
	if (height > current.height) width = Math.max(width, cap(height / MAX_ASPECT))
	return { width, height }
}

/** True when part of a plot is off the picture (it scrolls or spills past
 *  its box). */
export const isCutOff = (m: Measure): boolean => shownShare(m) !== undefined

/** The size that shows the whole plot, from a drawing at `current` whose
 *  plots spill past the picture; never past 3,000 px. */
export const sizeForOverflow = (m: Measure, current: Size): Size => {
	let right = m.rootWidth
	let bottom = m.rootHeight
	let left = 0
	let top = 0
	for (const p of m.panels) {
		right = Math.max(right, p.left + p.width)
		bottom = Math.max(bottom, p.top + p.height)
		left = Math.min(left, p.left)
		top = Math.min(top, p.top)
	}
	const extraW = right - m.rootWidth - left
	const extraH = bottom - m.rootHeight - top
	return {
		width: Math.max(current.width, cap(current.width + (extraW > 0.5 ? extraW + 4 : 0))),
		height: Math.max(current.height, cap(current.height + (extraH > 0.5 ? extraH + 4 : 0))),
	}
}

/** The share (0..1) of the plots that is on the picture, or undefined when
 *  all of it is. */
export const shownShare = (m: Measure): number | undefined => {
	let total = 0
	let visible = 0
	for (const p of m.panels) {
		const area = Math.max(0, p.width) * Math.max(0, p.height)
		total += area
		visible += Math.min(area, Math.max(0, p.visible))
	}
	if (total <= 0) return undefined
	const share = visible / total
	if (share >= 0.995) return undefined
	return Math.round(share * 1000) / 1000
}

/** The export resolution a picture is drawn at, for a CSS size: enough for
 *  `TARGET_LONG_EDGE` px on the long edge, between 1× and 2×. */
export const pictureRatio = (size: Size): number => {
	const long = Math.max(size.width, size.height)
	return Math.min(2, Math.max(1, Math.round((TARGET_LONG_EDGE / long) * 100) / 100))
}

export type EncodeStep = { width: number; height: number; quality: number }

/** The WebP attempts, in order: quality steps down at the starting scale
 *  (the long edge near `TARGET_LONG_EDGE`), then the scale steps down to
 *  about a third of the chart's own size at a low quality. */
export const encodeSteps = (css: Size): EncodeStep[] => {
	const long = Math.max(css.width, css.height)
	const start = Math.min(2, TARGET_LONG_EDGE / long)
	const floor = Math.min(start, 1 / 3)
	const steps: EncodeStep[] = []
	const at = (scale: number, quality: number) => {
		steps.push({
			width: Math.max(1, Math.round(css.width * scale)),
			height: Math.max(1, Math.round(css.height * scale)),
			quality,
		})
	}
	for (const q of [0.85, 0.7, 0.55]) at(start, q)
	for (const f of [0.75, 0.55, 0.4]) {
		const scale = start * f
		if (scale <= floor) break
		at(scale, 0.55)
		at(scale, 0.4)
	}
	at(floor, 0.4)
	at(floor, 0.25)
	return steps
}

// ---------------------------------------------------------------------------
// Page scripts (Runtime.evaluate expressions)
// ---------------------------------------------------------------------------

/** Marks the current document as one being left (see STATE_SCRIPT). */
export const MARK_SCRIPT = `/*vc:mark*/void (document.documentElement.dataset.vcLeaving = "1")`

/** Where the export stands: pending, the file's facts, or the error. A
 *  document marked as being left is still pending. */
export const STATE_SCRIPT = `/*vc:state*/(() => {
	if (document.documentElement.dataset.vcLeaving) return { kind: "pending" };
	const error = document.getElementById("export-error");
	if (error) return { kind: "error", message: (error.textContent || "").trim() || "The export failed." };
	const result = document.getElementById("export-result");
	if (result) {
		const d = result.dataset;
		return {
			kind: "result",
			mime: d.mime || "",
			bytes: Number(d.bytes),
			width: Number(d.width),
			height: Number(d.height),
			pixelRatio: Number(d.pixelRatio),
			length: (result.textContent || "").length,
		};
	}
	if (document.readyState === "complete" && document.scripts.length === 0) return { kind: "notApp" };
	return { kind: "pending" };
})()`

export type PageState =
	| { kind: "pending" }
	| { kind: "notApp" }
	| { kind: "error"; message: string }
	| { kind: "result"; mime: string; bytes: number; width: number; height: number; pixelRatio: number; length: number }

/** A slice of the result's base64 (big files come over in pieces). */
export const chunkScript = (start: number, end: number): string =>
	`/*vc:chunk*/(document.getElementById("export-result").textContent || "").slice(${start}, ${end})`

/** The layout facts `sizeForLabels` / `sizeForOverflow` / `shownShare`
 *  read, from the capture root (`[data-export-root]`) and each plot SVG. */
export const MEASURE_SCRIPT = `/*vc:measure*/(() => {
	const root = document.querySelector("[data-export-root]");
	if (!root) return null;
	const rr = root.getBoundingClientRect();
	const panels = [];
	for (const svg of root.querySelectorAll("#vc-scatter-svg")) {
		const r = svg.getBoundingClientRect();
		let vl = r.left, vt = r.top, vr = r.right, vb = r.bottom;
		for (let el = svg.parentElement; el; el = el.parentElement) {
			const cs = getComputedStyle(el);
			if (el === root || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
				const b = el.getBoundingClientRect();
				vl = Math.max(vl, b.left); vt = Math.max(vt, b.top);
				vr = Math.min(vr, b.right); vb = Math.min(vb, b.bottom);
			}
			if (el === root) break;
		}
		const axis = (o) => {
			const labels = svg.querySelectorAll('text[data-vc-tick-label="' + o + '"]');
			if (labels.length === 0) return null;
			let lo = Infinity, hi = -Infinity, tw = 0, th = 0;
			for (const t of labels) {
				const b = t.getBoundingClientRect();
				const c = o === "x" ? b.left + b.width / 2 : b.top + b.height / 2;
				lo = Math.min(lo, c); hi = Math.max(hi, c);
				let w = b.width, h = b.height;
				try { const bb = t.getBBox(); w = bb.width; h = bb.height; } catch (_) { /* unrendered */ }
				tw = Math.max(tw, w); th = Math.max(th, h);
			}
			return { n: labels.length, span: hi - lo, textW: tw, textH: th };
		};
		panels.push({
			left: r.left - rr.left, top: r.top - rr.top, width: r.width, height: r.height,
			visible: Math.max(0, vr - vl) * Math.max(0, vb - vt),
			x: axis("x"), y: axis("y"),
		});
	}
	return { rootWidth: rr.width, rootHeight: rr.height, panels };
})()`

/** Decode the export's PNG once, for the encode steps to redraw. */
export const LOAD_SCRIPT = `/*vc:load*/(async () => {
	const result = document.getElementById("export-result");
	const img = new Image();
	img.src = "data:image/png;base64," + (result.textContent || "");
	await img.decode();
	window.__vcPicture = img;
	return { width: img.naturalWidth, height: img.naturalHeight };
})()`

/** One WebP attempt: the decoded PNG redrawn at `width × height` on white
 *  (a transparent chart would vanish on a dark reader), encoded at
 *  `quality`. A browser that can't write WebP hands back PNG. */
export const encodeScript = (step: EncodeStep): string => `/*vc:encode*/((w, h, q) => {
	const img = window.__vcPicture;
	const canvas = document.createElement("canvas");
	canvas.width = w; canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, w, h);
	const url = canvas.toDataURL("image/webp", q);
	const comma = url.indexOf(",");
	return { mime: url.slice(5, url.indexOf(";")), data: url.slice(comma + 1), width: w, height: h };
})(${step.width}, ${step.height}, ${step.quality})`

export type Encoded = { mime: string; data: string; width: number; height: number }
