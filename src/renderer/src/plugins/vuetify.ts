import { createVuetify, ThemeDefinition } from 'vuetify'
import 'vuetify/styles'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import { en } from 'vuetify/locale'
import { h, type Component } from 'vue'
import type { IconSet, IconProps } from 'vuetify'
import DnaIcon from '../components/icons/DnaIcon.vue'
import { resolveInitialThemeName } from '../utils/theme-preference'

// Custom icon set registration
const customSvgNameToComponent: Record<string, Component> = {
  'varlens-dna': DnaIcon
}

const custom: IconSet = {
  component: (props: IconProps) =>
    h(props.tag, [
      h(
        customSvgNameToComponent[props.icon as string] !== undefined
          ? customSvgNameToComponent[props.icon as string]
          : 'span',
        {
          class: 'v-icon__svg',
          style: {
            width: '1em',
            height: '1em'
          }
        }
      )
    ])
}

// "Clinical Slate" light theme — WCAG 2.1 AA+ compliant
// Slate-navy primary inspired by NCBI/ClinVar/Broad Institute design language.
// All semantic colors achieve >= 4.5:1 contrast on surface for normal text.
// Cool-toned surfaces with subtle blue tint for a clinical, professional feel.
const warmLight: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#1E3A5F', // Slate navy → 11.1:1 on surface (AAA)
    secondary: '#455A64', // Blue-grey → 7.0:1 on surface (AAA)
    surface: '#FAFBFD',
    'surface-variant': '#ECF0F4',
    'surface-bright': '#FFFFFF',
    background: '#F0F4F8',
    error: '#B71C1C', // Deep red → 6.3:1 on surface (AA)
    info: '#1565C0', // Blue → 5.5:1 on surface (AA)
    success: '#1B5E20', // Dark green → 7.6:1 on surface (AAA)
    warning: '#BF360C', // Deep orange → 5.4:1 on surface (AA)
    'on-primary': '#FFFFFF', // 11.5:1 on primary (AAA)
    'on-secondary': '#FFFFFF',
    'on-surface': '#1A1D23', // 16.3:1 on surface (AAA)
    'on-background': '#1A1D23',
    'on-error': '#FFFFFF',
    'on-info': '#FFFFFF',
    'on-success': '#FFFFFF',
    'on-warning': '#FFFFFF',
    // Secondary/placeholder text. Replaces Material grey (#9E9E9E, 2.6:1) —
    // 5.8:1 on surface, 5.5:1 on background, 5.2:1 on grey-lighten-3 (AA).
    muted: '#5C6370',
    // Filled star (amber). Material amber is 1.6:1 on surface; this keeps the
    // hue at 4.1:1 so the starred state meets 3:1 non-text contrast (1.4.11).
    star: '#B26A00'
  },
  variables: {
    // Vuetify's light default (0.60) renders on-surface at 4.4:1 — just under AA.
    'medium-emphasis-opacity': 0.7
  }
}

// "Clinical Slate" dark theme — WCAG 2.1 AA+ compliant
// Lightened variants of the slate palette for dark surfaces.
const warmDark: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#7BAED4', // Light slate blue → 7.1:1 on surface (AAA)
    secondary: '#90A4AE', // Light blue-grey → 6.5:1 on surface (AA)
    surface: '#1A1D22',
    'surface-variant': '#252A32',
    'surface-bright': '#30353E',
    background: '#12141A',
    error: '#EF9A9A', // Light red → 7.9:1 on surface (AAA)
    info: '#64B5F6', // Light blue → 7.6:1 on surface (AAA)
    success: '#A5D6A7', // Light green → 10.3:1 on surface (AAA)
    warning: '#FFB74D', // Light orange → 9.8:1 on surface (AAA)
    'on-primary': '#12141A',
    'on-secondary': '#12141A',
    'on-surface': '#E4E7EC', // 13.6:1 on surface (AAA)
    'on-background': '#E4E7EC',
    'on-error': '#12141A',
    'on-info': '#12141A',
    'on-success': '#12141A',
    'on-warning': '#12141A',
    muted: '#A0A8B4', // 7.0:1 on surface (AA)
    star: '#FFC107' // 10.4:1 on surface
  }
}

export default createVuetify({
  theme: {
    // Resolved from the stored preference + prefers-color-scheme before mount,
    // so dark-OS users don't get a light flash after the (dark) login page.
    defaultTheme: resolveInitialThemeName(),
    themes: {
      warmLight,
      warmDark
    }
  },
  locale: {
    // Footer label of the "Auto (fit)" page size (composables/useAutoPageSize.ts)
    messages: { en: { ...en, dataFooter: { ...en.dataFooter, itemsPerPageAuto: 'Auto (fit)' } } }
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
      custom
    }
  },
  defaults: {
    global: {
      density: 'compact',
      ripple: false
    },
    // Buttons keep compact density for toolbar rhythm; a11y.css floors the
    // x-small/small sizes so they never collapse below the 24px WCAG 2.5.8 target.
    VBtn: {
      density: 'compact',
      ripple: false
    },
    VTextField: {
      density: 'compact',
      variant: 'outlined'
    },
    VSelect: {
      density: 'compact',
      variant: 'outlined',
      transition: 'fade-transition'
    },
    VAutocomplete: {
      density: 'compact',
      variant: 'outlined',
      transition: 'fade-transition'
    },
    VDataTable: {
      density: 'compact'
    },
    VCard: {
      elevation: 1
    },
    VCardTitle: {
      class: 'text-subtitle-1 font-weight-medium'
    },
    VDialog: {
      eager: false
    },
    VList: {
      density: 'compact'
    },
    VListItem: {
      density: 'compact'
    },
    VListSubheader: {
      class: 'text-overline font-weight-bold'
    },
    VMenu: {
      transition: 'fade-transition',
      openDelay: 0,
      closeDelay: 0
    },
    VExpansionPanel: {
      elevation: 0
    },
    VTooltip: {
      // Vuetify 4 defaults tooltips to eager, which renders a hidden, empty
      // role="tooltip" node per instance (hundreds in the variant table).
      eager: false,
      openDelay: 400,
      closeDelay: 0,
      transition: 'fade-transition',
      contentClass: 'bg-secondary'
    },
    VNavigationDrawer: {
      disableResizeWatcher: true
    },
    VSnackbar: {
      transition: 'fade-transition'
    }
  }
})
