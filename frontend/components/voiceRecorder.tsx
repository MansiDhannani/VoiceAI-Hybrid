import React, { useState, useRef, useEffect, Suspense } from "react";
import dynamic from "next/dynamic";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// Dynamic import — Three.js must not run on server
const Canvas = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
const VoiceOrb = dynamic(() => import("./VoiceOrb"), { ssr: false });

type Status = "ready" | "recording" | "transcribing" | "thinking" | "speaking";

const EMOTION_STYLE: Record<string, { bg: string; label: string }> = {
  happy:   { bg: "#f59e0b", label: "😄 Happy"   },
  excited: { bg: "#ef4444", label: "🤩 Excited" },
  sad:     { bg: "#3b82f6", label: "😢 Sad"     },
  calm:    { bg: "#10b981", label: "😌 Calm"    },
  angry:   { bg: "#dc2626", label: "😠 Angry"   },
  fearful: { bg: "#8b5cf6", label: "😨 Fearful" },
  neutral: { bg: "#6b7280", label: "😐 Neutral" },
};

const STATUS_HINT: Record<Status, string> = {
  ready:        "Hold to speak",
  recording:    "Recording… release to send",
  transcribing: "Transcribing audio…",
  thinking:     "AI is thinking…",
  speaking:     "AI is speaking…",
};

export default function VoiceConversation({ userId }: { userId: string }) {
  const [status, setStatus]       = useState<Status>("ready");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse]   = useState("");
  const [emotion, setEmotion]     = useState("neutral");
  const [pipeline, setPipeline]   = useState<Record<string, string>>({});
  const [latency, setLatency]     = useState<{asr_ms:number;llm_ms:number;tts_ms:number;total_ms:number}|null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const recRef     = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const audioCtx   = useRef<AudioContext | null>(null);
  const isPlaying  = useRef(false);

  useEffect(() => {
    fetch(`${API_URL}/health`).then(r => r.json()).then(d => setPipeline(d.pipeline ?? {})).catch(() => {});
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/ws/conversation/${userId}`);
    wsRef.current = ws;
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.status)        setStatus(msg.status as Status);
      if (msg.transcript)    setTranscript(msg.transcript);
      if (msg.response_text) setResponse(msg.response_text);
      if (msg.emotion)       setEmotion(msg.emotion);
      if (msg.latency)       setLatency(msg.latency);
      if (msg.error)         console.error("[WS]", msg.error);
      if (msg.audio_chunk) {
        const raw   = atob(msg.audio_chunk);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        if (!audioCtx.current) audioCtx.current = new AudioContext();
        const buf = await audioCtx.current.decodeAudioData(bytes.buffer.slice(0));
        audioQueue.current.push(buf);
        if (!isPlaying.current) drainQueue();
      }
    };
    return () => ws.close();
  }, [userId]);

  function drainQueue() {
    if (!audioCtx.current || audioQueue.current.length === 0) { isPlaying.current = false; return; }
    isPlaying.current = true;
    const buf = audioQueue.current.shift()!;
    const src = audioCtx.current.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.current.destination);
    src.onended = drainQueue;
    src.start();
  }

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      if (chunksRef.current.length === 0) { setStatus("ready"); return; }
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      wsRef.current?.send(await blob.arrayBuffer());
    };
    rec.start(100);
    (rec as any)._startTime = Date.now();
    setStatus("recording");
  };

  const stopRecording = () => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    const elapsed = Date.now() - (recRef.current as any)._startTime;
    const stop = () => { rec.stop(); setStatus("transcribing"); };
    elapsed < 500 ? setTimeout(stop, 500 - elapsed) : stop();
  };

  const emo = EMOTION_STYLE[emotion] ?? EMOTION_STYLE.neutral;
  const busy = status === "thinking" || status === "speaking" || status === "transcribing";

  return (
    <div style={s.wrapper}>
      {/* 3D Orb Canvas */}
      <div style={s.canvasWrap}>
        <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} style={{ background: "transparent" }}>
          <ambientLight intensity={0.3} />
          <Suspense fallback={null}>
            <VoiceOrb status={status} emotion={emotion} />
          </Suspense>
        </Canvas>
      </div>

      {/* Status hint */}
      <div style={s.statusHint}>{STATUS_HINT[status]}</div>

      {/* Emotion badge */}
      <div style={{ ...s.emoBadge, background: emo.bg }}>{emo.label}</div>

      {/* Hold button — positioned below orb */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={busy}
        style={{
          ...s.holdBtn,
          background: status === "recording" ? "#ef4444" : busy ? "#374151" : "#4f46e5",
          cursor: busy ? "not-allowed" : "pointer",
          transform: status === "recording" ? "scale(1.06)" : "scale(1)",
        }}
      >
        {status === "recording" ? "🔴 Release" : busy ? "⏳" : "🎙 Hold to Talk"}
      </button>

      {/* Pipeline badges */}
      <div style={s.badges}>
        {Object.entries(pipeline).map(([k, v]) => (
          <span key={k} style={s.badge}>{k}: {v}</span>
        ))}
      </div>

      {/* Latency strip */}
      {latency && (
        <div style={s.latencyStrip}>
          <span style={s.latVal}>ASR {latency.asr_ms.toFixed(0)}ms</span>
          <span style={s.latSep}>·</span>
          <span style={s.latVal}>LLM {latency.llm_ms.toFixed(0)}ms</span>
          <span style={s.latSep}>·</span>
          <span style={s.latVal}>TTS {latency.tts_ms.toFixed(0)}ms</span>
          <span style={s.latSep}>·</span>
          <span style={{ ...s.latVal, color: "#10b981", fontWeight: 600 }}>Total {latency.total_ms.toFixed(0)}ms</span>
        </div>
      )}

      {/* Conversation panels */}
      <div style={s.panels}>
        {transcript && (
          <div style={s.panel}>
            <div style={s.panelLabel}>You said</div>
            <div style={s.panelText}>{transcript}</div>
          </div>
        )}
        {response && (
          <div style={{ ...s.panel, borderColor: emo.bg + "55", background: "rgba(255,255,255,0.04)" }}>
            <div style={{ ...s.panelLabel, color: emo.bg }}>AI · {emo.label}</div>
            <div style={s.panelText}>{response}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 16, padding: "24px 24px 40px", minHeight: "calc(100vh - 64px)",
  },
  canvasWrap: {
    width: 280, height: 280,
    borderRadius: "50%",
    overflow: "hidden",
    background: "radial-gradient(circle at 50% 50%, rgba(79,70,229,0.12) 0%, transparent 70%)",
    boxShadow: "0 0 60px rgba(99,102,241,0.18)",
  },
  statusHint: {
    fontSize: 13, color: "#94a3b8", fontFamily: "monospace",
    textTransform: "uppercase", letterSpacing: "0.1em",
  },
  emoBadge: {
    padding: "5px 18px", borderRadius: 999, fontSize: 13,
    fontWeight: 600, color: "#fff",
  },
  holdBtn: {
    padding: "14px 36px", borderRadius: 12, border: "none",
    color: "#fff", fontSize: 15, fontWeight: 600,
    transition: "all 0.2s ease", userSelect: "none",
    boxShadow: "0 4px 20px rgba(79,70,229,0.35)",
  },
  badges: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  badge: {
    fontSize: 11, padding: "3px 9px", borderRadius: 20,
    background: "rgba(79,70,229,0.15)", border: "1px solid rgba(79,70,229,0.3)",
    color: "#a5b4fc", fontFamily: "monospace",
  },
  latencyStrip: {
    display: "flex", gap: 8, fontSize: 12, fontFamily: "monospace",
    background: "rgba(255,255,255,0.04)", padding: "6px 16px",
    borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)",
  },
  latVal: { color: "#94a3b8" },
  latSep: { color: "#374151" },
  panels: { width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 },
  panel: {
    padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
  panelLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 },
  panelText: { fontSize: 14, color: "#e0e7ff", lineHeight: 1.6 },
};
