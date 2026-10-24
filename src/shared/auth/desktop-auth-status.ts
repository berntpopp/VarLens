/**
 * What the renderer learns about the desktop sign-in before it renders
 * anything (`auth:desktopStatus`). It carries no data: the sign-in screen
 * needs the state, and the issuer to say where the user signs in.
 */
export type DesktopAuthStatus =
  | { mode: 'none' }
  | {
      mode: 'platform'
      state: 'locked' | 'signed-in'
      /** Where the user signs in, for the sign-in screen. */
      issuer: string
    }
  | {
      mode: 'platform'
      state: 'misconfigured'
      /** Why the admin config file was refused; shown to the user. */
      problem: string
    }

/** How one desktop sign-in ended (`auth:desktopSignIn`). */
export type DesktopSignInResult =
  | { outcome: 'signed-in' }
  /** The first sign-in set up the authenticator app; one more sign-in proves it. */
  | { outcome: 'enrolled' }
  /** The account may not use VarLens Desktop. */
  | { outcome: 'no-access' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; message: string }
