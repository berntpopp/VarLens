# Phase 1: Foundation - Research

**Researched:** 2026-01-26
**Domain:** Electron + Vue 3 desktop application development with TypeScript
**Confidence:** HIGH

## Summary

Phase 1 establishes a modern Electron desktop application using electron-vite 5.0 as the build tool, Vue 3 + Vuetify 3 for the UI framework, TypeScript with strict mode, and better-sqlite3 for native database access. The standard approach uses electron-vite's official Vue template, adds Vuetify through vite-plugin-vuetify for automatic tree-shaking, configures ESLint with flat config for strict linting, sets up Vitest with happy-dom for testing, and uses @electron/rebuild to handle native module compilation.

The critical insight is that native modules like better-sqlite3 require special handling: they must be marked as external in Vite's rollup config, rebuilt with @electron/rebuild for Electron's Node.js version, and unpacked from ASAR archives during packaging. Security is paramount - context isolation must be enabled, nodeIntegration disabled, and preload scripts properly sandboxed.

**Primary recommendation:** Use electron-vite's official scaffolding, follow the recommended project structure with separate main/preload/renderer directories, configure native modules as external dependencies, and enforce strict TypeScript + ESLint rules from the start to prevent type safety issues from accumulating.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron-vite | 5.0.0+ | Build tool | Official Vite integration for Electron, optimized defaults for main/preload/renderer |
| Electron | 28+ | Desktop framework | Cross-platform desktop apps with web technologies, ESM support from v28 |
| Vue | 3.x | Renderer UI framework | Composition API, better TypeScript support, smaller bundle size |
| Vuetify | 3.11.6+ | Material Design components | Complete component library, Vue 3 native, responsive grid system |
| TypeScript | 5.x | Type safety | Static typing, strict null checks, better tooling support |
| better-sqlite3 | 12.6.2+ | SQLite database | Synchronous API (main process safe), fastest SQLite binding, actively maintained |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @electron/rebuild | 3.6.0+ | Native module rebuilding | Required for better-sqlite3 and any native Node.js modules |
| vite-plugin-vuetify | 2.1.2+ | Vuetify tree-shaking | Automatic component imports, reduces bundle size |
| ESLint | 9.x | Code linting | Flat config support, TypeScript rules, Vue template linting |
| @vue/eslint-config-typescript | Latest | Vue + TS linting | Official Vue TypeScript ESLint config |
| eslint-plugin-prettier | Latest | Formatting integration | Prettier rules as ESLint errors |
| Vitest | Latest | Unit testing | Vite-native, fast, Vue component testing support |
| happy-dom | Latest | DOM environment | Faster than jsdom, sufficient for most UI tests |
| electron-builder | Latest | Application packaging | Cross-platform packaging, auto-update support, code signing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-vite | Electron Forge + Vite plugin | More boilerplate, less Electron-specific optimization |
| Vuetify 3 | Quasar, Element Plus | Vuetify has most mature Vue 3 support, largest component library |
| better-sqlite3 | sql.js (WASM) | sql.js is slower but pure JS (no native rebuild needed) |
| happy-dom | jsdom | jsdom has fuller API coverage but slower performance |
| @electron/rebuild | electron-rebuild (deprecated) | @electron/rebuild is official replacement |

**Installation:**
```bash
# Scaffold project
npm create @quick-start/electron@latest varlens -- --template vue

# Add Vuetify ecosystem
npm install vuetify vite-plugin-vuetify

# Add database
npm install better-sqlite3

# Add development tools
npm install --save-dev @electron/rebuild eslint prettier eslint-plugin-prettier eslint-config-prettier @vue/eslint-config-typescript vitest happy-dom @vitest/coverage-v8

# Rebuild native modules
npx @electron/rebuild
```

## Architecture Patterns

### Recommended Project Structure
```
varlens/
├── src/
│   ├── main/               # Main process (Node.js)
│   │   ├── index.ts        # Entry point
│   │   └── database.ts     # better-sqlite3 access (main process only)
│   ├── preload/            # Preload scripts (sandboxed Node.js)
│   │   └── index.ts        # IPC bridge via contextBridge
│   └── renderer/           # Renderer process (browser)
│       ├── src/
│       │   ├── main.ts     # Vue app entry
│       │   ├── App.vue
│       │   ├── plugins/
│       │   │   └── vuetify.ts
│       │   ├── components/
│       │   └── views/
│       └── index.html
├── tests/                  # Mirror src structure
│   ├── main/
│   ├── preload/
│   └── renderer/
├── out/                    # Build output (gitignored)
├── dist/                   # electron-builder output (gitignored)
├── electron.vite.config.ts
├── eslint.config.js        # Flat config
├── vitest.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── Makefile
└── package.json
```

### Pattern 1: Native Module Integration
**What:** Configure better-sqlite3 as external, rebuild for Electron, unpack from ASAR
**When to use:** Any native Node.js addon (.node files)
**Example:**
```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3'] // Don't bundle native module
      }
    }
  }
})

// package.json
{
  "build": {
    "asarUnpack": ["**/*.node"], // Unpack .node binaries from ASAR
    "files": ["out/**/*", "node_modules/better-sqlite3/**/*"]
  }
}
```

### Pattern 2: Secure IPC Communication
**What:** Use preload scripts with contextBridge, never expose raw ipcRenderer
**When to use:** All renderer-to-main communication
**Example:**
```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  queryDatabase: (sql: string, params: unknown[]) =>
    ipcRenderer.invoke('db:query', sql, params)
})

// src/main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import Database from 'better-sqlite3'

const db = new Database('data.db')

ipcMain.handle('db:query', (event, sql, params) => {
  const stmt = db.prepare(sql)
  return stmt.all(...params)
})

// Secure BrowserWindow config
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,    // Default since Electron 12
    nodeIntegration: false,     // Default since Electron 5
    sandbox: true               // Default since Electron 20
  }
})
```

### Pattern 3: Single Instance with Focus
**What:** Prevent multiple app instances, focus existing window on second launch
**When to use:** Always for desktop applications
**Example:**
```typescript
// src/main/index.ts
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      title: 'Varlens'
    })
  })
}
```

### Pattern 4: ESLint Flat Config with Vue + TypeScript + Prettier
**What:** Modern ESLint 9+ flat config with strict TypeScript rules
**When to use:** All new projects (ESLint 9+ default)
**Example:**
```javascript
// eslint.config.js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

export default [
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  prettierRecommended,
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: './tsconfig.json'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error'
    }
  }
]
```

### Pattern 5: Vitest with Coverage Thresholds
**What:** Configure Vitest with happy-dom and enforce 70% coverage
**When to use:** All projects requiring test coverage enforcement
**Example:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.d.ts', 'src/main/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  }
})
```

### Pattern 6: Vuetify 3 Plugin Setup
**What:** Configure Vuetify with vite-plugin-vuetify for automatic imports
**When to use:** All Vuetify 3 projects
**Example:**
```typescript
// electron.vite.config.ts (renderer section)
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  renderer: {
    plugins: [
      vue(),
      vuetify({ autoImport: true }) // Auto-import components
    ]
  }
})

// src/renderer/src/plugins/vuetify.ts
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light'
  }
})

// src/renderer/src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import vuetify from './plugins/vuetify'

createApp(App).use(vuetify).mount('#app')
```

### Anti-Patterns to Avoid
- **Using Node.js modules in renderer:** Violates Electron security model, breaks context isolation
- **Bundling native modules with Vite:** Causes "Cannot find module" errors, native modules must be external
- **Disabling context isolation:** Security vulnerability, allows renderer to access Electron internals
- **Using electron-rebuild (deprecated):** Use @electron/rebuild instead, official package
- **Forgetting ASAR unpack:** Native .node files inside ASAR can't load, must be unpacked
- **Loading assets with absolute paths:** Use relative paths (base: './') or loadFile() for Electron
- **Using history routing in production:** Use hash routing (createWebHashHistory) for Electron apps
- **Mixing ESM and CommonJS incorrectly:** Stick to ESM throughout, or use .mjs for config files

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Application packaging | Custom scripts with zip/tar | electron-builder | Handles code signing, notarization, auto-updates, platform-specific installers, ASAR bundling |
| Native module rebuilding | Manual node-gyp commands | @electron/rebuild | Handles Electron version detection, multiple architectures, prebuild fallback |
| Vuetify component imports | Manual component registration | vite-plugin-vuetify | Tree-shaking, auto-imports, SCSS variable access, reduces config boilerplate |
| IPC type safety | String-based channels | electron-typed-ipc or similar | Compile-time type checking across process boundary prevents runtime IPC errors |
| DevTools extension | Custom debug UI | electron-devtools-installer | Installs Vue DevTools, React DevTools automatically in development |
| Window state persistence | LocalStorage + manual restore | electron-window-state | Handles size, position, maximized state, multi-monitor setups |
| Application menu | Per-platform conditionals | electron-util or Menu templates | Cross-platform menu structure, keyboard shortcuts, role-based items |
| Hot reload during dev | Manual restart scripts | electron-vite built-in HMR | Hot module replacement for renderer, auto-restart for main process |

**Key insight:** Electron's multi-process architecture (main/preload/renderer) creates unique challenges around native modules, IPC, and security that standard web tooling doesn't handle. Use Electron-specific tools that understand this architecture.

## Common Pitfalls

### Pitfall 1: Native Module Version Mismatch
**What goes wrong:** better-sqlite3 throws "was compiled against a different Node.js version" error at runtime
**Why it happens:** npm installs the module compiled for system Node.js, but Electron uses a different Node.js version with V8 ABI differences
**How to avoid:** Always run `npx @electron/rebuild` after npm install, add it as postinstall script
**Warning signs:** Module loads fine with `node` but crashes in Electron, error mentions "NODE_MODULE_VERSION"

### Pitfall 2: Native Modules Bundled by Vite
**What goes wrong:** "Cannot find module 'better-sqlite3'" in production, even though it's installed
**Why it happens:** Vite tries to bundle native modules as if they're JavaScript, breaking the .node binary link
**How to avoid:** Mark native modules as external in rollupOptions, use externalizeDepsPlugin for dependencies
**Warning signs:** Development works but production build fails, main process can't find module

### Pitfall 3: ASAR Archive Blocks Native Module Loading
**What goes wrong:** "Error: Cannot find module" for .node files in packaged app
**Why it happens:** electron-builder packs everything into app.asar, but .node files can't be loaded from inside archives
**How to avoid:** Add `"asarUnpack": ["**/*.node"]` to electron-builder config
**Warning signs:** Packaged app crashes on database access, works in development

### Pitfall 4: Exposing Dangerous APIs in Preload
**What goes wrong:** Security vulnerability if renderer compromise allows arbitrary code execution
**Why it happens:** Directly exposing ipcRenderer or require() gives renderer full IPC access
**How to avoid:** Only expose specific functions via contextBridge, validate all inputs
**Warning signs:** ESLint warns about ipcRenderer usage, security audits flag exposed APIs

### Pitfall 5: TypeScript `any` Type Proliferation
**What goes wrong:** Type safety degrades over time, runtime errors increase
**Why it happens:** `any` is quick fix for type errors, but disables all type checking
**How to avoid:** Enable `@typescript-eslint/no-explicit-any` as error, use `unknown` instead
**Warning signs:** Increasing runtime type errors, IDE autocomplete stops working

### Pitfall 6: ESM vs CommonJS Confusion
**What goes wrong:** "SyntaxError: Named export not found" or "require() of ES Module not supported"
**Why it happens:** Mixing module systems, Electron 28+ supports ESM but config must be consistent
**How to avoid:** Use ESM throughout (add "type": "module" to package.json), or use .mjs for config files
**Warning signs:** Import/require errors, module not found for packages that exist

### Pitfall 7: Context Isolation Disabled
**What goes wrong:** Renderer process can access Electron internals, XSS becomes RCE
**Why it happens:** Developer disables to simplify IPC, not understanding security implications
**How to avoid:** Never set contextIsolation: false, use contextBridge for all IPC
**Warning signs:** Electron security warnings in console, security checklist violations

### Pitfall 8: Absolute Path Assets in Production
**What goes wrong:** HTML/CSS/JS files fail to load (ERR_FILE_NOT_FOUND) in packaged app
**Why it happens:** Vite generates absolute paths (/assets/...) which don't work with file:// protocol
**How to avoid:** Set `base: './'` in renderer Vite config, use loadFile() not loadURL()
**Warning signs:** White screen in production, console shows 404 for assets

### Pitfall 9: Missing Dependencies in Production
**What goes wrong:** "Cannot find module" errors for packages that exist in node_modules
**Why it happens:** Package in devDependencies instead of dependencies, pnpm hoisting issues
**How to avoid:** Put runtime deps in dependencies, add `shamefully-hoist=true` for pnpm
**Warning signs:** Works in dev, fails in production, works with npm but not pnpm

### Pitfall 10: Separate Tests Not Mirroring Source Structure
**What goes wrong:** Test imports break, coverage reports miss files, hard to find corresponding tests
**Why it happens:** Tests in flat structure while source is nested, or arbitrary test organization
**How to avoid:** Mirror src/ structure in tests/, use same folder names and file paths
**Warning signs:** Relative imports with ../../../, coverage includes unexpected files

## Code Examples

Verified patterns from official sources:

### Makefile for Electron Development
```makefile
# Makefile
.PHONY: dev build lint test typecheck package clean

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint -- --fix

test:
	npm run test

typecheck:
	npm run typecheck

package:
	npm run build && npx electron-builder --mac --win --linux

clean:
	rm -rf out dist node_modules/.vite
```

### TypeScript Strict Configuration
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "moduleResolution": "bundler",
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### electron-builder Configuration
```json
// package.json
{
  "name": "varlens",
  "version": "0.1.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev --watch",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "eslint . --fix",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json",
    "postinstall": "electron-builder install-app-deps && npx @electron/rebuild"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "vuetify": "^3.11.6",
    "better-sqlite3": "^12.6.2"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^25.0.0",
    "@electron/rebuild": "^3.6.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "vite-plugin-vuetify": "^2.1.2",
    "typescript": "^5.3.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-plugin-vue": "^9.0.0",
    "@vue/eslint-config-typescript": "^14.0.0",
    "eslint-plugin-prettier": "^5.0.0",
    "eslint-config-prettier": "^9.0.0",
    "prettier": "^3.0.0",
    "vitest": "^2.0.0",
    "happy-dom": "^15.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  },
  "build": {
    "appId": "com.varlens.app",
    "productName": "Varlens",
    "directories": {
      "output": "dist"
    },
    "files": [
      "out/**/*",
      "node_modules/better-sqlite3/**/*"
    ],
    "asarUnpack": ["**/*.node"],
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "target": ["nsis", "zip"]
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Development"
    }
  }
}
```

### Development Mode DevTools Auto-Open
```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Varlens',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| electron-rebuild (npm) | @electron/rebuild (npm) | 2023 | Official Electron org package, better maintained, same API |
| ESLint .eslintrc | ESLint flat config (eslint.config.js) | ESLint 9.0 (Apr 2024) | Simpler config, better TypeScript support, array-based |
| Vuetify 2 + Vue 2 | Vuetify 3 + Vue 3 | Vuetify 3 stable (Feb 2023) | Composition API, better tree-shaking, TypeScript native |
| nodeIntegration: true | Context isolation + preload | Electron 5 (2019) | Security improvement, prevents renderer accessing Node |
| jsdom for tests | happy-dom for tests | 2022+ | 2-3x faster test execution, sufficient API coverage |
| webpack for Electron | Vite-based tools (electron-vite) | 2022+ | 10-20x faster HMR, simpler config, better DX |
| CommonJS by default | ESM support in Electron | Electron 28 (Nov 2023) | Modern module system, better tree-shaking, align with Node.js |
| Sandboxing opt-in | Sandboxing default | Electron 20 (Aug 2022) | Security improvement, preload scripts sandboxed by default |

**Deprecated/outdated:**
- **electron-rebuild**: Use @electron/rebuild (official replacement)
- **eslint-plugin-vue v8**: Use v9+ for flat config support
- **Vuetify 2**: Not compatible with Vue 3, use Vuetify 3
- **contextIsolation: false**: Security anti-pattern, always keep true (default)
- **nodeIntegration: true**: Security vulnerability, use preload scripts
- **Electron Forge webpack template**: Slower than Vite-based tools for Electron
- **Manual bytecode plugins**: electron-vite 5.0 has built-in build.bytecode option

## Open Questions

Things that couldn't be fully resolved:

1. **Vuetify 3 Icon Font Configuration**
   - What we know: Vuetify 3 requires explicit icon font setup (MDI, Font Awesome, etc.)
   - What's unclear: Optimal setup for Electron (bundled vs CDN, subset selection)
   - Recommendation: Start with MDI SVG icons (smaller bundle), add web font if needed

2. **Test Coverage for Electron Main Process**
   - What we know: Vitest with happy-dom covers renderer (Vue components)
   - What's unclear: Best practices for testing main process with native modules
   - Recommendation: Use Vitest in Node environment for main, mock better-sqlite3 for most tests

3. **Universal macOS Builds (x64 + ARM64)**
   - What we know: better-sqlite3 has prebuilt binaries for both architectures
   - What's unclear: electron-builder config for universal binary with native modules
   - Recommendation: Build separately for each architecture initially, investigate universal after Phase 1

4. **ESLint Performance with TypeScript Type-Checking**
   - What we know: strictTypeChecked config requires project: './tsconfig.json'
   - What's unclear: Performance impact on large projects, whether to use type-aware rules
   - Recommendation: Start with strictTypeChecked, profile lint times, disable if >30s

5. **Source Code Protection**
   - What we know: electron-vite 5.0 has build.bytecode for V8 bytecode compilation
   - What's unclear: Whether to enable for Phase 1, obfuscation strength, performance impact
   - Recommendation: Skip for Phase 1 (POC), reconsider for production release

## Sources

### Primary (HIGH confidence)
- [electron-vite Official Documentation](https://electron-vite.org/guide/) - Getting started, configuration, troubleshooting
- [electron-vite 5.0 Release](https://electron-vite.org/blog/) - Version 5.0 features and migration
- [Electron Security Guide](https://www.electronjs.org/docs/latest/tutorial/security) - Security checklist, context isolation
- [Vuetify 3 Installation](https://vuetifyjs.com/en/getting-started/installation/) - Setup instructions
- [Vitest Environment Configuration](https://vitest.dev/guide/environment) - happy-dom setup
- [Vitest Coverage Configuration](https://vitest.dev/guide/coverage) - v8 provider, thresholds
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig/strict.html) - Compiler options
- [typescript-eslint Configs](https://typescript-eslint.io/users/configs/) - Recommended and strict presets
- [npm: better-sqlite3](https://www.npmjs.com/package/better-sqlite3) - Version 12.6.2
- [npm: electron-vite](https://www.npmjs.com/package/electron-vite) - Version 5.0.0
- [npm: vuetify](https://www.npmjs.com/package/vuetify) - Version 3.11.6

### Secondary (MEDIUM confidence)
- [electron-vite GitHub Releases](https://github.com/alex8088/electron-vite/releases) - Changelog for v5.0.0
- [Electron Official Docs: Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) - @electron/rebuild recommendation
- [Electron Official Docs: Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) - contextBridge patterns
- [Electron Official Docs: app API](https://www.electronjs.org/docs/latest/api/app) - requestSingleInstanceLock
- [electron-vite Troubleshooting](https://electron-vite.org/guide/troubleshooting) - Common issues and solutions
- [Prettier ESLint Integration](https://github.com/prettier/eslint-config-prettier) - Flat config setup
- [eslint-plugin-vue User Guide](https://eslint.vuejs.org/user-guide/) - Vue linting configuration
- [Vuetify Tree-shaking](https://vuetifyjs.com/en/features/treeshaking/) - vite-plugin-vuetify
- [Better TypeScript Strict Option Guide](https://betterstack.com/community/guides/scaling-nodejs/typescript-strict-option/) - Strict mode explanation

### Tertiary (LOW confidence - needs validation)
- WebSearch: Various blog posts and Medium articles on Electron + better-sqlite3 integration
- WebSearch: Community discussions on electron-vite with native modules
- WebSearch: Stack Overflow patterns for Electron security

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages verified with official docs and npm registry, versions confirmed current
- Architecture: HIGH - Patterns from official Electron and electron-vite documentation
- Pitfalls: HIGH - Sourced from official troubleshooting guides and GitHub issues
- Code examples: MEDIUM - Synthesized from multiple official sources, not tested end-to-end
- Version compatibility: HIGH - All version numbers verified against npm registry as of 2026-01-26

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - stable ecosystem with infrequent breaking changes)
