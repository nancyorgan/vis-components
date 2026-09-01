import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import {
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentMapConfigAtom,
	currentReshapeConfigAtom,
	currentTooltipConfigAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	saveStatusAtom,
} from "./atoms"
import { useSaveVisual } from "./saveVisual"

const DEBOUNCE_MS = 800

/**
 * Debounced auto-save for the editor. Watches every piece of editor state and
 * persists to the current visual (creating one the first time if none exists).
 * When a new visual is created by auto-save, the router is updated so a page
 * refresh hydrates back to the correct `/editor/$visualId` route.
 *
 * Gated on `currentDatasetIdAtom` — we won't create empty visuals just because
 * the editor mounted.
 */
export const useAutoSave = () => {
	const saveVisual = useSaveVisual()
	const navigate = useNavigate()
	const setStatus = useSetAtom(saveStatusAtom)

	const datasetId = useAtomValue(currentDatasetIdAtom)
	const visualId = useAtomValue(currentVisualIdAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const legend = useAtomValue(currentLegendConfigAtom)
	const tooltip = useAtomValue(currentTooltipConfigAtom)
	const dataLabelsEncodings = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataLabelsConfig = useAtomValue(currentDataLabelsConfigAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const name = useAtomValue(currentVisualNameAtom)
	const annotations = useAtomValue(currentAnnotationsAtom)
	const caption = useAtomValue(currentCaptionConfigAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const reshapeConfig = useAtomValue(currentReshapeConfigAtom)
	const derivedVariablesConfig = useAtomValue(currentDerivedVariablesAtom)

	// Skip the very first effect run — that's just the initial hydration
	// after a visual load; nothing has changed.
	const hydratedRef = useRef(false)

	useEffect(() => {
		if (!hydratedRef.current) {
			hydratedRef.current = true
			return
		}
		if (!datasetId) return
		setStatus("saving")
		const timer = setTimeout(async () => {
			const wasNew = !visualId
			const id = await saveVisual()
			if (wasNew) {
				await navigate({ to: "/editor/$visualId", params: { visualId: id } })
			}
		}, DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [
		datasetId,
		visualId,
		encodings,
		configs,
		labels,
		legend,
		tooltip,
		dataLabelsEncodings,
		dataLabelsConfig,
		overrides,
		name,
		annotations,
		caption,
		mapConfig,
		reshapeConfig,
		derivedVariablesConfig,
		saveVisual,
		navigate,
		setStatus,
	])
}
