"use client";

export default function UnlockCard({
  accessInput,
  setAccessInput,
  unlock,
  loading,
  notice,
}) {
  return (
    <main className="unlock-page">
      <section className="unlock-card">
        <div className="brand-mark" aria-hidden="true">*</div>
        <p className="eyebrow">NOTES</p>
        <h1>Private notes</h1>
        <p className="muted">Enter your key to continue.</p>
        <form onSubmit={unlock} className="unlock-form">
          <label htmlFor="access-key">Access key</label>
          <input
            id="access-key"
            type="password"
            autoComplete="current-password"
            value={accessInput}
            onChange={(event) => setAccessInput(event.target.value)}
            placeholder="Your key"
            required
          />
          <button className="button primary" type="submit" disabled={loading}>
            {loading ? "Opening..." : "Open"}
          </button>
        </form>
        {notice && <p className="form-message">{notice}</p>}
      </section>
    </main>
  );
}
