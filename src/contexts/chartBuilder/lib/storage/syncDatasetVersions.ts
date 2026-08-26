/** Keep one dataset's per-version bodies in step with its whole body — the
 *  ONE implementation shared by the IndexedDB layer (storage.ts) and the HTTP
 *  adapter. The two used to carry near-twin copies of this logic and drifted
 *  apart twice: one keyed its skip-cache on the version OBJECT (so a note
 *  edit re-uploaded megabytes of unchanged rows) and one computed the
 *  removed-version set AFTER overwriting its record of the prior set (so
 *  deleted versions were never deleted from the server). Every rule below is
 *  load-bearing:
 *
 *   - Writes are weak-identity diffed on the ROWS array, not the version
 *     object: the atoms treat datasets immutably, so an unchanged rows
 *     reference means the stored body is current — and metadata-only edits
 *     (a version note) must not re-write the rows.
 *   - `priorVersionIds` is the version set the store held BEFORE this write,
 *     captured by the CALLER before anything is overwritten. Versions in it
 *     but absent from `dataset` are deleted — without that, removed
 *     versions' rows sit in storage forever, servable long after the user
 *     believes them gone.
 *   - Failures propagate (unless the IO callback maps them to a soft
 *     `false`). Callers own the failure policy — the HTTP adapter must NOT
 *     write fresh metadata over a failed sync, or the non-null meta masks
 *     the stale version bodies from every future repair pass. */

export type DatasetVersionBody = {
	id: string
	rows: Array<Record<string, string>>
}

export type VersionSyncIO = {
	/** Write one version's body. Return false for a soft failure (nothing is
	 *  recorded, so the next save retries this version); throw to abort the
	 *  whole sync. */
	putVersion: (version: DatasetVersionBody) => Promise<boolean>
	deleteVersion: (versionId: string) => Promise<void>
}

export const syncDatasetVersions = async (
	dataset: { id: string; versions?: readonly DatasetVersionBody[] },
	priorVersionIds: Iterable<string> | undefined,
	io: VersionSyncIO,
	/** The rows arrays last written per `<datasetId>:<versionId>`, held weakly
	 *  so merely opening datasets never pins their rows for the tab's life. A
	 *  GC'd entry just re-writes, which is harmless. Owned by the caller — it
	 *  outlives individual syncs. */
	written: Map<string, WeakRef<object>>
): Promise<void> => {
	const versions = dataset.versions ?? []
	await Promise.all(
		versions.map(async (version) => {
			const key = `${dataset.id}:${version.id}`
			if (written.get(key)?.deref() === version.rows) return
			const wrote = await io.putVersion(version)
			if (wrote) written.set(key, new WeakRef(version.rows))
		})
	)
	if (!priorVersionIds) return
	const current = new Set(versions.map((v) => v.id))
	const removed = [...priorVersionIds].filter((id) => !current.has(id))
	await Promise.all(
		removed.map(async (versionId) => {
			await io.deleteVersion(versionId)
			written.delete(`${dataset.id}:${versionId}`)
		})
	)
}
