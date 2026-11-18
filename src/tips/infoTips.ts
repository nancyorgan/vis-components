import { atom } from "jotai"

/** The header's Info tips toggle has three settings:
 *  - "paced" — the default: helper tips show one moment at a time, as
 *    their time comes (tips.ts explains the pacing).
 *  - "all" — every helper bubble for the current view shows at once
 *    (TipBoard), and the paced tips wait.
 *  - "off" — no helper bubbles at all.
 *  Device-local and kept across sessions (`infoTipsModeAtom`). */
export type InfoTipsMode = "paced" | "all" | "off"

export const INFO_TIPS_MODES: readonly InfoTipsMode[] = ["paced", "all", "off"]

/** Which way the toggle went last from "paced". In memory only; a new
 *  page starts as if the last trip was to "off", so the first click from
 *  "paced" shows all the tips. */
export const infoTipsLastTripAtom = atom<"all" | "off">("off")

/** Click order: paced → all → paced → off → paced → all → …  From
 *  "paced" a click goes to whichever of "all" / "off" it didn't visit
 *  last; from either of those it comes back to "paced". */
export const nextInfoTipsMode = (
	mode: InfoTipsMode,
	lastTrip: "all" | "off"
): InfoTipsMode => {
	if (mode !== "paced") return "paced"
	return lastTrip === "all" ? "off" : "all"
}

/** Marks the header toggle; the board keeps the header clear of bubbles. */
export const INFO_TIPS_TOGGLE_ATTR = "data-info-tips-toggle"
