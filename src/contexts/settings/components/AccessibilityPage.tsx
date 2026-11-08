import { useAtom } from "jotai"

import {
	RadioGroup,
	type RadioGroupOption,
} from "../../../components/ui/RadioGroup"
import { type ContrastAlgorithm } from "../../chartBuilder/lib/accessibilityCheck"
import { contrastAlgorithmAtom } from "../../chartBuilder/store/atoms"

const Option = ({ name, note }: { name: string; note: string }) => (
	<>
		{name}
		<span className="vc-muted"> — {note}</span>
	</>
)

const MODEL_OPTIONS: ReadonlyArray<RadioGroupOption<ContrastAlgorithm>> = [
	{
		value: "apca",
		label: (
			<Option
				name="APCA (recommended)"
				note="perceptual lightness contrast (Lc), the model behind the draft WCAG 3. Judges light text on dark correctly, where the WCAG 2 ratio overstates contrast."
			/>
		),
	},
	{
		value: "wcag2",
		label: (
			<Option
				name="WCAG 2"
				note="the 4.5:1 and 3:1 luminance ratios of WCAG 2.x. Pick this when a WCAG 2 conformance level is what you report against."
			/>
		),
	},
]

/** What the check's two levels mean under each model — the lower one is
 *  the default. */
const LEVELS: Record<ContrastAlgorithm, string> = {
	apca:
		"The check's two levels are Lc 60 — APCA's minimum for content text; Lc 45 for large text (36px, or 24px bold) — and Lc 75 (Lc 60 large), the 15 Lc stricter level the guideline suggests where readability matters. APCA's font-size table is not applied beyond that; small text has its own rule.",
	wcag2:
		"The check's two levels are AA — 4.5:1; 3:1 for large text (18pt, or 14pt bold) — and AAA (7:1; 4.5:1 large).",
}

/** Settings → Accessibility: how the editor's accessibility check judges a
 *  chart. Preferences for this browser — nothing here is saved with a
 *  visual or changes how it draws. */
export const AccessibilityPage = () => {
	const [algorithm, setAlgorithm] = useAtom(contrastAlgorithmAtom)
	return (
		<div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
			<h1 className="mb-1 text-xl vc-heading">Accessibility</h1>
			<p className="mb-8 text-sm vc-muted">
				How the editor&apos;s accessibility check judges a chart. These are
				preferences for this browser: nothing here is saved with a visual or
				changes how it draws.
			</p>

			<div className="max-w-2xl rounded-lg border border-stone-200 p-5 dark:border-stone-700">
				<h2 className="mb-2 text-sm vc-heading" data-tip="contrast-model">
					Text contrast
				</h2>
				<RadioGroup
					legend="Measure text against its background with"
					align="start"
					value={algorithm}
					options={MODEL_OPTIONS}
					onChange={setAlgorithm}
				/>
				<p className="mt-3 text-xs vc-muted">{LEVELS[algorithm]}</p>
			</div>
		</div>
	)
}
