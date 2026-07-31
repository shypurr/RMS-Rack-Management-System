import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { getToken } from './api/client.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import RackList from './pages/RackList.jsx';
import ItemManagement from './pages/ItemManagement.jsx';
import AddItem from './pages/AddItem.jsx';
import MoveItem from './pages/MoveItem.jsx';
import RackReport from './pages/RackReport.jsx';
import Reports from './pages/Reports.jsx';
import AuditLog from './pages/AuditLog.jsx';
import './styles/style.css';
import './styles/responsive.css';

// Must be a component, not `getToken() ? … : …` inlined into the `element`
// prop: that expression evaluates once when this file renders and freezes the
// result, so logging in would save the token but still bounce back to /login
// until a manual page reload. As a component it re-reads on every render.
function RequireAuth() {
  return getToken() ? <Layout /> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* Outside <Layout /> — the login screen has no sidebar. */}
          <Route path="/login" element={<Login />} />
          {/* No token → straight to /login. A 401 from any API call also lands
              here (see api/client.js), so an expired session self-corrects. */}
          <Route element={<RequireAuth />}>
            <Route index element={<Dashboard />} />
            <Route path="racks" element={<RackList />} />
            <Route path="items" element={<ItemManagement />} />
            <Route path="add" element={<AddItem />} />
            <Route path="move" element={<MoveItem />} />
            <Route path="reports" element={<Reports />} />
            <Route path="report" element={<RackReport />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>
);
