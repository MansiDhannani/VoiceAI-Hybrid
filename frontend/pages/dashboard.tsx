import React, { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

const Canvas        = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
const ParticleField = dynamic(() => import("../components/ParticleField"), { ssr: false });

export default function Dashboard() {
  const router = useRouter();
  const [username, setUsername]   = useState("");
  const [hasProfile, setHasProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [health, setHealth]       = useState<any>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user  = localStorage.getItem("username");
    if (!token) { router.push("/"); return; }
    setUsername(user || "");
    fetch(`${API_URL}/health`, { headers: NGROK_HEADER })
      .then(r => r.json()).then(setHealth).catch(() => {});
    fetch(`${API_URL}/voice/status`, {
      headers: { Authorization: `Bearer ${token}`, ...NGROK_HEADER },
    }).then(r => r.json()).then(d => setHasProfile(d.has_profile)).catch(() => {});
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg("");
    const form = new FormData();
    Array.from(files).forEach(f => form.append("files", f));
    try {
      const res = await fetch(`${API_URL}/voice/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...NGROK_HEADER },
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      setHasProfile(true);
      setUploadMsg("✅ Voice profile ready");
    } catch (err: any) {
      setUploadMsg("❌ " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteProfile = async () => {
    await fetch(`${API_URL}/voice/profile`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...NGROK_HEADER },
    });
    setHasProfile(false);
  };

  const logout = () => { localStorage.clear(); router.push("/"); };

  return (
    <div style={s.page}>
      <style>{`
        @keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:.7} }
        @keyframes floatY { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        .hero-btn:hover { opacity:.92; transform:scale(1.02); }
        .hero-btn { transition: all .18s ease; }
        .muted-btn:hover { background: rgba(255,255,255,0.08) !important; }
        .muted-btn { transition: background .15s ease; }
        details summary { cursor:pointer; list-style:none; }
        details summary::-webkit-details-marker { display:none; }
      `}</style>

      {/* ── Top bar ─────────────────────────────────────── */}
      <div style={s.topbar}>
        <span style={s.topbarLogo}>🎙 VoiceAI</span>
        <div style={s.topbarRight}>
          <span style={s.topbarUser}>👤 {username}</span>
          <button style={s.topbarBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      {/* ── HERO ────────────────────────────────────────── */}
      <div style={s.hero}>
        {/* 3-D particles in hero bg */}
        <div style={s.heroBg}>
          <Canvas camera={{ position: [0, 0, 7], fov: 55 }} style={{ background: "transparent" }}>
            <Suspense fallback={null}>
              <ParticleField count={320} color="#22d3ee" />
            </Suspense>
          </Canvas>
        </div>

        <div style={s.heroInner}>
          {/* Waveform icon */}
          <div style={s.waveIcon}>
            {[14, 22, 30, 22, 14, 28, 20, 12, 26, 18].map((h, i) => (
              <div key={i} style={{
                width: 4, height: h, borderRadius: 3,
                background: "linear-gradient(180deg,#22d3ee,#6366f1)",
                animation: `floatY ${0.6 + i * 0.08}s ease-in-out infinite`,
                animationDelay: `${i * 0.06}s`,
              }} />
            ))}
          </div>

          <div style={s.heroBadge}>✦ MAIN FEATURE</div>
          <h1 style={s.heroTitle}>Multi-Speaker Dialogue Studio</h1>
          <p style={s.heroSub}>
            Upload voice samples for 2–3 speakers, write a script, and render a complete
            multi-language conversation in cloned voices — in one click.
          </p>

          <button
            className="hero-btn"
            style={s.heroCta}
            onClick={() => router.push("/dialogue")}
          >
            🎬 Open Dialogue Studio
          </button>

          {/* Tech tooltip */}
          <details style={s.techDetails}>
            <summary style={s.techSummary}>▸ Tech details</summary>
            <div style={s.techBody}>
              XTTS-v2 zero-shot voice cloning · OpenVoice V2 accent transfer · Whisper ASR ·
              Multi-language (EN / HI / Hinglish) · 24 kHz WAV output
            </div>
          </details>
        </div>
      </div>

      <div style={s.body}>

        {/* ── Setup & Conversation (collapsed by default) ─ */}
        <details style={s.setupPanel} open={setupOpen}
          onToggle={e => setSetupOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={s.setupSummary}>
            <span>⚙ Setup &amp; Voice Conversation</span>
            <span style={s.setupChevron}>{setupOpen ? "▲" : "▼"}</span>
          </summary>

          <div style={s.setupGrid}>
            {/* System status */}
            <div style={s.setupCard}>
              <div style={s.setupCardTitle}>System Status</div>
              {health ? (
                <div style={s.badgeRow}>
                  {Object.entries(health.pipeline || {}).map(([k, v]: any) => (
                    <span key={k} style={s.pipeBadge}>{k}: {v}</span>
                  ))}
                  {health.gpu && (
                    <span style={{ ...s.pipeBadge, color: "#10b981" }}>
                      GPU {health.vram_free_mb}MB free
                    </span>
                  )}
                </div>
              ) : (
                <span style={s.mutedText}>Loading…</span>
              )}
            </div>

            {/* Voice profile */}
            <div style={s.setupCard}>
              <div style={s.setupCardTitle}>Voice Profile</div>
              {hasProfile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#10b981", fontSize: 13 }}>✅ Ready</span>
                  <button className="muted-btn" style={s.dimBtn} onClick={deleteProfile}>Delete</button>
                </div>
              ) : (
                <label style={s.uploadLabel}>
                  {uploading ? "Uploading…" : "📁 Upload WAV"}
                  <input type="file" accept=".wav" multiple style={{ display: "none" }}
                    onChange={handleUpload} disabled={uploading} />
                </label>
              )}
              {uploadMsg && <div style={{ fontSize: 12, marginTop: 6, color: uploadMsg.startsWith("✅") ? "#10b981" : "#f87171" }}>{uploadMsg}</div>}
            </div>

            {/* Voice conversation */}
            <div style={s.setupCard}>
              <div style={s.setupCardTitle}>Voice Conversation</div>
              <p style={s.mutedText}>Real-time AI chat in your cloned voice.</p>
              <button
                className="muted-btn"
                style={{ ...s.dimBtn, opacity: hasProfile ? 1 : 0.4 }}
                disabled={!hasProfile}
                onClick={() => router.push("/conversation")}
              >
                🎙 Start
              </button>
            </div>
          </div>
        </details>

        {/* ── Section divider ─────────────────────────────── */}
        <div style={s.sectionLabel}>Also in this project</div>

        {/* ── Secondary features ──────────────────────────── */}
        <div style={s.secondaryGrid}>

          {/* Recovery Agent */}
          <div style={s.secCard}>
            <div style={s.secIcon}>💰</div>
            <div style={s.secTitle}>Example Use Case: Payment Recovery</div>
            <p style={s.secDesc}>
              One way VoiceAI can be applied — detecting failed transactions and sending personalised voice reminders in the customer's preferred language.
            </p>
            <div style={s.secActions}>
              <button className="muted-btn" style={s.secBtn}
                onClick={() => router.push("/recovery")}>📊 Dashboard</button>
              <button className="muted-btn" style={s.secBtn}
                onClick={() => router.push("/audit")}>📋 Audit</button>
            </div>
            <div style={{ fontSize: 11, color: "#334155", marginTop: 8, lineHeight: 1.6 }}>
              Demo uses simulated transaction data for privacy — the pipeline is built to connect to live payment webhooks in production.
            </div>
          </div>

          {/* Evaluation Metrics */}
          <div style={s.secCard}>
            <div style={s.secIcon}>📈</div>
            <div style={s.secTitle}>Evaluation Metrics</div>
            <p style={s.secDesc}>
              Live latency, language-detection accuracy, and voice-similarity scores — real measurements, not estimates.
            </p>
            <div style={s.secActions}>
              <button className="muted-btn" style={s.secBtn}
                onClick={() => router.push("/metrics")}>View Metrics</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  /* page shell */
  page: { minHeight: "100vh", background: "#0b0a15", color: "#fff", fontFamily: "system-ui,sans-serif" },

  /* top bar */
  topbar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)", position: "sticky", top: 0, zIndex: 10,
  },
  topbarLogo: { fontSize: 16, fontWeight: 700, color: "#a5b4fc" },
  topbarRight: { display: "flex", alignItems: "center", gap: 12 },
  topbarUser: { fontSize: 13, color: "#64748b" },
  topbarBtn: {
    padding: "5px 12px", borderRadius: 6, fontSize: 12,
    border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
    color: "#94a3b8", cursor: "pointer",
  },

  /* hero */
  hero: {
    position: "relative", overflow: "hidden",
    minHeight: 420,
    background: "linear-gradient(160deg, #0d0c1e 0%, #0f1729 60%, #0b0a15 100%)",
    borderBottom: "1px solid rgba(34,211,238,0.1)",
  },
  heroBg: { position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" },
  heroInner: {
    position: "relative", zIndex: 1,
    maxWidth: 760, margin: "0 auto",
    padding: "56px 32px 52px",
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14,
  },

  /* waveform bars */
  waveIcon: { display: "flex", alignItems: "flex-end", gap: 5, height: 36, marginBottom: 4 },

  heroBadge: {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
    color: "#22d3ee", textTransform: "uppercase",
    padding: "3px 10px", borderRadius: 99,
    border: "1px solid rgba(34,211,238,0.3)",
    background: "rgba(34,211,238,0.08)",
  },
  heroTitle: {
    margin: 0, fontSize: "clamp(26px,4vw,42px)",
    fontWeight: 800, color: "#f0f9ff",
    lineHeight: 1.15, letterSpacing: "-0.5px",
  },
  heroSub: {
    margin: 0, fontSize: 16, color: "#94a3b8",
    maxWidth: 540, lineHeight: 1.6,
  },

  /* THE primary CTA — only place with saturated cyan accent */
  heroCta: {
    marginTop: 8,
    padding: "16px 44px",
    fontSize: 17, fontWeight: 700,
    borderRadius: 12, border: "none", cursor: "pointer",
    background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
    color: "#fff",
    boxShadow: "0 0 32px rgba(6,182,212,0.4), 0 4px 16px rgba(6,182,212,0.25)",
    letterSpacing: "0.01em",
  },

  techDetails: { marginTop: 4 },
  techSummary: { fontSize: 12, color: "#475569", outline: "none" },
  techBody: {
    marginTop: 6, fontSize: 11, color: "#334155",
    lineHeight: 1.7, maxWidth: 520,
  },

  /* body */
  body: { maxWidth: 900, margin: "0 auto", padding: "32px 24px 64px", display: "flex", flexDirection: "column", gap: 28 },

  /* collapsible setup panel */
  setupPanel: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12, overflow: "hidden",
  },
  setupSummary: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 20px", fontSize: 13, fontWeight: 600,
    color: "#64748b", userSelect: "none",
  },
  setupChevron: { fontSize: 11, color: "#475569" },
  setupGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 1, borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  setupCard: {
    padding: "18px 20px",
    background: "rgba(255,255,255,0.02)",
    display: "flex", flexDirection: "column", gap: 8,
  },
  setupCardTitle: { fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  pipeBadge: {
    fontSize: 11, padding: "2px 8px", borderRadius: 20,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#64748b", fontFamily: "monospace",
  },
  mutedText: { fontSize: 13, color: "#475569", margin: 0 },
  uploadLabel: {
    display: "inline-block", padding: "7px 14px", borderRadius: 7,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    color: "#94a3b8", fontSize: 13, cursor: "pointer",
  },
  dimBtn: {
    display: "inline-block", padding: "7px 14px", borderRadius: 7,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#94a3b8", fontSize: 13, cursor: "pointer",
  },

  /* section divider */
  sectionLabel: {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.1em",
    textTransform: "uppercase", color: "#334155",
    display: "flex", alignItems: "center", gap: 12,
  },

  /* secondary grid */
  secondaryGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12,
  },
  secCard: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12, padding: "20px 22px",
    display: "flex", flexDirection: "column", gap: 8,
  },
  secIcon: { fontSize: 24 },
  secTitle: { fontSize: 15, fontWeight: 600, color: "#cbd5e1" },
  secDesc: { fontSize: 13, color: "#475569", lineHeight: 1.6, margin: 0 },
  secActions: { display: "flex", gap: 8, marginTop: 4 },
  secBtn: {
    padding: "7px 14px", borderRadius: 7, fontSize: 12,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#94a3b8", cursor: "pointer",
  },
  razorBadge: {
    display: "inline-block", marginLeft: 8,
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    padding: "1px 7px", borderRadius: 99,
    background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)",
    color: "#f59e0b", textTransform: "uppercase",
    verticalAlign: "middle",
  },
};
