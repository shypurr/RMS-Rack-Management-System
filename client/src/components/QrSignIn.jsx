import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, setToken } from '../api/client.js';

// The QR half of the login page. All this does is draw the value the server
// gave it and poll for the outcome — the MQTT subscription, Vastra's two
// messages and the verify call all happen server-side, because Vastra issued a
// plain TCP broker socket and a browser cannot open one.
//
// Poll rather than stream: the QR is on screen for two minutes at most and the
// status lookup is a single in-memory read, so an EventSource would be more
// moving parts for no gain.
const POLL_MS = 1500;

const MESSAGES = {
  starting: 'Preparing your code…',
  pending: 'Scan this code with the Vastra app on your phone.',
  scanned: 'Scanned — confirm the sign-in on your phone.',
  approved: 'Signing you in…',
};

export default function QrSignIn({ onSuccess, onError }) {
  const [phase, setPhase] = useState('starting');
  const [message, setMessage] = useState(MESSAGES.starting);
  const canvasRef = useRef(null);
  // Held in a ref, not state: the poll and the cleanup both need the current
  // attempt without re-subscribing the interval on every render.
  const attemptRef = useRef(null);
  // Ditto for the callbacks. If the parent passes inline arrows (it does), a
  // deps array containing them would tear down and recreate the interval on
  // every render — which restarts the 1.5s timer each time and can mean it
  // never actually fires.
  const cbRef = useRef({ onSuccess, onError });
  cbRef.current = { onSuccess, onError };

  const start = useCallback(async () => {
    setPhase('starting');
    setMessage(MESSAGES.starting);
    try {
      const attempt = await api.qrStart();
      attemptRef.current = attempt;
      // The QR carries the bare value and nothing else — that is what the
      // Vastra app expects to read.
      await QRCode.toCanvas(canvasRef.current, attempt.value, {
        width: 232,
        margin: 1,
        // Fixed black-on-white regardless of theme: scanners need the contrast,
        // and an inverted code in dark mode reads poorly on many phones.
        color: { dark: '#000000', light: '#ffffff' },
      });
      setPhase('pending');
      setMessage(MESSAGES.pending);
    } catch (e) {
      setPhase('error');
      setMessage(e.message);
    }
  }, []);

  // Start one attempt on mount, and make sure leaving the tab drops the
  // server's MQTT subscription instead of stranding it until the TTL sweep.
  useEffect(() => {
    start();
    return () => {
      const attempt = attemptRef.current;
      attemptRef.current = null;
      if (attempt) api.qrCancel(attempt.id, attempt.poll_secret).catch(() => {});
    };
  }, [start]);

  // Poll only while an attempt is actually in flight; expired/error/approved
  // all clear the interval by flipping `phase`.
  useEffect(() => {
    if (phase !== 'pending' && phase !== 'scanned') return undefined;

    let cancelled = false;
    const timer = setInterval(async () => {
      const attempt = attemptRef.current;
      if (!attempt) return;
      let res;
      try {
        res = await api.qrStatus(attempt.id, attempt.poll_secret);
      } catch {
        return; // a dropped poll is not fatal — the next tick retries
      }
      if (cancelled) return;

      if (res.status === 'scanned') {
        setPhase('scanned');
        setMessage(MESSAGES.scanned);
        return;
      }
      if (res.status === 'approved') {
        setPhase('approved');
        setMessage(MESSAGES.approved);
        // The attempt is consumed server-side by this read, so cancelling it on
        // unmount would be a no-op at best.
        attemptRef.current = null;
        setToken(res.token);
        cbRef.current.onSuccess(res.org);
        return;
      }
      if (res.status === 'error') {
        attemptRef.current = null;
        setPhase('error');
        setMessage(res.error || 'QR sign-in failed. Please try again.');
        cbRef.current.onError?.(res.error);
        return;
      }
      // 'expired' and 'unknown' both mean this code is dead — the server has
      // already dropped it, so there is nothing left to cancel.
      if (res.status === 'expired' || res.status === 'unknown') {
        attemptRef.current = null;
        setPhase('expired');
        setMessage('This code has expired.');
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase]);

  const stale = phase === 'expired' || phase === 'error';

  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-block',
          padding: 12,
          borderRadius: 12,
          background: '#ffffff',
          border: '1px solid var(--border, #e5e7eb)',
          position: 'relative',
          // Dimmed rather than hidden, so the panel does not jump height when a
          // code expires or a scan lands.
          opacity: stale ? 0.25 : phase === 'scanned' || phase === 'approved' ? 0.45 : 1,
          transition: 'opacity 150ms ease',
        }}
      >
        <canvas ref={canvasRef} width={232} height={232} style={{ display: 'block' }} />
      </div>

      <p
        className="text-sm mt-4"
        style={{ color: phase === 'error' ? 'var(--danger, #dc2626)' : 'var(--text-muted, #6b7280)' }}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>

      {stale && (
        <button className="btn btn-secondary mt-2" type="button" onClick={start}>
          Show a new code
        </button>
      )}
    </div>
  );
}
