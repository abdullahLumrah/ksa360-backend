const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.post('/events', (req, res) => {
  const name = String(req.body.event || req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'event is required' });
  const user = req.user;
  db()
    .prepare(
      `INSERT INTO analytics_events (
        event_id, event_name, section, category, target_id, target_title,
        user_id, email, device_id, path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `evt_${crypto.randomUUID()}`,
      name.slice(0, 80),
      String(req.body.section || '').slice(0, 80),
      String(req.body.category || '').slice(0, 80),
      String(req.body.targetId || req.body.target_id || '').slice(0, 120),
      String(req.body.targetTitle || req.body.target_title || '').slice(0, 200),
      user?.id || '',
      user?.email || '',
      String(req.body.deviceId || req.body.device_id || '').slice(0, 80),
      String(req.body.path || '').slice(0, 160),
      new Date().toISOString(),
    );
  res.status(201).json({ ok: true });
});

module.exports = { router };
