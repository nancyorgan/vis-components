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
/** Marks a per-version body. The separator is not in SAFE_ID's alphabet, so
 *  no dataset id can collide with a version file's name. */
const VERSION_INFIX = "."

const filePath = (dataDir: string, id: string): string => {
	if (!isSafeId(id)) throw new Error(`Unsafe dataset id: ${JSON.stringify(id)}`)
	return join(dataDir, `${id}${FILE_SUFFIX}`)
}

const versionFilePath = (
	dataDir: string,
	datasetId: string,
	versionId: string
): string => {
	if (!isSafeId(datasetId) || !isSafeId(versionId)) {
		throw new Error(
			`Unsafe dataset/version id: ${JSON.stringify([datasetId, versionId])}`
		)
	}
	return join(dataDir, `${datasetId}${VERSION_INFIX}${versionId}${FILE_SUFFIX}`)
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

/** Write one VERSION's gzipped rows. Same atomic write as a whole dataset. */
export const writeDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string,
	gzipped: Buffer
): Promise<void> => {
	const final = versionFilePath(dataDir, datasetId, versionId)
	const temp = join(
		dataDir,
		`.${datasetId}${VERSION_INFIX}${versionId}.${process.pid}.tmp`
	)
	const handle = await fs.open(temp, "w")
	try {
		await handle.writeFile(gzipped)
		await handle.sync()
	} finally {
		await handle.close()
	}
	await fs.rename(temp, final)
}

/** Read one VERSION's gzipped rows, or null when it doesn't exist. */
export const readDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string
): Promise<Buffer | null> => {
	try {
		return await fs.readFile(versionFilePath(dataDir, datasetId, versionId))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}

/** Delete one VERSION's file. Idempotent. */
export const deleteDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string
): Promise<void> => {
	try {
		await fs.unlink(versionFilePath(dataDir, datasetId, versionId))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
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

/** Ids of every whole-dataset file present in the data dir (temp files
 *  excluded).
 *
 *  Per-version files live in the same directory and share the suffix, so the
 *  stem is checked against `isSafeId` — a dataset id can never contain the
 *  `.` that separates a version file's two ids. Without that filter the boot
 *  sweep would read every version file as a dataset whose index row is
 *  missing and report the lot as orphans. */
export const listDatasetFiles = async (dataDir: string): Promise<string[]> => {
	const names = await fs.readdir(dataDir)
	return names
		.filter((n) => !n.startsWith(".") && n.endsWith(FILE_SUFFIX))
		.map((n) => n.slice(0, -FILE_SUFFIX.length))
		.filter(isSafeId)
}

/** `[datasetId, versionId]` for every per-version file in the data dir. */
export const listDatasetVersionFiles = async (
	dataDir: string
): Promise<Array<[string, string]>> => {
	const names = await fs.readdir(dataDir)
	const out: Array<[string, string]> = []
	for (const name of names) {
		if (name.startsWith(".") || !name.endsWith(FILE_SUFFIX)) continue
		const stem = name.slice(0, -FILE_SUFFIX.length)
		const cut = stem.indexOf(VERSION_INFIX)
		if (cut === -1) continue
		const datasetId = stem.slice(0, cut)
		const versionId = stem.slice(cut + VERSION_INFIX.length)
		if (isSafeId(datasetId) && isSafeId(versionId)) {
			out.push([datasetId, versionId])
		}
	}
	return out
}
