import { defineEndpoints } from '../../http/endpoint.js';
import { User } from '../users/schemas.js';
import {
  AuthSession,
  DemoSignInBody,
  GoogleSignInBody,
  LogoutBody,
  RefreshBody,
  TokenPair,
} from './schemas.js';

export const authEndpoints = defineEndpoints({
  googleSignIn: {
    method: 'POST',
    path: '/v1/auth/google',
    tag: 'Auth',
    summary: 'Sign in with a Google ID token',
    description:
      'Verifies the Google ID token server-side. Returning users are signed in. A new user must send `role`; without it the API answers 422 ROLE_REQUIRED and the app resends the same token with the chosen role.',
    access: 'public',
    body: GoogleSignInBody,
    responses: { 200: AuthSession },
    errors: ['GOOGLE_TOKEN_INVALID', 'ROLE_REQUIRED', 'RATE_LIMITED'],
  },
  demoSignIn: {
    method: 'POST',
    path: '/v1/auth/demo',
    tag: 'Auth',
    summary: 'Sign in as a seeded demo account (review builds only)',
    description:
      'Mounted only when DEMO_LOGIN_ENABLED=true; otherwise 404. Signs in as the seeded demo teacher or demo student.',
    access: 'public',
    body: DemoSignInBody,
    responses: { 200: AuthSession },
    errors: ['NOT_FOUND', 'RATE_LIMITED'],
  },
  refresh: {
    method: 'POST',
    path: '/v1/auth/refresh',
    tag: 'Auth',
    summary: 'Rotate a refresh token',
    description:
      'Revokes the presented refresh token and returns a new pair in the same family. Presenting an already-rotated token revokes the whole family (reuse detection).',
    access: 'public',
    body: RefreshBody,
    responses: { 200: TokenPair },
    errors: ['REFRESH_TOKEN_INVALID', 'RATE_LIMITED'],
  },
  logout: {
    method: 'POST',
    path: '/v1/auth/logout',
    tag: 'Auth',
    summary: 'Sign out this device',
    description: 'Revokes the refresh token family. Idempotent.',
    access: 'authenticated',
    body: LogoutBody,
    responses: { 204: null },
    errors: [],
  },
  me: {
    method: 'GET',
    path: '/v1/me',
    tag: 'Me',
    summary: 'Current user',
    access: 'authenticated',
    responses: { 200: User },
    errors: [],
  },
});
