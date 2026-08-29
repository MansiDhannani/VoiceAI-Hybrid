import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import DialogueStudio from "../components/dialoguestudio";

export default function DialoguePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/"); return; }
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => router.push("/dashboard")}>
          ← Dashboard
        </button>
        <h1 style={styles.title}>🎬 Dialogue Studio</h1>
        <div style={{ width: 100 }} />
      </div>
      <DialogueStudio />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#0f0e1a", color: "#fff" },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  back: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#a5b4fc", cursor: "pointer", fontSize: 13,
  },
  title: { margin: 0, fontSize: 18, color: "#e0e7ff" },
};
