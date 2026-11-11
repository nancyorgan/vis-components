/** Where create_dataset's text comes from: csv text sent in the call, or a
 *  file on this computer by its full path. Both parse as the editor's
 *  upload does (`parseCsvTextWithin`, the upload's options), within the
 *  limits below, so neither can take the MCP down.
 *
 *  A path is a prompt-injection surface (a model can be talked into naming
 *  any file), so only a plainly named data file is read: an absolute path,
 *  ending .csv, .tsv or .txt, with no hidden segment, to a regular file, and
 *  the same rules for wherever a link leads. The file is opened ONCE,
 *  non-blocking (a pipe swapped in after the checks can't hang the read),
 *  its open descriptor checked (still the same regular file, within the
 *  size limit), and read for at most the checked size plus one byte, so a
 *  file that grows after its check is refused, not read on. */

import { constants, promises as fs, type Stats } from "node:fs"
import { basename, extname, isAbsolute } from "node:path"
import { getHeapStatistics } from "node:v8"

import { DATASET_REJECT_BYTES } from "../../src/contexts/chartBuilder/lib/datasetLimits"
import { decodeUploadBytes, parseCsvTextWithin, type ParsedCsv } from "../../src/contexts/chartBuilder/lib/parseCsv"

/** The editor's upload limit, on the SOURCE: the file's size, or the csv
 *  text's UTF-8 bytes (never the rows it expands to). */
export const MAX_SOURCE_BYTES = DATASET_REJECT_BYTES
/** Data rows (header not counted) and cells (data rows times columns). */
export const MAX_ROWS = 1_000_000
export const MAX_CELLS = 10_000_000
/** The memory budget for the parsed rows, by the parse's own estimate
 *  (`estimatedRowBytes`: per row and per cell overhead, two bytes a
 *  character): 1 GiB, or a quarter of this process's heap limit when that is
 *  smaller. The rest of the heap is headroom for storing the rows (their
 *  hash and the request bodies). The largest data within the limits above
 *  (a million rows, ten million cells, 100 MB of text) estimates ~700 MB. */
export const PARSE_MEMORY_BUDGET_BYTES = Math.min(1024 ** 3, Math.floor(getHeapStatistics().heap_size_limit / 4))

const EXTENSIONS = [".csv", ".tsv", ".txt"]

const asMb = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
const count = (n: number) => n.toLocaleString("en-US")

export type Refusal = { ok: false; message: string }
export type Parsed = { ok: true } & ParsedCsv

const refusal = (message: string): Refusal => ({ ok: false, message: `Nothing was stored: ${message}` })

const TOO_BIG = (bytes: number) =>
	refusal(
		`the data is ${asMb(bytes)}, above the ${asMb(MAX_SOURCE_BYTES)} limit. Tell the person; a smaller extract or a split file would fit.`
	)

/** csv text or file text → rows, within the limits. */
export const parseSource = (text: string, delimiter?: string): Parsed | Refusal => {
	const result = parseCsvTextWithin(
		text,
		{ maxRows: MAX_ROWS, maxCells: MAX_CELLS, maxParsedBytes: PARSE_MEMORY_BUDGET_BYTES },
		delimiter ? { delimiter } : {}
	)
	if (result.ok) {
		if (result.rows.length === 0)
			return refusal("the data has a header but no data rows. Give the data with its rows.")
		return result
	}
	if ("error" in result) return refusal(`${result.error}. Tell the person what the parser says, and fix the data or ask them to.`)
	const fit = "Tell the person; a smaller extract or a split file would fit."
	if (result.limit === "rows") return refusal(`the data has more than ${count(MAX_ROWS)} rows, the limit for one data set. ${fit}`)
	if (result.limit === "cells")
		return refusal(`the data has more than ${count(MAX_CELLS)} cells (rows times columns), the limit for one data set. ${fit}`)
	return refusal(`reading the data would pass this MCP's memory budget (${asMb(PARSE_MEMORY_BUDGET_BYTES)}). ${fit}`)
}

/** csv text, after its size check. */
export const csvText = (csv: string): { ok: true; text: string } | Refusal => {
	const bytes = Buffer.byteLength(csv, "utf8")
	return bytes > MAX_SOURCE_BYTES ? TOO_BIG(bytes) : { ok: true, text: csv }
}

/** Test seams: run after the path's checks (before the open), and after the
 *  open descriptor's check (before the read). */
export type ReadHooks = {
	afterCheck?: () => void | Promise<void>
	afterOpen?: () => void | Promise<void>
}

/** A refusal for a name the rules don't allow, or null. */
const ruleBreak = (path: string, what: string): Refusal | null => {
	if (path.split(/[\\/]+/).some((seg) => seg.startsWith(".")))
		return refusal(
			`${what} has a hidden part (a file or folder whose name starts with "."), and those are never read. Ask the person for the path of a plain data file.`
		)
	if (!EXTENSIONS.includes(extname(path).toLowerCase()))
		return refusal(
			`${what} isn't a .csv, .tsv or .txt file. Ask the person for the full path of the data file, or to upload it in the editor.`
		)
	return null
}

/** What `stats` is, when it isn't a regular file. */
const notAFile = (stats: Stats): string | null =>
	stats.isFile()
		? null
		: stats.isDirectory()
			? "a folder"
			: stats.isFIFO()
				? "a named pipe"
				: stats.isSocket()
					? "a socket"
					: stats.isCharacterDevice() || stats.isBlockDevice()
						? "a device"
						: "not a regular file"

const errorCode = (error: unknown) => (error as { code?: string }).code

const unreadable = (path: string, error: unknown): Refusal => {
	const code = errorCode(error)
	if (code === "ENOENT" || code === "ENOTDIR") return refusal(`there is no file at ${path}. Ask the person for the file's full path.`)
	if (code === "EACCES" || code === "EPERM")
		return refusal(`${path} can't be read (no permission). Ask the person to check the file, or to upload it in the editor.`)
	return refusal(`${path} couldn't be read (${code ?? String(error)}). Ask the person to check the file, or to upload it in the editor.`)
}

const CHANGED = (path: string) =>
	refusal(`${path} changed while it was being read. Try again once it has finished changing.`)

/** A file by its path → its text and how to parse it, or why not. */
export const readSourceFile = async (
	path: string,
	hooks: ReadHooks = {}
): Promise<{ ok: true; text: string; fileName: string; delimiter?: string } | Refusal> => {
	if (!isAbsolute(path))
		return refusal(
			`"${path}" isn't a full path. Ask the person for the file's full path (from the root, e.g. /Users/name/Downloads/data.csv).`
		)
	const named = ruleBreak(path, path)
	if (named) return named
	let real: string
	let checked: Stats
	try {
		real = await fs.realpath(path)
		checked = await fs.stat(real)
	} catch (error) {
		return unreadable(path, error)
	}
	if (real !== path) {
		const target = ruleBreak(real, `${path} leads to ${real}, which`)
		if (target) return target
	}
	const kind = notAFile(checked)
	if (kind) return refusal(`${path} is ${kind}, not a data file. Ask the person for the path of the data file.`)
	if (checked.size > MAX_SOURCE_BYTES) return TOO_BIG(checked.size)
	await hooks.afterCheck?.()

	let handle: fs.FileHandle
	try {
		// The resolved file itself (never a link swapped in since), and
		// non-blocking: opening a pipe returns at once instead of waiting.
		handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
	} catch (error) {
		return errorCode(error) === "ELOOP" ? CHANGED(path) : unreadable(path, error)
	}
	try {
		const opened = await handle.stat()
		if (notAFile(opened)) return CHANGED(path)
		if (opened.dev !== checked.dev || opened.ino !== checked.ino) return CHANGED(path)
		if (opened.size > MAX_SOURCE_BYTES) return TOO_BIG(opened.size)
		// The path must still lead to the file that was checked.
		if ((await fs.realpath(path).catch(() => null)) !== real) return CHANGED(path)
		await hooks.afterOpen?.()
		// At most the checked size plus one byte: one more means it grew.
		const buffer = Buffer.allocUnsafe(opened.size + 1)
		let read = 0
		while (read < buffer.length) {
			const { bytesRead } = await handle.read(buffer, read, buffer.length - read, null)
			if (bytesRead === 0) break
			read += bytesRead
		}
		if (read > opened.size) return CHANGED(path)
		const fileName = basename(path)
		return {
			ok: true,
			text: decodeUploadBytes(buffer.subarray(0, read)),
			fileName,
			...(extname(fileName).toLowerCase() === ".tsv" ? { delimiter: "\t" } : {}),
		}
	} catch (error) {
		return unreadable(path, error)
	} finally {
		await handle.close()
	}
}

/** The data set name an upload of `fileName` takes: the name without its
 *  extension (the editor's upload drops ".csv" the same way). */
export const uploadName = (fileName: string): string => fileName.slice(0, fileName.length - extname(fileName).length)
