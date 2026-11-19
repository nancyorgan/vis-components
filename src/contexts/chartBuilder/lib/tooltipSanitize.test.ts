import { describe, expect, it } from "vitest"

import { buildDefaultTooltipHtml, DEFAULT_TOOLTIP_CSS } from "./tooltipDefaults"
import { sanitizeTooltipCss, sanitizeTooltipHtml } from "./tooltipSanitize"

describe("sanitizeTooltipHtml", () => {
	it("leaves the starter template and ordinary formatting as written", () => {
		const starter = buildDefaultTooltipHtml(["State", "Sales"]).replaceAll(/\{\{[^}]+\}\}/g, "x")
		expect(sanitizeTooltipHtml(starter)).toBe(starter)
		const table =
			'<table class="t"><tbody><tr><th colspan="2" scope="row">A</th><td style="color: red; text-align: right">1</td></tr></tbody></table>'
		expect(sanitizeTooltipHtml(table)).toBe(table)
		expect(sanitizeTooltipHtml("<strong>West</strong><br>Sales: <em>12</em>")).toBe(
			"<strong>West</strong><br>Sales: <em>12</em>"
		)
	})

	it("removes anything that runs", () => {
		expect(sanitizeTooltipHtml('<img src="x" onerror="alert(1)">')).toBe("")
		expect(sanitizeTooltipHtml('<b onclick="alert(1)" onmouseover="x()">hi</b>')).toBe("<b>hi</b>")
		expect(sanitizeTooltipHtml("a<script>alert(1)</script>b")).toBe("ab")
		expect(sanitizeTooltipHtml('<svg onload="alert(1)"><script>1</script></svg>ok')).toBe("ok")
		expect(sanitizeTooltipHtml('<iframe src="javascript:alert(1)"></iframe>ok')).toBe("ok")
		expect(sanitizeTooltipHtml('<math><mtext><script>1</script></mtext></math>ok')).toBe("ok")
		expect(sanitizeTooltipHtml("<style>body{display:none}</style>ok")).toBe("ok")
		// Markup hidden inside markup comes out as inert text, never a tag.
		const nested = sanitizeTooltipHtml("<scr<script>ipt>alert(1)</scr</script>ipt>")
		expect(nested).not.toMatch(/<script/i)
	})

	it("removes links and anything that collects input, keeping the words", () => {
		expect(sanitizeTooltipHtml('<a href="javascript:alert(1)">read me</a>')).toBe("read me")
		expect(sanitizeTooltipHtml('<a href="https://example.com">site</a>')).toBe("site")
		expect(sanitizeTooltipHtml('<form action="https://example.com"><input name="p">x</form>ok')).toBe(
			"ok"
		)
		expect(sanitizeTooltipHtml("<marquee>old</marquee>")).toBe("old")
	})

	it("removes anything that would ask another server for something", () => {
		expect(sanitizeTooltipHtml('<img src="https://example.com/a.png" alt="a">')).toBe("")
		expect(sanitizeTooltipHtml('<img src="//example.com/a.png">')).toBe("")
		const inline = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot" width="8" height="8">'
		expect(sanitizeTooltipHtml(inline)).toBe(inline)
		expect(sanitizeTooltipHtml('<img src="data:text/html,<script>1</script>">')).toBe("")
		expect(
			sanitizeTooltipHtml('<div style="background: url(https://example.com/a.png)">x</div>')
		).toBe("<div>x</div>")
		expect(sanitizeTooltipHtml('<div style="background: \\75rl(x)">x</div>')).toBe("<div>x</div>")
		expect(sanitizeTooltipHtml('<link rel="stylesheet" href="https://example.com/a.css">x')).toBe("x")
	})

	it("keeps text that only looks like markup as text", () => {
		expect(sanitizeTooltipHtml("1 &lt; 2 &amp; 3")).toBe("1 &lt; 2 &amp; 3")
		expect(sanitizeTooltipHtml("")).toBe("")
	})
})

describe("sanitizeTooltipCss", () => {
	it("passes the starter CSS and ordinary declarations", () => {
		expect(sanitizeTooltipCss(DEFAULT_TOOLTIP_CSS)).toBe(DEFAULT_TOOLTIP_CSS)
		const css = `background: #111; color: #fff; font-family: "DM Sans", sans-serif; /* dark */`
		expect(sanitizeTooltipCss(css)).toBe(css)
		expect(sanitizeTooltipCss("")).toBe("")
	})

	it("passes rules nested for what is inside the tooltip", () => {
		const css = `padding: 4px;\n.vc-tooltip-name { font-weight: 600 }\n.vc-tooltip-value { color: teal }`
		expect(sanitizeTooltipCss(css)).toBe(css)
		expect(sanitizeTooltipCss(`.a::after { content: "}" }`)).toBe(`.a::after { content: "}" }`)
	})

	it("refuses CSS that leaves the tooltip's rule", () => {
		expect(sanitizeTooltipCss("color: red } body { display: none")).toBeNull()
		expect(sanitizeTooltipCss("} * { display: none } .x {")).toBeNull()
		expect(sanitizeTooltipCss(".a { color: red")).toBeNull()
		// A brace the browser reads as text can't be used to balance one it doesn't.
		expect(sanitizeTooltipCss(`content: "{" } body { display: none }`)).toBeNull()
		expect(sanitizeTooltipCss(`/* { */ } body { display: none }`)).toBeNull()
		expect(sanitizeTooltipCss(`content: "/*" } body { color: red } .x { content: "*/"`)).toBeNull()
		expect(sanitizeTooltipCss("body:has(&) header { display: none }")).toBeNull()
		expect(sanitizeTooltipCss(`content: "unclosed`)).toBeNull()
		expect(sanitizeTooltipCss("/* unclosed")).toBeNull()
	})

	it("refuses CSS that fetches, imports or uses escapes", () => {
		expect(sanitizeTooltipCss("background: url(https://example.com/a.png)")).toBeNull()
		expect(sanitizeTooltipCss(`background: url("https://example.com/a.png")`)).toBeNull()
		expect(sanitizeTooltipCss("background: URL (x)")).toBeNull()
		expect(sanitizeTooltipCss("background: image-set('a.png' 1x)")).toBeNull()
		expect(sanitizeTooltipCss("@import 'https://example.com/a.css';")).toBeNull()
		expect(sanitizeTooltipCss("@font-face { font-family: x }")).toBeNull()
		expect(sanitizeTooltipCss("background: \\75rl(x)")).toBeNull()
		expect(sanitizeTooltipCss(`content: "a\\7d "`)).toBeNull()
	})
})
