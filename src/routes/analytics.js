const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');

const router = express.Router();
const DEDUPE_SECONDS = 30;

function actorKey(userId, deviceId) {
  if (userId) return `u:${userId}`;
  if (deviceId) return `d:${deviceId}`;
  return '';
}

function recordEvent({
  event,
  section = '',
  category = '',
  targetId = '',
  targetTitle = '',
  user = null,
  deviceId = '',
  path = '',
}) {
  const name = String(event || '').trim().slice(0, 80);
  if (!name) return { ok: false, skipped: true };
  const uid = user?.id || '';
  const email = user?.email || '';
  const device = String(deviceId || '').slice(0, 80);
  const sec = String(section || '').slice(0, 80);
  const cat = String(category || '').slice(0, 80);
  const tid = String(targetId || '').slice(0, 120);
  const recent = db()
    .prepare(
      `SELECT event_id FROM analytics_events
       WHERE event_name = ?
         AND section = ?
         AND target_id = ?
         AND user_id = ?
         AND device_id = ?
         AND created_at >= datetime('now', ?)
       LIMIT 1`,
    )
    .get(name, sec, tid, uid, device, `-${DEDUPE_SECONDS} seconds`);
  if (recent) return { ok: true, skipped: true };
  db()
    .prepare(
      `INSERT INTO analytics_events (
        event_id, event_name, section, category, target_id, target_title,
        user_id, email, device_id, path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `evt_${crypto.randomUUID()}`,
      name,
      sec,
      cat,
      tid,
      String(targetTitle || '').slice(0, 200),
      uid,
      email,
      device,
      String(path || '').slice(0, 160),
      new Date().toISOString(),
    );
  return { ok: true, skipped: false };
}

router.post('/events', (req, res) => {
  const name = String(req.body.event || req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'event is required' });
  const result = recordEvent({
    event: name,
    section: req.body.section,
    category: req.body.category,
    targetId: req.body.targetId || req.body.target_id,
    targetTitle: req.body.targetTitle || req.body.target_title,
    user: req.user,
    deviceId: req.body.deviceId || req.body.device_id,
    path: req.body.path,
  });
  res.status(201).json(result);
});

module.exports = { router, recordEvent, actorKey };
