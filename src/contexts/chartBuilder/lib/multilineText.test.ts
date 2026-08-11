import { describe, expect, it } from "vitest"
import {
	fitTextWithEllipsis,
	lineCount,
	wrapByCharCount,
	wrapSegments,
	wrapTextToWidth,
} from "./multilineText"

describe("lineCount", () => {
	it("returns 1 for a single line", () => {
		expect(lineCount("hello")).toBe(1)
	})
	it("returns 2 for one newline", () => {
		expect(lineCount("a\nb")).toBe(2)
	})
	it("counts trailing empty line", () => {
		expect(lineCount("a\nb\n")).toBe(3)
	})
})

describe("fitTextWithEllipsis", () => {
	it("returns the original string when it fits", () => {
		// "hello" at 14px → 5 * 14 * 0.55 + 4 ≈ 42.5px, fits in 100px
		expect(fitTextWithEllipsis("hello", 100, 14)).toBe("hello")
	})

	it("truncates with ellipsis when text overflows", () => {
		// Very long string + small box → ellipsis
		const result = fitTextWithEllipsis(
			"AAAAAAAAAAAAAAAAAAAA",
			30,
			14
		)
		expect(result.endsWith("…")).toBe(true)
		expect(result.length).toBeLessThan(20)
	})

	it("returns ellipsis alone when even the ellipsis exceeds maxPx", () => {
		// 5px maxPx is tiny — only the ellipsis fits (or barely).
		expect(fitTextWithEllipsis("hello", 5, 14)).toBe("…")
	})

	it("returns empty string for zero/negative maxPx", () => {
		expect(fitTextWithEllipsis("hello", 0, 14)).toBe("")
		expect(fitTextWithEllipsis("hello", -10, 14)).toBe("")
	})

	it("returns empty string for empty input", () => {
		expect(fitTextWithEllipsis("", 100, 14)).toBe("")
	})

	it("returns empty string for zero/negative fontSize", () => {
		expect(fitTextWithEllipsis("hello", 100, 0)).toBe("")
	})

	it("produces shorter output for smaller box sizes", () => {
		const wide = fitTextWithEllipsis("a long string of text", 200, 12)
		const narrow = fitTextWithEllipsis("a long string of text", 50, 12)
		expect(narrow.length).toBeLessThan(wide.length)
	})
})

describe("wrapTextToWidth", () => {
	it("keeps short text on one line", () => {
		expect(wrapTextToWidth("hello world", 1000, 14)).toEqual(["hello world"])
	})

	it("wraps long text across multiple lines", () => {
		// ~6 chars per line at 14px → 14 * 0.55 ≈ 7.7px/char, 50px ≈ 6 chars.
		const lines = wrapTextToWidth("alpha beta gamma delta", 50, 14)
		expect(lines.length).toBeGreaterThan(1)
		// Every original word survives the wrap.
		expect(lines.join(" ").split(/\s+/).sort()).toEqual(
			["alpha", "beta", "delta", "gamma"].sort()
		)
	})

	it("honors explicit newline breaks", () => {
		expect(wrapTextToWidth("a\nb", 1000, 14)).toEqual(["a", "b"])
	})

	it("preserves blank lines from double newlines", () => {
		expect(wrapTextToWidth("a\n\nb", 1000, 14)).toEqual(["a", "", "b"])
	})

	it("never splits a single long word mid-word", () => {
		const lines = wrapTextToWidth("supercalifragilistic", 20, 14)
		expect(lines).toEqual(["supercalifragilistic"])
	})

	it("returns a single empty line for empty input", () => {
		expect(wrapTextToWidth("", 100, 14)).toEqual([""])
	})

	it("narrower boxes produce more lines", () => {
		const text = "the quick brown fox jumps over the lazy dog"
		const wide = wrapTextToWidth(text, 300, 12)
		const narrow = wrapTextToWidth(text, 60, 12)
		expect(narrow.length).toBeGreaterThan(wide.length)
	})

	it("breaks after a hyphen, keeping it at the end of the line", () => {
		// 14px → ~7.7px/char, 70px → 9 chars/line. "state-of-the-art" alone
		// can't fit, but hyphen fragments can.
		expect(wrapTextToWidth("state-of-the-art", 70, 14)).toEqual([
			"state-of-",
			"the-art",
		])
	})

	it("keeps a hyphenated word whole when it fits the line", () => {
		// 12 chars/line: "a well-known" fills the line exactly.
		expect(wrapTextToWidth("a well-known fox", 100, 14)).toEqual([
			"a well-known",
			"fox",
		])
	})

	it("does not split a leading minus sign from its number", () => {
		// 5 chars/line: "-1234" must stay whole, not break after "-".
		expect(wrapTextToWidth("ab -1234", 40, 14)).toEqual(["ab", "-1234"])
	})
})

describe("wrapTextToWidth with breakWords", () => {
	// Tick-label wrapping's fallback: when a single word alone exceeds a
	// line, hard-break it mid-word instead of letting it overflow.

	it("splits a single over-long word into line-sized chunks", () => {
		// 14px → ~7.7px/char, 40px → 5 chars/line.
		const lines = wrapTextToWidth("supercalifragilistic", 40, 14, {
			breakWords: true,
		})
		expect(lines.length).toBeGreaterThan(1)
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(5)
		// No characters lost in the break.
		expect(lines.join("")).toBe("supercalifragilistic")
	})

	it("still prefers space breaks when words fit", () => {
		expect(
			wrapTextToWidth("alpha beta", 45, 14, { breakWords: true })
		).toEqual(["alpha", "beta"])
	})

	it("flushes the current line before breaking an over-long word", () => {
		// "ab" fits; "cdefghijklm" is over-long and must start fresh lines.
		const lines = wrapTextToWidth("ab cdefghijklm", 40, 14, {
			breakWords: true,
		})
		expect(lines[0]).toBe("ab")
		expect(lines.slice(1).join("")).toBe("cdefghijklm")
	})

	it("lets short words join the tail chunk of a broken word", () => {
		// 5-char lines: "abcdefg" breaks into "abcde" + "fg"; "hi" joins "fg".
		expect(
			wrapTextToWidth("abcdefg hi", 40, 14, { breakWords: true })
		).toEqual(["abcde", "fg hi"])
	})

	it("does not change behavior when the option is off", () => {
		expect(wrapTextToWidth("supercalifragilistic", 40, 14)).toEqual([
			"supercalifragilistic",
		])
	})
})

describe("wrapByCharCount", () => {
	it("keeps text at or under the target on one line", () => {
		expect(wrapByCharCount("hello world", 20)).toEqual(["hello world"])
	})

	it("breaks on the space nearest the target width", () => {
		// target 15; spaces at index 3, 9, 15. Nearest to 15 is 15 →
		// "the quick brown" / "fox".
		expect(wrapByCharCount("the quick brown fox", 15)).toEqual([
			"the quick brown",
			"fox",
		])
	})

	it("can break earlier than the target when a space is closer", () => {
		// "aa bbbbbbbbbbb cc" target 5 → nearest space to 5 is index 2, so
		// the first break lands well before the target width.
		expect(wrapByCharCount("aa bbbbbbbbbbb cc", 5)).toEqual([
			"aa",
			"bbbbbbbbbbb",
			"cc",
		])
	})

	it("never splits a single over-long word", () => {
		expect(wrapByCharCount("supercalifragilistic", 5)).toEqual([
			"supercalifragilistic",
		])
	})

	it("keeps an over-long word whole then wraps the tail", () => {
		expect(wrapByCharCount("supercalifragilistic done", 5)).toEqual([
			"supercalifragilistic",
			"done",
		])
	})

	it("honors explicit newline breaks", () => {
		expect(wrapByCharCount("alpha\nbeta", 50)).toEqual(["alpha", "beta"])
	})

	it("wraps each paragraph independently", () => {
		expect(wrapByCharCount("one two three\nfour five six", 8)).toEqual([
			"one two",
			"three",
			"four five",
			"six",
		])
	})

	it("returns a single empty line for empty input", () => {
		expect(wrapByCharCount("", 20)).toEqual([""])
	})

	it("clamps a zero/negative target to one character", () => {
		// target 1 → break on the earliest space each pass.
		expect(wrapByCharCount("a b c", 0)).toEqual(["a", "b", "c"])
	})

	it("breaks after a hyphen, keeping it at the end of the line", () => {
		expect(wrapByCharCount("well-known", 6)).toEqual(["well-", "known"])
	})

	it("picks the hyphen when it lands nearer the target than a space", () => {
		// target 12; space breaks give lines of 3 or 20 chars, the hyphen
		// after "state-of-" gives 13 — closest wins.
		expect(wrapByCharCount("the state-of-the-art fox", 12)).toEqual([
			"the state-of-",
			"the-art fox",
		])
	})

	it("never breaks after a minus sign", () => {
		// The hyphen in "-12" follows a space, so it's not a break point.
		expect(wrapByCharCount("temp -12 deg", 6)).toEqual(["temp", "-12", "deg"])
	})
})

describe("wrapSegments", () => {
	const seg = (text: string, fill: string) => ({ text, fill })

	it("returns the segments untouched when the joined text fits one line", () => {
		const segs = [seg("10 ", "#111"), seg("north", "#222")]
		expect(wrapSegments(segs, 50)).toEqual([segs])
	})

	it("breaks lines exactly where wrapByCharCount breaks the joined text", () => {
		const segs = [seg("32% ", "#111"), seg("the far north", "#222")]
		const joined = segs.map((s) => s.text).join("")
		const lines = wrapSegments(segs, 8)
		expect(lines.map((l) => l.map((p) => p.text).join(""))).toEqual(
			wrapByCharCount(joined, 8)
		)
	})

	it("splits a straddling segment into pieces that keep its styling", () => {
		// Break lands inside the second segment: its head stays on line 1,
		// its tail opens line 2, both carrying fill #222.
		const lines = wrapSegments([seg("32% ", "#111"), seg("far north", "#222")], 8)
		expect(lines).toEqual([
			[seg("32% ", "#111"), seg("far", "#222")],
			[seg("north", "#222")],
		])
	})

	it("drops the break space from whichever segment held it", () => {
		// The break space is the trailing char of the FIRST segment — the
		// second segment must come through whole, not de-prefixed.
		const lines = wrapSegments([seg("alpha ", "#111"), seg("beta", "#222")], 5)
		expect(lines).toEqual([[seg("alpha", "#111")], [seg("beta", "#222")]])
	})

	it("stays aligned across a hyphen break, which drops no source char", () => {
		// "well-known fox" breaks after the hyphen (kept) then at the space
		// (dropped) — mixed drop widths must not shift later pieces.
		const lines = wrapSegments([seg("well-", "#111"), seg("known fox", "#222")], 6)
		expect(lines).toEqual([
			[seg("well-", "#111")],
			[seg("known", "#222")],
			[seg("fox", "#222")],
		])
	})

	it("passes empty-text segments through without stalling", () => {
		const lines = wrapSegments(
			[seg("", "#000"), seg("one two three", "#111")],
			5
		)
		expect(lines.map((l) => l.map((p) => p.text).join(""))).toEqual([
			"one",
			"two",
			"three",
		])
	})
})
