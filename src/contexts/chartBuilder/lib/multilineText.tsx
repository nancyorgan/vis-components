import type { ReactNode } from "react"
import { charWidthFactor } from "./estimateMargins"

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

/** Split a word into fragments a line may end on: each hyphen that follows
 *  at least one other character (and isn't the word's last char) closes a
 *  fragment, keeping the hyphen — `"well-known"` → `["well-", "known"]`.
 *  A leading hyphen never splits, so a minus sign (`-5`) stays glued to its
 *  number. Words without internal hyphens come back whole. */
const splitAfterHyphens = (word: string): string[] => {
	const parts: string[] = []
	let start = 0
	for (let i = 0; i < word.length - 1; i++) {
		if (word[i] === "-" && i > start) {
			parts.push(word.slice(start, i + 1))
			start = i + 1
		}
	}
	parts.push(word.slice(start))
	return parts
}

/** Word-wrap `text` to fit within `maxPx`, honoring explicit `\n` breaks.
 *
 *  Used by the caption box, which has a fixed pixel width but free-form long
 *  text. SVG `<text>` has no auto-wrap, so we pre-break into lines here using
 *  the same `charWidthFactor` px/char heuristic as `fitTextWithEllipsis` /
 *  `estimateMargins`. Lines break at spaces and after internal hyphens (the
 *  hyphen stays at the end of the line). By default a single unbreakable word
 *  longer than `maxPx` is left intact on its own line, so it may visually
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
	const charWidth = fontSize * charWidthFactor
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
			for (const [fragIdx, frag] of splitAfterHyphens(word).entries()) {
				// Fragments of the same word abut (the hyphen is the joint);
				// only a new word gets a space.
				const sep = line.length > 0 && fragIdx === 0 ? " " : ""
				const candidate = line + sep + frag
				const fragTooLong = opts?.breakWords === true && frag.length > maxChars
				if (!fragTooLong && (candidate.length <= maxChars || line.length === 0)) {
					line = candidate
					continue
				}
				if (line.length > 0) out.push(line)
				// Hard-break an over-long fragment into full lines; the tail
				// (possibly empty) becomes the current line so following
				// fragments/words can join it.
				let rest = frag
				while (fragTooLong && rest.length > maxChars) {
					out.push(rest.slice(0, maxChars))
					rest = rest.slice(maxChars)
				}
				line = rest
			}
		}
		if (line.length > 0) out.push(line)
	}
	return out.length > 0 ? out : [""]
}

/** Word-wrap `text` to roughly `maxChars` characters per line, breaking on
 *  the space or internal hyphen nearest the target width.
 *
 *  Unlike `wrapTextToWidth` (which fills each line greedily up to a pixel
 *  budget), this targets a character count and then searches OUTWARD from
 *  that target — both earlier and later in the line — for the closest
 *  break point. So a target of 20 in `"the quick brown fox"` breaks at
 *  whichever space sits nearest character 20, even if that means a
 *  slightly shorter or slightly longer line. This matches the Data
 *  Labels "wrap text" request: pick a width, then let word boundaries win.
 *  A break on whitespace drops the space; a break after a hyphen keeps the
 *  hyphen at the end of the line (`"well-known"` → `"well-"` / `"known"`).
 *  Hyphens touching whitespace or at a word's start (a minus sign, `-5`)
 *  are not break points.
 *
 *  Explicit `\n` breaks in the input are always honored (each paragraph
 *  wraps independently). A single word longer than `maxChars` with no
 *  usable break point is left intact on its own line (never split
 *  mid-word), so it may overflow — the caller's cue to raise the width.
 *  Returns at least one line so callers can map over the result
 *  unconditionally. */
export const wrapByCharCount = (text: string, maxChars: number): string[] => {
	const target = Math.max(1, Math.floor(maxChars))
	const isSpace = (ch: string): boolean => /\s/.test(ch)
	const out: string[] = []
	for (const paragraph of text.split("\n")) {
		let rest = paragraph
		while (rest.length > target) {
			// Find the break point whose line length lands closest to the
			// target width. Break points appear left-to-right, so distance
			// falls then rises around the target — but we scan the whole
			// remaining string for simplicity; these strings are short.
			let bestEnd = -1 // the line is rest.slice(0, bestEnd)
			let bestDrop = 0 // separator chars consumed after the line
			let bestDist = Infinity
			for (let i = 0; i < rest.length; i++) {
				let end: number
				let drop: number
				if (isSpace(rest[i])) {
					end = i
					drop = 1
				} else if (
					rest[i] === "-" &&
					i > 0 &&
					i + 1 < rest.length &&
					!isSpace(rest[i - 1]) &&
					!isSpace(rest[i + 1])
				) {
					end = i + 1 // the hyphen stays on the line
					drop = 0
				} else continue
				const dist = Math.abs(end - target)
				// `<` (not `<=`) keeps the FIRST/earliest break on a tie, which
				// biases toward the shorter line — deterministic either way.
				if (dist < bestDist) {
					bestDist = dist
					bestEnd = end
					bestDrop = drop
				}
			}
			// No break point (or only a leading space): the remaining text
			// is a single over-long word. Leave it whole on its own line.
			if (bestEnd <= 0) break
			out.push(rest.slice(0, bestEnd))
			rest = rest.slice(bestEnd + bestDrop)
		}
		out.push(rest)
	}
	return out.length > 0 ? out : [""]
}

/** Wrap a run of styled text segments across lines, breaking exactly where
 *  `wrapByCharCount` would break their concatenated text. Returns one array
 *  of segment PIECES per line — a segment that straddles a line break is
 *  split into two pieces carrying the same styling (spread), so callers can
 *  emit per-piece `<tspan fill>`s without losing the wrap. Used by the Data
 *  Labels layer for multi-variable labels with per-variable colors, which
 *  previously rendered as one unwrappable line.
 *
 *  A break on whitespace drops one source character (`wrapByCharCount`
 *  consumes the break space; paragraph splits consume the `\n`) while a
 *  break after a hyphen drops none (the hyphen stays in the line), so the
 *  walk checks the source character at each break to stay aligned with the
 *  segment stream. */
export const wrapSegments = <T extends { text: string }>(
	segments: T[],
	maxChars: number
): T[][] => {
	const full = segments.map((s) => s.text).join("")
	const lines = wrapByCharCount(full, maxChars)
	if (lines.length <= 1) return [segments]
	const out: T[][] = []
	let segIdx = 0
	// Chars of segments[segIdx] already consumed.
	let offset = 0
	// Chars of `full` already consumed (across all segments).
	let pos = 0
	const skipChars = (n: number) => {
		pos += n
		offset += n
		while (segIdx < segments.length && offset >= segments[segIdx].text.length) {
			offset -= segments[segIdx].text.length
			segIdx++
		}
	}
	for (let li = 0; li < lines.length; li++) {
		let remaining = lines[li].length
		const pieces: T[] = []
		while (remaining > 0 && segIdx < segments.length) {
			const seg = segments[segIdx]
			const take = Math.min(seg.text.length - offset, remaining)
			if (take > 0) {
				pieces.push({ ...seg, text: seg.text.slice(offset, offset + take) })
				remaining -= take
			}
			skipChars(take)
		}
		out.push(pieces)
		// Skip the separator IF the wrapper dropped one at this break: a
		// whitespace source char here was consumed (space break / paragraph
		// `\n`); anything else means a hyphen break, which consumes nothing.
		if (li < lines.length - 1 && /\s/.test(full[pos] ?? "")) skipChars(1)
	}
	return out
}

/** Truncate `text` with a trailing ellipsis so its estimated rendered
 *  width fits within `maxPx`. Used by the SVG-faceted layout for long
 *  facet labels, which can't rely on CSS `text-overflow: ellipsis`
 *  (SVG <text> ignores that rule).
 *
 *  Uses the same character-count heuristic as `estimateMargins.ts`:
 *  ~`fontSize * charWidthFactor` px/char. Returns the original string when it
 *  already fits, and `…` (or `text[0]`) when even the ellipsis would
 *  overflow. */
export const fitTextWithEllipsis = (
	text: string,
	maxPx: number,
	fontSize: number
): string => {
	if (!text || maxPx <= 0 || fontSize <= 0) return ""
	const charWidth = fontSize * charWidthFactor
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
