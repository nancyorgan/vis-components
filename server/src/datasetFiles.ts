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

/** The file name's extension-less stem: the dataset id alone, or the two ids
 *  joined by VERSION_INFIX for a per-version body. Both stems gate on
 *  isSafeId, so every path below is built from vetted input. */
const datasetStem = (id: string): string => {
	if (!isSafeId(id)) throw new Error(`Unsafe dataset id: ${JSON.stringify(id)}`)
	return id
}

const versionStem = (datasetId: string, versionId: string): string => {
	if (!isSafeId(datasetId) || !isSafeId(versionId)) {
		throw new Error(
			`Unsafe dataset/version id: ${JSON.stringify([datasetId, versionId])}`
		)
	}
	return `${datasetId}${VERSION_INFIX}${versionId}`
}

/** Write one gzipped body. Temp file + fsync + atomic rename, so a crash
 *  mid-write can never leave a half-written body at the final name. The temp
 *  name's leading dot keeps it out of listDatasetFiles. */
const writeGzipFile = async (
	dataDir: string,
	stem: string,
	gzipped: Buffer
): Promise<void> => {
	const final = join(dataDir, `${stem}${FILE_SUFFIX}`)
	const temp = join(dataDir, `.${stem}.${process.pid}.tmp`)
	const handle = await fs.open(temp, "w")
	try {
		await handle.writeFile(gzipped)
		await handle.sync()
	} finally {
		await handle.close()
	}
	await fs.rename(temp, final)
}

/** Read one gzipped body, or null when it doesn't exist. */
const readGzipFile = async (
	dataDir: string,
	stem: string
): Promise<Buffer | null> => {
	try {
		return await fs.readFile(join(dataDir, `${stem}${FILE_SUFFIX}`))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}

/** Delete one gzipped body. Idempotent. */
const deleteGzipFile = async (dataDir: string, stem: string): Promise<void> => {
	try {
		await fs.unlink(join(dataDir, `${stem}${FILE_SUFFIX}`))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
}

/** Write one dataset's gzipped body. */
export const writeDatasetFile = async (
	dataDir: string,
	id: string,
	gzipped: Buffer
): Promise<void> => writeGzipFile(dataDir, datasetStem(id), gzipped)

/** Write one VERSION's gzipped rows. */
export const writeDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string,
	gzipped: Buffer
): Promise<void> =>
	writeGzipFile(dataDir, versionStem(datasetId, versionId), gzipped)

/** Read one VERSION's gzipped rows, or null when it doesn't exist. */
export const readDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string
): Promise<Buffer | null> =>
	readGzipFile(dataDir, versionStem(datasetId, versionId))

/** Delete one VERSION's file. Idempotent. */
export const deleteDatasetVersionFile = async (
	dataDir: string,
	datasetId: string,
	versionId: string
): Promise<void> => deleteGzipFile(dataDir, versionStem(datasetId, versionId))

/** Read one dataset's gzipped body, or null when it doesn't exist. */
export const readDatasetFile = async (
	dataDir: string,
	id: string
): Promise<Buffer | null> => readGzipFile(dataDir, datasetStem(id))

/** Delete one dataset file. Idempotent. */
export const deleteDatasetFile = async (dataDir: string, id: string): Promise<void> =>
	deleteGzipFile(dataDir, datasetStem(id))

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
