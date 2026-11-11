/** The Export folder and the files written into it. A name is a file name,
 *  never a path; a file is never replaced (a taken name gets " (2)", …);
 *  the file is created exclusively and without following a link at its
 *  name; and it must land inside the REAL Export folder — a folder that is
 *  itself a link, or that is swapped while the chart renders or the file
 *  is written, is refused. */

import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises"
import path from "node:path"

const MAX_NAME_CHARS = 120

/** Names Windows reserves for devices, alone or before an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

// Characters Windows refuses in a file name, plus every control character.
// eslint-disable-next-line no-control-regex
const REFUSED_CHARS = /[<>:"|?*\u0000-\u001f\u007f]/g

const trimEnds = (s: string): string => s.replace(/^\s+/, "").replace(/[\s.]+$/, "")

/** Clean a file name (no extension) for every platform: refuse a path,
 *  drop the characters Windows refuses and trailing dots / spaces, cut to
 *  120 characters; refuse what is left empty or a reserved device name. */
export const checkFileName = (name: string): { ok: true; name: string } | { ok: false; reason: string } => {
	if (/[/\\]/.test(name)) {
		return { ok: false, reason: `"${name}" is a path; give a file name, not a path (no / or \\).` }
	}
	let cleaned = trimEnds(name.replace(REFUSED_CHARS, ""))
	const chars = Array.from(cleaned)
	if (chars.length > MAX_NAME_CHARS) cleaned = trimEnds(chars.slice(0, MAX_NAME_CHARS).join(""))
	if (cleaned.length === 0) {
		return { ok: false, reason: "The file name is empty once characters a file name can't hold are removed." }
	}
	if (RESERVED_NAME.test(cleaned)) {
		return { ok: false, reason: `"${cleaned}" is a name Windows reserves for a device; choose another file name.` }
	}
	return { ok: true, name: cleaned }
}

/** `VIS_EXPORT_DIR`, with a leading `~` / `${HOME}` / `$HOME` as the home
 *  folder; blank, unset or relative → `<home>/Downloads/Zafiro`. */
export const resolveExportFolder = (env: NodeJS.ProcessEnv, homeDir: string): string => {
	const fallback = path.join(homeDir, "Downloads", "Zafiro")
	const raw = env.VIS_EXPORT_DIR?.trim()
	if (!raw) return fallback
	const home = /^(~|\$\{HOME\}|\$HOME)(?=$|[/\\])/.exec(raw)
	const expanded = home ? path.join(homeDir, raw.slice(home[0].length)) : raw
	if (!path.isAbsolute(expanded)) return fallback
	return path.resolve(expanded)
}

export const EXTENSIONS = { png: ".png", jpeg: ".jpg", svg: ".svg", pdf: ".pdf" } as const

/** What the Export folder was before the render: its real path and
 *  identity, or null when it did not exist yet. */
export type FolderSnapshot = { real: string; dev: number; ino: number } | null

export class ExportFolderError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ExportFolderError"
	}
}

const linkRefusal = (folder: string) =>
	new ExportFolderError(
		`The Export folder ${folder} is a link to another folder; set VIS_EXPORT_DIR to the real folder.`
	)

/** The folder's identity now; refuses a folder that is a link. */
export const snapshotFolder = async (folder: string): Promise<FolderSnapshot> => {
	let info
	try {
		info = await lstat(folder)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw new ExportFolderError(`Can't read the Export folder ${folder} (${(error as Error).message}).`)
	}
	if (info.isSymbolicLink()) throw linkRefusal(folder)
	if (!info.isDirectory()) throw new ExportFolderError(`The Export folder ${folder} is not a folder.`)
	return { real: await realpath(folder), dev: info.dev, ino: info.ino }
}

const sameFolder = (a: NonNullable<FolderSnapshot>, b: NonNullable<FolderSnapshot>) =>
	a.real === b.real && a.dev === b.dev && a.ino === b.ino

const MAX_SUFFIX = 999

/** Write `bytes` as `<name><ext>` (or `<name> (n)<ext>`) inside the real
 *  Export folder, making the folder when missing. `before` is the folder's
 *  snapshot taken before the render; a folder that changed identity since
 *  is refused. Returns the written file's path. */
export const writeExportFile = async (opts: {
	folder: string
	before: FolderSnapshot
	name: string
	ext: string
	bytes: Uint8Array
}): Promise<string> => {
	const { folder, before, name, ext, bytes } = opts
	try {
		await mkdir(folder, { recursive: true })
	} catch (error) {
		throw new ExportFolderError(`Can't make the Export folder ${folder} (${(error as Error).message}).`)
	}
	const current = await snapshotFolder(folder)
	if (!current) throw new ExportFolderError(`The Export folder ${folder} disappeared.`)
	if (before && !sameFolder(before, current)) {
		throw new ExportFolderError(`The Export folder ${folder} was replaced while the chart was drawn; nothing was saved.`)
	}

	const flags =
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | ((constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0)
	for (let n = 1; n <= MAX_SUFFIX; n++) {
		const fileName = `${name}${n === 1 ? "" : ` (${n})`}${ext}`
		const target = path.join(current.real, fileName)
		// Immediately before the exclusive open: still the same real folder.
		const check = await snapshotFolder(folder)
		if (!check || !sameFolder(current, check)) {
			throw new ExportFolderError(`The Export folder ${folder} changed while saving; nothing was saved.`)
		}
		let handle
		try {
			handle = await open(target, flags, 0o644)
		} catch (error) {
			// Taken — by a file, a folder or a link (O_EXCL never follows
			// one): try the next suffix.
			const code = (error as NodeJS.ErrnoException).code
			if (code === "EEXIST" || code === "ELOOP" || code === "EISDIR") continue
			throw new ExportFolderError(`Can't create ${target} (${(error as Error).message}).`)
		}
		try {
			await handle.writeFile(bytes)
			const written = await handle.stat()
			// After the write: the file at the name is the one we wrote, and it
			// sits directly inside the real Export folder.
			const landed = await realpath(target)
			const landedInfo = await stat(landed)
			const after = await snapshotFolder(folder)
			if (
				path.dirname(landed) !== current.real ||
				landedInfo.ino !== written.ino ||
				landedInfo.dev !== written.dev ||
				!after ||
				!sameFolder(current, after)
			) {
				throw new ExportFolderError(
					`The Export folder ${folder} changed while saving; check ${current.real} for a partial file.`
				)
			}
		} finally {
			await handle.close()
		}
		// Named as the person configured the folder (its real path may differ
		// by a parent link, e.g. macOS /var → /private/var).
		return path.join(folder, fileName)
	}
	throw new ExportFolderError(`Too many files named "${name}" in ${current.real}; choose another name.`)
}
