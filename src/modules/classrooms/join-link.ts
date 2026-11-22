/**
 * The QR code encodes a deep link holding only the code (D6), so a scanned QR
 * and a typed code reach the same API call, and regenerating a code kills both.
 */
export const JOIN_LINK_SCHEME = 'joinly';

export function buildJoinUrl(code: string): string {
  return `${JOIN_LINK_SCHEME}://join?code=${code}`;
}
