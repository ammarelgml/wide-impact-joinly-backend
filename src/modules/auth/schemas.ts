import { z } from 'zod';
import { Timestamp } from '../../http/common.schemas.js';
import { Role, User } from '../users/schemas.js';

export const GoogleSignInBody = z
  .strictObject({
    idToken: z
      .string()
      .min(1)
      .max(4096)
      .meta({ description: 'Google ID token from native sign-in.' }),
    role: Role.optional().meta({
      description: 'Required only on first sign-in. Ignored for existing users.',
    }),
  })
  .meta({ id: 'GoogleSignInBody' });
export type GoogleSignInBody = z.infer<typeof GoogleSignInBody>;

export const DemoAccount = z.enum(['teacher', 'student']);
export const DemoSignInBody = z
  .strictObject({ account: DemoAccount })
  .meta({ id: 'DemoSignInBody' });
export type DemoSignInBody = z.infer<typeof DemoSignInBody>;

export const RefreshToken = z.string().min(20).max(200);

export const RefreshBody = z
  .strictObject({ refreshToken: RefreshToken })
  .meta({ id: 'RefreshBody' });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const LogoutBody = RefreshBody.meta({ id: 'LogoutBody' });
export type LogoutBody = z.infer<typeof LogoutBody>;

export const TokenPair = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: Timestamp,
    refreshToken: z.string(),
  })
  .meta({ id: 'TokenPair' });
export type TokenPair = z.infer<typeof TokenPair>;

export const AuthSession = TokenPair.extend({ user: User, isNewUser: z.boolean() }).meta({
  id: 'AuthSession',
});
export type AuthSession = z.infer<typeof AuthSession>;
