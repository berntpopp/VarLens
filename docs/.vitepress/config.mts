import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'VarLens',
  description: 'Offline genetic variant analysis for research collaborators',
  base: '/VarLens/',

  appearance: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  sitemap: {
    hostname: 'https://berntpopp.github.io/VarLens/'
  },

  head: [
    ['link', { rel: 'icon', href: '/VarLens/logo.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'VarLens Documentation' }],
    ['meta', { property: 'og:description', content: 'Offline genetic variant analysis for research collaborators' }],
    ['meta', { name: 'twitter:card', content: 'summary' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Features', link: '/features/variant-table' },
      { text: 'Reference', link: '/reference/supported-formats' },
      { text: 'About', link: '/about/overview' },
      {
        text: 'Download',
        link: 'https://github.com/berntpopp/VarLens/releases/latest',
        target: '_blank'
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'App Layout', link: '/guide/app-layout' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Importing Data', link: '/guide/importing-data' }
          ]
        }
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Variant Table', link: '/features/variant-table' },
            { text: 'Filtering', link: '/features/filtering' },
            { text: 'Filter Presets', link: '/features/filter-presets' },
            { text: 'Variant Details', link: '/features/variant-details' },
            { text: 'Annotations', link: '/features/annotations' },
            { text: 'Cohort Analysis', link: '/features/cohort-analysis' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Supported Formats', link: '/reference/supported-formats' },
            { text: 'Keyboard Shortcuts', link: '/reference/keyboard-shortcuts' },
            { text: 'FAQ', link: '/reference/faq' }
          ]
        }
      ],
      '/about/': [
        {
          text: 'About',
          items: [
            { text: 'Overview', link: '/about/overview' },
            { text: 'Citation', link: '/about/citation' },
            { text: 'Changelog', link: '/about/changelog' },
            { text: 'Contributing', link: '/about/contributing' }
          ]
        }
      ]
    },

    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/berntpopp/VarLens' }
    ]
  }
})
