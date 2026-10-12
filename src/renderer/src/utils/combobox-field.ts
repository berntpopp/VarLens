import type { VNode } from 'vue'

/**
 * `@vue:mounted` handler for a `v-text-field role="combobox"`. Vuetify 4.2
 * copies `role` onto the `.v-field` wrapper too: a second combobox without
 * aria-expanded (axe aria-required-attr, critical). Drop it there; the input
 * keeps the role and its ARIA state.
 * ponytail: patches Vuetify's DOM once at mount; remove when Vuetify stops
 * forwarding `role` to VField.
 */
export function dropFieldRole(vnode: VNode): void {
  ;(vnode.el as HTMLElement | null)?.querySelector('.v-field')?.removeAttribute('role')
}
