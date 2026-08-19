/** Dataset upload size thresholds. The browser is the real constraint — a
 *  large dataset is slow to parse, render, and (in server mode) transfer —
 *  so the guard applies in local and server mode alike. The server enforces
 *  the hard limit independently (server/src/limits.ts; a test keeps the two
 *  in sync). */

export const DATASET_WARN_BYTES = 25 * 1024 * 1024
export const DATASET_REJECT_BYTES = 100 * 1024 * 1024

export type DatasetSizeIssue = "warn" | "reject" | null

export const datasetSizeIssue = (bytes: number): DatasetSizeIssue =>
	bytes > DATASET_REJECT_BYTES
		? "reject"
		: bytes > DATASET_WARN_BYTES
			? "warn"
			: null

const asMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

export const datasetRejectMessage = (bytes: number): string =>
	`This file is ${asMb(bytes)} — above the ${asMb(DATASET_REJECT_BYTES)} ` +
	`limit. Try reducing rows or columns, or splitting the data.`

export const datasetWarnMessage = (bytes: number): string =>
	`This file is ${asMb(bytes)}. Datasets over ${asMb(DATASET_WARN_BYTES)} ` +
	`can make charts slow to load and render in the browser.`
