import React, { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

const Canvas        = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
const ParticleField = dynamic(() => import("../components/ParticleField"), { ssr: false });

export default function Dashboard() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [hasProfile, setHasProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user = localStorage.getItem("username");
    if (!token) { router.push("/"); return; }
    setUsername(user || "");

    // Fetch health + voice status
    fetch(`${API_URL}/health`, { headers: NGROK_HEADER })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});

    fetch(`${API_URL}/voice/status`, {
      headers: { Authorization: `Bearer ${token}`, ...NGROK_HEADER },
    })
      .then((r) => r.json())
      .then((d) => setHasProfile(d.has_profile))
      .catch(() => {});
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage("");

    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));

    try {
      const res = await fetch(`${API_URL}/voice/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...NGROK_HEADER },
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      setHasProfile(true);
      setMessage("✅ Voice profile created! You can now start a conversation.");
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const logout = () => {
    localStorage.clear();
    router.push("/");
  };

  return (
    <div style={styles.container}>
      {/* ── 3D Hero Header ── */}
      <div style={styles.hero}>
        {/* particle canvas behind header */}
        <div style={styles.heroBg}>
          <Canvas camera={{ position: [0, 0, 7], fov: 55 }} style={{ background: "transparent" }}>
            <Suspense fallback={null}>
              <ParticleField count={350} color="#818cf8" />
            </Suspense>
          </Canvas>
        </div>
        <div style={styles.heroContent}>
          <h1 style={styles.logo}>🎙 VoiceAI</h1>
          <p style={styles.heroSub}>AI Voice Cloning · Revenue Recovery · Emotion-Aware Conversations</p>
          <div style={styles.headerRight}>
            <span style={styles.user}>👤 {username}</span>
            <button style={styles.logoutBtn} onClick={logout}>Logout</button>
          </div>
        </div>
      </div>

      <div style={styles.content}>
        {/* Pipeline status */}
        {health && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>System Status</h2>
            <div style={styles.badges}>
              {Object.entries(health.pipeline || {}).map(([k, v]: any) => (
                <span key={k} style={styles.badge}>
                  <span style={styles.badgeKey}>{k}</span> {v}
                </span>
              ))}
              {health.gpu && (
                <span style={{ ...styles.badge, background: "rgba(16,185,129,0.15)", borderColor: "rgba(16,185,129,0.3)" }}>
                  🖥 {health.gpu} · {health.vram_free_mb}MB free
                </span>
              )}
            </div>
          </div>
        )}

        {/* Voice profile */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Voice Profile</h2>
          {hasProfile ? (
            <div>
              <p style={styles.successText}>✅ Voice profile ready</p>
              <p style={styles.hint}>Your voice is cloned and ready for conversations.</p>
              <button
                style={{ ...styles.btn, background: "#dc2626", marginTop: 12 }}
                onClick={async () => {
                  await fetch(`${API_URL}/voice/profile`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...NGROK_HEADER },
                  });
                  setHasProfile(false);
                  setMessage("Voice profile deleted.");
                }}
              >
                Delete Profile
              </button>
            </div>
          ) : (
            <div>
              <p style={styles.hint}>
                Upload audio files of your voice. <strong style={{color:"#a5b4fc"}}>Longer = better accent cloning</strong> — 
                10 minutes of speech gives the best results. Any format (WAV, MP3, M4A) accepted.
                Uses XTTS-v2 + OpenVoice V2 hybrid for maximum accuracy.
              </p>
              <label style={styles.uploadLabel}>
                {uploading ? "Uploading..." : "📁 Choose WAV Files"}
                <input
                  type="file"
                  accept=".wav"
                  multiple
                  style={{ display: "none" }}
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          )}
          {message && <p style={message.startsWith("✅") ? styles.successText : styles.errorText}>{message}</p>}
        </div>

        {/* Start conversation */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Conversation</h2>
          <p style={styles.hint}>
            {hasProfile
              ? "Your voice profile is ready. Start a real-time voice conversation with the AI."
              : "Upload a voice profile first to enable voice cloning."}
          </p>
          <button
            style={{ ...styles.btn, opacity: hasProfile ? 1 : 0.5 }}
            disabled={!hasProfile}
            onClick={() => router.push("/conversation")}
          >
            🎙 Start Conversation
          </button>
        </div>

        {/* Dialogue Studio */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Dialogue Studio</h2>
          <p style={styles.hint}>
            Upload voice samples for 2–3 speakers, write a script, and render a full multi-language
            conversation in cloned voices. No saved profile needed — just upload WAV/MP3 files directly.
          </p>
          <button
            style={{ ...styles.btn, background: "#7c3aed" }}
            onClick={() => router.push("/dialogue")}
          >
            🎬 Open Dialogue Studio
          </button>
        </div>

        {/* Revenue Recovery */}
        <div style={{ ...styles.card, borderColor: "rgba(251,191,36,0.2)" }}>
          <h2 style={styles.cardTitle}>🏆 AI Revenue Recovery Agent</h2>
          <p style={styles.hint}>
            <strong>Razorpay Track 3 Submission:</strong> AI-powered payment recovery system that detects failed and abandoned transactions,
            runs intelligent decision algorithms, and generates personalized voice reminders using advanced voice cloning AI.
            Features multi-language support (Hindi/Hinglish/English), bounded stopping rules, and complete audit trails.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              style={{ ...styles.btn, background: "#d97706" }}
              onClick={() => router.push("/recovery")}
            >
              📊 Recovery Dashboard
            </button>
            <button
              style={{ ...styles.btn, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
              onClick={() => router.push("/audit")}
            >
              📋 Audit Trail
            </button>
          </div>
          <div style={{ fontSize: 12, padding: 8, background: "rgba(245,158,11,0.1)", borderRadius: 6, color: "#f59e0b" }}>
            <strong>🧪 DEMO MODE:</strong> Uses synthetic transaction data for demonstration purposes. 
            Core AI/ML component: Advanced voice cloning with XTTS-v2 + OpenVoice V2 hybrid.
          </div>
        </div>

        {/* Evaluation Metrics */}
        <div style={{ ...styles.card, borderColor: "rgba(16,185,129,0.2)" }}>
          <h2 style={styles.cardTitle}>📊 Evaluation Metrics</h2>
          <p style={styles.hint}>
            Live proof of system performance: pipeline latency (ASR / LLM / TTS), 
            language detection accuracy, voice similarity scores, and recovery decision throughput.
            Measured with real instrumentation — not simulated.
          </p>
          <button
            style={{ ...styles.btn, background: "#059669" }}
            onClick={() => router.push("/metrics")}
          >
            📈 View Metrics
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#0f0e1a", color: "#fff" },
  hero: {
    position: "relative", height: 160, overflow: "hidden",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, #0a0918 0%, #0f0e1a 100%)",
  },
  heroBg: {
    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
  },
  heroContent: {
    position: "relative", zIndex: 1,
    display: "flex", flexDirection: "column", alignItems: "flex-start",
    justifyContent: "center", height: "100%",
    padding: "0 32px", gap: 4,
  },
  logo: { margin: 0, fontSize: 26, color: "#e0e7ff", fontWeight: 800 },
  heroSub: { margin: 0, fontSize: 12, color: "#6366f1", letterSpacing: "0.04em" },
  headerRight: { display: "flex", alignItems: "center", gap: 16, position: "absolute", right: 32, top: "50%", transform: "translateY(-50%)" },
  user: { color: "#a5b4fc", fontSize: 14 },
  logoutBtn: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#fff", cursor: "pointer", fontSize: 13,
  },
  content: { maxWidth: 640, margin: "32px auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 20 },
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 },
  cardTitle: { margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#e0e7ff" },
  badges: { display: "flex", flexWrap: "wrap", gap: 8 },
  badge: { fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "rgba(79,70,229,0.15)", border: "1px solid rgba(79,70,229,0.3)", color: "#a5b4fc", fontFamily: "monospace" },
  badgeKey: { color: "#6366f1", marginRight: 4 },
  hint: { color: "#94a3b8", fontSize: 14, margin: "0 0 16px", lineHeight: 1.6 },
  successText: { color: "#34d399", fontSize: 14, margin: "0 0 8px" },
  errorText: { color: "#f87171", fontSize: 14, margin: "8px 0 0" },
  uploadLabel: {
    display: "inline-block", padding: "10px 20px", borderRadius: 8,
    background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 500,
  },
  btn: {
    padding: "10px 24px", borderRadius: 8, border: "none",
    background: "#4f46e5", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
};
