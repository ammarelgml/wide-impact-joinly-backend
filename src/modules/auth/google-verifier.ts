import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../lib/app-error.js';
import type { GoogleProfile } from '../users/user.repository.js';

/** Verifies a Google ID token. An interface so tests run without Google. */
export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleProfile>;
}

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Checks signature (against Google's rotating keys, cached by the library),
 * audience, issuer and expiry, then requires a verified email.
 */
export class GoogleAuthLibraryVerifier implements GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly audiences: string[]) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audiences });
      payload = ticket.getPayload();
    } catch {
      throw invalid('Google ID token could not be verified.');
    }
    if (!payload || !GOOGLE_ISSUERS.has(payload.iss)) throw invalid('Unexpected token issuer.');
    if (!payload.email || payload.email_verified !== true) {
      throw invalid('Google account email is not verified.');
    }
    return {
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name?.trim() || payload.email.split('@')[0] || 'Joinly user',
      avatarUrl: payload.picture ?? null,
    };
  }
}

const invalid = (msg: string) => new AppError('GOOGLE_TOKEN_INVALID', msg);
