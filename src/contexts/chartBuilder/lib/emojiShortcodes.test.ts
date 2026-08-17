import { describe, expect, it } from "vitest"
import {
	expandEmojiInput,
	expandEmojiShortcodes,
} from "./emojiShortcodes"

describe("expandEmojiShortcodes (live, per-keystroke)", () => {
	it("converts complete :name: tokens", () => {
		expect(expandEmojiShortcodes(":fire:")).toBe("🔥")
		expect(expandEmojiShortcodes("A:star:")).toBe("A⭐")
	})

	it("leaves incomplete and unknown tokens alone", () => {
		expect(expandEmojiShortcodes(":fir")).toBe(":fir")
		expect(expandEmojiShortcodes(":joy")).toBe(":joy")
		expect(expandEmojiShortcodes(":notarealemoji:")).toBe(":notarealemoji:")
	})

	it("is case-insensitive and handles +1/-1 aliases", () => {
		expect(expandEmojiShortcodes(":JOY:")).toBe("😂")
		expect(expandEmojiShortcodes(":+1:")).toBe("👍")
	})
})

describe("expandEmojiInput (submit-time)", () => {
	it("accepts a bare :name with no closing colon when it's the whole input", () => {
		expect(expandEmojiInput(":joy")).toBe("😂")
		expect(expandEmojiInput(" :joy: ")).toBe("😂")
	})

	it("does NOT bare-expand mid-text or unknown names", () => {
		expect(expandEmojiInput("A :joy")).toBe("A :joy")
		expect(expandEmojiInput(":notarealemoji")).toBe(":notarealemoji")
	})
})
