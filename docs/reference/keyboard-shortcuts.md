# Keyboard Shortcuts

VarLens supports keyboard shortcuts for navigating variant tables, performing actions on selected rows, and accessing app features. Press `?` at any time to see the full list in-app.

> Shortcuts are disabled when a text input, textarea, or dialog field is focused.

## Table Navigation

| Shortcut | Action |
|----------|--------|
| `Arrow Down` / `Arrow Up` | Move row selection down / up |
| `Enter` | Open variant detail panel for selected row |
| `Escape` | Close detail panel / deselect row |

## Actions (on selected row)

| Shortcut | Action |
|----------|--------|
| `s` | Toggle star |
| `c` | Open comment dialog |
| `a` | Open ACMG classification |
| `e` | Expand / collapse row (Cohort view) |

## Search & Filters

| Shortcut (Windows/Linux) | Shortcut (macOS) | Action |
|--------------------------|------------------|--------|
| `/` | `/` | Focus search field |
| `Ctrl+Shift+F` | `Cmd+Shift+F` | Toggle filter panel |
| `Alt+Shift+C` | `Option+Shift+C` | Toggle columns panel |
| `Ctrl+Shift+X` | `Cmd+Shift+X` | Clear all filters |
| `Escape` | `Escape` | Blur search bar (when focused) |

## General

| Shortcut (Windows/Linux) | Shortcut (macOS) | Action |
|--------------------------|------------------|--------|
| `?` | `?` | Show keyboard shortcuts help |
| `Alt+Shift+I` | `Option+Shift+I` | Import data |
| `Alt+Shift+L` | `Option+Shift+L` | Toggle log viewer |
| `Alt+Shift+D` | `Option+Shift+D` | Show disclaimer |
| `Alt+Shift+Q` | `Option+Shift+Q` | Show FAQ |

App shortcuts use `Alt+Shift` (`Option+Shift` on macOS) so they don't override browser and Electron shortcuts such as `Ctrl+L` (address bar), `Ctrl+Shift+Q` (quit Chrome), or `Ctrl+Shift+C` (DevTools element picker). The single-letter row actions (`s`, `c`, `a`, `e`) ignore `Ctrl`, `Cmd`, and `Alt`, so `Ctrl+C` copies and `Ctrl+A` selects all as usual.
