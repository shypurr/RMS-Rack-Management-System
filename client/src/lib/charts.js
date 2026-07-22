// Register Chart.js pieces once, re-export the React chart components.
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

// Muted tick/grid colors that read on both light and dark themes.
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,.15)';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";

export { Line, Doughnut, Bar, Pie } from 'react-chartjs-2';

// Build a continuous last-7-days axis from sparse {day, added, moved} rows.
export function sevenDayTrend(trend) {
  const key = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local tz
  const map = new Map(trend.map((r) => [key(new Date(r.day)), r]));
  const labels = [];
  const added = [];
  const moved = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-IN', { weekday: 'short' }));
    const row = map.get(key(d));
    added.push(row ? row.added : 0);
    moved.push(row ? row.moved : 0);
  }
  return { labels, added, moved };
}
