// ---------------------------------------------------------------------------
// The tooltip's custom HTML template and custom CSS, made safe to render
// ---------------------------------------------------------------------------
//
// A template is typed by one person and rendered in everyone else's browser:
// a colleague opening the chart, anyone importing its file, and the public
// on a published embed. So it is FORMATTING ONLY. Nothing in it may run
// (scripts, event handlers), ask another server for anything (remote
// pictures, fonts, `url()`), or collect input (forms, links).
//
// Both functions are an ALLOWLIST: what isn't named here is removed. They
// run at render time, on every tooltip, so a template saved before this
// existed (or written into the server by hand) gets the same treatment.

/** Elements a template may use: text formatting, lists, tables, pictures. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
	"abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup",
	"dd", "del", "div", "dl", "dt", "em", "figcaption", "figure",
	"h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li",
	"mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup",
	"table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
])

/** Elements removed WITH everything inside them. Any other unknown element
 *  is unwrapped: the tag goes, its text stays (a link becomes its words). */
const REMOVED_WITH_CONTENT: ReadonlySet<string> = new Set([
	"applet", "audio", "base", "button", "canvas", "embed", "form", "frame",
	"frameset", "head", "iframe", "input", "link", "math", "meta", "noembed",
	"noframes", "noscript", "object", "option", "script", "select", "source",
	"style", "svg", "template", "textarea", "title", "track", "video",
])

/** Attributes any allowed element may carry. */
const GLOBAL_ATTRIBUTES: readonly string[] = ["class", "style", "title", "dir", "lang"]

/** Extra attributes per element. */
const TAG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
	img: ["src", "alt", "width", "height"],
	td: ["colspan", "rowspan"],
	th: ["colspan", "rowspan", "scope"],
	col: ["span"],
	colgroup: ["span"],
	ol: ["start", "reversed", "type"],
}

/** A picture must be inline data: nothing is fetched to draw a tooltip. */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i

/** CSS that would fetch something, run something, or needs an escape to be
 *  read (an escape can spell any of the others). */
const UNSAFE_CSS = /url\s*\(|image-set|image\s*\(|src\s*\(|expression\s*\(|-moz-binding|behavior\s*:|javascript:|@|\\|</i

/** Whether an inline `style="…"` value is plain declarations. */
const isSafeInlineStyle = (value: string): boolean => !UNSAFE_CSS.test(value)

const escapeText = (raw: string): string =>
	raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const copyAllowed = (source: Node, target: Node, doc: Document): void => {
	for (const child of Array.from(source.childNodes)) {
		if (child.nodeType === 3) {
			target.appendChild(doc.createTextNode(child.textContent ?? ""))
			continue
		}
		// Comments, processing instructions and the rest are dropped.
		if (child.nodeType !== 1) continue
		const element = child as Element
		const tag = element.localName.toLowerCase()
		const isHtml = element.namespaceURI === "http://www.w3.org/1999/xhtml"
		if (!isHtml || REMOVED_WITH_CONTENT.has(tag)) continue
		if (!ALLOWED_TAGS.has(tag)) {
			copyAllowed(element, target, doc)
			continue
		}
		const copy = doc.createElement(tag)
		for (const name of [...GLOBAL_ATTRIBUTES, ...(TAG_ATTRIBUTES[tag] ?? [])]) {
			const value = element.getAttribute(name)
			if (value === null) continue
			if (name === "style" && !isSafeInlineStyle(value)) continue
			if (name === "src" && !INLINE_IMAGE.test(value.trim())) continue
			copy.setAttribute(name, value)
		}
		// A picture with no usable source would draw a broken-image icon.
		if (tag === "img" && !copy.hasAttribute("src")) continue
		copyAllowed(element, copy, doc)
		target.appendChild(copy)
	}
}

/** `html` with everything but formatting removed (see the file header).
 *  Parsed inside a `<template>`, whose contents the browser keeps inert:
 *  nothing in the input runs or loads while it is being read. The result is
 *  rebuilt element by element from the allowlist, in a second template.
 *  Without a DOM to parse with, the text is shown as text. */
export const sanitizeTooltipHtml = (html: string): string => {
	if (html === "") return ""
	if (typeof document === "undefined") return escapeText(html)
	const parsed = document.createElement("template")
	parsed.innerHTML = html
	const out = document.createElement("template")
	copyAllowed(parsed.content, out.content, out.content.ownerDocument ?? document)
	return out.innerHTML
}

/** The Custom CSS box, safe to place inside `.vc-tooltip { … }` — or null
 *  when it can't be, and none of it is applied.
 *
 *  The box holds declarations for the tooltip, and may nest rules for what
 *  is inside it (`.vc-tooltip-name { font-weight: 600 }`). What it must not
 *  do is get OUT of that rule and style the rest of the page, so:
 *   - braces must balance and never close more than they opened. Braces
 *     inside a quoted string or a comment are text, exactly as the browser
 *     reads them — which is why this walks the text instead of counting
 *   - no `&`: a nested selector could otherwise reach outside the tooltip
 *     (`body:has(&) header`)
 *   - nothing from `UNSAFE_CSS`: no at-rules, no `url()`, no escapes */
export const sanitizeTooltipCss = (css: string): string | null => {
	let depth = 0
	let quote: string | null = null
	let code = ""
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (quote !== null) {
			// An unescaped line break ends a string badly; escapes are refused.
			if (c === "\n" || c === "\r" || c === "\f" || c === "\\") return null
			if (c === quote) quote = null
			continue
		}
		if (c === "/" && css[i + 1] === "*") {
			const end = css.indexOf("*/", i + 2)
			if (end === -1) return null
			i = end + 1
			// A comment separates tokens; it never joins them.
			code += " "
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			code += " "
			continue
		}
		if (c === "&") return null
		if (c === "{") depth += 1
		if (c === "}") {
			depth -= 1
			if (depth < 0) return null
		}
		code += c
	}
	if (quote !== null || depth !== 0 || UNSAFE_CSS.test(code)) return null
	return css
}
