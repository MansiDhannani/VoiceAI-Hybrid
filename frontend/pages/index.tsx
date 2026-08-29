import React, { useState } from "react";
import { useRouter } from "next/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isLogin ? "/auth/token" : "/auth/signup";
      const body = isLogin
        ? new URLSearchParams({ username, password })
        : new URLSearchParams({ username, password });

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: isLogin
          ? { "Content-Type": "application/x-www-form-urlencoded", "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" }
          : { "Content-Type": "application/x-www-form-urlencoded", "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" },
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
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>🎙 VoiceAI</h1>
        <p style={styles.subtitle}>Real-time voice conversation with emotion-aware AI</p>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(isLogin ? styles.tabActive : {}) }}
            onClick={() => setIsLogin(true)}
          >
            Login
          </button>
          <button
            style={{ ...styles.tab, ...(!isLogin ? styles.tabActive : {}) }}
            onClick={() => setIsLogin(false)}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? "Please wait..." : isLogin ? "Login" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)",
  },
  card: {
    background: "rgba(255,255,255,0.05)",
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: "40px 48px",
    width: "100%",
    maxWidth: 400,
    textAlign: "center",
  },
  title: { color: "#fff", fontSize: 32, margin: "0 0 8px" },
  subtitle: { color: "#a5b4fc", fontSize: 14, margin: "0 0 32px" },
  tabs: { display: "flex", marginBottom: 24, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" },
  tab: { flex: 1, padding: "10px 0", background: "transparent", border: "none", color: "#a5b4fc", cursor: "pointer", fontSize: 14 },
  tabActive: { background: "#4f46e5", color: "#fff" },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontSize: 14,
    outline: "none",
  },
  button: {
    padding: "12px 0",
    borderRadius: 8,
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  error: { color: "#f87171", fontSize: 13, margin: 0 },
};
