import type { Plugin } from "vite"
import type { SettingCatalog } from "../src/contexts/chartBuilder/lib/visualSpec/settingCatalog"

export const NOT_SETTINGS: Readonly<Record<string, string>>
export function extractSettingCatalog(): SettingCatalog
export function settingCatalog(): Plugin
