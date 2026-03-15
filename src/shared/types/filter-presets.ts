/**
 * Filter preset types shared across main and renderer.
 *
 * Presets store a named combination of filter values that can be
 * toggled on/off in the toolbar preset bar. Each preset stores
 * filter state as structured JSON for programmatic application.
 */

import type { FilterState } from './filters'

/**
 * A saved filter preset as stored in the database.
 * Uses camelCase for TypeScript; database columns use snake_case.
 */
export interface FilterPreset {
  id: number
  name: string
  description: string | null
  /** Structured filter state (subset of FilterState) */
  filterJson: Partial<FilterState>
  /** Whether this is a built-in preset shipped with the app */
  isBuiltIn: boolean
  /** Whether this preset is visible in the preset bar */
  isVisible: boolean
  /** Sort order for display in the preset bar */
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Params for creating a new preset */
export interface FilterPresetCreate {
  name: string
  description?: string | null
  filterJson: Partial<FilterState>
  isVisible?: boolean
  sortOrder?: number
}

/** Params for updating an existing preset */
export interface FilterPresetUpdate {
  name?: string
  description?: string | null
  filterJson?: Partial<FilterState>
  isVisible?: boolean
  sortOrder?: number
}
