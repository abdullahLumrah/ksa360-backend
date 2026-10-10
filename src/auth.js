const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, syncUserActivityStats } = require('./db');

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

function parseJsonList(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch (_) {
    return [];
  }
}

function publicUser(row, { refreshStats = false } = {}) {
  const fresh = refreshStats && row?.id ? syncUserActivityStats(row.id) || row : row;
  const communityIds = parseJsonList(fresh.community_ids);
  const communityNames = parseJsonList(fresh.community_names);
  const communities = communityIds.map((id, index) => ({
    id,
    name: communityNames[index] || id,
  }));
  return {
    id: fresh.id,
    name: fresh.name,
    email: fresh.email,
    dateOfBirth: fresh.date_of_birth || '',
    gender: fresh.gender || '',
    phone: fresh.phone || '',
    avatar: fresh.avatar || '',
    provider: fresh.provider || 'email',
    profileComplete: Boolean(
      String(fresh.phone || '').trim() &&
        String(fresh.gender || '').trim() &&
        String(fresh.date_of_birth || '').trim(),
    ),
    deletedAt: fresh.deleted_at || '',
    isCommunityMember: Boolean(fresh.is_community_member),
    communities,
    communityIds,
    communityNames,
    pagesOwnedCount: Number(fresh.pages_owned_count || 0),
    hasPlacedAd: Boolean(fresh.has_placed_ad),
    adCount: Number(fresh.ad_count || 0),
    communityPostCount: Number(fresh.community_post_count || 0),
    jobCount: Number(fresh.job_count || 0),
    commentCount: Number(fresh.comment_count || 0),
    isDummy: Boolean(fresh.is_dummy),
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
  if (isPermanentlyDeleted(user)) {
    const err = new Error('This account was permanently deleted');
    err.status = 401;
    throw err;
  }
  return { user, jti: payload.jti };
}

const DELETE_GRACE_MS = 15 * 24 * 60 * 60 * 1000;

function deletionAgeMs(user) {
  const raw = String(user?.deleted_at || '').trim();
  if (!raw) return 0;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Date.now() - at;
}

function isSoftDeleted(user) {
  return Boolean(String(user?.deleted_at || '').trim());
}

function isPermanentlyDeleted(user) {
  return isSoftDeleted(user) && deletionAgeMs(user) > DELETE_GRACE_MS;
}

function canRestore(user) {
  return isSoftDeleted(user) && deletionAgeMs(user) <= DELETE_GRACE_MS;
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

async function fetchGoogleProfile(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return {};
  try {
    const res = await fetch(
      'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses,photos',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return {};
    const data = await res.json();
    return {
      name: String(data.names?.[0]?.displayName || '').trim(),
      picture: String(data.photos?.[0]?.url || '').trim(),
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
  isSoftDeleted,
  isPermanentlyDeleted,
  canRestore,
  DELETE_GRACE_MS,
};
