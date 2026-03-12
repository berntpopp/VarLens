# Overview

VarLens is an open-source desktop application for offline genetic variant analysis, developed at the [Institute of Human Genetics](https://www.kidney-genetics.org/) by Bernt Popp.

## Project Goals

- Provide a **secure, offline** tool for analyzing genetic variant data
- Support **research collaboration** where data cannot leave the local machine
- Offer **rich analysis features** (filtering, ACMG classification, cohort analysis) in a user-friendly interface
- Maintain **cross-platform** support (Windows, macOS, Linux)

## Technology

- **Frontend:** Vue 3, Vuetify 3, TypeScript
- **Backend:** Electron, SQLite (better-sqlite3-multiple-ciphers)
- **Build:** electron-vite, electron-builder
- **Testing:** Vitest (unit), Playwright (E2E)

## Source Code

VarLens is open source under the MIT license. The source code is available on [GitHub](https://github.com/berntpopp/VarLens).
