import { Router } from 'express';

/**
 * Public homepage and privacy policy. Google requires both URLs, on an
 * authorized domain, before the OAuth consent screen can be published.
 */
export function pagesRouter(opts: { supportEmail: string | undefined }): Router {
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
