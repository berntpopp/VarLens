/**
 * How the desktop app decides who may open data (berntpopp/VarLens#295,
 * .planning/specs/2026-10-24-desktop-platform-sign-in.md).
 *
 * - `none`: no sign-in, the default.
 * - `platform`: sign-in through the platform identity provider in the system
 *   browser; switched on only by an administrator's config file.
 *
 * The admin config file resolves the mode once at startup
 * (src/main/auth/desktop-auth.ts). Local desktop accounts can join as a
 * further mode on the same main-process gate.
 */
export type DesktopAuthMode = 'none' | 'platform'
