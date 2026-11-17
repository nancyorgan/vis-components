// Shared helpers for the Zafiro PowerPoint add-ins (task pane + content).
// Plain script, no dependencies; everything hangs off `window.Zafiro`.
;(function () {
	"use strict"

	// A v4-ish UUID anywhere in a pasted embed / image URL (or a bare id).
	const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

	// Tag keys are capitalized by Office when saved, so keep ours uppercase
	// to begin with (PowerPoint.TagCollection.add, PowerPointApi 1.3).
	const TAG_KEY = "ZAFIRO_EMBED_ID"

	const parseEmbedId = (text) => {
		if (typeof text !== "string") return null
		const match = text.match(UUID_RE)
		return match ? match[0].toLowerCase() : null
	}

	// The add-in's pages sit in `addin/` beside the published `embeds/`, on
	// the publish host (the self-host server installs them there) and on the
	// addin-dev server (which proxies /embeds/*). So every picture is
	// same-origin, resolved relative to this page — no CORS, and a publish
	// base URL with a path prefix still works. The ?t= defeats any
	// intermediate cache.
	const embedFileUrl = (id, file) => new URL(`../embeds/${id}/${file}`, location.href).href
	const imageUrl = (id) => `${embedFileUrl(id, "image.png")}?t=${Date.now()}`
	// The vector picture published beside the PNG (the editor's portable SVG
	// of the same figure). 404 when the publish predates vector pictures or
	// that upload failed — callers fall back to the PNG.
	const vectorUrl = (id) => `${embedFileUrl(id, "image.svg")}?t=${Date.now()}`
	const embedUrl = (id) => embedFileUrl(id, "index.html")

	// A short fingerprint of a picture's bytes, stored on the figure so a
	// refresh can skip a picture that hasn't changed. Null where Web Crypto
	// isn't available (it needs HTTPS) — callers then always replace.
	const fingerprint = async (bytes) => {
		try {
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
			return Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")
		} catch {
			return null
		}
	}

	const bytesToBase64 = (bytes) => {
		let binary = ""
		const chunk = 0x8000
		for (let i = 0; i < bytes.length; i += chunk) {
			binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
		}
		return btoa(binary)
	}

	// PNG width/height straight from the IHDR chunk (bytes 16..24, big-endian),
	// so the slide shape can keep the picture's aspect without decoding it.
	const pngSize = (bytes) => {
		if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e) return null
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		return { width: view.getUint32(16), height: view.getUint32(20) }
	}

	// Dots per inch from the pHYs chunk (Zafiro stamps 96 × its raster scale),
	// or null when the PNG carries none — the caller then assumes 96.
	const pngDpi = (bytes) => {
		if (!pngSize(bytes)) return null
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		let at = 8
		while (at + 12 <= bytes.length) {
			const length = view.getUint32(at)
			const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
			if (type === "pHYs" && length >= 9) {
				return view.getUint8(at + 16) === 1 ? view.getUint32(at + 8) * 0.0254 : null
			}
			if (type === "IDAT") break
			at += 12 + length
		}
		return null
	}

	// → { base64, width, height, dpi, hash } (width/height null if the body
	// isn't a PNG; dpi null when unstamped). Throws with the HTTP status so
	// a 404 (unpublished, or mid-republish) can be told apart.
	const fetchImage = async (id) => {
		const url = imageUrl(id)
		let response
		try {
			response = await fetch(url, { cache: "no-store" })
		} catch (error) {
			throw new Error(`Couldn't reach ${url}: ${error.message}`)
		}
		if (!response.ok) {
			const error = new Error(`Picture for ${id} returned HTTP ${response.status} (${url})`)
			error.status = response.status
			throw error
		}
		const bytes = new Uint8Array(await response.arrayBuffer())
		if (bytes.length === 0) throw new Error(`Picture for ${id} is empty (${url})`)
		const size = pngSize(bytes)
		return {
			base64: bytesToBase64(bytes),
			width: size ? size.width : null,
			height: size ? size.height : null,
			dpi: pngDpi(bytes),
			hash: await fingerprint(bytes),
		}
	}

	// Base64 string WITHOUT the data: prefix (what Office.js wants).
	const fetchImageBase64 = async (id) => (await fetchImage(id)).base64

	// CSS-px size of an SVG document from its root width/height (the export
	// pipeline writes both, unitless = px), else from the viewBox; null when
	// neither is there. Text-level, no parser: the root tag is the first tag.
	const svgSize = (text) => {
		const root = /<svg\b[^>]*>/i.exec(text)
		if (!root) return null
		const attr = (name) => {
			const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(root[0])
			return m ? Number(m[1]) : null
		}
		const width = attr("width")
		const height = attr("height")
		if (width && height) return { width, height }
		const box = /\sviewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(root[0])
		return box ? { width: Number(box[1]), height: Number(box[2]) } : null
	}

	// → { text, width, height, dpi: 96, hash }. The SVG is CSS px at 96 dpi by
	// construction, so it places at true size like a stamped PNG. Throws with
	// the HTTP status so a 404 (no vector published) can fall back to the PNG.
	const fetchVector = async (id) => {
		const url = vectorUrl(id)
		let response
		try {
			response = await fetch(url, { cache: "no-store" })
		} catch (error) {
			throw new Error(`Couldn't reach ${url}: ${error.message}`)
		}
		if (!response.ok) {
			const error = new Error(`Vector picture for ${id} returned HTTP ${response.status} (${url})`)
			error.status = response.status
			throw error
		}
		const text = await response.text()
		if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
			throw new Error(`Vector picture for ${id} is not an SVG document (${url})`)
		}
		const size = svgSize(text)
		return {
			text,
			width: size ? size.width : null,
			height: size ? size.height : null,
			dpi: 96,
			hash: await fingerprint(new TextEncoder().encode(text)),
		}
	}

	window.Zafiro = {
		TAG_KEY,
		parseEmbedId,
		imageUrl,
		vectorUrl,
		embedUrl,
		fetchImage,
		fetchImageBase64,
		fetchVector,
		svgSize,
		pngSize,
		pngDpi,
	}
})()
