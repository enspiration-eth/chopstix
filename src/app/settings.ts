import { Schema } from 'effect'

export const QualityPref = Schema.Literals(['Auto', 'Low', 'Medium', 'High'])
export type QualityPref = typeof QualityPref.Type
export const QUALITY_PREFS: ReadonlyArray<QualityPref> = ['Auto', 'Low', 'Medium', 'High']

export const Settings = Schema.Struct({
  quality: QualityPref,
  swapNose: Schema.Boolean,
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = { quality: 'Auto', swapNose: false }

const KEY = 'chopstix.settings.v1'

/** Read saved settings, falling back field by field to the defaults for anything missing or invalid. */
export const loadSettings = (): Settings => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const quality = QUALITY_PREFS.find(q => q === o['quality']) ?? defaultSettings.quality
    const swapNose = typeof o['swapNose'] === 'boolean' ? o['swapNose'] : defaultSettings.swapNose
    return { quality, swapNose }
  } catch {
    return defaultSettings
  }
}

export const saveSettings = (s: Settings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

/** Tier index for the engine: null = adaptive. */
export const tierIndex = (q: QualityPref): number | null => (q === 'Auto' ? null : q === 'Low' ? 0 : q === 'Medium' ? 1 : 2)
