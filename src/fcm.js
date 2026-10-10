const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEAD_TOKEN = /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT|SENDER_ID_MISMATCH/;

let cachedAccount;
let cachedAccess;
let cachedAccessExp = 0;

function serviceAccountPath() {
  return String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
}

function loadAccount() {
  if (cachedAccount) return cachedAccount;
  const file = serviceAccountPath();
  if (!file) {
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is not set');
    err.status = 503;
    throw err;
  }
  const resolved = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) {
    const err = new Error('Firebase service account file is missing');
    err.status = 503;
    throw err;
  }
  cachedAccount = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!cachedAccount.client_email || !cachedAccount.private_key || !cachedAccount.project_id) {
    const err = new Error('Firebase service account JSON is incomplete');
    err.status = 503;
    throw err;
  }
  return cachedAccount;
}

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function signJwt(account) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: account.client_email,
    sub: account.client_email,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    scope: FCM_SCOPE,
  })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  return `${unsigned}.${sig.toString('base64url')}`;
}

async function accessToken() {
  if (cachedAccess && cachedAccessExp - 60 > Date.now() / 1000) return cachedAccess;
  const account = loadAccount();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(account),
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    const err = new Error(data.error_description || 'Could not get a Firebase access token');
    err.status = 503;
    throw err;
  }
  cachedAccess = data.access_token;
  cachedAccessExp = Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  return cachedAccess;
}

function fcmReady() {
  try {
    loadAccount();
    return true;
  } catch (_) {
    return false;
  }
}

function projectId() {
  return loadAccount().project_id;
}

async function sendToToken(deviceToken, { title, body }) {
  const token = await accessToken();
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: { title, body },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'ksa360_default',
              icon: 'ic_stat_ksa',
              sound: 'default',
              default_sound: true,
              default_vibrate_timings: true,
              notification_priority: 'PRIORITY_HIGH',
              visibility: 'PUBLIC',
            },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: { aps: { sound: 'default', badge: 1 } },
          },
        },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  const code = String(data.error?.status || data.error?.code || res.status);
  const message = String(data.error?.message || 'FCM send failed');
  return { ok: false, dead: DEAD_TOKEN.test(`${code} ${message}`), error: message };
}

module.exports = { sendToToken, fcmReady, loadAccount, serviceAccountPath };
