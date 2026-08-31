/** Published-embed boot: wire the app's storage seams so the real chart
 *  components render the payload — and nothing durable is ever written to
 *  the viewer's browser (0016 rule 6).
 *
 *  Three seams, all installed BEFORE the first atom read:
 *   - `enableEphemeralStorage()` — every device-local localStorage
 *     read/write (draft atoms, UI state) goes to an in-memory map.
 *   - `disableIdb()` — IndexedDB (dataset bodies, thumbnails, font binaries)
 *     is off outright; every helper degrades to its safe no-op.
 *   - `installExampleOverlay(...)` — the payload's visual/dataset/theme are
 *     served in memory at the storage read seams, exactly the mechanism the
 *     ephemeral seed examples use. Saves strip these rows again, and land in
 *     the ephemeral map anyway.
 *
 *  Fonts register straight from the payload's base64 woff2 bytes via the
 *  in-memory FontFace API — never through `ensureFontBinary`, whose cache
 *  write would touch IndexedDB. */

import { createStore } from "jotai"

import { installExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import { setZctaTopologyLoader } from "../contexts/chartBuilder/lib/geo/zctaTopology"
import { enableEphemeralStorage } from "../contexts/chartBuilder/lib/storage/ephemeral"
import { disableIdb } from "../contexts/chartBuilder/lib/storage/idb"
import { themeAtom } from "../contexts/chartBuilder/store/atoms"
import type { EmbedFontFace, EmbedPayload } from "./payload"

export type EmbedStore = ReturnType<typeof createStore>

const bytesFromBase64 = (base64: string): ArrayBuffer => {
	// atob is the direct base64 decoder for the payload's woff2 bytes
	// (mirrors fontEmbed.ts's btoa on the encode side).
	// eslint-disable-next-line no-restricted-globals
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes.buffer
}

/** Register the payload's font faces. Best-effort per face (a corrupt binary
 *  skips that face, the rest still register) and inert where the FontFace API
 *  doesn't exist (tests). */
export const registerEmbedFonts = (fonts: readonly EmbedFontFace[]): void => {
	if (typeof FontFace === "undefined" || typeof document === "undefined") return
	if (!("fonts" in document)) return
	for (const font of fonts) {
		try {
			const face = new FontFace(font.family, bytesFromBase64(font.woff2Base64), {
				weight: font.weight,
				style: font.style,
				...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}),
			})
			document.fonts.add(face)
			void face.load().catch(() => undefined)
		} catch {
			// skip this face
		}
	}
}

/** Install every seam and hand back the seeded Jotai store to render under.
 *  Call exactly once, before render. */
export const bootEmbedRuntime = (payload: EmbedPayload): EmbedStore => {
	enableEphemeralStorage()
	disableIdb()
	installExampleOverlay({
		visuals: [payload.visual],
		folders: [],
		datasets: payload.dataset ? { [payload.dataset.id]: payload.dataset } : {},
		themes: payload.theme ? [payload.theme] : [],
		userDefaultThemeId: null,
	})
	registerEmbedFonts(payload.fonts)
	// ZIP-level maps: the topology rides in the payload (the runtime build
	// stamps __ZCTA_ASSET_PATH__ null, so there is no fetch path to fall
	// back to — by design, a published embed requests nothing).
	const zctaTopology = payload.zctaTopology
	if (zctaTopology !== undefined) {
		setZctaTopologyLoader(async () => zctaTopology)
	}
	const store = createStore()
	// The live theme the renderer reads. Its write-path save lands in the
	// ephemeral map (enabled above), so seeding it writes nothing durable.
	if (payload.theme) store.set(themeAtom, payload.theme)
	return store
}
