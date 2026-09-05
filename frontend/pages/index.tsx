import React, { useState, Suspense } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const Canvas        = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
const ParticleField = dynamic(() => import("../components/ParticleField"), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [isLogin, setIsLogin]     = useState(true);
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim()) { setError("Username is required."); return; }
    if (password.length < 3) { setError("Password must be at least 3 characters."); return; }
    setLoading(true);
    try {
      const endpoint = isLogin ? "/auth/token" : "/auth/signup";
      const body = new URLSearchParams({ username: username.trim(), password });
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "ngrok-skip-browser-warning": "true" },
        body: body.toString(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || (isLogin ? "Invalid credentials." : "Could not create account."));
      }
      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("username", username.trim());
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.root}>
      <style>{`
        * { box-sizing: border-box; }
        ::placeholder { color: #334155; }
        .field-input { transition: border-color .15s ease, box-shadow .15s ease; }
        .field-input:focus { outline: none; }
        .cta-btn { transition: opacity .15s ease, transform .15s ease, box-shadow .15s ease; }
        .cta-btn:hover:not(:disabled) { opacity: .92; transform: translateY(-1px); box-shadow: 0 0 40px rgba(6,182,212,.5), 0 6px 20px rgba(6,182,212,.3) !important; }
        .cta-btn:active:not(:disabled) { transform: translateY(0); }
        .cta-btn:disabled { opacity: .6; cursor: not-allowed; }
        .link-btn { background: none; border: none; cursor: pointer; transition: color .12s ease; }
        .link-btn:hover { color: #22d3ee !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes floatBar { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.6)} }
        @media (max-width: 680px) {
          .split-left { display: none !important; }
          .split-right { width: 100% !important; padding: 32px 24px !important; min-height: 100vh; }
          .mobile-header { display: flex !important; }
        }
      `}</style>

      {/* ── Left branded panel ────────────────────────────── */}
      <div className="split-left" style={s.leftPanel}>
        {/* Particle background */}
        <div style={s.leftBg}>
          <Canvas camera={{ position: [0, 0, 7], fov: 55 }} style={{ background: "transparent" }}>
            <Suspense fallback={null}>
              <ParticleField count={280} color="#22d3ee" />
            </Suspense>
          </Canvas>
        </div>

        <div style={s.leftContent}>
          {/* Logo */}
          <div style={s.logoRow}>
            <div style={s.logoIcon}>🎙</div>
            <span style={s.logoText}>VoiceAI</span>
          </div>

          {/* Animated waveform bars */}
          <div style={s.waveBars}>
            {[10, 18, 28, 22, 32, 20, 14, 26, 18, 30, 16, 24].map((h, i) => (
              <div key={i} style={{
                width: 5, height: h, borderRadius: 3,
                background: "linear-gradient(180deg, #22d3ee 0%, #6366f1 100%)",
                animation: `floatBar ${0.7 + i * 0.07}s ease-in-out infinite`,
                animationDelay: `${i * 0.07}s`,
                transformOrigin: "bottom",
                opacity: 0.85,
              }} />
            ))}
          </div>

          <h2 style={s.leftHeadline}>
            AI Voice Cloning &amp;<br />Revenue Recovery
          </h2>
          <p style={s.leftTagline}>
            Multi-speaker dialogue rendering ·<br />
            Emotion-aware conversations ·<br />
            Razorpay Track 3
          </p>

          {/* Feature pills */}
          <div style={s.pillRow}>
            {["XTTS-v2", "Whisper ASR", "Groq LLM", "OpenVoice V2"].map(p => (
              <span key={p} style={s.pill}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile-only header (hidden on desktop) ─────────── */}
      <div className="mobile-header" style={{ ...s.mobileHeader, display: "none" }}>
        <span style={{ fontSize: 22 }}>🎙</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e7ff" }}>VoiceAI</span>
        <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>Razorpay Track 3</span>
      </div>

      {/* ── Right form panel ──────────────────────────────── */}
      <div className="split-right" style={s.rightPanel}>
        <div style={s.formWrap}>

          {/* Header */}
          <div style={s.formHeader}>
            <h1 style={s.formTitle}>
              {isLogin ? "Welcome back" : "Create account"}
            </h1>
            <p style={s.formSub}>
              {isLogin
                ? "Sign in to access your voice dashboard."
                : "Set up your account to start cloning voices."}
            </p>
          </div>

          {/* Mode toggle */}
          <div style={s.modeToggle}>
            <button
              className="link-btn"
              style={{ ...s.modeBtn, ...(isLogin ? s.modeBtnActive : {}) }}
              onClick={() => { setIsLogin(true); setError(""); }}
            >
              Sign In
            </button>
            <button
              className="link-btn"
              style={{ ...s.modeBtn, ...(!isLogin ? s.modeBtnActive : {}) }}
              onClick={() => { setIsLogin(false); setError(""); }}
            >
              Sign Up
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={s.form} noValidate>

            {/* Username */}
            <div style={s.fieldGroup}>
              <label style={s.label}>Username</label>
              <input
                className="field-input"
                style={{
                  ...s.input,
                  borderColor: focusedField === "username"
                    ? "rgba(6,182,212,0.7)"
                    : error && !username.trim() ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.09)",
                  boxShadow: focusedField === "username"
                    ? "0 0 0 3px rgba(6,182,212,0.12)"
                    : "none",
                }}
                type="text"
                placeholder="your_username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                autoComplete="username"
                required
              />
            </div>

            {/* Password */}
            <div style={s.fieldGroup}>
              <label style={s.label}>Password</label>
              <input
                className="field-input"
                style={{
                  ...s.input,
                  borderColor: focusedField === "password"
                    ? "rgba(6,182,212,0.7)"
                    : error && password.length < 3 ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.09)",
                  boxShadow: focusedField === "password"
                    ? "0 0 0 3px rgba(6,182,212,0.12)"
                    : "none",
                }}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
              />
            </div>

            {/* Inline error */}
            {error && (
              <div style={s.errorMsg} key={error}>
                <span style={{ fontSize: 13 }}>⚠</span> {error}
              </div>
            )}

            {/* Submit */}
            <button
              className="cta-btn"
              type="submit"
              disabled={loading}
              style={s.ctaBtn}
            >
              {loading ? (
                <span style={s.spinnerRow}>
                  <span style={s.spinner} />
                  {isLogin ? "Signing in…" : "Creating account…"}
                </span>
              ) : (
                isLogin ? "Sign In →" : "Create Account →"
              )}
            </button>

          </form>

          {/* Footer links */}
          <div style={s.footerLinks}>
            <button
              className="link-btn"
              style={s.footerLink}
              onClick={() => { setIsLogin(v => !v); setError(""); }}
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>

          {/* Demo hint */}
          <div style={s.demoHint}>
            Demo: create any username + password to get started.
          </div>

        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "#0b0a15",
    color: "#fff",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },

  /* Left panel */
  leftPanel: {
    position: "relative",
    width: "45%",
    flexShrink: 0,
    overflow: "hidden",
    background: "linear-gradient(160deg, #0d0c1e 0%, #0f1729 70%, #0b0a15 100%)",
    borderRight: "1px solid rgba(34,211,238,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  leftBg: { position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" },
  leftContent: {
    position: "relative", zIndex: 1,
    padding: "48px 40px",
    display: "flex", flexDirection: "column", gap: 20,
  },
  logoRow: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: { fontSize: 32, lineHeight: 1 },
  logoText: { fontSize: 24, fontWeight: 800, color: "#f0f9ff", letterSpacing: "-0.5px" },
  waveBars: {
    display: "flex", alignItems: "flex-end", gap: 5, height: 40,
    margin: "8px 0",
  },
  leftHeadline: {
    margin: 0, fontSize: 28, fontWeight: 800,
    color: "#e0e7ff", lineHeight: 1.25, letterSpacing: "-0.3px",
  },
  leftTagline: {
    margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.8,
  },
  pillRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  pill: {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
    padding: "3px 9px", borderRadius: 99,
    background: "rgba(34,211,238,0.07)",
    border: "1px solid rgba(34,211,238,0.15)",
    color: "#22d3ee",
  },

  /* Mobile header */
  mobileHeader: {
    alignItems: "center", gap: 8,
    padding: "16px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  },

  /* Right panel */
  rightPanel: {
    flex: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "48px 40px",
    background: "#0b0a15",
  },
  formWrap: {
    width: "100%", maxWidth: 400,
    display: "flex", flexDirection: "column", gap: 24,
  },

  /* Form header */
  formHeader: { display: "flex", flexDirection: "column", gap: 6 },
  formTitle: {
    margin: 0, fontSize: 26, fontWeight: 800,
    color: "#f0f9ff", letterSpacing: "-0.4px",
  },
  formSub: { margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.5 },

  /* Mode toggle */
  modeToggle: {
    display: "flex", gap: 0,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8, overflow: "hidden",
    padding: 3,
  },
  modeBtn: {
    flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600,
    color: "#475569", borderRadius: 6,
    transition: "all .15s ease",
  },
  modeBtnActive: {
    background: "rgba(6,182,212,0.12)",
    color: "#22d3ee",
    boxShadow: "inset 0 0 0 1px rgba(6,182,212,0.25)",
  },

  /* Fields */
  form: { display: "flex", flexDirection: "column", gap: 16 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: "#64748b", letterSpacing: "0.04em", textTransform: "uppercase" },
  input: {
    padding: "12px 16px",
    fontSize: 14, color: "#f0f9ff",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    transition: "border-color .15s, box-shadow .15s",
  },

  /* Error */
  errorMsg: {
    display: "flex", alignItems: "center", gap: 6,
    fontSize: 13, color: "#f87171",
    padding: "8px 12px",
    background: "rgba(248,113,113,0.07)",
    border: "1px solid rgba(248,113,113,0.15)",
    borderRadius: 7,
    animation: "fadeIn .2s ease",
  },

  /* CTA — same cyan accent as dashboard */
  ctaBtn: {
    padding: "13px 0", width: "100%",
    fontSize: 15, fontWeight: 700, letterSpacing: "0.01em",
    borderRadius: 9, border: "none", cursor: "pointer",
    background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
    color: "#fff",
    boxShadow: "0 0 28px rgba(6,182,212,0.35), 0 4px 14px rgba(6,182,212,0.2)",
    marginTop: 4,
  },
  spinnerRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10 },
  spinner: {
    display: "inline-block", width: 16, height: 16,
    border: "2px solid rgba(255,255,255,0.25)",
    borderTopColor: "#fff", borderRadius: "50%",
    animation: "spin .7s linear infinite",
    flexShrink: 0,
  },

  /* Footer */
  footerLinks: { textAlign: "center" },
  footerLink: {
    fontSize: 13, color: "#475569",
    padding: 0, textDecoration: "none",
  },
  demoHint: {
    textAlign: "center", fontSize: 11,
    color: "#2d3748",
    padding: "10px 16px",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 7,
  },
};
