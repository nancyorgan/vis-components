import { parse as papaParse, type ParseError } from "papaparse"

export type ParsedCsv = {
	fieldNames: string[]
	rows: Array<Record<string, string>>
}

/** The parser options every upload is read with: the editor's file and
 *  paste paths here, and the MCP's csv text and file path through
 *  `parseCsvTextWithin`. The first row is the header; the delimiter is
 *  auto-detected unless a caller names one; cells stay text. */
const UPLOAD_PARSE_OPTIONS = {
	header: true,
	skipEmptyLines: true,
	dynamicTyping: false,
} as const

/** "Quotes" is a stray quote inside a field, which the parser recovers
 *  from. "Delimiter" means it couldn't tell the delimiter apart and fell
 *  back to a comma — which is exactly right for a single-column file or
 *  paste, where there is no delimiter to find. Anything else is fatal. */
const isFatal = (e: ParseError) => e.type !== "Quotes" && e.type !== "Delimiter"

const parseErrorMessage = (e: ParseError) =>
	`CSV parse error at row ${e.row}: ${e.message}`

/** Upload bytes as text, the way the browser's `File.text()` reads them:
 *  UTF-8, a leading byte-order mark dropped, invalid bytes replaced. */
export const decodeUploadBytes = (bytes: Uint8Array): string =>
	new TextDecoder("utf-8").decode(bytes)

export const parseCsvFile = async (file: File): Promise<ParsedCsv> => {
	const text = await file.text()
	return parseCsvText(text)
}

export const parseCsvText = (text: string): ParsedCsv => {
	const result = papaParse<Record<string, string>>(text, UPLOAD_PARSE_OPTIONS)
	if (result.errors.length > 0) {
		const firstFatal = result.errors.find(isFatal)
		if (firstFatal) throw new Error(parseErrorMessage(firstFatal))
	}
	const fieldNames = result.meta.fields ?? []
	return { fieldNames, rows: result.data }
}

/** What `parseCsvTextWithin` stops at. `maxParsedBytes` bounds the parsed
 *  rows' estimated memory (`estimatedRowBytes`). */
export type CsvLimits = {
	maxRows: number
	maxCells: number
	maxParsedBytes: number
}

export type BoundedCsv =
	| ({ ok: true } & ParsedCsv)
	/** A limit passed: the parse stopped there, keeping nothing. */
	| { ok: false; limit: "rows" | "cells" | "memory" }
	/** The parse error `parseCsvText` throws, with the same message. */
	| { ok: false; error: string }

/** Estimated heap bytes per parsed row object and per cell (the property
 *  slot plus the string's header), measured on Node 24 with margin: a
 *  million rows of ten short cells take ~500 MB, this estimates ~560 MB.
 *  Characters count two bytes each, the two-byte string case. */
const ROW_OVERHEAD_BYTES = 80
const CELL_OVERHEAD_BYTES = 40

/** One parsed row's estimated heap size. */
export const estimatedRowBytes = (row: Record<string, string>): number => {
	let bytes = ROW_OVERHEAD_BYTES
	for (const key in row) bytes += CELL_OVERHEAD_BYTES + 2 * (row[key]?.length ?? 0)
	return bytes
}

/** Text is fed to the parser this much at a time, so no step of the parse
 *  holds more than a slice of the input split into lines (whole, a file of
 *  a hundred million blank lines is past what one array can hold). */
const CHUNK_CHARS = 8 * 1024 * 1024

/** The parser guesses the line break from the first MB it is given and
 *  the delimiter from the first ten rows, both from the FIRST chunk; that
 *  chunk must hold what the whole text would show it. */
const LINE_BREAK_SAMPLE_CHARS = 1024 * 1024
const DELIMITER_SAMPLE_ROWS = 10
/** Past this, a first chunk is not grown to hold ten rows (a ten-row
 *  sample over 32 M characters is guessed on its first 32 M). */
const MAX_FIRST_CHUNK_CHARS = 32 * 1024 * 1024

/** Where the first `n` raw rows end (line breaks outside double quotes;
 *  blank lines count, as the parser's sample counts them), at most `cap`. */
const endOfRows = (text: string, n: number, cap: number): number => {
	const stop = Math.min(text.length, cap)
	let inQuotes = false
	let count = 0
	for (let i = 0; i < stop; i++) {
		const c = text.charCodeAt(i)
		if (c === 34) inQuotes = !inQuotes
		else if (!inQuotes && (c === 10 || c === 13)) {
			if (c === 13 && text.charCodeAt(i + 1) === 10) i++
			if (++count >= n) return i + 1
		}
	}
	return stop
}

/** The chunk size: at least the line-break sample, and big enough that the
 *  first chunk holds the header and the delimiter sample. */
const chunkCharsFor = (text: string, wanted: number): number =>
	Math.max(
		wanted,
		LINE_BREAK_SAMPLE_CHARS,
		endOfRows(text, DELIMITER_SAMPLE_ROWS + 1, MAX_FIRST_CHUNK_CHARS)
	)

/** `parseCsvText`, row by row, stopping as soon as the data rows, the cells
 *  (data rows times columns) or the rows' estimated memory pass `limits`,
 *  so an oversized input is refused without ever being held whole. The
 *  same options and the same error rule, so within the limits it returns
 *  exactly what `parseCsvText` returns (a test holds the two equal).
 *  `delimiter` forces one (a .tsv file's tab); `chunkChars` is for tests
 *  (it never goes under the samples the parser guesses from). */
export const parseCsvTextWithin = (
	text: string,
	limits: CsvLimits,
	opts: { delimiter?: string; chunkChars?: number } = {}
): BoundedCsv => {
	const options = {
		...UPLOAD_PARSE_OPTIONS,
		...(opts.delimiter ? { delimiter: opts.delimiter } : {}),
	}
	const chunkSize = chunkCharsFor(text, opts.chunkChars ?? CHUNK_CHARS)
	const rows: Array<Record<string, string>> = []
	let fieldNames: string[] = []
	let bytes = 0
	let stopped: BoundedCsv | null = null
	papaParse<Record<string, string>>(text, {
		...options,
		chunkSize,
		// Typed for files only, but the parser feeds a string by chunkSize
		// as well; `complete` (unused) selects that overload.
		complete: () => {},
		step: (result, parser) => {
			const fatal = result.errors.find(isFatal)
			if (fatal) stopped = { ok: false, error: parseErrorMessage(fatal) }
			else {
				if (rows.length === 0) fieldNames = result.meta.fields ?? []
				bytes += estimatedRowBytes(result.data)
				if (rows.length + 1 > limits.maxRows) stopped = { ok: false, limit: "rows" }
				else if ((rows.length + 1) * fieldNames.length > limits.maxCells)
					stopped = { ok: false, limit: "cells" }
				else if (bytes > limits.maxParsedBytes) stopped = { ok: false, limit: "memory" }
				else rows.push(result.data)
			}
			if (stopped) {
				rows.length = 0
				parser.abort()
			}
		},
	})
	if (stopped) return stopped
	// A header with no data rows never reaches `step`: read it from the first
	// chunk, which holds it and everything its delimiter is guessed from.
	if (rows.length === 0) {
		const head = papaParse<Record<string, string>>(text.slice(0, chunkSize), options)
		return { ok: true, fieldNames: head.meta.fields ?? [], rows: [] }
	}
	return { ok: true, fieldNames, rows }
}
