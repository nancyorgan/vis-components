import { describe, expect, it } from "vitest"

import { inlineImage, isFontFileUrl, isInlineImage } from "./storedUrls"

describe("isInlineImage", () => {
	it("passes every form an upload stores", () => {
		for (const type of ["png", "jpeg", "gif", "webp", "avif", "svg+xml", "bmp", "x-icon", "vnd.microsoft.icon"]) {
			expect(isInlineImage(`data:image/${type};base64,AAAA`)).toBe(true)
		}
		expect(isInlineImage("data:image/svg+xml,%3Csvg/%3E")).toBe(true)
		expect(isInlineImage("DATA:IMAGE/PNG;base64,AAAA")).toBe(true)
	})

	it("refuses an address, and data that isn't a picture", () => {
		for (const value of [
			"https://example.com/a.png",
			"//example.com/a.png",
			"/api/visuals",
			"a.png",
			"javascript:alert(1)",
			"data:text/html,<script>1</script>",
			"data:image/",
			" data:image/png;base64,AAAA",
			"",
			null,
			undefined,
			7,
		]) {
			expect(isInlineImage(value)).toBe(false)
		}
		expect(inlineImage("https://example.com/a.png")).toBeUndefined()
		expect(inlineImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
	})
})

describe("isFontFileUrl", () => {
	it("passes a file on Google's font host", () => {
		expect(
			isFontFileUrl("https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2")
		).toBe(true)
	})

	it("refuses any other address", () => {
		for (const value of [
			"http://fonts.gstatic.com/s/a.woff2",
			"https://fonts.gstatic.com.evil.example/s/a.woff2",
			"https://evil.example/fonts.gstatic.com/a.woff2",
			"https://user@fonts.gstatic.com/s/a.woff2",
			"https://fonts.gstatic.com:8443/s/a.woff2",
			"https://fonts.googleapis.com/css2?family=Inter",
			"/api/visuals",
			"data:font/woff2;base64,AAAA",
			"",
			null,
		]) {
			expect(isFontFileUrl(value)).toBe(false)
		}
	})
})
