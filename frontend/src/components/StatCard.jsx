export default function StatCard({ label, value, hint, accent = "cyan" }) {
  return (
    <article className={`stat-card ${accent}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}
