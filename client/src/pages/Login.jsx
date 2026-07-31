import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

// Vastra mobile + OTP login. Two steps: mobile → OTP. There is no password and
// no signup — only organizations that already exist in Vastra can get in.
export default function Login() {
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState('mobile');
  const [countryCode, setCountryCode] = useState('+91');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (isResend = 0) => {
    if (!/^[0-9]{6,15}$/.test(mobile)) return toast('Enter a valid mobile number', 'warning');
    setBusy(true);
    try {
      const { message } = await api.sendOtp(countryCode, mobile, isResend);
      toast(message || 'OTP sent', 'success');
      setStep('otp');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!otp.trim()) return toast('Enter the OTP', 'warning');
    setBusy(true);
    try {
      const { token, org } = await api.verifyOtp(countryCode, mobile, otp.trim());
      setToken(token);
      toast(`Welcome, ${org.name}`, 'success');
      navigate('/', { replace: true });
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
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <div className="flex items-center gap-3 mt-4 text-sm">
                <a href="#" onClick={(e) => { e.preventDefault(); send(1); }}>Resend OTP</a>
                <span className="text-muted">·</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setStep('mobile'); setOtp(''); }}>
                  Change number
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
