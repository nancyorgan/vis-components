// @vitest-environment node
// TST-16/17/18: create_dataset's three sources (rows, csv text, a file by
// path), their refusals and limits, against the real self-host server.
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { inferFields, newDatasetRecord } from "../../src/contexts/chartBuilder/lib/datasetFromRows"
import { parseCsvFile } from "../../src/contexts/chartBuilder/lib/parseCsv"
import type { Dataset } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import type { ReadHooks } from "./source"
import { fakeRenderer, startTestServer, type TestServer } from "./testServer"
import { createHandlers, type CreateDatasetArgs } from "./tools"

let server: TestServer
let dir: string
let hooks: ReadHooks = {}
let tools: ReturnType<typeof createHandlers>

const posix = process.platform !== "win32"
const root = typeof process.getuid === "function" && process.getuid() === 0

beforeAll(async () => {
	server = await startTestServer()
	dir = mkdtempSync(join(tmpdir(), "vis-mcp-sources-"))
	tools = createHandlers(createApi(server.base), {
		renderer: fakeRenderer(),
		// Each test sets its own; read per call.
		readHooks: {
			afterCheck: () => hooks.afterCheck?.(),
			afterOpen: () => hooks.afterOpen?.(),
		},
	})
})

afterAll(() => {
	server.close()
	rmSync(dir, { recursive: true, force: true })
})

type Out = { id: string; name: string; rowCount: number; fields: Record<string, string>; reused: boolean; message: string }

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text
const out = (r: CallToolResult) => JSON.parse(text(r)) as Out

const create = async (args: CreateDatasetArgs) => tools.create_dataset(args)

const stored = async (r: CallToolResult): Promise<Out> => {
	expect(r.isError, text(r)).toBeFalsy()
	return out(r)
}

const body = async (id: string): Promise<Dataset> =>
	(await (await fetch(`${server.base}/api/datasets/${encodeURIComponent(id)}`)).json()) as Dataset

const datasetCount = async () =>
	Object.keys((await (await fetch(`${server.base}/api/datasets?view=index`)).json()) as object).length

/** `call` is refused (its message matching `message`) and stores nothing. */
const refusedWithNothingStored = async (call: () => Promise<CallToolResult>, message?: RegExp) => {
	const before = await datasetCount()
	const r = await call()
	expect(r.isError, text(r)).toBe(true)
	if (message) expect(out(r).message).toMatch(message)
	expect(text(r)).not.toContain("—")
	expect(await datasetCount()).toBe(before)
	return out(r)
}

const file = (name: string, content: string | Uint8Array) => {
	const path = join(dir, name)
	writeFileSync(path, content)
	return path
}

/** The fixture: a BOM, a quoted header holding a comma, a quoted "1,204",
 *  a blank trailing line. */
const FIXTURE = '﻿"Region, area",Sales,Month\nEast,"1,204",2024-01-01\nWest,7,2024-02-01\n\n'

/** What the editor's upload makes of `content` as a file named `name`. */
const editorUpload = async (name: string, content: string) => {
	const upload = new File([content], name)
	const { fieldNames, rows } = await parseCsvFile(upload)
	return { fieldNames, rows, fields: inferFields(fieldNames, rows) }
}

describe("TST-16: rows, csv and path", () => {
	it("stores rows as sent", async () => {
		const ds = await stored(await create({ name: "Rows as sent", rows: [{ a: "x", b: 1.5, c: true, d: null }] }))
		const b = await body(ds.id)
		expect(b.versions[0].rows).toEqual([{ a: "x", b: "1.5", c: "true", d: "" }])
		expect(b.versions[0].filename).toBe("Rows from API")
	})

	it("stores csv text and a file by path exactly as the editor's upload parses them", async () => {
		const editor = await editorUpload("sales.csv", FIXTURE)
		expect(editor.fieldNames).toEqual(["Region, area", "Sales", "Month"])
		expect(editor.rows).toEqual([
			{ "Region, area": "East", Sales: "1,204", Month: "2024-01-01" },
			{ "Region, area": "West", Sales: "7", Month: "2024-02-01" },
		])
		const types = { "Region, area": "categorical", Sales: "quantitative", Month: "temporal" }

		const byCsv = await stored(await create({ name: "Sales by csv", csv: FIXTURE }))
		const path = file("sales.csv", FIXTURE)
		const byPath = await stored(await create({ path }))
		expect(byPath.name).toBe("sales")
		for (const ds of [byCsv, byPath]) {
			expect(ds).toMatchObject({ rowCount: 2, fields: types, reused: false })
			const b = await body(ds.id)
			expect(b.fields).toEqual(editor.fields)
			expect(b.versions[0].rows).toEqual(editor.rows)
		}
		expect((await body(byPath.id)).versions[0].filename).toBe("sales.csv")
		expect((await body(byCsv.id)).versions[0].filename).toBe("Pasted data")
	})

	it("parses .tsv as tab-separated and .txt as an upload", async () => {
		const tsv = await stored(await create({ path: file("tabs.TSV", "a,1\tb\nx,2\ty\n") }))
		expect(tsv.name).toBe("tabs")
		expect((await body(tsv.id)).versions[0].rows).toEqual([{ "a,1": "x,2", b: "y" }])
		const txt = await stored(await create({ path: file("plain.txt", "a;b\n1;2\n") }))
		expect((await body(txt.id)).versions[0].rows).toEqual([{ a: "1", b: "2" }])
	})

	it.skipIf(!posix)("follows a symlink to a regular file; the version takes the link's base name", async () => {
		const target = file("target.csv", "k,v\nA,1\n")
		const link = join(dir, "linked.csv")
		symlinkSync(target, link)
		const ds = await stored(await create({ path: link }))
		expect(ds).toMatchObject({ name: "linked", rowCount: 1 })
		expect((await body(ds.id)).versions[0].filename).toBe("linked.csv")
	})

	it("refuses each bad path with nothing stored", async () => {
		file("relative.csv", "a\n1\n")
		const cases: Array<[string, RegExp]> = [
			["relative.csv", /isn't a full path/],
			["./relative.csv", /isn't a full path/],
			[join(dir, "missing.csv"), /no file at/],
			["/dev/null", /isn't a \.csv, \.tsv or \.txt file/],
			[file("data.json", '{"a":1}'), /isn't a \.csv, \.tsv or \.txt file/],
			[file("config.env", "A=1\n"), /isn't a \.csv, \.tsv or \.txt file/],
			[file("header-only.csv", "a,b,c\n\n"), /header but no data rows/],
			[file("empty.csv", ""), /header but no data rows/],
		]
		mkdirSync(join(dir, "folder.csv"))
		cases.push([join(dir, "folder.csv"), /is a folder/])
		mkdirSync(join(dir, ".secret"))
		cases.push([file(join(".secret", "data.csv"), "a\n1\n"), /hidden part/])
		cases.push([file(".hidden.csv", "a\n1\n"), /hidden part/])
		cases.push(["/Users/someone/.ssh/id_rsa.csv", /hidden part/])
		cases.push([`${dir}/sub/../relative.csv`, /hidden part/])
		if (posix) {
			symlinkSync(join(dir, ".secret", "data.csv"), join(dir, "to-hidden.csv"))
			cases.push([join(dir, "to-hidden.csv"), /leads to .*hidden part/])
			symlinkSync(join(dir, "data.json"), join(dir, "to-json.csv"))
			cases.push([join(dir, "to-json.csv"), /leads to .*isn't a \.csv/])
			symlinkSync("/dev/null", join(dir, "to-null.csv"))
			cases.push([join(dir, "to-null.csv"), /leads to \/dev\/null/])
			execFileSync("mkfifo", [join(dir, "pipe.csv")])
			cases.push([join(dir, "pipe.csv"), /is a named pipe/])
		}
		for (const [path, message] of cases) await refusedWithNothingStored(() => create({ path }), message)
	})

	it.skipIf(!posix)("refuses a socket", async () => {
		const path = join(dir, "sock.csv")
		const sock: Server = createServer()
		await new Promise<void>((resolve) => sock.listen(path, resolve))
		try {
			await refusedWithNothingStored(() => create({ path }), /is a socket/)
		} finally {
			sock.close()
		}
	})

	it.skipIf(!posix || root)("refuses an unreadable file", async () => {
		const path = file("locked.csv", "a\n1\n")
		chmodSync(path, 0o000)
		try {
			await refusedWithNothingStored(() => create({ path }), /can't be read/)
		} finally {
			chmodSync(path, 0o644)
		}
	})

	it("refuses every pair of rows, csv and path, and none", async () => {
		const path = file("pair.csv", "a\n1\n")
		const rows = [{ a: 1 }]
		const csv = "a\n1\n"
		for (const args of [{ rows, csv }, { rows, path }, { csv, path }, { rows, csv, path }, {}])
			await refusedWithNothingStored(() => create({ name: "Pair", ...args }), /give exactly one of rows, csv or path/)
	})

	it("refuses a nested object or array cell with nothing stored", async () => {
		for (const cell of [{ deep: 1 }, [1, 2]]) {
			const r = await refusedWithNothingStored(() => create({ name: "Nested", rows: [{ a: 1 }, { a: cell }] }))
			expect(JSON.stringify(r)).toMatch(/cells must be text, numbers, booleans or null/)
		}
	})

	it("refuses rows that differ from expectedRows, saying how many arrived", async () => {
		const csv = "n\n" + Array.from({ length: 20 }, (_, i) => `${i}\n`).join("")
		const r = await refusedWithNothingStored(() => create({ name: "Twenty", csv, expectedRows: 20000 }))
		expect(r.message).toMatch(/20 rows arrived, not the 20,000 expected/)
		expect(r.message).toMatch(/Send every row .* or give the file's full path/)
		const path = file("twenty.csv", csv)
		await refusedWithNothingStored(() => create({ path, expectedRows: 19 }), /20 rows arrived/)
		await refusedWithNothingStored(
			() => create({ name: "Twenty", rows: [{ n: 1 }], expectedRows: 20 }),
			/1 rows arrived/
		)
	})

	it("stores when expectedRows matches, by rows, csv and path", async () => {
		const csv = "n\n" + Array.from({ length: 20 }, (_, i) => `${i}\n`).join("")
		const rows = Array.from({ length: 20 }, (_, i) => ({ n: i }))
		expect((await stored(await create({ name: "Twenty rows", rows, expectedRows: 20 }))).rowCount).toBe(20)
		expect((await stored(await create({ name: "Twenty csv", csv, expectedRows: 20 }))).rowCount).toBe(20)
		expect((await stored(await create({ path: file("twenty-ok.csv", csv), expectedRows: 20 }))).rowCount).toBe(20)
	})
})

describe("TST-17: bounded reads and limits", () => {
	it("refuses a sparse 101 MB file before reading it", async () => {
		const path = file("sparse.csv", "a\n1\n")
		truncateSync(path, 101 * 1024 * 1024)
		let read = false
		hooks = { afterCheck: () => void (read = true) }
		try {
			await refusedWithNothingStored(() => create({ path }), /101 MB, above the 100 MB limit/)
		} finally {
			hooks = {}
		}
		expect(read).toBe(false)
	})

	it("refuses csv text over 100 MB by its UTF-8 bytes", async () => {
		await refusedWithNothingStored(
			() => create({ name: "Huge", csv: "a\n" + "é".repeat(51 * 1024 * 1024) }),
			/above the 100 MB limit/
		)
	})

	it("limits the source, not the expanded rows: a 1,100-character header over 100,000 rows, by csv and path", async () => {
		const csv = "h".repeat(1100) + "\n" + "1\n".repeat(100_000)
		const byCsv = await stored(await create({ name: "Long header", csv, expectedRows: 100_000 }))
		const byPath = await stored(await create({ path: file("long-header.csv", csv), expectedRows: 100_000 }))
		for (const ds of [byCsv, byPath]) expect(ds.rowCount).toBe(100_000)
	}, 60_000)

	it("refuses a file that grows past its checked size after the check", async () => {
		const path = file("grows.csv", "a\n1\n")
		hooks = { afterOpen: () => truncateSync(path, 101 * 1024 * 1024) }
		try {
			await refusedWithNothingStored(() => create({ path }), /changed while it was being read/)
		} finally {
			hooks = {}
		}
		writeFileSync(path, "a\n1\n")
		hooks = { afterOpen: () => writeFileSync(path, "a\n1\n2\n3\n", { flag: "a" }) }
		try {
			await refusedWithNothingStored(() => create({ path }), /changed while it was being read/)
		} finally {
			hooks = {}
		}
	})

	it.skipIf(!posix)("returns promptly when a link is retargeted, or its file replaced, by a named pipe after the check", async () => {
		const target = file("before-pipe.csv", "a\n1\n")
		const link = join(dir, "retargeted.csv")
		symlinkSync(target, link)
		const fifo = join(dir, "after.csv")
		execFileSync("mkfifo", [fifo])
		hooks = {
			afterCheck: () => {
				unlinkSync(link)
				symlinkSync(fifo, link)
			},
		}
		const started = Date.now()
		try {
			await refusedWithNothingStored(() => create({ path: link }), /changed while it was being read/)
			hooks = {
				afterCheck: () => {
					unlinkSync(target)
					execFileSync("mkfifo", [target])
				},
			}
			await refusedWithNothingStored(() => create({ path: target }), /changed while it was being read/)
		} finally {
			hooks = {}
		}
		expect(Date.now() - started).toBeLessThan(5_000)
	})

	it("refuses a 16 MB file of 8 million one-value rows naming the row limit, and answers the next call", async () => {
		const path = file("eight-million.csv", "v\n" + "1\n".repeat(8_000_000))
		expect(readFileSync(path).byteLength).toBe(16_000_002)
		await refusedWithNothingStored(() => create({ path }), /more than 1,000,000 rows, the limit for one data set/)
		await stored(await create({ name: "Next call", rows: [{ ok: 1 }] }))
	}, 60_000)

	it("refuses csv text of 1,000,001 rows and of 10,000,001 cells", async () => {
		await refusedWithNothingStored(
			() => create({ name: "Too many rows", csv: "v\n" + "1\n".repeat(1_000_001) }),
			/more than 1,000,000 rows/
		)
		// 11 columns × 909,091 rows = 10,000,001 cells.
		const header = Array.from({ length: 11 }, (_, i) => `c${i}`).join(",")
		await refusedWithNothingStored(
			() => create({ name: "Too many cells", csv: header + "\n" + "1,1,1,1,1,1,1,1,1,1,1\n".repeat(909_091) }),
			/more than 10,000,000 cells/
		)
		await refusedWithNothingStored(
			() => create({ name: "Too many", rows: Array.from({ length: 1_000_001 }, () => ({ v: 1 })) }),
			/more than 1,000,000/
		)
	}, 60_000)

	it("stores 1,000,000 rows of 10 columns", async () => {
		const header = Array.from({ length: 10 }, (_, i) => `c${i}`).join(",")
		const lines = [header]
		for (let i = 0; i < 1_000_000; i++) lines.push(`${i},${i % 7},a${i % 13},${i % 100},x,${i},1,2,3,${i % 2}`)
		const path = file("million.csv", lines.join("\n") + "\n")
		const ds = await stored(await create({ path, expectedRows: 1_000_000 }))
		expect(ds).toMatchObject({ rowCount: 1_000_000, reused: false })
		expect(Object.keys(ds.fields)).toHaveLength(10)
	}, 120_000)
})

describe("TST-18: header order and reuse", () => {
	it("keeps the header's order by path", async () => {
		const ds = await stored(await create({ path: file("years.csv", "2024,2023,Region\n5,4,East\n") }))
		expect((await body(ds.id)).fields.map((f) => f.name)).toEqual(["2024", "2023", "Region"])
	})

	it("returns the data set the editor's upload stored for the same file under the same name, storing nothing", async () => {
		const content = "﻿City,Visits\nOslo,\"1,204\"\nRome,3\n"
		const path = file("visits.csv", content)
		const { rows, fields } = await editorUpload("visits.csv", content)
		// The editor's upload: its record, written through the same triplet
		// its storage adapter uses.
		const record = newDatasetRecord("visits", "visits.csv", fields, rows)
		await createApi(server.base).putDataset(record)
		const before = await datasetCount()
		const ds = await stored(await create({ path }))
		expect(ds).toMatchObject({ id: record.id, name: "visits", reused: true })
		expect(await datasetCount()).toBe(before)
	})

	it("reuses identical rows under one name, and identical csv", async () => {
		const rows = [{ a: 1, b: "x" }]
		const first = await stored(await create({ name: "Twice", rows }))
		const before = await datasetCount()
		expect(await stored(await create({ name: "Twice", rows }))).toMatchObject({ id: first.id, reused: true })
		const csvFirst = await stored(await create({ name: "Twice csv", csv: "a,b\n1,x\n" }))
		expect(await stored(await create({ name: "Twice csv", csv: "a,b\n1,x\n" }))).toMatchObject({
			id: csvFirst.id,
			reused: true,
		})
		expect(await datasetCount()).toBe(before + 1)
	})
})
