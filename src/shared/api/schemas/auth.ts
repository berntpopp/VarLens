import { z } from 'zod'

import { USER_ROLES } from '../../auth/auth-constants'

export const UsernameSchema = z.string().min(1).max(100)

export const PasswordSchema = z.string().min(8).max(256)
export const PasswordInputSchema = z.string().min(1).max(256)

export const LoginParamsSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1).max(256)
})

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  displayName: z.string().min(1).max(200),
  tempPassword: PasswordSchema
})

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema
})

export const LoginArgsSchema = z.tuple([LoginParamsSchema.shape.username, PasswordInputSchema])
export const CreateUserArgsSchema = z.tuple([
  CreateUserSchema.shape.username,
  CreateUserSchema.shape.displayName,
  CreateUserSchema.shape.tempPassword
])
export const UsernameArgsSchema = z.tuple([UsernameSchema])
export const UserRoleSchema = z.enum(USER_ROLES)
export const SetRoleArgsSchema = z.tuple([UsernameSchema, UserRoleSchema])
export const ResetPasswordArgsSchema = z.tuple([UsernameSchema, PasswordSchema])
export const ChangePasswordArgsSchema = z.tuple([
  ChangePasswordSchema.shape.oldPassword,
  PasswordInputSchema
])

export const AuthSessionUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  role: z.string(),
  passwordChangedAt: z.string().nullable().optional()
})

export const AuthUserSchema = z
  .object({
    id: z.number().int().positive(),
    username: z.string(),
    display_name: z.string().nullable().optional(),
    role: z.string(),
    is_active: z.number().int().optional(),
    must_change_password: z.number().int().optional(),
    failed_login_count: z.number().int().optional(),
    locked_until: z.string().nullable().optional(),
    password_changed_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    created_by: z.number().int().nullable().optional(),
    updated_at: z.string().nullable().optional()
  })
  .passthrough()

export const AuthResultSchema = z.object({
  success: z.boolean(),
  user: AuthUserSchema.nullable().optional(),
  locked: z.boolean().optional(),
  mustChangePassword: z.boolean().optional()
})

export const AuthBooleanSchema = z.boolean()
export const AuthOkSchema = z.object({ ok: z.boolean() })
export const AuthSuccessSchema = z.object({ success: z.boolean() })
export const AuthErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional()
  })
  .passthrough()

export const AuthInvokeBodySchemas = {
  login: z.object({ args: LoginArgsSchema }),
  logout: z.object({ args: z.tuple([]).optional() }),
  currentUser: z.object({ args: z.tuple([]).optional() }),
  isAccountsEnabled: z.object({ args: z.tuple([]).optional() }),
  createUser: z.object({ args: CreateUserArgsSchema }),
  listUsers: z.object({ args: z.tuple([]).optional() }),
  deactivateUser: z.object({ args: UsernameArgsSchema }),
  reactivateUser: z.object({ args: UsernameArgsSchema }),
  setRole: z.object({ args: SetRoleArgsSchema }),
  resetPassword: z.object({ args: ResetPasswordArgsSchema }),
  changePassword: z.object({ args: ChangePasswordArgsSchema })
} as const

export type LoginParams = z.infer<typeof LoginParamsSchema>
export type CreateUserParams = z.infer<typeof CreateUserSchema>
export type ChangePasswordParams = z.infer<typeof ChangePasswordSchema>
