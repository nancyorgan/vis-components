// @vitest-environment node
// TST-0: the chart card (an MCP App view) run in happy-dom against a host
// stand-in that speaks the MCP Apps protocol and answers chart_picture from
// the real handler. TST-19: pictures on every write, with a fake renderer.
// And export_chart's wiring. All over MCP against the real self-host server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Window } from "happy-dom"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Visual } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import { APPS_EXTENSION, CARD_MIME, CARD_URI, PICTURE_SLICE, RESULT_LIMIT } from "./pictures"
import type { PictureOutcome } from "./render"
import { createZafiroServer } from "./server"
import { fakeRenderer, PIXEL_PNG, startTestServer, type FakeRenderer, type TestServer } from "./testServer"

const MODEL_TOOLS = [
	"create_chart",
	"create_dataset",
	"edit_chart",
	"export_chart",
	"get_chart",
	"list_charts",
	"list_datasets",
	"list_settings",
	"undo_chart_edit",
]

const PIXEL: PictureOutcome = { ok: true, picture: { data: PIXEL_PNG, mimeType: "image/png", width: 1, height: 1 } }

let server: TestServer
let renderer: FakeRenderer
/** What the fake renderer answers next; reset to the 1x1 PNG per test. */
let nextPicture: (id: string) => PictureOutcome | Promise<PictureOutcome> = () => PIXEL
let cards: Client
let plain: Client
let chartId: string

const connect = async (withCards: boolean): Promise<Client> => {
	const [a, b] = InMemoryTransport.createLinkedPair()
	await createZafiroServer(createApi(server.base), { renderer }).connect(a)
	const client = new Client(
		{ name: withCards ? "card-host" : "plain", version: "0" },
		withCards ? { capabilities: { extensions: { [APPS_EXTENSION]: { mimeTypes: [CARD_MIME] } } } } : {}
	)
	await client.connect(b)
	// A host lists tools before calling them (and the client then checks
	// structuredContent against each output schema).
	await client.listTools()
	return client
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
	(await client.callTool({ name, arguments: args })) as CallToolResult

const texts = (r: CallToolResult) => r.content.flatMap((b) => (b.type === "text" ? [b.text] : []))
const summary = (r: CallToolResult) => JSON.parse(texts(r)[0]) as Record<string, unknown>
const kinds = (r: CallToolResult) => r.content.map((b) => b.type)
const keyOf = (r: CallToolResult) => (r.structuredContent as { pictureKey?: string } | undefined)?.pictureKey

const storedVisuals = async () =>
	(await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]

beforeAll(async () => {
	server = await startTestServer()
	renderer = fakeRenderer({ picture: (id) => nextPicture(id) })
	cards = await connect(true)
	plain = await connect(false)
	const ds = await call(plain, "create_dataset", {
		name: "Drinks",
		rows: [
			{ Month: "Jan", Drink: "Tea", Sales: 3 },
			{ Month: "Feb", Drink: "Tea", Sales: 5 },
			{ Month: "Jan", Drink: "Coffee", Sales: 7 },
		],
	})
	expect(ds.isError).toBeFalsy()
	const chart = await call(plain, "create_chart", {
		dataset: "Drinks",
		encodings: { x: "Month", length: "Sales" },
		name: "Drink sales",
		title: "Sales by month",
	})
	chartId = summary(chart).id as string
})
beforeEach(() => {
	nextPicture = () => PIXEL
})
afterAll(async () => {
	await cards.close()
	await plain.close()
	server.close()
})

// ---------------------------------------------------------------------------
// A host stand-in for the card
// ---------------------------------------------------------------------------

type Message = { jsonrpc: "2.0"; id?: number; method?: string; params?: Record<string, unknown>; result?: unknown }

const waitFor = async <T>(probe: () => T | null | undefined | false, ms = 3000): Promise<T> => {
	const end = Date.now() + ms
	for (;;) {
		const value = probe()
		if (value) return value
		if (Date.now() > end) throw new Error("timed out waiting for the card")
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

type El = { textContent: string | null; hidden: boolean; click(): void; getAttribute(name: string): string | null }

/** Read the card's HTML over MCP and run it in happy-dom, with a host that
 *  answers the handshake, sends tool-input and tool-result only after the
 *  card's initialized notification (the result WITHOUT its image block, so
 *  the card must load the picture by key), and proxies tools/call to
 *  `client`. */
const showCard = async (client: Client, result: CallToolResult, hostContext: Record<string, unknown> = {}) => {
	const read = await client.readResource({ uri: CARD_URI })
	const html = (read.contents[0] as { text: string }).text
	const window = new Window({ url: "https://card.test/" })
	const fromCard: Message[] = []
	const problems: string[] = []
	const opened: string[] = []
	const modes: string[] = []
	let initialized = false
	const toCard = (data: unknown) =>
		setTimeout(() => window.dispatchEvent(new window.MessageEvent("message", { data })), 0)
	const handle = async (message: Message) => {
		fromCard.push(message)
		if (message.method === undefined) return
		if (!initialized && !message.method.startsWith("ui/initialize") && message.method !== "ui/notifications/initialized")
			problems.push(`${message.method} before initialized`)
		const reply = (value: unknown) => toCard({ jsonrpc: "2.0", id: message.id, result: value })
		switch (message.method) {
			case "ui/initialize":
				if (message.params?.protocolVersion !== "2026-01-26") problems.push("protocolVersion")
				return reply({
					protocolVersion: "2026-01-26",
					hostInfo: { name: "stand-in", version: "0" },
					hostCapabilities: { openLinks: {}, serverTools: {} },
					hostContext,
				})
			case "ui/notifications/initialized":
				initialized = true
				toCard({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } })
				toCard({
					jsonrpc: "2.0",
					method: "ui/notifications/tool-result",
					params: { ...result, content: result.content.filter((b) => b.type !== "image") },
				})
				return
			case "tools/call":
				return reply(await client.callTool(message.params as { name: string; arguments: Record<string, unknown> }))
			case "ui/open-link":
				opened.push(String(message.params?.url))
				return reply({})
			case "ui/request-display-mode":
				modes.push(String(message.params?.mode))
				return reply({ mode: message.params?.mode })
		}
	}
	Object.defineProperty(window, "parent", {
		value: { postMessage: (message: Message) => void handle(message) },
		configurable: true,
	})
	window.document.write(html)
	const el = (id: string) => window.document.getElementById(id) as unknown as El
	let hostIds = 1000
	/** A request from the host; answers the card's response. */
	const hostRequest = async (method: string) => {
		const id = ++hostIds
		toCard({ jsonrpc: "2.0", id, method, params: {} })
		return waitFor(() => fromCard.find((m) => m.id === id && m.method === undefined))
	}
	return {
		el,
		fromCard,
		problems,
		opened,
		modes,
		hostRequest,
		picture: () => el("picture").getAttribute("src"),
		close: () => window.happyDOM.close(),
	}
}

// ---------------------------------------------------------------------------
// TST-0: the card
// ---------------------------------------------------------------------------

describe("the chart card", () => {
	it("is one self-contained page, listed with the MCP Apps mime type; the four chart tools point at it", async () => {
		for (const client of [cards, plain]) {
			const { resources } = await client.listResources()
			expect(resources).toEqual([expect.objectContaining({ uri: CARD_URI, mimeType: CARD_MIME })])
		}
		const read = await cards.readResource({ uri: CARD_URI })
		const [content] = read.contents as Array<{ uri: string; mimeType: string; text: string }>
		expect(content).toMatchObject({ uri: CARD_URI, mimeType: CARD_MIME })
		expect(content.text).toMatch(/^<!doctype html>/i)
		expect(content.text).toMatch(/<style>[\s\S]+<\/style>/)
		expect(content.text).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(|https?:\/\//i)
		expect(content.text).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/)
		expect(content.text).not.toContain("\u2014")
		expect(content.text).toMatch(/color-scheme: light dark/)
		const { tools } = await cards.listTools()
		const withCard = tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri === CARD_URI)
		expect(withCard.map((t) => t.name).sort()).toEqual(["create_chart", "edit_chart", "get_chart", "undo_chart_edit"])
	})

	it("lists chart_picture (app-only) only to a client that announced MCP Apps; any other lists exactly the nine", async () => {
		const withCards = (await cards.listTools()).tools
		expect(withCards.map((t) => t.name).sort()).toEqual([...MODEL_TOOLS, "chart_picture"].sort())
		const picture = withCards.find((t) => t.name === "chart_picture")
		expect(picture?._meta).toEqual({ ui: { visibility: ["app"] } })
		expect(Object.keys(picture?.outputSchema?.properties ?? {}).sort()).toEqual(["data", "mimeType", "offset", "total"])
		expect((await plain.listTools()).tools.map((t) => t.name).sort()).toEqual(MODEL_TOOLS)
		const refused = await call(plain, "chart_picture", { picture_key: "x" })
		expect(refused.isError).toBe(true)
	})

	it("create_chart: handshake first, then the fetched picture, the name, Open in editor and Full screen", async () => {
		const result = await call(cards, "create_chart", {
			dataset: "Drinks",
			encodings: { x: "Month", length: "Sales" },
			name: "Card chart",
		})
		expect(kinds(result)).toEqual(["text", "image"])
		const { editorUrl } = summary(result)
		const card = await showCard(cards, result, {
			theme: "dark",
			displayMode: "inline",
			availableDisplayModes: ["inline", "fullscreen"],
			styles: { variables: { "--color-text-primary": "#fafafa" } },
		})
		await waitFor(() => card.picture())
		expect(card.picture()).toBe(`data:image/png;base64,${PIXEL_PNG}`)
		expect(card.el("name").textContent).toBe("Card chart")
		expect(card.el("open").hidden).toBe(false)
		expect(card.el("open").textContent).toBe("Open in editor")
		expect(card.el("full").hidden).toBe(false)
		expect(card.el("placeholder").hidden).toBe(true)
		expect(card.problems).toEqual([])
		const methods = card.fromCard.flatMap((m) => (m.method ? [m.method] : []))
		expect(methods.slice(0, 2)).toEqual(["ui/initialize", "ui/notifications/initialized"])
		expect(methods).toContain("tools/call")
		expect(methods).toContain("ui/notifications/size-changed")
		const fetches = card.fromCard.filter((m) => m.method === "tools/call")
		expect(fetches[0].params).toEqual({ name: "chart_picture", arguments: { picture_key: keyOf(result), offset: 0 } })

		card.el("open").click()
		await waitFor(() => card.opened.length > 0)
		expect(card.opened).toEqual([editorUrl])
		card.el("full").click()
		await waitFor(() => card.modes.length > 0)
		expect(card.modes).toEqual(["fullscreen"])
		await waitFor(() => card.el("full").textContent === "Exit full screen")

		expect((await card.hostRequest("ping")).result).toEqual({})
		expect((await card.hostRequest("ui/resource-teardown")).result).toEqual({})
		await card.close()
	})

	it("offers Full screen only when the host lists it", async () => {
		const result = await call(cards, "get_chart", { id: chartId })
		const card = await showCard(cards, result, { availableDisplayModes: ["inline"] })
		await waitFor(() => card.picture())
		expect(card.el("full").hidden).toBe(true)
		await card.close()
	})

	it("get_chart: name and editor link come from the text JSON; structuredContent holds only the pictureKey", async () => {
		const result = await call(cards, "get_chart", { id: chartId })
		expect(result.isError).toBeFalsy()
		expect(kinds(result)).toEqual(["text", "image"])
		expect(Object.keys(result.structuredContent ?? {})).toEqual(["pictureKey"])
		const card = await showCard(cards, result)
		await waitFor(() => card.picture())
		expect(card.el("name").textContent).toBe("Drink sales")
		card.el("open").click()
		await waitFor(() => card.opened.length > 0)
		expect(card.opened).toEqual([summary(result).editorUrl])
		await card.close()
	})

	it("a picture over the result limit: a card client gets no image block, a line saying so, and the key loads it in slices that reassemble exactly", async () => {
		const big = "QUJD".repeat(62_500)
		nextPicture = () => ({ ok: true, picture: { data: big, mimeType: "image/webp", width: 2000, height: 1200 } })
		const result = await call(cards, "edit_chart", { id: chartId, patch: { subtitle: "Big" } })
		expect(result.isError).toBeFalsy()
		expect(kinds(result)).toEqual(["text", "text"])
		expect(texts(result)[1]).toMatch(/person sees this chart in the card.*did not see it/)
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_LIMIT)
		const key = keyOf(result) as string
		expect(key).toEqual(expect.any(String))

		const parts: string[] = []
		for (let offset = 0; ; ) {
			const slice = await call(cards, "chart_picture", { picture_key: key, offset })
			const s = slice.structuredContent as { data: string; offset: number; total: number; mimeType: string }
			expect(s.data.length).toBeLessThanOrEqual(PICTURE_SLICE)
			expect(s).toMatchObject({ offset, total: big.length, mimeType: "image/webp" })
			expect(texts(slice)[0]).not.toContain(s.data.slice(0, 50))
			parts.push(s.data)
			offset += s.data.length
			if (offset >= s.total) break
		}
		expect(parts).toHaveLength(3)
		expect(parts.join("")).toBe(big)

		const card = await showCard(cards, result)
		await waitFor(() => card.picture())
		expect(card.picture()).toBe(`data:image/webp;base64,${big}`)
		expect(card.fromCard.filter((m) => m.method === "tools/call")).toHaveLength(3)
		await card.close()

		const keep = await call(plain, "get_chart", { id: chartId })
		expect(kinds(keep)).toEqual(["text", "image"])
		expect(texts(keep).join(" ")).not.toMatch(/sees this chart in the card/)
	})

	it("an unknown or dropped picture key is refused with a line saying to show the chart again", async () => {
		const result = await call(cards, "chart_picture", { picture_key: "nope" })
		expect(result.isError).toBe(true)
		expect(texts(result)[0]).toMatch(/Show the chart again/)
	})

	it("get_chart with settings past the limit sends the slices that fit, names the rest, and slice returns one in full", async () => {
		const api = createApi(server.base)
		const stored = (await api.visual(chartId)) as Visual
		const caption = { text: "c".repeat(150_000) }
		await api.putVisual({ ...stored, captionConfig: caption } as unknown as Visual)
		for (const client of [cards, plain]) {
			const read = await call(client, "get_chart", { id: chartId })
			expect(read.isError).toBeFalsy()
			expect(JSON.stringify(read).length).toBeLessThanOrEqual(RESULT_LIMIT)
			const out = summary(read)
			expect(out.settingsLeftOut).toEqual(["captionConfig"])
			expect(Object.keys(out.settings as object)).toContain("channelConfigs")
			expect(out.note).toMatch(/slice/)
		}
		const one = await call(plain, "get_chart", { id: chartId, slice: "captionConfig", picture: false })
		expect(one.isError).toBeFalsy()
		expect((summary(one).settings as Record<string, unknown>).captionConfig).toEqual(caption)
		expect(summary(one).editorUrl).toEqual(expect.any(String))
		const bad = await call(plain, "get_chart", { id: chartId, slice: "nope", picture: false })
		expect(bad.isError).toBe(true)
		expect(texts(bad)[0]).toMatch(/not a settings slice. Give one of: accessibilityConfig/)
		await api.putVisual(stored)
	})

	it("a refusal: the card shows its first line, and Open in editor still opens the chart", async () => {
		const result = await call(cards, "edit_chart", { id: chartId, patch: { encodings: { y: "Nope" } } })
		expect(result.isError).toBe(true)
		expect(kinds(result)).toEqual(["text"])
		const card = await showCard(cards, result)
		await waitFor(() => !card.el("line").hidden)
		expect(card.el("line").textContent).toBe(summary(result).message)
		expect(card.el("name").textContent).toBe("Drink sales")
		card.el("open").click()
		await waitFor(() => card.opened.length > 0)
		expect(card.opened[0]).toMatch(new RegExp(`/editor/${chartId}$`))
		await card.close()
	})

	it("no picture: the card shows the result's no-picture line and the editor link", async () => {
		nextPicture = () => ({ ok: false, reason: "No Chrome or Edge was found" })
		const result = await call(cards, "get_chart", { id: chartId })
		const card = await showCard(cards, result)
		await waitFor(() => !card.el("line").hidden)
		expect(card.el("line").textContent).toBe(texts(result)[1])
		expect(card.el("open").hidden).toBe(false)
		expect(card.picture()).toBeNull()
		await card.close()
	})
})

// ---------------------------------------------------------------------------
// TST-19: pictures on every write
// ---------------------------------------------------------------------------

describe("pictures on every write", () => {
	it("create, edit and undo each return the summary, then the picture, taken after the save landed", async () => {
		const seenTitles: string[] = []
		nextPicture = async (id) => {
			seenTitles.push((await createApi(server.base).visual(id))?.labelsConfig?.title ?? "(none)")
			return PIXEL
		}
		const created = await call(plain, "create_chart", {
			dataset: "Drinks",
			encodings: { x: "Month", length: "Sales" },
			title: "First",
		})
		const id = summary(created).id as string
		const edited = await call(plain, "edit_chart", { id, patch: { title: "Second" } })
		const undone = await call(plain, "undo_chart_edit", { id })
		for (const r of [created, edited, undone]) {
			expect(r.isError).toBeFalsy()
			expect(kinds(r)).toEqual(["text", "image"])
			expect(r.content[1]).toEqual({ type: "image", data: PIXEL_PNG, mimeType: "image/png" })
			expect(r.structuredContent).toEqual({ ...summary(r), pictureKey: expect.any(String) })
		}
		expect(seenTitles).toEqual(["First", "Second", "First"])
	})

	it("a write sent picture: false is not refused and still returns its picture", async () => {
		const created = await call(plain, "create_chart", {
			dataset: "Drinks",
			encodings: { x: "Month", length: "Sales" },
			picture: false,
		})
		expect(created.isError, texts(created)[0]).toBeFalsy()
		expect(kinds(created)).toEqual(["text", "image"])
		const id = summary(created).id as string
		const edited = await call(plain, "edit_chart", { id, picture: false, patch: { subtitle: "Still" } })
		expect(edited.isError, texts(edited)[0]).toBeFalsy()
		expect(kinds(edited)).toEqual(["text", "image"])
	})

	it("a picture failure never fails the write: the full summary, then why, that it's saved, and the editor link", async () => {
		nextPicture = () => ({ ok: false, reason: "The page didn't finish drawing in 20 seconds." })
		const before = (await storedVisuals()).length
		const created = await call(plain, "create_chart", {
			dataset: "Drinks",
			encodings: { x: "Month", length: "Sales" },
			name: "No picture",
		})
		expect(created.isError).toBeFalsy()
		expect((await storedVisuals()).length).toBe(before + 1)
		expect(kinds(created)).toEqual(["text", "text"])
		const out = summary(created)
		expect(Object.keys(out).sort()).toEqual(["editorUrl", "embedUrl", "id", "name", "revision", "warnings"])
		expect(created.structuredContent).toEqual(out)
		expect(texts(created)[1]).toBe(
			`No picture this time (The page didn't finish drawing in 20 seconds). The chart is saved; the editor link opens it: ${out.editorUrl}`
		)

		nextPicture = () => ({ ok: false, reason: "too big", tooLarge: true })
		const large = await call(plain, "edit_chart", { id: out.id, patch: { subtitle: "x" } })
		expect(texts(large)[1]).toBe(`The picture was too large to send. The chart is saved; open it in the editor: ${out.editorUrl}`)

		nextPicture = () => {
			throw new Error("browser crashed")
		}
		const crashed = await call(plain, "undo_chart_edit", { id: out.id })
		expect(crashed.isError).toBeFalsy()
		expect(texts(crashed)[1]).toMatch(/^No picture this time \(browser crashed\)\. The chart is saved/)
	})

	it("a picture showing part of the plot says how much", async () => {
		nextPicture = () => ({ ok: true, picture: { data: PIXEL_PNG, mimeType: "image/png", width: 1, height: 1, shownShare: 0.62 } })
		const read = await call(plain, "get_chart", { id: chartId })
		expect(kinds(read)).toEqual(["text", "image", "text"])
		expect(texts(read)[1]).toMatch(/^The picture shows 62% of the plot; the editor shows all of it: https:\/\//)
	})

	it("a refused write, get_chart picture: false and a missing chart never call the renderer", async () => {
		const before = renderer.pictured.length
		const refused = await call(plain, "edit_chart", { id: chartId, patch: { encodings: { y: "Nope" } } })
		expect(refused.isError).toBe(true)
		expect(kinds(refused)).toEqual(["text"])
		const quiet = await call(plain, "get_chart", { id: chartId, picture: false })
		expect(quiet.isError).toBeFalsy()
		expect(kinds(quiet)).toEqual(["text"])
		expect(quiet.structuredContent).toBeUndefined()
		const missing = await call(plain, "get_chart", { id: "nope" })
		expect(missing.isError).toBe(true)
		expect(kinds(missing)).toEqual(["text"])
		const missingCreate = await call(plain, "create_chart", { dataset: "No such data", encodings: { x: "a" } })
		expect(missingCreate.isError).toBe(true)
		expect(renderer.pictured.length).toBe(before)
	})
})

// ---------------------------------------------------------------------------
// export_chart
// ---------------------------------------------------------------------------

describe("export_chart", () => {
	it("refuses path-like names before the renderer runs", async () => {
		const before = renderer.exported.length
		for (const fileName of ["../evil", "a/b", "C:\\Users\\x", "/etc/passwd"]) {
			const result = await call(plain, "export_chart", { id: chartId, format: "png", fileName })
			expect(result.isError, fileName).toBe(true)
			expect(texts(result)[0]).toMatch(/Give a plain file name/)
		}
		expect(renderer.exported.length).toBe(before)
	})

	it("names the file after the chart by default (a slash in the name is no folder) and returns the file", async () => {
		const result = await call(plain, "export_chart", { id: chartId, format: "pdf" })
		expect(result.isError).toBeFalsy()
		expect(result.structuredContent).toBeUndefined()
		expect(summary(result)).toEqual({
			path: "/exports/Drink sales.pdf",
			format: "pdf",
			bytes: 1234,
			width: 800,
			height: 500,
			pixelRatio: 1,
		})
		const slashed = await call(plain, "create_chart", {
			dataset: "Drinks",
			encodings: { x: "Month", length: "Sales" },
			name: "Q3 / sales",
		})
		const id = summary(slashed).id as string
		await call(plain, "export_chart", { id, format: "svg", width: 640, height: 400 })
		expect(renderer.exported.at(-1)).toEqual({
			id,
			req: { format: "svg", width: 640, height: 400, fileName: "Q3 sales" },
		})
		await call(plain, "export_chart", { id, format: "png", pixelRatio: 2, fileName: "Report" })
		expect(renderer.exported.at(-1)?.req).toEqual({ format: "png", pixelRatio: 2, fileName: "Report" })
	})

	it("a missing chart is refused before the renderer; a renderer failure is an error naming the reason", async () => {
		const before = renderer.exported.length
		const missing = await call(plain, "export_chart", { id: "nope", format: "png" })
		expect(missing.isError).toBe(true)
		expect(renderer.exported.length).toBe(before)

		const [a, b] = InMemoryTransport.createLinkedPair()
		const failing = fakeRenderer({ exportChart: async () => ({ ok: false, reason: "No Chrome or Edge was found." }) })
		await createZafiroServer(createApi(server.base), { renderer: failing }).connect(a)
		const client = new Client({ name: "x", version: "0" })
		await client.connect(b)
		const result = await call(client, "export_chart", { id: chartId, format: "jpeg" })
		expect(result.isError).toBe(true)
		expect(texts(result)[0]).toMatch(/No file was written: No Chrome or Edge was found\. Tell the person; .*\/editor\//)
		await client.close()
	})

	it("takes no folder", async () => {
		const tool = (await plain.listTools()).tools.find((t) => t.name === "export_chart")
		expect(Object.keys(tool?.inputSchema.properties ?? {}).some((k) => /folder|dir|path/i.test(k))).toBe(false)
		expect(tool?.outputSchema).toBeUndefined()
	})
})
