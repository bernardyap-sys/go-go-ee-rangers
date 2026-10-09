import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('Cloudflare API keeps the admin workflow and public content', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(directory, '..', 'migrations', '0001_init.sql'), 'utf8'));
  sqlite.exec(fs.readFileSync(path.join(directory, '..', 'migrations', '0002_tasks.sql'), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
  };
  const env = {
    DB: db,
    ADMIN_PASSWORD: 'CloudTestPassword!42',
    ASSETS: { fetch: async (request) => new Response(new URL(request.url).pathname) },
  };
  let cookie = '';
  const call = async (route, method = 'GET', body, headers = {}) => worker.fetch(new Request(`https://easypkee3.example${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);

  try {
    assert.equal((await call('/api/admin/session')).status, 401);
    assert.equal((await call('/api/admin/announcements', 'POST', { title: 'Blocked' })).status, 401);
    assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await call('/api/admin/login', 'POST', { password: env.ADMIN_PASSWORD });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /Secure/);

    const announcement = await call('/api/admin/announcements', 'POST', { title: 'Class update', description: 'Room confirmed.', pinned: true });
    assert.equal(announcement.status, 201);
    const announcementId = (await announcement.json()).id;
    assert.equal((await call('/api/admin/schedule', 'POST', { title: 'Lecture', day: 0, start_time: '11:00', end_time: '10:00' })).status, 400);
    assert.equal((await call('/api/admin/schedule', 'POST', { title: 'Lecture', day: 0, start_time: '10:00', end_time: '11:00', location: 'Room A' })).status, 201);
    assert.equal((await call('/api/admin/tasks', 'POST', { title: 'Invalid date', due_at: '2026-02-30T18:00+08:00' })).status, 400);
    const task = await call('/api/admin/tasks', 'POST', { title: 'Finish report', due_at: '2026-10-20T18:00+08:00' });
    assert.equal(task.status, 201);
    const taskId = (await task.json()).id;
    assert.equal((await call('/api/admin/resources', 'POST', { title: 'Bad', category: 'link', url: 'javascript:alert(1)' })).status, 400);
    const resource = await call('/api/admin/resources', 'POST', { title: 'Slides', category: 'slides', url: 'https://example.com/slides' });
    assert.equal(resource.status, 201);
    const resourceId = (await resource.json()).id;
    assert.equal((await call('/api/admin/activities', 'POST', { title: 'Group task', date: '2026-02-30' })).status, 400);
    assert.equal((await call('/api/admin/activities', 'POST', { title: 'Group task', date: '2026-10-20' })).status, 201);
    assert.equal((await call('/api/admin/contact', 'PUT', { text: 'pls contact rara via WA group' })).status, 200);

    let content = await (await call('/api/content')).json();
    assert.equal(content.announcements[0].title, 'Class update');
    assert.equal(content.announcements[0].pinned, true);
    assert.equal(content.schedule[0].location, 'Room A');
    assert.equal(content.tasks[0].due_at, '2026-10-20T18:00+08:00');
    assert.equal(content.resources[0].url, 'https://example.com/slides');
    assert.equal(content.activities[0].date, '2026-10-20');

    assert.equal((await call(`/api/admin/announcements/${announcementId}`, 'PUT', { title: 'Updated notice' })).status, 200);
    assert.equal((await call(`/api/admin/tasks/${taskId}`, 'PUT', { title: 'Finish report', due_at: '2026-10-21T18:00+08:00' })).status, 200);
    assert.equal((await call(`/api/admin/resources/${resourceId}`, 'DELETE')).status, 200);
    content = await (await call('/api/content')).json();
    assert.equal(content.announcements[0].title, 'Updated notice');
    assert.equal(content.tasks[0].due_at, '2026-10-21T18:00+08:00');
    assert.equal((await call(`/api/admin/tasks/${taskId}`, 'DELETE')).status, 200);
    assert.equal((await (await call('/api/content')).json()).tasks.length, 0);
    assert.equal(content.resources.length, 0);
    assert.equal((await call('/api/admin/contact', 'PUT', { text: 'Blocked' }, { Origin: 'https://evil.example' })).status, 403);

    assert.equal(await (await call('/admin')).text(), '/admin.html');
    assert.equal((await call('/api/admin/logout', 'POST')).status, 200);
    assert.equal((await call('/api/admin/session')).status, 401);
  } finally {
    sqlite.close();
  }
});
