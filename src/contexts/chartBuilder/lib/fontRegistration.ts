/** Runtime FontFace registration for the user font library.
 *
 * User fonts aren't in index.html's Google Fonts <link> (that list is
 * static), so their faces register programmatically: binary from the
 * IndexedDB cache (fetched from fonts.gstatic.com on first sight) →
 * `new FontFace(...)` → `document.fonts.add`. RootLayout runs
 * `registerUserFonts` whenever the library atom changes, which covers the
 * editor, the library thumbnails, and the /embed/ pages alike.
 *
 * The module also keeps an in-memory catalog of every registered font's
 * faces so non-React code (export/thumbnail font embedding) can look them
 * up without a Jotai store handle. */

import type { GoogleFontFace } from "../../../lib/googleFonts"
import { ensureFontBinary } from "./fontBinaries"
import type { UserFont } from "./fontLibrary"

const registeredFaceUrls = new Set<string>()

/** family (exact name) → faces, for every user font seen this session. */
const catalog = new Map<string, GoogleFontFace[]>()

/** Case-insensitive face lookup for the export embedder. */
export const userFontFaces = (family: string): GoogleFontFace[] | null => {
	for (const [name, faces] of catalog) {
		if (name.toLowerCase() === family.toLowerCase()) return faces
	}
	return null
}

const fontFaceSupported = (): boolean =>
	typeof FontFace !== "undefined" &&
	typeof document !== "undefined" &&
	"fonts" in document

/** Register one face; best-effort (a face that fails to fetch or parse is
 * skipped — the family's other faces still register). */
const registerFace = async (
	family: string,
	face: GoogleFontFace
): Promise<void> => {
	if (registeredFaceUrls.has(face.url)) return
	registeredFaceUrls.add(face.url)
	try {
		const bytes = await ensureFontBinary(face.url)
		const fontFace = new FontFace(family, bytes, {
			style: face.style,
			weight: face.weight,
			...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
		})
		await fontFace.load()
		document.fonts.add(fontFace)
	} catch {
		// Allow a retry later (offline now, online next attempt).
		registeredFaceUrls.delete(face.url)
	}
}

/** Make every face of the given fonts available to the document. Idempotent
 * per face; safe to call on every library change. */
export const registerUserFonts = async (fonts: UserFont[]): Promise<void> => {
	for (const font of fonts) catalog.set(font.family, font.faces)
	if (!fontFaceSupported()) return
	await Promise.all(
		fonts.flatMap((font) =>
			font.faces.map((face) => registerFace(font.family, face))
		)
	)
}
