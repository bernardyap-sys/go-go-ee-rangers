import fs from 'node:fs';

const origin = process.argv[2] || 'https://easypkee3.vercel.app';
const password = fs.readFileSync(new URL('../data/vercel-admin-password.txt', import.meta.url), 'utf8');
const content = await fetch(`${origin}/api/content`);
if (!content.ok || !(await content.json()).announcements) throw new Error('Public content failed.');

const login = await fetch(`${origin}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error(`Admin login failed (${login.status}).`);
const sessionCookie = login.headers.get('set-cookie')?.split(';')[0];
if (!sessionCookie) throw new Error('Admin session cookie missing.');

const session = await fetch(`${origin}/api/admin/session`, { headers: { Cookie: sessionCookie } });
if (!session.ok) throw new Error(`Admin session failed (${session.status}).`);
const logout = await fetch(`${origin}/api/admin/logout`, { method: 'POST', headers: { Cookie: sessionCookie } });
if (!logout.ok) throw new Error(`Admin logout failed (${logout.status}).`);
const expired = await fetch(`${origin}/api/admin/session`, { headers: { Cookie: sessionCookie } });
if (expired.status !== 401) throw new Error('Admin session remained active after logout.');

console.log('Public content, admin login, session, and logout: OK');
