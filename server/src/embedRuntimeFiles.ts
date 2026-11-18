/** The embed app as shared, cacheable files beside the embeds.
 *
 *  The build still produces ONE self-contained page (`dist/embed-runtime.html`,
 *  the charting app inlined). Publishing it as is made every embed carry its
 *  own ~2 MB copy of the app, so a page framing 30 charts downloaded it 30
 *  times. Here the server lifts the page's inline app script and stylesheet
 *  out into `$VIS_PUBLISH_DIR/runtime/embed-<hash>.js|css`, and the page that
 *  gets published keeps only a relative reference to them. A browser
 *  downloads the app once and reads it from its cache for every other embed.
 *
 *  The publish host's side of the contract (it caches these names for a
 *  year, so it must be able to trust them):
 *   - a file is named by a hash of its own bytes, and that name is only ever
 *     written with those bytes — rewriting a damaged copy is fine
 *   - a runtime file is never deleted: published embeds point at it
 *   - the `.gz` beside it decompresses to exactly those bytes (the host
 *     sends it to browsers that accept gzip, so nothing compresses per request)
 *   - a file is written whole and read back BEFORE any page points at it
 *
 *  Embeds published before this existed are converted in place at startup
 *  (`convertPublishedEmbeds`): each page's OWN inline app moves out to the
 *  file its bytes hash to. A converted embed therefore runs exactly the app
 *  it was published with, and embeds from one build share one file. Only a
 *  republish moves an embed to a newer app. */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

import { EMBED_PART_FILES, isPublishId, writeAndVerify } from "./embedFiles.js"
import { toPublicPayload, validatePublicPayload } from "./publicEmbed.js"

export const RUNTIME_DIR = "runtime"
/** How an embed page (always `embeds/<publishId>/<part>.html`) reaches the
 *  runtime folder. Relative, so it works wherever the publish dir is served. */
const RUNTIME_HREF = `../../${RUNTIME_DIR}`
/** Hex characters of the SHA-256 kept in a name. The publish host caches
 *  names with 16 to 64. */
const HASH_LENGTH = 32

export type RuntimeFile = { name: string; bytes: Buffer }

const runtimeFile = (text: string, extension: "js" | "css"): RuntimeFile => {
	const bytes = Buffer.from(text, "utf-8")
	const hash = createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH)
	return { name: `embed-${hash}.${extension}`, bytes }
}

/** A comment, or the opening tag of an element whose body is raw text. */
const RAW_TEXT_OPENER = /<!--|<(script|style)\b([^>]*)>/g

/** Lift the inline app out of a single-file embed page. Returns the page
 *  with the module script and the stylesheet replaced by references into the
 *  runtime folder, plus the files those references name. `null` when the page
 *  inlines neither (it is already in the shared form, or isn't an embed
 *  page), and when it can't be read as one — the caller leaves it alone.
 *
 *  The page is walked element by element rather than searched: the app's
 *  script is 2 MB of code that may well contain the text "<style" or
 *  "<script", and only a walk that skips each raw-text body whole can't be
 *  fooled by it. The payload script is skipped the same way, untouched. */
export const splitEmbedPage = (
	html: string
): { html: string; files: RuntimeFile[] } | null => {
	const files: RuntimeFile[] = []
	let out = ""
	let position = 0
	for (;;) {
		RAW_TEXT_OPENER.lastIndex = position
		const match = RAW_TEXT_OPENER.exec(html)
		if (match === null) break
		const [opener, tag, attributes = ""] = match
		const bodyStart = match.index + opener.length
		const closer = tag === undefined ? "-->" : `</${tag}>`
		const bodyEnd = html.indexOf(closer, bodyStart)
		if (bodyEnd === -1) return null
		const end = bodyEnd + closer.length
		const body = html.slice(bodyStart, bodyEnd)
		const inlineModule =
			tag === "script" && /\btype="module"/.test(attributes) && !/\bsrc=/.test(attributes)
		if (inlineModule && body.length > 0) {
			const file = runtimeFile(body, "js")
			files.push(file)
			out +=
				html.slice(position, match.index) +
				`<script type="module" src="${RUNTIME_HREF}/${file.name}"></script>`
		} else if (tag === "style" && body.length > 0) {
			const file = runtimeFile(body, "css")
			files.push(file)
			out +=
				html.slice(position, match.index) +
				`<link rel="stylesheet" href="${RUNTIME_HREF}/${file.name}" />`
		} else {
			out += html.slice(position, end)
		}
		position = end
	}
	if (files.length === 0) return null
	return { html: out + html.slice(position), files }
}

const PAYLOAD_OPENER = '<script type="application/json" id="embed-payload">'

/** Rewrite a published page's payload into the public shape (publicEmbed.ts)
 *  — for pages published when whole stored records went out, carrying who
 *  saved the visual, library ids, file names and timestamps. Returns the
 *  page unchanged when its payload is already public; throws when the page
 *  has no readable payload, so the caller reports it and leaves it alone. */
export const withPublicPayload = (html: string): string => {
	const start = html.indexOf(PAYLOAD_OPENER)
	const bodyStart = start + PAYLOAD_OPENER.length
	const bodyEnd = start === -1 ? -1 : html.indexOf("</script>", bodyStart)
	if (bodyEnd === -1) throw new Error("the page has no payload")
	const wrapper = JSON.parse(html.slice(bodyStart, bodyEnd)) as {
		v?: unknown
		part?: unknown
		payload?: unknown
	}
	if (validatePublicPayload(wrapper.payload) === null) return html
	const payload = toPublicPayload(wrapper.payload)
	const problem = payload === null ? "it holds no visual" : validatePublicPayload(payload)
	if (problem !== null) throw new Error(`the payload can't be made public: ${problem}`)
	// `<` escaped as at publish, so nothing in the payload can end the tag.
	const json = JSON.stringify({ v: wrapper.v, part: wrapper.part, payload }).replaceAll(
		"<",
		"\\u003c"
	)
	return html.slice(0, bodyStart) + json + html.slice(bodyEnd)
}

const readIfPresent = async (path: string): Promise<Buffer | null> => {
	try {
		return await fs.readFile(path)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}

const gunzipsTo = (gz: Buffer, bytes: Buffer): boolean => {
	try {
		return gunzipSync(gz).equals(bytes)
	} catch {
		return false
	}
}

/** Make the runtime folder hold these files, each with its `.gz`. A file
 *  already there with the right bytes is left alone; a missing or damaged
 *  one is written whole and read back. Nothing is ever deleted. Throws on
 *  any failure, so a caller never goes on to point a page at a missing file. */
export const installRuntimeFiles = (
	publishDir: string,
	files: readonly RuntimeFile[]
): Promise<void> => {
	// One install at a time: the startup pass and a publish can ask for the
	// same file at once, and two writers would share one temp name.
	const run = installing.then(() => installNow(publishDir, files))
	installing = run.catch(() => undefined)
	return run
}

let installing: Promise<void> = Promise.resolve()

const installNow = async (
	publishDir: string,
	files: readonly RuntimeFile[]
): Promise<void> => {
	const dir = join(publishDir, RUNTIME_DIR)
	await fs.mkdir(dir, { recursive: true })
	for (const { name, bytes } of files) {
		const existing = await readIfPresent(join(dir, name))
		if (existing === null || !existing.equals(bytes)) {
			await writeAndVerify(dir, name, bytes)
		}
		const gzName = `${name}.gz`
		const existingGz = await readIfPresent(join(dir, gzName))
		if (existingGz === null || !gunzipsTo(existingGz, bytes)) {
			await writeAndVerify(dir, gzName, gzipSync(bytes, { level: 9 }))
		}
	}
}

/** The template last prepared, so a publish doesn't re-hash 2 MB each time.
 *  Keyed on the template text itself: a rebuilt template (the embed:dev
 *  watch build) is a different string and installs its own files. */
let prepared: { publishDir: string; template: string; shared: string } | null = null

/** The build's template in its shared form, with the files it references
 *  installed and verified first. A template that inlines nothing is returned
 *  as is. Called at startup (which is what repairs a damaged runtime file)
 *  and before every publish. */
export const prepareEmbedTemplate = async (
	publishDir: string,
	template: string
): Promise<string> => {
	if (prepared?.publishDir === publishDir && prepared.template === template) {
		return prepared.shared
	}
	const split = splitEmbedPage(template)
	if (split === null) return template
	await installRuntimeFiles(publishDir, split.files)
	prepared = { publishDir, template, shared: split.html }
	return split.html
}

export type EmbedConversion = {
	/** Pages rewritten by this pass: app moved out, payload made public. */
	converted: number
	/** Pages that needed nothing. */
	current: number
	/** Pages left exactly as they were because converting them failed. */
	failed: { path: string; reason: string }[]
}

/** Convert every published embed page that predates today's form: one
 *  still carrying its own inline app (moved out to runtime/), or a payload
 *  from before the public boundary (rewritten to hold only public fields,
 *  publicEmbed.ts). Safe to run on every start: a converted page comes out
 *  of both steps unchanged, so the next pass skips it. A page that can't be converted is left untouched and
 *  reported; it keeps working as the self-contained page it is. The runtime
 *  files are installed and verified before the page that points at them is
 *  written, and the page write is whole-file with a read-back, as a publish.
 *  Pictures and everything else in an embed's folder are not touched. */
export const convertPublishedEmbeds = async (publishDir: string): Promise<EmbedConversion> => {
	const result: EmbedConversion = { converted: 0, current: 0, failed: [] }
	const embedsDir = join(publishDir, "embeds")
	let ids: string[]
	try {
		ids = (await fs.readdir(embedsDir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && isPublishId(entry.name))
			.map((entry) => entry.name)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
		throw error
	}
	for (const id of ids) {
		const dir = join(embedsDir, id)
		for (const name of EMBED_PART_FILES) {
			try {
				const page = await readIfPresent(join(dir, name))
				if (page === null) continue
				const original = page.toString("utf-8")
				const split = splitEmbedPage(original)
				const shared = split?.html ?? original
				const next = withPublicPayload(shared)
				if (next === original) {
					result.current += 1
					continue
				}
				if (split !== null) await installRuntimeFiles(publishDir, split.files)
				// A republish or unpublish may have landed while the files were
				// being installed; its page wins, and the next pass sees it.
				const now = await readIfPresent(join(dir, name))
				if (now === null || !now.equals(page)) continue
				await writeAndVerify(dir, name, next)
				result.converted += 1
			} catch (error) {
				result.failed.push({ path: `embeds/${id}/${name}`, reason: String(error) })
			}
		}
	}
	return result
}
