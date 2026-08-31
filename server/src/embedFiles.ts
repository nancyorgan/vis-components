/** Published-embed files (the 0016 public embed contract).
 *
 *  A publish writes one self-contained HTML file per requested part into
 *  `$VIS_PUBLISH_DIR/embeds/<publishId>/`, where a dumb static server makes
 *  it public at `$VIS_PUBLISH_BASE_URL/embeds/<publishId>/<file>`. Everything
 *  in the publish dir is fully public; nothing there is ever needed by this
 *  server again except to rewrite or delete it.
 *
 *  Contract rules enforced here:
 *   - whole-file I/O only (temp + fsync + rename, same as datasetFiles)
 *   - every file has a correct extension and every URL names a file
 *   - no URL is reported until its file is written AND read back intact —
 *     the caller only builds URLs from what this module returns
 *   - unpublish deletes the embed's files (idempotent)
 *   - the part filenames are a closed set, so no manifest file is needed
 *     (and nothing non-content ever sits in the public dir) */

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

/** Compose one part's finished page: the wrapper JSON replaces the template
 *  marker. `payloadJson` is the client's payload, already serialized — it is
 *  wrapped, not parsed, so a large dataset never round-trips through
 *  JSON.parse here. `<` is escaped to < so no payload content (say, a
 *  tooltip template containing "</script>") can terminate the script tag. */
export const composePartHtml = (
	template: string,
	part: EmbedPart,
	payloadJson: string
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
	return template.replace(PAYLOAD_MARKER, () => wrapper)
}

/** Write one part file: temp + fsync + rename so a crash mid-write can never
 *  leave a half-written page at a public name, then read back and compare —
 *  only a verified byte-identical file counts as published. */
const writeAndVerify = async (dir: string, name: string, html: string): Promise<void> => {
	const final = join(dir, name)
	const temp = join(dir, `.${name}.${process.pid}.tmp`)
	const bytes = Buffer.from(html, "utf-8")
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
	parts: readonly EmbedPart[]
): Promise<Record<string, string>> => {
	const dir = embedDir(publishDir, publishId)
	await fs.mkdir(dir, { recursive: true })
	const paths: Record<string, string> = {}
	for (const part of parts) {
		await writeAndVerify(dir, PART_FILES[part], composePartHtml(template, part, payloadJson))
		paths[part] = embedPartPath(publishId, part)
	}
	for (const part of EMBED_PARTS) {
		if (!parts.includes(part)) await deleteIfPresent(join(dir, PART_FILES[part]))
	}
	return paths
}

/** Unpublish: delete every part file, then the now-empty directory.
 *  Idempotent — unpublishing an unknown or already-gone embed is a no-op. */
export const unpublishEmbedFiles = async (
	publishDir: string,
	publishId: string
): Promise<void> => {
	const dir = embedDir(publishDir, publishId)
	for (const part of EMBED_PARTS) {
		await deleteIfPresent(join(dir, PART_FILES[part]))
	}
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
