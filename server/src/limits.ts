/** Body-size limits. The dataset thresholds mirror the client-side ones in
 *  src/contexts/chartBuilder/lib/datasetLimits.ts (a test there asserts the
 *  two stay in sync) — but the server enforces independently: never trust
 *  the client. */

/** Hard reject for dataset uploads, matching DATASET_REJECT_BYTES client-side. */
export const DATASET_REJECT_BYTES = 100 * 1024 * 1024

/** Cap on a dataset PUT body. Bodies arrive UNCOMPRESSED (the client stopped
 *  setting Content-Encoding: gzip), so this has to clear the JSON expansion
 *  of the 100 MB pre-compression rule, not the 100 MB itself: the wire body
 *  is an array of row objects that repeats every column name on every row,
 *  which runs ~1.5-5x the source CSV for realistic tables. 512 MB covers a
 *  100 MB upload at ~5x and is also where Chrome's max JS string length sits
 *  — a body past it cannot be serialized in the browser to begin with. It is
 *  headroom, not a second user-facing threshold. */
export const DATASET_BODY_CAP_BYTES = 512 * 1024 * 1024

/** Cap on every non-dataset body (visuals with inline thumbnails included).
 *  These were never compressed on the wire, so the uncompressed switch does
 *  not move this one. */
export const JSON_BODY_CAP_BYTES = 10 * 1024 * 1024

/** Cap on an embed publish body: a payload carries a whole dataset version
 *  (bounded by the dataset rule above) plus font binaries and, for ZCTA
 *  maps, an inlined topology — hence dataset parity with headroom. */
export const EMBED_BODY_CAP_BYTES = 640 * 1024 * 1024
