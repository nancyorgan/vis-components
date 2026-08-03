import type { ReactNode } from "react"

/** Render a title/label string as one or more `<tspan>` lines.
 *
 * Splits on literal `\n` so users can break a title into multiple lines from
 * the LabelsPanel textbox. Each line is anchored at the same `x` so the
 * tspans stack vertically; subsequent lines drop by `dy` em-units. Empty
 * lines render a single space so they still contribute vertical space (an
 * empty `<tspan>` would collapse).
 *
 * Caller controls the wrapping `<text>`'s textAnchor / fontSize / fill — the
 * tspans inherit those attributes. */
export const renderMultilineTspans = (
	text: string,
	x: number,
	opts?: {
		/** Shift the first line UP by half the extra lines so the whole block
		 *  stays centered on the `<text>` anchor. For callers that anchor with
		 *  `dominantBaseline="middle"` (y-axis tick labels, radar r-ticks) —
		 *  without it a wrapped label's first line sits at the tick and the
		 *  rest hang below, visually off-center. */
		verticallyCentered?: boolean
		/** Per-line `text-anchor`, overriding the parent `<text>`'s anchor.
		 *  Used by aligned wrapped tick labels: the caller computes the
		 *  block-edge `x` for the chosen alignment and anchors every line
		 *  there (see `renderWrappedTickLabel`). */
		lineAnchor?: "start" | "middle" | "end"
	}
): ReactNode[] => {
	const lines = text.split("\n")
	const firstDy = opts?.verticallyCentered
		? `${-0.6 * (lines.length - 1)}em`
		: 0
	return lines.map((line, i) => (
		<tspan
			// eslint-disable-next-line react/no-array-index-key -- line index IS its identity
			key={i}
			x={x}
			dy={i === 0 ? firstDy : "1.2em"}
			textAnchor={opts?.lineAnchor}
		>
			{line.length > 0 ? line : " "}
		</tspan>
	))
}

/** Number of lines in a multiline title string. */
export const lineCount = (text: string): number => text.split("\n").length

/** Word-wrap `text` to fit within `maxPx`, honoring explicit `\n` breaks.
 *
 *  Used by the caption box, which has a fixed pixel width but free-form long
 *  text. SVG `<text>` has no auto-wrap, so we pre-break into lines here using
 *  the same `fontSize * 0.55` px/char heuristic as `fitTextWithEllipsis` /
 *  `estimateMargins`. By default a single word longer than `maxPx` is left
 *  intact on its own line (we never split mid-word), so it may visually
 *  overflow — that's the caller's cue to widen the box. `breakWords: true`
 *  changes that: an over-long word is hard-broken into `maxPx`-sized chunks
 *  (used by tick-label wrapping, where the width is a hard budget). Returns
 *  at least one line (possibly empty) so callers can map over the result
 *  unconditionally. */
export const wrapTextToWidth = (
	text: string,
	maxPx: number,
	fontSize: number,
	opts?: { breakWords?: boolean }
): string[] => {
	const charWidth = fontSize * 0.55
	const maxChars = charWidth > 0 ? Math.max(1, Math.floor(maxPx / charWidth)) : 1
	const out: string[] = []
	for (const paragraph of text.split("\n")) {
		const words = paragraph.split(/\s+/).filter((w) => w.length > 0)
		if (words.length === 0) {
			// Preserve blank lines from explicit `\n\n`.
			out.push("")
			continue
		}
		let line = ""
		for (const word of words) {
			const candidate = line.length === 0 ? word : `${line} ${word}`
			const wordTooLong = opts?.breakWords === true && word.length > maxChars
			if (!wordTooLong && (candidate.length <= maxChars || line.length === 0)) {
				line = candidate
				continue
			}
			if (line.length > 0) out.push(line)
			// Hard-break an over-long word into full lines; the tail (possibly
			// empty) becomes the current line so following words can join it.
			let rest = word
			while (wordTooLong && rest.length > maxChars) {
				out.push(rest.slice(0, maxChars))
				rest = rest.slice(maxChars)
			}
			line = rest
		}
		if (line.length > 0) out.push(line)
	}
	return out.length > 0 ? out : [""]
}

/** Word-wrap `text` to roughly `maxChars` characters per line, breaking on
 *  the SPACE nearest the target width.
 *
 *  Unlike `wrapTextToWidth` (which fills each line greedily up to a pixel
 *  budget), this targets a character count and then searches OUTWARD from
 *  that target — both earlier and later in the line — for the closest
 *  whitespace to break on. So a target of 20 in `"the quick brown fox"`
 *  breaks at whichever space sits nearest character 20, even if that means
 *  a slightly shorter or slightly longer line. This matches the Data
 *  Labels "wrap text" request: pick a width, then let word boundaries win.
 *
 *  Explicit `\n` breaks in the input are always honored (each paragraph
 *  wraps independently). A single word longer than `maxChars` with no
 *  usable space is left intact on its own line (never split mid-word), so
 *  it may overflow — the caller's cue to raise the width. Returns at least
 *  one line so callers can map over the result unconditionally. */
export const wrapByCharCount = (text: string, maxChars: number): string[] => {
	const target = Math.max(1, Math.floor(maxChars))
	const isSpace = (ch: string): boolean => /\s/.test(ch)
	const out: string[] = []
	for (const paragraph of text.split("\n")) {
		let rest = paragraph
		while (rest.length > target) {
			// Find the whitespace index closest to the target width. Spaces
			// appear left-to-right, so distance falls then rises around the
			// target — but we scan the whole remaining string for simplicity;
			// these strings are short.
			let bestSpace = -1
			let bestDist = Infinity
			for (let i = 0; i < rest.length; i++) {
				if (!isSpace(rest[i])) continue
				const dist = Math.abs(i - target)
				// `<` (not `<=`) keeps the FIRST/earliest space on a tie, which
				// biases toward the shorter line — deterministic either way.
				if (dist < bestDist) {
					bestDist = dist
					bestSpace = i
				}
			}
			// No space to break on (or only a leading one): the remaining text
			// is a single over-long word. Leave it whole on its own line.
			if (bestSpace <= 0) break
			out.push(rest.slice(0, bestSpace))
			rest = rest.slice(bestSpace + 1) // drop the break whitespace
		}
		out.push(rest)
	}
	return out.length > 0 ? out : [""]
}

/** Truncate `text` with a trailing ellipsis so its estimated rendered
 *  width fits within `maxPx`. Used by the SVG-faceted layout for long
 *  facet labels, which can't rely on CSS `text-overflow: ellipsis`
 *  (SVG <text> ignores that rule).
 *
 *  Uses the same character-count heuristic as `estimateMargins.ts`:
 *  ~`fontSize * 0.55` px/char. Returns the original string when it
 *  already fits, and `…` (or `text[0]`) when even the ellipsis would
 *  overflow. */
export const fitTextWithEllipsis = (
	text: string,
	maxPx: number,
	fontSize: number
): string => {
	if (!text || maxPx <= 0 || fontSize <= 0) return ""
	const charWidth = fontSize * 0.55
	const ellipsis = "…"
	const ellipsisPx = charWidth // ellipsis is roughly one char wide
	const fullPx = text.length * charWidth + 4
	if (fullPx <= maxPx) return text
	// Reserve space for the ellipsis, then keep as many chars as fit.
	const available = maxPx - ellipsisPx - 4
	const keep = Math.max(0, Math.floor(available / charWidth))
	if (keep <= 0) return ellipsis
	return text.slice(0, keep) + ellipsis
}
