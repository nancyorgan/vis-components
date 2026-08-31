/** Body-size limits. The dataset thresholds mirror the client-side ones in
 *  src/contexts/chartBuilder/lib/datasetLimits.ts (a test there asserts the
 *  two stay in sync) — but the server enforces independently: never trust
 *  the client. */

/** Hard reject for dataset uploads, matching DATASET_REJECT_BYTES client-side. */
export const DATASET_REJECT_BYTES = 100 * 1024 * 1024

/** Cap on a dataset PUT body. Bodies arrive gzipped, so this is generous
 *  headroom over the 100 MB pre-compression rule rather than a second
 *  user-facing threshold. */
export const DATASET_BODY_CAP_BYTES = 110 * 1024 * 1024

/** Cap on every non-dataset body (visuals with inline thumbnails included). */
export const JSON_BODY_CAP_BYTES = 10 * 1024 * 1024

/** Cap on an embed publish body: a payload carries a whole dataset version
 *  (bounded by the dataset rule above) plus font binaries and, for ZCTA
 *  maps, an inlined topology — hence dataset parity with headroom. */
export const EMBED_BODY_CAP_BYTES = 128 * 1024 * 1024
