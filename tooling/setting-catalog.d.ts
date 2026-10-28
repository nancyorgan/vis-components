import type { Plugin } from "vite"
import type { SettingCatalog } from "../src/contexts/chartBuilder/lib/visualSpec/settingCatalog"

export function extractSettingCatalog(): SettingCatalog
export function settingCatalog(): Plugin
