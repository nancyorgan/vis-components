/** Dataset bodies as whole files: one gzipped JSON file per dataset in the
 *  data dir. Whole-file I/O only — write once (temp + fsync + rename), read
 *  whole, delete. Never edited in place, so the data dir can be blob-backed. */

import { promises as fs } from "node:fs"
import { join } from "node:path"

/** Ids come from URLs, so they gate all path construction. The app generates
 *  ids like "ds-<ts>-<rand>"; anything outside this strict allowlist —
 *  dots, slashes, anything path-like — is rejected outright. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export const isSafeId = (id: string): boolean => SAFE_ID.test(id)

const FILE_SUFFIX = ".json.gz"

const filePath = (dataDir: string, id: string): string => {
	if (!isSafeId(id)) throw new Error(`Unsafe dataset id: ${JSON.stringify(id)}`)
	return join(dataDir, `${id}${FILE_SUFFIX}`)
}

/** Write one dataset's gzipped body. Temp file + fsync + atomic rename, so a
 *  crash mid-write can never leave a half-written dataset at the final name.
 *  The temp name's leading dot keeps it out of listDatasetFiles. */
export const writeDatasetFile = async (
	dataDir: string,
	id: string,
	gzipped: Buffer
): Promise<void> => {
	const final = filePath(dataDir, id)
	const temp = join(dataDir, `.${id}.${process.pid}.tmp`)
	const handle = await fs.open(temp, "w")
	try {
		await handle.writeFile(gzipped)
		await handle.sync()
	} finally {
		await handle.close()
	}
	await fs.rename(temp, final)
}

/** Read one dataset's gzipped body, or null when it doesn't exist. */
export const readDatasetFile = async (
	dataDir: string,
	id: string
): Promise<Buffer | null> => {
	try {
		return await fs.readFile(filePath(dataDir, id))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}

/** Delete one dataset file. Idempotent. */
export const deleteDatasetFile = async (
	dataDir: string,
	id: string
): Promise<void> => {
	try {
		await fs.unlink(filePath(dataDir, id))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
}

/** Ids of every dataset file present in the data dir (temp files excluded). */
export const listDatasetFiles = async (dataDir: string): Promise<string[]> => {
	const names = await fs.readdir(dataDir)
	return names
		.filter((n) => !n.startsWith(".") && n.endsWith(FILE_SUFFIX))
		.map((n) => n.slice(0, -FILE_SUFFIX.length))
}
