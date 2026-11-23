import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { createClassroom, makeApp, signIn } from './helpers.js';

const FINGERPRINT =
  '01:26:09:56:C2:E6:6F:71:8B:D5:4C:7B:E2:EF:B1:00:DC:95:4E:C2:2C:72:C0:E6:69:D7:F6:D9:B2:CB:E5:08';
const android = {
  packageName: 'com.ammarelgml.joinly',
  certSha256: [FINGERPRINT],
  apkDownloadUrl: 'https://github.com/o/r/releases/latest/download/joinly.apk',
};

describe('https join links', () => {
  it('puts an https /join link in the QR when PUBLIC_URL is set', async () => {
    const { app } = makeApp({ config: { publicUrl: 'https://api.example.com' } });
    const teacher = await signIn(app, 't-links', 'teacher');
    const c = await createClassroom(app, teacher);
    expect(c.joinCode.joinUrl).toBe(`https://api.example.com/join?code=${c.joinCode.code}`);
  });

  it('serves a static landing page with the code, an app link and the APK download', async () => {
    const { http } = makeApp({ config: { android } });
    const res = await http.get('/join?code=012345');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('012 345');
    expect(res.text).toContain('href="joinly://join?code=012345"');
    expect(res.text).toContain(`href="${android.apkDownloadUrl}"`);
  });

  it('shows no code, and echoes nothing, for a missing or malformed code', async () => {
    const { http } = makeApp({ config: { android } });
    for (const q of ['', '?code=12345', '?code=<script>alert(1)</script>', '?code=1234567']) {
      const res = await http.get(`/join${q}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('missing its 6-digit class code');
      expect(res.text).not.toContain('joinly://');
      expect(res.text).not.toContain('<script>');
    }
  });

  it('publishes the Android App Links statement for the signing certificate', async () => {
    const { http } = makeApp({ config: { android } });
    const res = await http.get('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.ammarelgml.joinly',
          sha256_cert_fingerprints: [FINGERPRINT],
        },
      },
    ]);
    const none = await makeApp().http.get('/.well-known/assetlinks.json');
    expect(none.body).toEqual([]);
  });
});

describe('join link config', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    GOOGLE_WEB_CLIENT_ID: 'id',
  };

  it('normalises PUBLIC_URL and fingerprints', () => {
    const c = loadConfig({
      ...base,
      PUBLIC_URL: 'https://api.example.com/',
      ANDROID_CERT_SHA256: ` ${FINGERPRINT.toLowerCase()} `,
    });
    expect(c.publicUrl).toBe('https://api.example.com');
    expect(c.android.certSha256).toEqual([FINGERPRINT]);
  });

  it('rejects a malformed fingerprint or a non-http PUBLIC_URL', () => {
    expect(() => loadConfig({ ...base, ANDROID_CERT_SHA256: 'AB:CD' })).toThrow(
      /ANDROID_CERT_SHA256/,
    );
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'javascript:alert(1)' })).toThrow(/PUBLIC_URL/);
  });
});
