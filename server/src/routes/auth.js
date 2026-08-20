import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../services/rackService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendLoginOtp, verifyLoginOtp, VastraApiError, VastraRejection } from '../vastraClient.js';
import { establishSession } from '../services/session.js';
import { startAttempt, readAttempt, cancelAttempt } from '../services/qrLogin.js';

const router = Router();

// Vastra is the identity provider: only people who already exist there can log
// in. No password, no signup, no admin "create org" — the single INSERT into
// `organization` below happens only after Vastra verifies an OTP.

const COUNTRY_CODE = /^\+[0-9]+$/;
const MOBILE = /^[0-9]{6,15}$/;
const OTP = /^[0-9]{3,10}$/;

// The two OTP endpoints are unauthenticated and each one costs Vastra a real
// SMS, so cap them per IP.
// ponytail: in-memory, per-process — move to a shared store if RMS ever runs multiple instances.
const WINDOW_MS = 60_000;
const MAX_HITS = 10;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const hit = hits.get(ip);
  if (!hit || now - hit.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    // Opportunistic sweep so the Map can't grow without bound.
    if (hits.size > 1000) {
      for (const [key, val] of hits) if (now - val.windowStart > WINDOW_MS) hits.delete(key);
    }
    return next();
  }
  if (++hit.count > MAX_HITS) {
    return next(new HttpError(429, 'Too many OTP requests — wait a minute and try again.'));
  }
  next();
}

// Vastra's own rejection message is safe to show (bad OTP, unknown mobile).
// A transport error's raw text is not — it can embed the internal Vastra IP, so
// it goes to the log and the browser gets a generic 502. Same discipline app.js
// already applies to driver errors.
function toHttpError(err, rejectionStatus) {
  if (err instanceof VastraRejection) return new HttpError(rejectionStatus, err.message);
  if (err instanceof VastraApiError) {
    console.error('Vastra call failed:', err.message);
    return new HttpError(502, 'Vastra login service unavailable: please try again in a moment.');
  }
  return err;
}

// POST /api/auth/send-otp — Vastra texts the OTP.
router.post('/send-otp', rateLimit, async (req, res, next) => {
  try {
    const { country_code = '+91', mobile, is_resend = 0 } = req.body || {};
    if (!COUNTRY_CODE.test(String(country_code))) {
      throw new HttpError(400, 'country_code must look like +91');
    }
    if (!MOBILE.test(String(mobile ?? ''))) throw new HttpError(400, 'mobile must be 6–15 digits');

    let message;
    try {
      message = await sendLoginOtp(String(country_code), String(mobile), is_resend ? 1 : 0);
    } catch (err) {
      throw toHttpError(err, 403);
    }
    res.json({ message });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/verify-otp — the only path that can create a session.
router.post('/verify-otp', rateLimit, async (req, res, next) => {
  try {
    const { country_code = '+91', mobile, otp } = req.body || {};
    if (!COUNTRY_CODE.test(String(country_code))) {
      throw new HttpError(400, 'country_code must look like +91');
    }
    if (!MOBILE.test(String(mobile ?? ''))) throw new HttpError(400, 'mobile must be 6–15 digits');
    if (!OTP.test(String(otp ?? ''))) throw new HttpError(400, 'otp must be 3–10 digits');

    let profile;
    try {
      profile = await verifyLoginOtp(String(country_code), String(mobile), String(otp));
    } catch (err) {
      throw toHttpError(err, 401);
    }

    // Shared with the QR path (services/qrLogin.js) so both login methods mint
    // sessions identically — same blocked check, same single-active-session
    // rule, same token refresh. Never returns the vastra_access_token.
    res.json(await establishSession(profile, mobile));
  } catch (err) {
    next(err);
  }
});

// ── QR login ──────────────────────────────────────────────────────────────
// The browser's whole view of the QR flow is these three endpoints. Everything
// else — the MQTT subscription, the two Vastra messages, the verify call — is
// handled in services/qrLogin.js, because Vastra gave us a plain TCP broker
// socket and a browser has no TCP API to dial it with.

// POST /api/auth/qr/start — mint an attempt and return what to draw.
// `poll_secret` is the browser's claim on this attempt: the QR on screen is
// public, this is not, so a photographed QR alone cannot collect the session.
router.post('/qr/start', rateLimit, async (req, res, next) => {
  try {
    const attempt = await startAttempt();
    res.json({
      id: attempt.id,
      poll_secret: attempt.pollSecret,
      value: attempt.value, // exactly what goes in the QR — the bare 15 chars
      expires_at: attempt.expiresAt,
    });
  } catch (err) {
    next(toHttpError(err, 403));
  }
});

// GET /api/auth/qr/status — polled while the QR is on screen.
//   pending  → waiting for a scan
//   scanned  → Vastra published isVerified; confirm on the phone
//   approved → carries { token, org }, exactly like verify-otp
//   expired | error | unknown → start a new attempt
// `unknown` deliberately covers both "no such attempt" and "wrong secret", so
// the endpoint cannot be used to probe which attempt ids are live.
router.get('/qr/status', (req, res, next) => {
  try {
    const { id, secret } = req.query || {};
    if (!id || !secret) throw new HttpError(400, 'id and secret are required');
    res.json(readAttempt(String(id), String(secret)));
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/qr/cancel — leaving the tab drops the MQTT subscription
// instead of holding it until the TTL sweeps it up.
router.post('/qr/cancel', (req, res, next) => {
  try {
    const { id, secret } = req.body || {};
    if (id && secret) cancelAttempt(String(id), String(secret));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — the Vastra session dies with ours.
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM session WHERE org_id = ?', [req.org.id]);
    await pool.query('UPDATE organization SET vastra_access_token = NULL WHERE id = ?', [req.org.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — lets the client restore a session on refresh.
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.org.id, name: req.org.name });
});

export default router;
