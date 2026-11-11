/** The Zafiro MCP server over an API client and a renderer: instructions,
 *  the nine model tools, and the chart card (an MCP App view) with its own
 *  tool, chart_picture, listed only to a client that announced MCP Apps.
 *  main.ts connects it to stdio; the tests to an in-memory client. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { version } from "../../package.json"
import type { Api } from "./api"
import { CARD_HTML } from "./card"
import { SERVER_INSTRUCTIONS } from "./guide"
import { announcesCards, CARD_MIME, CARD_URI, type PictureStore } from "./pictures"
import type { Renderer } from "./render"
import { createHandlers, registerTools } from "./tools"

export type ZafiroServerDeps = {
	renderer: Renderer
	/** Shared across connections when one process serves several. */
	pictures?: PictureStore
}

export const createZafiroServer = (api: Api, { renderer, pictures }: ZafiroServerDeps): McpServer => {
	const server = new McpServer({ name: "zafiro", version }, { instructions: SERVER_INSTRUCTIONS })
	// The capabilities this connection's client sent with initialize (the
	// SDK keeps `extensions`); read per call, so nothing is fixed before
	// the handshake.
	const showsCards = () => announcesCards(server.server.getClientCapabilities())
	registerTools(server, createHandlers(api, { renderer, showsCards, pictures }), { showsCards })
	server.registerResource(
		"chart card",
		CARD_URI,
		{
			title: "Zafiro chart",
			description: "A chart's picture, name and editor link, drawn beside each chart result.",
			mimeType: CARD_MIME,
		},
		async () => ({ contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: CARD_HTML }] })
	)
	return server
}
