import { createContext, useCallback, useContext, useState } from 'react';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

const ICONS = { success: 'check', error: 'xmark', warning: 'triangle-exclamation', info: 'circle-info' };
const TITLES = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, type = 'success', title = '') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type, title: title || TITLES[type] }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast show ${t.type}`}>
            <div className="toast-icon"><i className={`fa-solid fa-${ICONS[t.type] || 'circle-info'}`} /></div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              <div className="toast-msg">{t.msg}</div>
            </div>
            <div className="toast-close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <i className="fa-solid fa-xmark" />
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
