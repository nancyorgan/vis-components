/** Published-embed files (the 0016 public embed contract).
 *
 *  A publish writes one self-contained HTML file per requested part into
 *  `$VIS_PUBLISH_DIR/embeds/<publishId>/`, where a dumb static server makes
 *  it public at `$VIS_PUBLISH_BASE_URL/embeds/<publishId>/<file>`. The client
 *  then uploads pictures of the chart into the same folder — a PNG as
 *  `image.png` and a vector SVG as `image.svg` — each a separate request, so
 *  either can be linked as a picture that refreshes on republish. Everything
 *  in the publish dir is fully public; nothing there is ever needed by this
 *  server again except to rewrite or delete it.
 *
 *  Contract rules enforced here:
 *   - whole-file I/O only (temp + fsync + rename, same as datasetFiles)
 *   - every file has a correct extension and every URL names a file
 *   - no URL is reported until its file is written AND read back intact —
 *     the caller only builds URLs from what this module returns
 *   - unpublish deletes the embed's files (idempotent)
 *   - the filenames are a closed set — the part files plus `image.png` and
 *     `image.svg` — so no manifest file is needed (and nothing non-content
 *     ever sits in the public dir)
 *   - an HTML (re)publish deletes both pictures, so the stable picture URLs
 *     never show a stale chart; the client's trailing uploads restore them
 *   - a picture is only ever written into an existing embed dir: an upload
 *     that trails a DELETE must not resurrect the embed */

import { promises as fs } from "node:fs"
import { join } from "node:path"

/** The embeddable parts. "full" is the combined chart + legend page. */
export const EMBED_PARTS = ["full", "chart", "legend"] as const
export type EmbedPart = (typeof EMBED_PARTS)[number]

export const isEmbedPart = (value: unknown): value is EmbedPart =>
	typeof value === "string" && (EMBED_PARTS as readonly string[]).includes(value)

/** The closed filename set — everything an embed can ever consist of. */
const PART_FILES: Record<EmbedPart, string> = {
	full: "index.html",
	chart: "chart.html",
	legend: "legend.html",
}

/** The embed's picture file — not a part (it is uploaded separately, never
 *  composed from the template), but part of the closed filename set. */
export const IMAGE_FILE = "image.png"
/** The vector picture beside it: the same figure as a portable SVG, for
 *  consumers that keep vectors sharp at any zoom (slides, print, PDF). */
export const VECTOR_FILE = "image.svg"
/** The picture files, as the client uploads them: PNG raster, SVG vector. */
export type PictureFile = typeof IMAGE_FILE | typeof VECTOR_FILE

/** Publish ids are minted client-side with crypto.randomUUID() — lowercase
 *  hyphenated UUID, nothing else. They come from URLs, so they gate all path
 *  construction (mirrors datasetFiles' isSafeId, but stricter: an embed URL
 *  is public and enumeration-resistant by id entropy). */
const PUBLISH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isPublishId = (id: string): boolean => PUBLISH_ID.test(id)

/** The marker the built embed-runtime template carries exactly once; a
 *  publish replaces it with the wrapper JSON. Split so this file's own
 *  compiled output can't be mistaken for a template. */
export const PAYLOAD_MARKER = "__VIS_EMBED_" + "PAYLOAD__"

/** The built embed-runtime page, shipped in the frontend dist next to the
 *  SPA. Null when the build didn't produce it — publishing is then a clear
 *  server-side error, never a broken public file. */
export const readEmbedTemplate = async (distDir: string): Promise<string | null> => {
	try {
		return await fs.readFile(join(distDir, "embed-runtime.html"), "utf-8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}

const embedDir = (publishDir: string, publishId: string): string => {
	if (!isPublishId(publishId)) {
		throw new Error(`Unsafe publish id: ${JSON.stringify(publishId)}`)
	}
	return join(publishDir, "embeds", publishId)
}

/** The public URL path (relative to VIS_PUBLISH_BASE_URL) for one part.
 *  Always names a file, never a directory — per the contract, even the
 *  default part is addressed as .../index.html. */
export const embedPartPath = (publishId: string, part: EmbedPart): string => {
	if (!isPublishId(publishId)) {
		throw new Error(`Unsafe publish id: ${JSON.stringify(publishId)}`)
	}
	return `embeds/${publishId}/${PART_FILES[part]}`
}

/** The public URL path (relative to VIS_PUBLISH_BASE_URL) for the embed's
 *  picture. */
export const embedImagePath = (publishId: string): string => {
	if (!isPublishId(publishId)) {
		throw new Error(`Unsafe publish id: ${JSON.stringify(publishId)}`)
	}
	return `embeds/${publishId}/${IMAGE_FILE}`
}

/** `embeds/<publishId>/image.svg` — the vector picture's public path. */
export const embedVectorPath = (publishId: string): string => {
	if (!isPublishId(publishId)) {
		throw new Error(`Unsafe publish id: ${JSON.stringify(publishId)}`)
	}
	return `embeds/${publishId}/${VECTOR_FILE}`
}

/** Compose one part's finished page: the wrapper JSON replaces the template
 *  marker. `payloadJson` is the client's payload, already serialized — it is
 *  wrapped, not parsed, so a large dataset never round-trips through
 *  JSON.parse here. `<` is escaped to < so no payload content (say, a
 *  tooltip template containing "</script>") can terminate the script tag. */
/** HTML-escape text for an element body (the page <title>). */
const escapeHtmlText = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")

/** Put the visual's name in the page's <title> (escaped) so the embed's
 *  document — and the frame a screen reader lands in — is named for its
 *  chart rather than the template's generic "Chart embed". */
const withTitle = (html: string, title: string | undefined): string => {
	const name = title?.trim()
	if (!name) return html
	return html.replace(
		/<title>[^<]*<\/title>/,
		() => `<title>${escapeHtmlText(name)}</title>`
	)
}

export const composePartHtml = (
	template: string,
	part: EmbedPart,
	payloadJson: string,
	title?: string
): string => {
	if (!template.includes(PAYLOAD_MARKER)) {
		throw new Error("embed runtime template is missing the payload marker")
	}
	const wrapper = `{"v":1,"part":"${part}","payload":${payloadJson}}`.replaceAll(
		"<",
		"\\u003c"
	)
	// Thunk replacement: a literal second argument would reinterpret `$`
	// sequences inside the payload as replacement patterns.
	return withTitle(template, title).replace(PAYLOAD_MARKER, () => wrapper)
}

/** Write one public file: temp + fsync + rename so a crash mid-write can never
 *  leave a half-written file at a public name, then read back and compare —
 *  only a verified byte-identical file counts as published. A string is
 *  written as UTF-8. */
const writeAndVerify = async (
	dir: string,
	name: string,
	content: Buffer | string
): Promise<void> => {
	const final = join(dir, name)
	const temp = join(dir, `.${name}.${process.pid}.tmp`)
	const bytes = typeof content === "string" ? Buffer.from(content, "utf-8") : content
	const handle = await fs.open(temp, "w")
	try {
		await handle.writeFile(bytes)
		await handle.sync()
	} finally {
		await handle.close()
	}
	await fs.rename(temp, final)
	const readBack = await fs.readFile(final)
	if (!readBack.equals(bytes)) {
		throw new Error(`published file ${name} failed read-back verification`)
	}
}

/** Publish (or republish, in place) the given parts of one embed. Parts NOT
 *  in `parts` are deleted — the request's part list is authoritative, so a
 *  republish that drops the split variant retires its public files too.
 *  Throws on any failure; the caller reports a retryable error and shows no
 *  URL. Returns the public path (relative to VIS_PUBLISH_BASE_URL) per
 *  published part. */
export const publishEmbedFiles = async (
	publishDir: string,
	publishId: string,
	template: string,
	payloadJson: string,
	parts: readonly EmbedPart[],
	/** The visual's name, for the page <title>. */
	title?: string
): Promise<Record<string, string>> => {
	const dir = embedDir(publishDir, publishId)
	await fs.mkdir(dir, { recursive: true })
	const paths: Record<string, string> = {}
	for (const part of parts) {
		await writeAndVerify(dir, PART_FILES[part], composePartHtml(template, part, payloadJson, title))
		paths[part] = embedPartPath(publishId, part)
	}
	for (const part of EMBED_PARTS) {
		if (!parts.includes(part)) await deleteIfPresent(join(dir, PART_FILES[part]))
	}
	// The picture shows the PREVIOUS content now; retire it rather than serve
	// a stale chart at the stable URL until the client's upload lands.
	await deleteIfPresent(join(dir, IMAGE_FILE))
	await deleteIfPresent(join(dir, VECTOR_FILE))
	return paths
}

/** Write one of the embed's pictures into an already-published embed.
 *  Returns its public path (relative to VIS_PUBLISH_BASE_URL), or `null`
 *  when the embed is not published — the directory is never created here,
 *  so an upload that trails an unpublish cannot resurrect it. Throws on any
 *  other failure. The bytes are stored as given; the caller validates them. */
const publishEmbedPicture = async (
	publishDir: string,
	publishId: string,
	file: PictureFile,
	bytes: Buffer
): Promise<string | null> => {
	const dir = embedDir(publishDir, publishId)
	try {
		if (!(await fs.stat(dir)).isDirectory()) return null
		await writeAndVerify(dir, file, bytes)
	} catch (error) {
		// ENOENT covers both "never published" and an unpublish racing the
		// write (the dir vanished before the temp file was opened).
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
	return file === IMAGE_FILE ? embedImagePath(publishId) : embedVectorPath(publishId)
}

/** The raster picture (`image.png`); see {@link publishEmbedPicture}. */
export const publishEmbedImage = (
	publishDir: string,
	publishId: string,
	png: Buffer
): Promise<string | null> => publishEmbedPicture(publishDir, publishId, IMAGE_FILE, png)

/** The vector picture (`image.svg`); see {@link publishEmbedPicture}. */
export const publishEmbedVector = (
	publishDir: string,
	publishId: string,
	svg: Buffer
): Promise<string | null> => publishEmbedPicture(publishDir, publishId, VECTOR_FILE, svg)

/** Unpublish: delete every part file and both pictures, then the now-empty
 *  directory.
 *  Idempotent — unpublishing an unknown or already-gone embed is a no-op. */
export const unpublishEmbedFiles = async (
	publishDir: string,
	publishId: string
): Promise<void> => {
	const dir = embedDir(publishDir, publishId)
	for (const part of EMBED_PARTS) {
		await deleteIfPresent(join(dir, PART_FILES[part]))
	}
	await deleteIfPresent(join(dir, IMAGE_FILE))
	await deleteIfPresent(join(dir, VECTOR_FILE))
	// Leftover temp files from a crashed publish are the only other thing
	// that can exist here; sweep them so the rmdir below succeeds.
	try {
		for (const name of await fs.readdir(dir)) {
			if (name.startsWith(".") && name.endsWith(".tmp")) {
				await deleteIfPresent(join(dir, name))
			}
		}
		await fs.rmdir(dir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	}
}

const deleteIfPresent = async (path: string): Promise<void> => {
	try {
		await fs.unlink(path)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
}
