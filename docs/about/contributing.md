# Contributing

VarLens welcomes contributions. Here's how to get set up for development.

## Development Setup

### Prerequisites

- **Node.js** 20.x or later
- **npm** 10.x or later
- **Git**
- **Linux/macOS:** Standard build tools
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload

### Clone and Install

```bash
git clone https://github.com/berntpopp/VarLens.git
cd VarLens
npm install
```

The `postinstall` script automatically rebuilds native modules for Electron.

### Development

```bash
make dev        # Start dev server with hot reload
make test       # Run unit tests
make lint       # Lint and auto-fix
make typecheck  # TypeScript checking
make ci         # Run all CI checks locally
```

### Building

```bash
make dist       # Build and package for current platform
```

## Pull Request Workflow

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `make ci` passes locally
4. Open a pull request against `main`
5. PR checks (lint, typecheck, test, build) run on Windows, Ubuntu, and macOS

## Releasing

Releases are triggered by pushing version tags:

```bash
# Bump version in package.json, then:
git tag v0.23.0
git push origin v0.23.0
```

The release workflow builds platform installers and creates a GitHub draft release.
