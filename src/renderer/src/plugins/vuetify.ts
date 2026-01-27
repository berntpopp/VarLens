import { createVuetify, ThemeDefinition } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { mdi } from 'vuetify/iconsets/mdi'
import { h, type Component } from 'vue'
import type { IconSet, IconProps } from 'vuetify'
import DnaIcon from '../components/icons/DnaIcon.vue'

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

// Warm light theme with RequiForm palette
const warmLight: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#a09588',
    secondary: '#424242',
    surface: '#faf8f6',
    'surface-variant': '#f5f2ef',
    'surface-bright': '#ffffff',
    background: '#fefdfb',
    error: '#c85a54',
    info: '#5b8a9f',
    success: '#6b9b6e',
    warning: '#d4a05e',
    'on-primary': '#ffffff',
    'on-secondary': '#ffffff',
    'on-surface': '#1c1b1f',
    'on-background': '#1c1b1f',
    'on-error': '#ffffff',
    'on-info': '#ffffff',
    'on-success': '#ffffff',
    'on-warning': '#000000'
  }
}

// Warm dark theme with warm-shifted colors
const warmDark: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#a09588',
    secondary: '#bdbdbd',
    surface: '#2a2724',
    'surface-variant': '#3a3632',
    'surface-bright': '#4a4540',
    background: '#1e1c1a',
    error: '#d47470',
    info: '#7ba8bb',
    success: '#87b58a',
    warning: '#ddb880',
    'on-primary': '#ffffff',
    'on-secondary': '#000000',
    'on-surface': '#e6e1e5',
    'on-background': '#e6e1e5',
    'on-error': '#000000',
    'on-info': '#000000',
    'on-success': '#000000',
    'on-warning': '#000000'
  }
}

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'warmLight',
    themes: {
      warmLight,
      warmDark
    }
  },
  icons: {
    defaultSet: 'mdi',
    sets: {
      mdi,
      custom
    }
  },
  defaults: {
    global: {
      density: 'compact'
    },
    VBtn: {
      density: 'compact'
    },
    VTextField: {
      density: 'compact',
      variant: 'outlined'
    },
    VSelect: {
      density: 'compact',
      variant: 'outlined'
    },
    VAutocomplete: {
      density: 'compact',
      variant: 'outlined'
    },
    VDataTable: {
      density: 'compact'
    },
    VCard: {
      elevation: 2
    },
    VTooltip: {
      contentClass: 'bg-secondary'
    }
  }
})
