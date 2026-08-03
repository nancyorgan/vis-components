import { describe, expect, it } from "vitest"

import { MODE_REGISTRY } from "../../lib/chartModes"
import { MODE_RENDERERS } from "./rendererRegistry"

describe("MODE_RENDERERS", () => {
	// The Record<ChartMode, ...> type already forces an entry per union
	// member at compile time; this pins the runtime seam — every id the
	// mode registry can actually resolve has a component bound, and the
	// binding map doesn't carry ids the registry no longer knows.
	it("binds a component for every registered mode id", () => {
		for (const mode of MODE_REGISTRY) {
			expect(
				MODE_RENDERERS[mode.id as keyof typeof MODE_RENDERERS],
				`no renderer bound for mode "${mode.id}"`,
			).toBeTypeOf("function")
		}
	})

	it("has no bindings for unregistered mode ids", () => {
		const registered = new Set(MODE_REGISTRY.map((m) => m.id))
		for (const id of Object.keys(MODE_RENDERERS)) {
			expect(registered.has(id), `stale renderer binding "${id}"`).toBe(true)
		}
	})
})
