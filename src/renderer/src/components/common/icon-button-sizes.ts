/**
 * Icon-only button sizes (CSS px). Every button is at least 24x24 so it meets
 * WCAG 2.5.8 Target Size (Minimum); icons follow the app's 16 / 20 / 24 scale.
 */
export type IconButtonSize = 'x-small' | 'small' | 'default'

export const ICON_BUTTON_SIZES: Record<IconButtonSize, { button: number; icon: number }> = {
  /** Dense rows and inline chips. */
  'x-small': { button: 24, icon: 16 },
  /** Toolbars, panel headers, filter bars (default). */
  small: { button: 32, icon: 20 },
  /** Primary app chrome. */
  default: { button: 40, icon: 24 }
}
