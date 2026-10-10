const crypto = require('crypto');
const { db } = require('./db');
const { sendToToken, fcmReady } = require('./fcm');

const PLATFORMS = new Set(['all', 'android', 'ios']);
const CONCURRENCY = 8;

function publicPushJob(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    platform: row.platform,
    userId: row.user_id || '',
    sendAt: row.send_at,
    status: row.status,
    tokenCount: Number(row.token_count || 0),
    sentCount: Number(row.sent_count || 0),
    failedCount: Number(row.failed_count || 0),
    error: row.error || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tokenCounts() {
  const rows = db()
    .prepare('SELECT platform, COUNT(*) AS n FROM push_tokens GROUP BY platform')
    .all();
  const byPlatform = { android: 0, ios: 0 };
  for (const row of rows) {
    if (row.platform === 'ios' || row.platform === 'android') {
      byPlatform[row.platform] = row.n;
    }
  }
  return {
    total: byPlatform.android + byPlatform.ios,
    android: byPlatform.android,
    ios: byPlatform.ios,
  };
}

function upsertToken({ token, platform, userId }) {
  const value = String(token || '').trim();
  if (!value || value.length < 20) {
    const err = new Error('token is required');
    err.status = 400;
    throw err;
  }
  const plat = String(platform || '').trim().toLowerCase();
  if (plat !== 'android' && plat !== 'ios') {
    const err = new Error('platform must be android or ios');
    err.status = 400;
    throw err;
  }
  db()
    .prepare(
      `INSERT INTO push_tokens (token, user_id, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(token) DO UPDATE SET
         user_id = excluded.user_id,
         platform = excluded.platform,
         updated_at = datetime('now')`,
    )
    .run(value, userId || null, plat);
  return { ok: true, platform: plat };
}

function parseSendAt(value) {
  if (value == null || value === '') return new Date();
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    const err = new Error('sendAt must be a valid date');
    err.status = 400;
    throw err;
  }
  return at;
}

function createJob({ title, body, platform, sendAt, userId, createdBy }) {
  const nextTitle = String(title || '').trim();
  const nextBody = String(body || '').trim();
  if (!nextTitle || !nextBody) {
    const err = new Error('title and body are required');
    err.status = 400;
    throw err;
  }
  const plat = String(platform || 'all').trim().toLowerCase();
  if (!PLATFORMS.has(plat)) {
    const err = new Error('platform must be all, android, or ios');
    err.status = 400;
    throw err;
  }
  const when = parseSendAt(sendAt);
  const id = `push_${crypto.randomUUID()}`;
  db()
    .prepare(
      `INSERT INTO push_jobs (
         id, title, body, platform, user_id, send_at, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      id,
      nextTitle,
      nextBody,
      plat,
      userId ? String(userId).trim() : null,
      when.toISOString(),
      createdBy || '',
    );
  return db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(id);
}

function listJobs({ page = 0, limit = 30 } = {}) {
  const offset = page * limit;
  const total = db().prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n;
  const items = db()
    .prepare('SELECT * FROM push_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return { items: items.map(publicPushJob), total, page, limit };
}

function cancelJob(id) {
  const row = db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(id);
  if (!row) {
    const err = new Error('Push not found');
    err.status = 404;
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('Only a scheduled push can be cancelled');
    err.status = 400;
    throw err;
  }
  db()
    .prepare(
      `UPDATE push_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
    )
    .run(id);
  return db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(id);
}

function tokensForJob(job) {
  const where = [];
  const params = [];
  if (job.platform === 'android' || job.platform === 'ios') {
    where.push('platform = ?');
    params.push(job.platform);
  }
  if (job.user_id) {
    where.push('user_id = ?');
    params.push(job.user_id);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db().prepare(`SELECT token, platform FROM push_tokens ${clause}`).all(...params);
}

function dropToken(token) {
  db().prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
}

async function mapPool(items, worker) {
  const out = [];
  let i = 0;
  async function next() {
    const index = i;
    i += 1;
    if (index >= items.length) return;
    out[index] = await worker(items[index]);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return out;
}

async function deliverJob(job) {
  if (!fcmReady()) {
    db()
      .prepare(
        `UPDATE push_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run('Firebase service account is not configured', job.id);
    return db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(job.id);
  }
  const claimed = db()
    .prepare(
      `UPDATE push_jobs SET status = 'sending', updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .run(job.id);
  if (!claimed.changes) {
    return db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(job.id);
  }
  const tokens = tokensForJob(job);
  let sent = 0;
  let failed = 0;
  let lastError = '';
  await mapPool(tokens, async (row) => {
    const result = await sendToToken(row.token, { title: job.title, body: job.body });
    if (result.ok) {
      sent += 1;
      return;
    }
    failed += 1;
    lastError = result.error || lastError;
    if (result.dead) dropToken(row.token);
  });
  const status = tokens.length === 0 || sent > 0 ? 'sent' : 'failed';
  const error =
    tokens.length === 0
      ? 'No device tokens yet'
      : sent === 0
        ? lastError || 'FCM send failed'
        : '';
  db()
    .prepare(
      `UPDATE push_jobs SET
         status = ?, token_count = ?, sent_count = ?, failed_count = ?,
         error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(status, tokens.length, sent, failed, error, job.id);
  return db().prepare('SELECT * FROM push_jobs WHERE id = ?').get(job.id);
}

async function processDueJobs() {
  const due = db()
    .prepare(
      `SELECT * FROM push_jobs
       WHERE status = 'pending' AND datetime(send_at) <= datetime('now')
       ORDER BY send_at ASC LIMIT 8`,
    )
    .all();
  for (const job of due) {
    try {
      await deliverJob(job);
    } catch (err) {
      console.error('push job failed', job.id, err);
      db()
        .prepare(
          `UPDATE push_jobs SET status = 'failed', error = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'sending'`,
        )
        .run(String(err.message || 'Send failed').slice(0, 300), job.id);
    }
  }
}

function startPushWorker() {
  processDueJobs().catch((err) => console.error('push worker', err));
  setInterval(() => {
    processDueJobs().catch((err) => console.error('push worker', err));
  }, 30 * 1000).unref();
}

module.exports = {
  publicPushJob,
  tokenCounts,
  upsertToken,
  createJob,
  listJobs,
  cancelJob,
  deliverJob,
  processDueJobs,
  startPushWorker,
};
