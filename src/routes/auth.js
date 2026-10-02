const { Router } = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const {
  publicUser,
  signToken,
  userByEmail,
  requireUser,
  revokeSession,
  hashPassword,
  checkPassword,
  verifyGoogleToken,
  exchangeGoogleCode,
  fetchGoogleProfile,
} = require('../auth');

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = new Set(['male', 'female', 'other']);

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validDob(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const oldest = new Date();
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 13);
  return date <= oldest;
}

function insertUser(input) {
  const id = input.id || crypto.randomUUID();
  db()
    .prepare(
      `INSERT INTO users (
        id, name, email, password_hash, google_id, date_of_birth, gender, avatar, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.email,
      input.password_hash || null,
      input.google_id || null,
      input.date_of_birth || '',
      input.gender || '',
      input.avatar || '',
      input.provider || 'email',
    );
  return db().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

router.get('/google-config', (_req, res) => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  res.json({ enabled: Boolean(clientId), clientId });
});

router.post('/register', async (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanName(body.name);
    const email = cleanEmail(body.email);
    const password = String(body.password || '');
    const confirm = String(body.confirmPassword || body.password || '');
    const dateOfBirth = String(body.dateOfBirth || body.date_of_birth || '').trim();
    const gender = String(body.gender || '').trim().toLowerCase();

    if (name.length < 2) return res.status(400).json({ error: 'Enter your name' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match' });
    if (!validDob(dateOfBirth)) {
      return res.status(400).json({ error: 'Enter a valid date of birth (13+)' });
    }
    if (!GENDERS.has(gender)) {
      return res.status(400).json({ error: 'Choose male, female, or other' });
    }
    if (userByEmail(email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = insertUser({
      name,
      email,
      password_hash: await hashPassword(password),
      date_of_birth: dateOfBirth,
      gender,
      provider: 'email',
    });
    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = userByEmail(email);
    if (!user || !(await checkPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }
    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not sign in' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || req.body?.id_token || '').trim();
    const code = String(req.body?.code || '').trim();
    const redirectUri = String(req.body?.redirectUri || req.body?.redirect_uri || '').trim();
    const accessToken = String(req.body?.accessToken || req.body?.access_token || '').trim();
    if (!idToken && !code) return res.status(400).json({ error: 'Google token is required' });
    const google = code
      ? await exchangeGoogleCode(code, redirectUri)
      : await verifyGoogleToken(idToken);
    const people = await fetchGoogleProfile(accessToken);
    const email = cleanEmail(google.email);
    const name = cleanName(people.name || google.name || email.split('@')[0]);
    const avatar = String(people.picture || google.picture || '');
    const dateOfBirth = people.dateOfBirth || '';
    const gender = people.gender || '';
    let user = userByEmail(email);
    if (!user) {
      user = insertUser({
        name,
        email,
        google_id: google.sub,
        date_of_birth: dateOfBirth,
        gender,
        avatar,
        provider: 'google',
      });
    } else {
      db()
        .prepare(
          `UPDATE users SET
            google_id = COALESCE(google_id, ?),
            name = CASE WHEN name = '' THEN ? ELSE name END,
            avatar = CASE WHEN avatar = '' THEN ? ELSE avatar END,
            date_of_birth = CASE WHEN date_of_birth = '' THEN ? ELSE date_of_birth END,
            gender = CASE WHEN gender = '' THEN ? ELSE gender END,
            provider = CASE WHEN provider = 'email' THEN 'email' ELSE 'google' END,
            updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(google.sub, name, avatar, dateOfBirth, gender, user.id);
      user = db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Google sign-in failed' });
  }
});

router.post('/logout', requireUser, (req, res) => {
  revokeSession(req.jti);
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json(publicUser(req.user));
});

router.patch('/me', requireUser, (req, res) => {
  const body = req.body || {};
  const name = body.name != null ? cleanName(body.name) : req.user.name;
  const dateOfBirth = body.dateOfBirth != null || body.date_of_birth != null
    ? String(body.dateOfBirth || body.date_of_birth || '').trim()
    : req.user.date_of_birth;
  const gender = body.gender != null
    ? String(body.gender || '').trim().toLowerCase()
    : req.user.gender;
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name' });
  if (dateOfBirth && !validDob(dateOfBirth)) {
    return res.status(400).json({ error: 'Enter a valid date of birth (13+)' });
  }
  if (gender && !GENDERS.has(gender)) {
    return res.status(400).json({ error: 'Choose male, female, or other' });
  }
  db()
    .prepare(
      `UPDATE users SET name = ?, date_of_birth = ?, gender = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(name, dateOfBirth, gender, req.user.id);
  const user = db().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(publicUser(user));
});

module.exports = { router };
