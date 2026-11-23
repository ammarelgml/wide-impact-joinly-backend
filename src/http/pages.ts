import { Router } from 'express';

import { JOIN_LINK_SCHEME } from '../modules/classrooms/join-link.js';

export interface PagesOptions {
  supportEmail: string | undefined;
  android: { packageName: string; certSha256: string[]; apkDownloadUrl: string };
}

/**
 * Public web pages: homepage and privacy policy (Google requires both before the
 * OAuth consent screen can be published), the /join landing page that QR codes
 * point at, and the Android App Links statement that lets /join open the app.
 */
export function pagesRouter(opts: PagesOptions): Router {
  const router = Router();
  const contact = opts.supportEmail
    ? `<a href="mailto:${escapeHtml(opts.supportEmail)}">${escapeHtml(opts.supportEmail)}</a>`
    : 'the support contact listed on the app’s store page';

  router.get('/', (_req, res) => {
    res.type('html').send(
      layout(
        'Joinly',
        `<h1>Joinly</h1>
<p class="lead">Teachers create classrooms. Students join in seconds by scanning a QR code or typing a 6-digit code.</p>
<ul>
  <li>Sign in with your Google account as a teacher or a student.</li>
  <li>Teachers create classrooms, share a QR code or join code, and see students appear as they join.</li>
  <li>Students scan or type the code, confirm the class, and join.</li>
</ul>
<p><a href="/privacy">Privacy policy</a> · <a href="/docs">API documentation</a></p>`,
      ),
    );
  });

  router.get('/privacy', (_req, res) => {
    res.type('html').send(
      layout(
        'Joinly privacy policy',
        `<h1>Privacy policy</h1>
<p><em>Last updated: 22 November 2026</em></p>
<h2>What we collect</h2>
<p>When you sign in with Google, Joinly receives your Google account <strong>name</strong>, <strong>email address</strong> and <strong>profile photo</strong>. We also store the role you choose (teacher or student), the classrooms you create or join, and when you joined them.</p>
<h2>How we use it</h2>
<ul>
  <li>To sign you in and keep you signed in.</li>
  <li>To show teachers the names, emails and photos of the students in their own classrooms, so they can recognise them.</li>
  <li>To show students their classrooms and the teacher’s name and photo. Students never see other students’ details.</li>
</ul>
<h2>What we don’t do</h2>
<p>We do not sell your data, share it with third parties, use it for advertising, or access any other part of your Google account.</p>
<h2>Retention and deletion</h2>
<p>Leaving a classroom or being removed deletes that membership. Deleting a classroom deletes its memberships and codes. To delete your account and all its data, contact us and we will do so promptly.</p>
<h2>Contact</h2>
<p>Questions or deletion requests: ${contact}.</p>`,
      ),
    );
  });

  /**
   * Where a scanned QR lands when the app is not installed (with the app,
   * Android opens it directly). Deliberately static: it never looks the code
   * up, so it reveals nothing and cannot be used to test guesses.
   */
  router.get('/join', (req, res) => {
    const raw = typeof req.query.code === 'string' ? req.query.code : '';
    const code = /^\d{6}$/.test(raw) ? raw : null;
    const apk = escapeHtml(opts.android.apkDownloadUrl);
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(
      layout(
        'Join a class on Joinly',
        `<h1>Join a class on Joinly</h1>
${
  code
    ? `<p class="lead">Your class code is</p>
<p class="code" aria-label="Class code ${code.split('').join(' ')}">${code.slice(0, 3)} ${code.slice(3)}</p>
<p><a class="button" href="${JOIN_LINK_SCHEME}://join?code=${code}">Open in Joinly</a></p>`
    : `<p class="lead">This join link is missing its 6-digit class code. Ask your teacher for the code, then type it in the app.</p>`
}
<h2>Don't have the app yet?</h2>
<ol>
  <li><a class="button secondary" href="${apk}">Download Joinly for Android</a></li>
  <li>Install it and sign in with Google as a student.</li>
  <li>${code ? 'Tap <strong>Open in Joinly</strong> above, or tap <strong>Join a class</strong> and type the code.' : 'Tap <strong>Join a class</strong> and type the code.'}</li>
</ol>`,
      ),
    );
  });

  /** Digital Asset Links: proves the app owns this host, so Android opens /join links in it. */
  router.get('/.well-known/assetlinks.json', (_req, res) => {
    const { packageName, certSha256 } = opts.android;
    res.json(
      certSha256.length
        ? [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: packageName,
                sha256_cert_fingerprints: certSha256,
              },
            },
          ]
        : [],
    );
  });

  return router;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 680px; margin: 48px auto; padding: 0 20px; color: #1c1f24; }
  h1 { font-size: 2rem; margin-bottom: .25rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  .lead { font-size: 1.15rem; color: #444; } a { color: #2f5bea; }
  .code { font: 700 3rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; margin: .25rem 0 1.25rem; }
  .button { display: inline-block; padding: .75rem 1.25rem; border-radius: 12px; background: #2f5bea; color: #fff; text-decoration: none; font-weight: 600; }
  .button.secondary { background: #eef2fd; color: #2f5bea; }
  ol li { margin: .5rem 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
