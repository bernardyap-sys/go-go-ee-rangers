import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { createHandler } from './index.mjs';
import seed from '../vercel/seed-content.json' with { type: 'json' };

test('Vercel route forwards the existing API paths', async () => {
  const missing = await handler.fetch(new Request('https://example.vercel.app/api/index?path=unknown'));
  assert.equal(missing.status, 404);
  const content = await handler.fetch(new Request('https://example.vercel.app/api/index?path=content'));
  assert.equal(content.status, 503);
  const login = await handler.fetch(new Request('https://example.vercel.app/api/index?path=admin%2Flogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test' }),
  }));
  assert.equal(login.status, 503);
});

test('Vercel admin changes persist in private storage', async () => {
  const records = new Map();
  let revision = 0;
  const store = {
    async read(path) {
      const record = records.get(path);
      return record ? structuredClone(record) : null;
    },
    async write(path, value, etag = null) {
      if (etag && records.get(path)?.etag !== etag) throw Object.assign(new Error('Conflict'), { status: 409 });
      records.set(path, { value: structuredClone(value), etag: String(++revision) });
    },
    async remove(path) { records.delete(path); },
    isConflict(error) { return error.status === 409; },
  };
  const oldContent = structuredClone(seed);
  delete oldContent.tasks;
  records.set('content.json', { value: oldContent, etag: '0' });
  const api = createHandler(store, () => 'NewOnlinePassword!42');
  let sessionCookie = '';
  const call = (path, method = 'GET', body, headers = {}) => api.fetch(new Request(`https://easypkee3.vercel.app/api/index?path=${encodeURIComponent(path)}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));

  assert.equal((await call('admin/session')).status, 401);
  const seedContent = await (await call('content')).json();
  assert.equal(seedContent.announcements.length, 1);
  assert.deepEqual(seedContent.tasks, []);
  assert.equal((await call('admin/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await call('admin/login', 'POST', { password: 'NewOnlinePassword!42' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  sessionCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('admin/session')).status, 200);

  const added = await call('admin/resources', 'POST', { title: 'Lecture slides', category: 'slides', url: 'https://example.com/slides' });
  assert.equal(added.status, 201);
  const id = (await added.json()).id;
  assert.equal((await call('admin/tasks', 'POST', { title: 'Invalid date', due_at: '2026-02-30T18:00+08:00' })).status, 400);
  const task = await call('admin/tasks', 'POST', { title: 'Finish report', due_at: '2026-10-20T18:00+08:00' });
  assert.equal(task.status, 201);
  const taskId = (await task.json()).id;
  assert.equal((await call('admin/contact', 'PUT', { text: 'pls contact rara via WA group' })).status, 200);
  let content = await (await call('content')).json();
  assert.equal(content.resources[0].url, 'https://example.com/slides');
  assert.equal(content.tasks[0].due_at, '2026-10-20T18:00+08:00');
  assert.equal(content.announcements[0].title, seedContent.announcements[0].title);
  assert.equal((await call(`admin/resources/${id}`, 'DELETE')).status, 200);
  assert.equal((await call(`admin/tasks/${taskId}`, 'PUT', { title: 'Finish report', due_at: '2026-10-21T18:00+08:00' })).status, 200);
  content = await (await call('content')).json();
  assert.equal(content.resources.length, 0);
  assert.equal(content.tasks[0].due_at, '2026-10-21T18:00+08:00');
  assert.equal((await call(`admin/tasks/${taskId}`, 'DELETE')).status, 200);
  assert.equal((await (await call('content')).json()).tasks.length, 0);
  assert.equal((await call('admin/contact', 'PUT', { text: 'Blocked' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('admin/logout', 'POST')).status, 200);
  assert.equal((await call('admin/session')).status, 401);
});
