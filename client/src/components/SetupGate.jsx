import { Link } from 'react-router-dom';
import { useLayoutStatus } from '../lib/layout.js';

// Wraps any page that is meaningless before the organization has bins.
//
// The server refuses these operations independently — this is the friendly
// half, so the user gets a route to the fix instead of an empty list that looks
// like a bug.
export default function SetupGate({ children }) {
  const { loading, configured } = useLayoutStatus();

  if (loading) return <div className="skeleton" style={{ height: 220 }} />;
  if (configured) return children;

  return (
    <div className="empty-state">
      <i className="fa-solid fa-warehouse" />
      <p>No racks configured yet — set up your rack layout to start storing stock.</p>
      <Link className="btn btn-primary mt-4" to="/setup">Set up rack layout</Link>
    </div>
  );
}
