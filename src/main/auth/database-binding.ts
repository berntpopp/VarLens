/**
 * The open guard of the desktop platform sign-in (#295): every database
 * session passes it before it becomes active.
 *
 * - Bound to the identity: a database records the identity (issuer and
 *   subject) of the first account that opens it while signed in
 *   (`database_settings`, `platform_identity`), and refuses every other
 *   account afterwards. The subject alone is unique only within one issuer.
 * - Passphrase only, when the admin config asks for it: a database the
 *   computer account alone could unlock (plaintext, or a key wrapped by the
 *   OS credential store) is refused before the file is touched.
 * - Server workspaces stay closed; the binding covers local databases.
 */
import { ErrorCode } from '../../shared/types/errors'
import { AppError, ForbiddenError } from '../ipc/errors'
import type { OpenGuard } from '../services/DatabaseManager'
import { SqliteStorageSession } from '../storage/sqlite/SqliteStorageSession'

export interface OpenGuardDependencies {
  /** The signed-in identity, undefined while locked. */
  identity: () => string | undefined
  requirePassphrase: boolean
  /** True when the OS credential store holds a wrap of this key. */
  osUnlockable: (key: string) => boolean
}

/** One string for issuer and subject, compared as a whole. */
export function platformIdentity(issuer: string, subject: string): string {
  return JSON.stringify([issuer, subject])
}

function refuse(message: string): ForbiddenError {
  return new ForbiddenError(message, message)
}

export function platformOpenGuard(deps: OpenGuardDependencies): OpenGuard {
  const signedIn = (): string => {
    const identity = deps.identity()
    if (identity === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to open a database.')
    }
    return identity
  }
  return {
    checkKey(key) {
      signedIn()
      if (deps.requirePassphrase && (key === undefined || key === '' || deps.osUnlockable(key))) {
        throw refuse(
          'This computer opens only databases protected by a passphrase. Create a new database with a passphrase, or ask your administrator.'
        )
      }
    },
    async checkSession(session) {
      if (!(session instanceof SqliteStorageSession)) {
        throw refuse(
          'Server workspaces cannot be opened while this VarLens signs in through your organisation.'
        )
      }
      const identity = signedIn()
      const auth = session.getDatabaseService().auth
      if (auth.platformIdentity() === undefined) await auth.bindPlatformIdentity(identity)
      // Read back: a binding that already existed is never overwritten.
      if (auth.platformIdentity() !== identity) {
        throw refuse(
          'This database belongs to another account. Sign in with that account to open it.'
        )
      }
    }
  }
}
