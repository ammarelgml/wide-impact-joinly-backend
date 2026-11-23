/**
 * The QR code encodes a link holding only the code (D6), so a scanned QR and a
 * typed code reach the same API call, and regenerating a code kills both.
 *
 * With a public origin configured the link is https: Android opens the app for
 * it (App Links, see /.well-known/assetlinks.json) and any other phone gets the
 * /join web page with the code and a download link. Without one it falls back
 * to the app's custom scheme.
 */
export const JOIN_LINK_SCHEME = 'joinly';

export function buildJoinUrl(code: string, publicUrl?: string): string {
  return publicUrl ? `${publicUrl}/join?code=${code}` : `${JOIN_LINK_SCHEME}://join?code=${code}`;
}
