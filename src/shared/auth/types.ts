/**
 * Cross-backend auth types — single source of truth so the desktop
 * SQLite AuthService and the web Postgres PostgresWebAuthService can't
 * drift on return shapes.
 *
 * Both implementations import from this module; any field added, removed, or
 * renamed lands in both runtimes simultaneously.
 *
 * Storage representation differs between backends:
 *   - SQLite stores integer 0/1 for booleans, TEXT ISO strings for
 *     timestamps, INTEGER PK for ids.
 *   - Postgres stores native BOOLEAN, TIMESTAMPTZ, BIGINT.
 * Each backend's row mapper normalises to this shared `User` shape so
 * handlers (and the AuthResult contract) never have to branch.
 */
import type { UserRole } from './auth-constants'

export interface User {
  id: number
  username: string
  display_name: string | null
  password_hash: string
  role: UserRole
  is_active: number
  must_change_password: number
  failed_login_count: number
  locked_until: string | null
  password_changed_at: string | null
  created_at: string
  created_by: number | null
  updated_at: string | null
  private_db_secret_ref?: string | null
  private_db_status?: string | null
  public_annotation_snapshot_id?: string | null
}

export interface AuthResult {
  success: boolean
  user: Omit<User, 'password_hash'> | null
  locked?: boolean
  mustChangePassword?: boolean
}
