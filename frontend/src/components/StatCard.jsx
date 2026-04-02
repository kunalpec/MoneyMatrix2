export default function StatCard({ label, value, hint, accent = "cyan" }) {
  return (
    <article className={`stat-card ${accent}`}>
      <div className="stat-card-head">
        <p>{label}</p>
        <span className="stat-orb" aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}
