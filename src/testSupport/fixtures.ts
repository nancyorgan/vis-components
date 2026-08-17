import type {
	Dataset,
	DatasetVersion,
	Field,
} from "../contexts/chartBuilder/lib/types"

export type BuildDatasetOptions = {
	/** Stable dataset id. Suites normally pass their own module-level
	 *  `DATASET_ID` so the seeded localStorage keys and the atom seeds agree. */
	id?: string
	/** Dataset name. Also supplies the default version filename. */
	name?: string
	/** Columns, shared across every version (a Dataset invariant). */
	fields: Field[]
	/** Rows for the single generated version. Ignored when `versions` is
	 *  passed. */
	rows?: Array<Record<string, string>>
	/** Filename of the single generated version. Defaults to `<name>.csv`.
	 *  Ignored when `versions` is passed. */
	filename?: string
	/** Full version list, for the handful of suites that exercise multi-version
	 *  behavior. Supersedes `rows`/`filename`; `latestVersionId` points at the
	 *  last entry. */
	versions?: DatasetVersion[]
	/** First-version timestamp. Fixed at 0 by default so snapshots are
	 *  deterministic. */
	createdAt?: number
}

/** Build a `Dataset` for tests without restating the version envelope.
 *
 *  Almost every suite needs the same shape — one version, `createdAt: 0`,
 *  `latestVersionId` pointing at it — and differs only in the fields and rows
 *  the assertions actually care about. Pass those; the envelope is filled in.
 *
 *  Suites whose dataset shape is genuinely load-bearing (multi-version
 *  histories, nonzero timestamps) can pass `versions` outright. */
export const buildDataset = ({
	id = "ds-test",
	name = "data",
	fields,
	rows = [],
	filename = `${name}.csv`,
	versions,
	createdAt = 0,
}: BuildDatasetOptions): Dataset => {
	const resolved: DatasetVersion[] = versions ?? [
		{ id: "v1", filename, rows, createdAt },
	]
	const latest = resolved.at(-1)
	if (!latest) {
		throw new Error("buildDataset: `versions` must not be empty")
	}
	return {
		id,
		name,
		fields,
		versions: resolved,
		latestVersionId: latest.id,
		createdAt,
	}
}
