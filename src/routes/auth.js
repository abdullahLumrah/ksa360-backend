const { Router } = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const {
  publicUser,
  signToken,
  userByEmail,
  userByAppleId,
  requireUser,
  revokeSession,
  revokeAllForUser,
  hashPassword,
  checkPassword,
  verifyGoogleToken,
  verifyAppleToken,
  exchangeGoogleCode,
  fetchGoogleProfile,
  isPermanentlyDeleted,
  canRestore,
} = require('../auth');
const { recordEvent } = require('./analytics');

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSaudiPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('966')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^5\d{8}$/.test(digits)) return '';
  return `+966${digits}`;
}

function insertUser(input) {
  const id = input.id || crypto.randomUUID();
  db()
    .prepare(
      `INSERT INTO users (
        id, name, email, password_hash, google_id, apple_id, date_of_birth, gender, phone, avatar, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.email,
      input.password_hash || null,
      input.google_id || null,
      input.apple_id || null,
      input.date_of_birth || '',
      input.gender || '',
      input.phone || '',
      input.avatar || '',
      input.provider || 'email',
    );
  return db().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function restoreIfNeeded(user) {
  if (!user || !canRestore(user)) return user;
  db()
    .prepare("UPDATE users SET deleted_at = '', updated_at = datetime('now') WHERE id = ?")
    .run(user.id);
  recordEvent({
    event: 'account_restore',
    section: 'auth',
    user,
  });
  return db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

function issueSession(user, event) {
  const ready = restoreIfNeeded(user);
  recordEvent({ event, section: 'auth', user: ready });
  return { token: signToken(ready.id), user: publicUser(ready) };
}

function rejectDeleted(user, res) {
  if (!user) return false;
  if (isPermanentlyDeleted(user)) {
    res.status(403).json({ error: 'This account was permanently deleted' });
    return true;
  }
  return false;
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
    const phone = normalizeSaudiPhone(body.phone);

    if (name.length < 2) return res.status(400).json({ error: 'Enter your name' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match' });
    const existing = userByEmail(email);
    if (existing && !canRestore(existing)) {
      if (isPermanentlyDeleted(existing)) {
        return res.status(403).json({ error: 'This account was permanently deleted' });
      }
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    let user = existing;
    if (existing && canRestore(existing)) {
      db()
        .prepare(
          `UPDATE users SET
            name = ?, password_hash = ?, phone = CASE WHEN ? != '' THEN ? ELSE phone END,
            deleted_at = '', updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(name, await hashPassword(password), phone, phone, existing.id);
      user = db().prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
      return res.status(200).json(issueSession(user, 'account_restore'));
    }

    user = insertUser({
      name,
      email,
      password_hash: await hashPassword(password),
      phone,
      provider: 'email',
    });
    res.status(201).json(issueSession(user, 'register'));
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
    if (rejectDeleted(user, res)) return;
    res.json(issueSession(user, 'login'));
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
    let user = userByEmail(email);
    if (user && rejectDeleted(user, res)) return;
    if (!user) {
      user = insertUser({
        name,
        email,
        google_id: google.sub,
        avatar,
        provider: 'google',
      });
      return res.json(issueSession(user, 'register'));
    }
    db()
      .prepare(
        `UPDATE users SET
          google_id = COALESCE(google_id, ?),
          name = CASE WHEN name = '' THEN ? ELSE name END,
          avatar = CASE WHEN avatar = '' THEN ? ELSE avatar END,
          provider = CASE WHEN provider = 'email' THEN 'email' ELSE 'google' END,
          updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(google.sub, name, avatar, user.id);
    user = db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json(issueSession(user, 'login'));
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Google sign-in failed' });
  }
});

router.post('/apple', async (req, res) => {
  try {
    const identityToken = String(req.body?.identityToken || req.body?.identity_token || '').trim();
    const appleUserId = String(req.body?.appleUserId || req.body?.apple_user_id || '').trim();
    const clientEmail = cleanEmail(req.body?.email);
    const fullName = cleanName(req.body?.fullName || req.body?.full_name);
    const apple = await verifyAppleToken(identityToken);
    const sub = String(apple.sub || appleUserId || '').trim();
    if (!sub) return res.status(401).json({ error: 'Apple could not verify this account' });
    const tokenEmail = cleanEmail(apple.email);
    const email =
      tokenEmail ||
      clientEmail ||
      `apple.${sub.replace(/[^a-zA-Z0-9._-]/g, '')}@privaterelay.appleid.com`;
    const name = fullName || (email.includes('@') ? email.split('@')[0] : 'Apple user');
    let user = userByAppleId(sub) || (tokenEmail ? userByEmail(tokenEmail) : null) || (clientEmail ? userByEmail(clientEmail) : null);
    if (user && rejectDeleted(user, res)) return;
    if (!user) {
      user = insertUser({
        name,
        email,
        apple_id: sub,
        provider: 'apple',
      });
      return res.json(issueSession(user, 'register'));
    }
    db()
      .prepare(
        `UPDATE users SET
          apple_id = COALESCE(NULLIF(apple_id, ''), ?),
          email = CASE WHEN email = '' THEN ? ELSE email END,
          name = CASE WHEN name = '' THEN ? ELSE name END,
          provider = CASE WHEN provider = 'email' THEN 'email' ELSE
            CASE WHEN provider = 'google' THEN 'google' ELSE 'apple' END END,
          updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(sub, email, name, user.id);
    user = db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json(issueSession(user, 'login'));
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Apple sign-in failed' });
  }
});

router.post('/logout', requireUser, (req, res) => {
  recordEvent({ event: 'logout', section: 'auth', user: req.user });
  revokeSession(req.jti);
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  if (rejectDeleted(req.user, res)) return;
  res.json(publicUser(req.user, { refreshStats: true }));
});

router.patch('/me', requireUser, (req, res) => {
  if (rejectDeleted(req.user, res)) return;
  const body = req.body || {};
  const name = body.name != null ? cleanName(body.name) : req.user.name;
  const phone = body.phone != null ? normalizeSaudiPhone(body.phone) : req.user.phone;
  const gender = body.gender != null
    ? String(body.gender || '').trim().toLowerCase()
    : req.user.gender;
  const dateOfBirth = body.dateOfBirth != null || body.date_of_birth != null
    ? String(body.dateOfBirth || body.date_of_birth || '').trim()
    : req.user.date_of_birth;
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name' });
  if (body.phone != null && !phone) {
    return res.status(400).json({ error: 'Enter a valid Saudi mobile number' });
  }
  if (body.gender != null && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'Choose male, female, or other' });
  }
  if (body.dateOfBirth != null || body.date_of_birth != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return res.status(400).json({ error: 'Enter a valid date of birth' });
    }
    const date = new Date(`${dateOfBirth}T00:00:00Z`);
    const oldest = new Date();
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 13);
    if (Number.isNaN(date.getTime()) || date > oldest) {
      return res.status(400).json({ error: 'Enter a valid date of birth (13+)' });
    }
  }
  const wasComplete = Boolean(
    String(req.user.phone || '').trim() &&
      String(req.user.gender || '').trim() &&
      String(req.user.date_of_birth || '').trim(),
  );
  db()
    .prepare(
      `UPDATE users SET name = ?, phone = ?, gender = ?, date_of_birth = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(name, phone, gender || '', dateOfBirth || '', req.user.id);
  const user = db().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const nowComplete = Boolean(phone && gender && dateOfBirth);
  if (!wasComplete && nowComplete) {
    recordEvent({ event: 'profile_complete', section: 'profile', user });
  }
  res.json(publicUser(user));
});

function scheduleAccountDeletion(user) {
  const now = new Date().toISOString();
  db()
    .prepare("UPDATE users SET deleted_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(now, user.id);
  recordEvent({ event: 'account_delete', section: 'auth', user });
  revokeAllForUser(user.id);
  const restoreUntil = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    message: 'Account scheduled for deletion. Sign in within 15 days to restore it.',
    restoreUntil,
  };
}

router.delete('/me', requireUser, (req, res) => {
  if (rejectDeleted(req.user, res)) return;
  res.json(scheduleAccountDeletion(req.user));
});

router.post('/delete-account', async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!EMAIL.test(email)) {
      return res.status(400).json({ error: 'Enter the email on the KSA 360 account' });
    }
    const user = userByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }
    if (rejectDeleted(user, res)) return;
    if (!user.password_hash) {
      return res.status(400).json({
        error:
          'This account uses Google sign-in. Delete it in KSA 360 → Profile → Manage profile, or email privacy@lumrah.co from this same address.',
      });
    }
    if (!(await checkPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }
    res.json(scheduleAccountDeletion(user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not delete the account' });
  }
});

module.exports = { router };
