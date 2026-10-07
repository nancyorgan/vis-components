/** Collections whose stored bodies carry a frontend content-schema version.
 *  `datasets` is here despite living in files rather than a JSON table;
 *  `folders` and `settings` are absent because the frontend never versioned
 *  them (they're read unversioned; if that changes, add them here AND to the
 *  client registry in lib/storage/migrations.ts). The server never interprets
 *  these numbers — it only stores what the client stamps.
 *
 *  Deliberately dependency-free: the client's migrations parity test imports
 *  this list directly so the two registries can't drift, and importing db.ts
 *  (which loads `node:sqlite`) from a happy-dom suite isn't an option. */
export const CONTENT_VERSION_COLLECTIONS = [
	"visuals",
	"datasets",
	"embed-instances",
	"themes",
	"fonts",
] as const
