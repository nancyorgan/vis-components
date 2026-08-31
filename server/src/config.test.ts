// @vitest-environment node
import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"

const VALID = {
	VIS_BASE_URL: "https://charts.example.com",
	VIS_DB_DIR: "/tmp/db",
	VIS_DATA_DIR: "/tmp/data",
	VIS_PORT: "8080",
	VIS_PUBLISH_DIR: "/tmp/publish",
	VIS_PUBLISH_BASE_URL: "https://embeds.example.com",
}

describe("loadConfig", () => {
	it("accepts a complete valid environment", () => {
		expect(loadConfig(VALID)).toEqual({
			baseUrl: "https://charts.example.com",
			dbDir: "/tmp/db",
			dataDir: "/tmp/data",
			port: 8080,
			publishDir: "/tmp/publish",
			publishBaseUrl: "https://embeds.example.com",
		})
	})

	it("strips trailing slashes from both base URLs", () => {
		const config = loadConfig({
			...VALID,
			VIS_BASE_URL: "http://host:9000/",
			VIS_PUBLISH_BASE_URL: "http://host:9001//",
		})
		expect(config.baseUrl).toBe("http://host:9000")
		expect(config.publishBaseUrl).toBe("http://host:9001")
	})

	it("reports every missing variable at once, fail-fast", () => {
		let message = ""
		try {
			loadConfig({})
		} catch (error) {
			message = (error as Error).message
		}
		for (const name of [
			"VIS_BASE_URL",
			"VIS_DB_DIR",
			"VIS_DATA_DIR",
			"VIS_PORT",
			"VIS_PUBLISH_DIR",
			"VIS_PUBLISH_BASE_URL",
		]) {
			expect(message).toContain(name)
		}
	})

	it("rejects a blank-but-present variable", () => {
		expect(() => loadConfig({ ...VALID, VIS_DATA_DIR: "  " })).toThrow(
			/VIS_DATA_DIR/
		)
		expect(() => loadConfig({ ...VALID, VIS_PUBLISH_DIR: "  " })).toThrow(
			/VIS_PUBLISH_DIR/
		)
	})

	it("rejects a non-integer or out-of-range port", () => {
		expect(() => loadConfig({ ...VALID, VIS_PORT: "abc" })).toThrow(/VIS_PORT/)
		expect(() => loadConfig({ ...VALID, VIS_PORT: "0" })).toThrow(/VIS_PORT/)
		expect(() => loadConfig({ ...VALID, VIS_PORT: "70000" })).toThrow(/VIS_PORT/)
	})

	it("rejects a relative or non-http URL, for either URL variable", () => {
		expect(() => loadConfig({ ...VALID, VIS_BASE_URL: "charts.local" })).toThrow(
			/VIS_BASE_URL/
		)
		expect(() => loadConfig({ ...VALID, VIS_BASE_URL: "ftp://x" })).toThrow(
			/VIS_BASE_URL/
		)
		expect(() =>
			loadConfig({ ...VALID, VIS_PUBLISH_BASE_URL: "embeds.local" })
		).toThrow(/VIS_PUBLISH_BASE_URL/)
		expect(() =>
			loadConfig({ ...VALID, VIS_PUBLISH_BASE_URL: "ftp://x" })
		).toThrow(/VIS_PUBLISH_BASE_URL/)
	})
})
