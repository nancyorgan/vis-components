/** Is an uploaded vector picture a plain SVG we can park in the public dir?
 *
 *  The publish dir is served as-is by a dumb static server, and an SVG is a
 *  document: a browser that opens `image.svg` directly will run a script in
 *  it. The client only ever sends the export pipeline's own portable SVG
 *  (text, shapes, data-URL fonts and pictures), so anything beyond that is
 *  refused rather than sanitized — the upload is not a feature for arbitrary
 *  SVGs. Checks are textual (zero-dep, no XML parser) and err on the side of
 *  refusing: a false "unsafe" costs one chart its vector link, a false "safe"
 *  costs the publish host. */

const MAX_PROLOGUE = 4 * 1024

/** Patterns that have no place in the export pipeline's SVG. */
const REFUSED: readonly RegExp[] = [
	/<!DOCTYPE/i, // entity expansion
	/<!ENTITY/i,
	/<script/i,
	// A prefixed element (`<x:script xmlns:x="…svg">`) is the same element
	// under another spelling, and runs. The export pipeline writes no
	// prefixed element at all (only prefixed ATTRIBUTES, `xlink:href`), so
	// every one is refused rather than listing the dangerous names.
	/<\/?[^\s<>/!?"'=:]+:/,
	/<foreignObject/i,
	/<iframe/i,
	/<embed/i,
	/<object/i,
	/<meta/i,
	/<link/i,
	/<base/i,
	/<set\b/i, // SMIL can rewrite attributes, including hrefs
	/<animate/i,
	/<handler/i,
	/<listener/i,
	/\son[a-z]+\s*=/i, // event handler attributes
	/javascript:/i,
	/vbscript:/i,
	/@import/i,
	/expression\s*\(/i,
	/-moz-binding/i,
	/behavior\s*:/i,
]

/** Attribute values and CSS url() references must point inside the
 *  document (`#id`) or at inline data. Anything else fetches. */
const HREF_ATTR = /\b(?:xlink:href|href|src)\s*=\s*(["'])\s*([^"']*)\1/gi
const CSS_URL = /url\(\s*(["']?)\s*([^"')]*)\1\s*\)/gi

/** The namespaces an export SVG declares. Any other (XHTML above all: an
 *  `<h:form>` or a `<div xmlns="…xhtml">` puts a working HTML page inside
 *  the picture) is refused, however it is bound. */
const NAMESPACE_DECL = /\bxmlns(?::[^\s=]+)?\s*=\s*(["'])([^"']*)\1/gi
const ALLOWED_NAMESPACES: ReadonlySet<string> = new Set([
	"http://www.w3.org/2000/svg",
	"http://www.w3.org/1999/xlink",
	"http://www.w3.org/XML/1998/namespace",
])

const isLocalReference = (value: string): boolean => {
	const v = value.trim()
	return v === "" || v.startsWith("#") || /^data:/i.test(v)
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** Whether `data` is UTF-8 text that is an `<svg>` document (optionally
 *  behind an XML declaration and comments), free of scripting, external
 *  fetches and anything else the export pipeline never writes. */
export const isSafeSvg = (data: Buffer): boolean => {
	let text: string
	try {
		text = stripBom(new TextDecoder("utf-8", { fatal: true }).decode(data))
	} catch {
		return false
	}
	if (text.includes("\0")) return false
	// Prologue: whitespace, one optional XML declaration, comments; then <svg.
	const head = text.slice(0, MAX_PROLOGUE)
	const prologue = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i
	if (!prologue.test(head)) return false
	for (const pattern of REFUSED) {
		if (pattern.test(text)) return false
	}
	for (const match of text.matchAll(NAMESPACE_DECL)) {
		if (!ALLOWED_NAMESPACES.has(match[2] ?? "")) return false
	}
	for (const match of text.matchAll(HREF_ATTR)) {
		if (!isLocalReference(match[2] ?? "")) return false
	}
	for (const match of text.matchAll(CSS_URL)) {
		if (!isLocalReference(match[2] ?? "")) return false
	}
	return true
}
