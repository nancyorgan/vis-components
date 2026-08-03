import { describe, expect, it } from "vitest"
import {
	fitTextWithEllipsis,
	lineCount,
	wrapByCharCount,
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
})
