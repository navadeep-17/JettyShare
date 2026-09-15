export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">COASTAL JETTY SHARING BOARD</p>
        <h1>JettyShare</h1>
        <p className="lede">
          Share surplus ice and bait before it spoils. The live harbor board is being wired up now.
        </p>
        <div className="status-row" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          Implementation in progress
        </div>
      </section>
    </main>
  );
}
