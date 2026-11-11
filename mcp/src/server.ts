/** The Zafiro MCP server over an API client: instructions and the eight
 *  tools. main.ts connects it to stdio; the tests to an in-memory client. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { version } from "../../package.json"
import type { Api } from "./api"
import { SERVER_INSTRUCTIONS } from "./guide"
import { createHandlers, registerTools } from "./tools"

export const createZafiroServer = (api: Api): McpServer => {
	const server = new McpServer({ name: "zafiro", version }, { instructions: SERVER_INSTRUCTIONS })
	registerTools(server, createHandlers(api))
	return server
}
