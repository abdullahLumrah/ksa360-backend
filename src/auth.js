const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-me') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return 'ksa-guide-local-dev-secret';
  }
  return secret;
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    dateOfBirth: row.date_of_birth || '',
    gender: row.gender || '',
    avatar: row.avatar || '',
    provider: row.provider || 'email',
  };
}

function signToken(userId) {
  const jti = crypto.randomUUID();
  const expiresIn = 60 * 60 * 24 * 30;
  const token = jwt.sign({ sub: userId, jti }, jwtSecret(), { expiresIn });
  db()
    .prepare(
      'INSERT INTO sessions (jti, user_id, expires_at) VALUES (?, ?, ?)',
    )
    .run(jti, userId, Math.floor(Date.now() / 1000) + expiresIn);
  return token;
}

function userById(id) {
  return db().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function userByEmail(email) {
  return db()
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
    .get(email);
}

function readBearer(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function loadSessionUser(token) {
  const payload = jwt.verify(token, jwtSecret());
  const session = db()
    .prepare('SELECT * FROM sessions WHERE jti = ?')
    .get(payload.jti);
  if (!session || session.revoked) {
    const err = new Error('Session expired. Sign in again.');
    err.status = 401;
    throw err;
  }
  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    const err = new Error('Session expired. Sign in again.');
    err.status = 401;
    throw err;
  }
  const user = userById(payload.sub);
  if (!user) {
    const err = new Error('Account not found');
    err.status = 401;
    throw err;
  }
  return { user, jti: payload.jti };
}

function requireUser(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue' });
  }
  try {
    const session = loadSessionUser(token);
    req.user = session.user;
    req.jti = session.jti;
    next();
  } catch (err) {
    return res.status(401).json({ error: err.message || 'Session expired. Sign in again.' });
  }
}

function optionalUser(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const session = loadSessionUser(token);
    req.user = session.user;
    req.jti = session.jti;
    return next();
  } catch (err) {
    return res.status(401).json({ error: err.message || 'Session expired. Sign in again.' });
  }
}

function softUser(req, res, next) {
  const token = readBearer(req);
  req.user = null;
  if (!token) return next();
  try {
    const session = loadSessionUser(token);
    req.user = session.user;
    req.jti = session.jti;
  } catch (_) {
    req.user = null;
  }
  return next();
}

function revokeSession(jti) {
  if (!jti) return;
  db().prepare('UPDATE sessions SET revoked = 1 WHERE jti = ?').run(jti);
}

function revokeAllForUser(userId) {
  db().prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function checkPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

async function verifyGoogleToken(idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  const data = await res.json();
  if (!data.email || data.email_verified === 'false') {
    const err = new Error('Google could not verify this account');
    err.status = 401;
    throw err;
  }
  const allowed = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!allowed.length) {
    const err = new Error('Google sign-in is not configured on the server');
    err.status = 503;
    throw err;
  }
  if (!allowed.includes(data.aud) && !allowed.includes(data.azp)) {
    const err = new Error('Google client is not configured for this app');
    err.status = 401;
    throw err;
  }
  return data;
}

const GOOGLE_REDIRECTS = new Set([
  'http://127.0.0.1:8765',
  'http://localhost:8765',
  'http://127.0.0.1:8765/',
  'http://localhost:8765/',
]);

async function exchangeGoogleCode(code, redirectUri) {
  if (!GOOGLE_REDIRECTS.has(redirectUri)) {
    const err = new Error('Invalid Google redirect');
    err.status = 400;
    throw err;
  }
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !secret) {
    const err = new Error('Google sign-in is not configured on the server');
    err.status = 503;
    throw err;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!data.id_token) {
    const err = new Error(data.error_description || 'Google could not complete sign-in');
    err.status = 401;
    throw err;
  }
  return verifyGoogleToken(data.id_token);
}

function mapGoogleGender(value) {
  const gender = String(value || '').trim().toLowerCase();
  if (gender === 'male' || gender === 'female' || gender === 'other') return gender;
  return '';
}

function mapGoogleBirthday(entry) {
  const date = entry?.date || {};
  const year = Number(date.year || 0);
  const month = Number(date.month || 0);
  const day = Number(date.day || 0);
  if (!year || !month || !day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function fetchGoogleProfile(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return {};
  try {
    const res = await fetch(
      'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses,birthdays,genders,photos',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const birthday = (data.birthdays || []).find((item) => item.date) || {};
    const gender = mapGoogleGender((data.genders || [])[0]?.value);
    return {
      name: String(data.names?.[0]?.displayName || '').trim(),
      picture: String(data.photos?.[0]?.url || '').trim(),
      dateOfBirth: mapGoogleBirthday(birthday),
      gender,
    };
  } catch (_) {
    return {};
  }
}

module.exports = {
  publicUser,
  signToken,
  userById,
  userByEmail,
  requireUser,
  optionalUser,
  softUser,
  revokeSession,
  revokeAllForUser,
  exchangeGoogleCode,
  fetchGoogleProfile,
  hashPassword,
  checkPassword,
  verifyGoogleToken,
};
