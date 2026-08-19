import { describe, expect, it } from "vitest"
import {
	DATASET_REJECT_BYTES as SERVER_REJECT_BYTES,
} from "../../../../server/src/limits"
import {
	DATASET_REJECT_BYTES,
	DATASET_WARN_BYTES,
	datasetSizeIssue,
} from "./datasetLimits"

describe("datasetSizeIssue", () => {
	it("passes small files silently", () => {
		expect(datasetSizeIssue(0)).toBeNull()
		expect(datasetSizeIssue(DATASET_WARN_BYTES)).toBeNull()
	})

	it("warns between the thresholds", () => {
		expect(datasetSizeIssue(DATASET_WARN_BYTES + 1)).toBe("warn")
		expect(datasetSizeIssue(DATASET_REJECT_BYTES)).toBe("warn")
	})

	it("rejects above the hard limit", () => {
		expect(datasetSizeIssue(DATASET_REJECT_BYTES + 1)).toBe("reject")
	})
})

describe("client/server threshold sync", () => {
	// The server enforces the hard limit independently (never trust the
	// client); this pins the two constants together so neither drifts.
	it("client and server agree on the hard limit", () => {
		expect(DATASET_REJECT_BYTES).toBe(SERVER_REJECT_BYTES)
	})
})
