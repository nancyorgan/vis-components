// ---------------------------------------------------------------------------
// Addresses that arrive inside stored content
// ---------------------------------------------------------------------------
//
// A saved visual, a shared font or an imported file can carry an address
// that every viewer's browser then loads: a picture's `href`, a font file's
// `url`. The app itself only ever writes two kinds — a picture pasted in as
// data, and a font file on Google's font host — so those are the only kinds
// it reads back. Anything else (typed into the server by hand, or arriving
// in an imported file) would make each viewer's browser call an address
// somebody else chose, including from a published embed, which is meant to
// ask nobody for anything.
//
// Checked where the address is USED (drawn or fetched), not only where it
// is saved, so a record stored before these checks existed is covered too.

/** A picture held as data: `data:image/<type>…`. Every upload path stores
 *  this form (image annotations, custom glyphs, thumbnails), whatever the
 *  picture's format, so an uploaded picture always passes. */
export const isInlineImage = (value: unknown): value is string =>
	typeof value === "string" && /^data:image\/[a-z0-9.+-]+[;,]/i.test(value)

/** `value` when it is an inline picture, else undefined: what a picture
 *  element is handed, so an address that isn't one draws nothing. */
export const inlineImage = (value: unknown): string | undefined =>
	isInlineImage(value) ? value : undefined

/** The host Google serves font files from: the only one a font face's
 *  stored `url` may name. */
const FONT_FILE_HOST = "fonts.gstatic.com"

/** Whether a font face's address is a file on Google's font host, over
 *  https, with nothing odd in it (no sign-in part, no other port). */
export const isFontFileUrl = (value: unknown): value is string => {
	if (typeof value !== "string") return false
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		return false
	}
	return (
		parsed.protocol === "https:" &&
		parsed.hostname === FONT_FILE_HOST &&
		parsed.port === "" &&
		parsed.username === "" &&
		parsed.password === ""
	)
}
