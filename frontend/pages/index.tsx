import React, { useState, Suspense } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// SSR-safe dynamic imports
const Canvas        = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
const ParticleField = dynamic(() => import("../components/ParticleField"), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin]   = useState(true);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = isLogin ? "/auth/token" : "/auth/signup";
      const body = new URLSearchParams({ username, password });
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "ngrok-skip-browser-warning": "true" },
        body: body.toString(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Authentication failed");
      }
      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("username", username);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.container}>
      {/* 3D particle background — fills entire screen */}
      <div style={s.bg}>
        <Canvas camera={{ position: [0, 0, 8], fov: 60 }} style={{ background: "transparent" }}>
          <Suspense fallback={null}>
            <ParticleField count={500} color="#6366f1" />
          </Suspense>
        </Canvas>
      </div>

      {/* Glassmorphism login card */}
      <div style={s.card}>
        <div style={s.orbGlow} />

        <h1 style={s.title}>🎙 VoiceAI</h1>
        <p style={s.subtitle}>Real-time voice conversation with emotion-aware AI</p>

        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(isLogin ? s.tabActive : {}) }} onClick={() => setIsLogin(true)}>Login</button>
          <button style={{ ...s.tab, ...(!isLogin ? s.tabActive : {}) }} onClick={() => setIsLogin(false)}>Sign Up</button>
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input} type="text" placeholder="Username"
            value={username} onChange={e => setUsername(e.target.value)} required
          />
          <input
            style={s.input} type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required
          />
          {error && <p style={s.error}>{error}</p>}
          <button style={s.button} type="submit" disabled={loading}>
            {loading ? "Please wait…" : isLogin ? "Login" : "Create Account"}
          </button>
        </form>

        <p style={s.footer}>Razorpay Track 3 · XTTS-v2 + OpenVoice V2</p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, #0a0918 0%, #1e1b4b 50%, #0a0918 100%)",
    position: "relative", overflow: "hidden",
  },
  bg: {
    position: "absolute", inset: 0, zIndex: 0,
    pointerEvents: "none",
  },
  card: {
    position: "relative", zIndex: 1,
    background: "rgba(15,14,26,0.75)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(99,102,241,0.25)",
    borderRadius: 20,
    padding: "44px 48px",
    width: "100%", maxWidth: 400,
    textAlign: "center",
    boxShadow: "0 0 80px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
  },
  orbGlow: {
    position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
    width: 160, height: 160, borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  title: { color: "#fff", fontSize: 34, margin: "0 0 8px", fontWeight: 800, letterSpacing: "-0.5px" },
  subtitle: { color: "#a5b4fc", fontSize: 13, margin: "0 0 32px", lineHeight: 1.5 },
  tabs: {
    display: "flex", marginBottom: 24, borderRadius: 8,
    overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
  },
  tab: {
    flex: 1, padding: "10px 0", background: "transparent",
    border: "none", color: "#a5b4fc", cursor: "pointer", fontSize: 14,
  },
  tabActive: { background: "#4f46e5", color: "#fff", fontWeight: 600 },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    padding: "12px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14,
    outline: "none", transition: "border-color 0.2s",
  },
  button: {
    padding: "13px 0", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    color: "#fff", fontSize: 15, fontWeight: 600,
    cursor: "pointer", marginTop: 4,
    boxShadow: "0 4px 15px rgba(79,70,229,0.4)",
    transition: "opacity 0.2s",
  },
  error: { color: "#f87171", fontSize: 13, margin: 0 },
  footer: { fontSize: 11, color: "#475569", marginTop: 24 },
};
