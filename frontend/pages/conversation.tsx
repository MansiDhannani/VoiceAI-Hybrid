import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import VoiceConversation from "../components/voiceRecorder";

export default function ConversationPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user = localStorage.getItem("username");
    if (!token || !user) { router.push("/"); return; }
    setUserId(user);
  }, []);

  if (!userId) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => router.push("/dashboard")}>
          ← Dashboard
        </button>
        <h1 style={styles.title}>🎙 Voice Conversation</h1>
        <div style={{ width: 100 }} />
      </div>
      <VoiceConversation userId={userId} />
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
