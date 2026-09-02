import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import QrSignIn from '../components/QrSignIn.jsx';
import { extractOtp } from '../lib/otp.js';

// Two ways in, both ending at the same place: an RMS session token from
// /api/auth. Vastra is the identity provider either way — there is no password
// and no signup, so only organizations that already exist there can get in.
//
//   OTP — mobile → OTP, entered here.
//   QR  — scan the code in the Vastra app and confirm on the phone.
export default function Login() {
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('otp');
  const [step, setStep] = useState('mobile');
  const [countryCode, setCountryCode] = useState('+91');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [autoFilled, setAutoFilled] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (isResend = 0) => {
    if (!/^[0-9]{6,15}$/.test(mobile)) return toast('Enter a valid mobile number', 'warning');
    setBusy(true);
    try {
      const { message } = await api.sendOtp(countryCode, mobile, isResend);
      toast(message || 'OTP sent', 'success');
      setStep('otp');

      // Vastra's staging message carries the code itself, so put it in the box
      // rather than making the tester retype what is already on their screen.
      // extractOtp returns null unless it is sure, so when the message stops
      // carrying a code this simply leaves the field empty. See lib/otp.js.
      const code = extractOtp(message, mobile);
      setOtp(code || '');
      setAutoFilled(!!code);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Both login paths land here. QrSignIn has already stored the token by the
  // time it calls this, exactly as verify() does below.
  const enter = (org) => {
    toast(`Welcome, ${org.name}`, 'success');
    navigate('/', { replace: true });
  };

  const verify = async () => {
    if (!otp.trim()) return toast('Enter the OTP', 'warning');
    setBusy(true);
    try {
      const { token, org } = await api.verifyOtp(countryCode, mobile, otp.trim());
      setToken(token);
      enter(org);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="card-body">
          <div className="flex items-center gap-3 mb-4">
            <div className="logo-icon"><i className="fa-solid fa-warehouse" /></div>
            <div className="logo-text">Vastra<span>WMS</span></div>
          </div>
          <h2 className="font-700 mb-2">Sign in</h2>

          <div
            role="tablist"
            className="flex mb-4"
            style={{ borderBottom: '1px solid var(--border, #e5e7eb)', gap: 4 }}
          >
            {[['otp', 'Mobile OTP'], ['qr', 'Scan QR']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontWeight: mode === key ? 700 : 500,
                  color: mode === key ? 'var(--primary, #2563eb)' : 'var(--text-muted, #6b7280)',
                  // Transparent, not absent, so switching tabs does not shift
                  // the panel by a pixel.
                  borderBottom: `2px solid ${mode === key ? 'var(--primary, #2563eb)' : 'transparent'}`,
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'qr' ? (
            // Mounting starts an attempt; unmounting cancels it, so flipping
            // tabs never leaves an MQTT subscription open on the server.
            <QrSignIn onSuccess={enter} onError={(m) => m && toast(m, 'error')} />
          ) : (
          <>
          <p className="text-sm text-muted mb-4">
            {step === 'mobile'
              ? 'Enter the mobile number registered with Vastra. We will text you an OTP.'
              : `Enter the OTP sent to ${countryCode} ${mobile}.`}
          </p>

          {step === 'mobile' ? (
            <form onSubmit={(e) => { e.preventDefault(); send(0); }}>
              <div className="grid cols-2 gap-col-4">
                <div className="form-group">
                  <label className="form-label">Code</label>
                  <input className="form-control" value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile <span className="required">*</span></label>
                  <input className="form-control" inputMode="numeric" autoFocus
                    placeholder="9XXXXXXXXX" value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ''))} />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Sending…' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); verify(); }}>
              <div className="form-group">
                <label className="form-label">OTP <span className="required">*</span></label>
                <input className="form-control" inputMode="numeric" autoFocus placeholder="••••"
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/[^0-9]/g, '')); setAutoFilled(false); }} />
                {/* Say that it was filled in, so a wrong code is obviously a
                    filled-in wrong code rather than something the user typed. */}
                {autoFilled && (
                  <p className="text-xs text-muted mt-1">
                    <i className="fa-solid fa-wand-magic-sparkles" />&nbsp;
                    Filled in from the message — staging only, edit it if it looks wrong.
                  </p>
                )}
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <div className="flex items-center gap-3 mt-4 text-sm">
                <a href="#" onClick={(e) => { e.preventDefault(); send(1); }}>Resend OTP</a>
                <span className="text-muted">·</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setStep('mobile'); setOtp(''); setAutoFilled(false); }}>
                  Change number
                </a>
              </div>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
