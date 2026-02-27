export default function DashboardPage(): JSX.Element {
  return (
    <section className="grid" style={{ gap: '1.25rem' }}>
      <h1>Dashboard</h1>
      <div className="grid grid-3">
        <article className="card">
          <h2>Total contacts</h2>
          <p>0</p>
        </article>
        <article className="card">
          <h2>Recent activity</h2>
          <p>No activity yet.</p>
        </article>
        <article className="card">
          <h2>Enrichment jobs</h2>
          <p>Deferred to later PRs.</p>
        </article>
      </div>
    </section>
  );
}
