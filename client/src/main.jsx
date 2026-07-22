import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/Toast.jsx';
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
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
