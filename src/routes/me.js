const express = require('express');
const { upsertToken } = require('../push');

const router = express.Router();

router.post('/push-token', (req, res) => {
  const saved = upsertToken({
    token: req.body.token,
    platform: req.body.platform,
    userId: req.user?.id || null,
  });
  res.json(saved);
});

module.exports = { router };
