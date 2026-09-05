import React, { useState, useRef, useEffect, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const Canvas   = dynamic(() => import("@react-three/fiber").then(m => m.Canvas), { ssr: false });
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
  const [status,     setStatus]     = useState<Status>("ready");
  const [wsReady,    setWsReady]    = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response,   setResponse]   = useState("");
  const [emotion,    setEmotion]    = useState("neutral");
  const [pipeline,   setPipeline]   = useState<Record<string, string>>({});
  const [latency,    setLatency]    = useState<{ asr_ms: number; llm_ms: number; tts_ms: number; total_ms: number } | null>(null);
  const [wsError,    setWsError]    = useState("");

  const wsRef       = useRef<WebSocket | null>(null);
  const recRef      = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef    = useRef<ArrayBuffer[]>([]);
  const playingRef  = useRef(false);

  // ── Audio playback ──────────────────────────────────────────
  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) { playingRef.current = false; return; }
    playingRef.current = true;
    const buf = queueRef.current.shift()!;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      const decoded = await audioCtxRef.current.decodeAudioData(buf.slice(0));
      const src = audioCtxRef.current.createBufferSource();
      src.buffer = decoded;
      src.connect(audioCtxRef.current.destination);
      src.onended = playNext;
      src.start();
    } catch (err) {
      console.warn("[Audio] decode failed:", err);
      playNext(); // skip bad chunk
    }
  }, []);

  // ── WebSocket ───────────────────────────────────────────────
  useEffect(() => {
    let ws: WebSocket;
    let dead = false;

    function connect() {
      ws = new WebSocket(`${WS_URL}/ws/conversation/${userId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (dead) { ws.close(); return; }
        setWsReady(true);
        setWsError("");
        console.log("[WS] connected");
      };

      ws.onclose = () => {
        setWsReady(false);
        wsRef.current = null;
        // Auto-reconnect after 2s if component still mounted
        if (!dead) {
          console.log("[WS] disconnected — reconnecting in 2s");
          setTimeout(() => { if (!dead) connect(); }, 2000);
        }
      };

      ws.onerror = (e) => {
        console.error("[WS] error", e);
        setWsError("Connection error — retrying…");
      };

      ws.onmessage = async (event) => {
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.status)        setStatus(msg.status as Status);
        if (msg.transcript)    setTranscript(msg.transcript);
        if (msg.response_text) setResponse(msg.response_text);
        if (msg.emotion)       setEmotion(msg.emotion);
        if (msg.latency)       setLatency(msg.latency);
        if (msg.error) {
          console.error("[WS]", msg.error);
          setWsError(msg.error);
          setStatus("ready");
        }

        if (msg.audio_chunk) {
          try {
            // Decode base64 → ArrayBuffer cleanly
            const binStr = atob(msg.audio_chunk);
            const bytes  = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
            queueRef.current.push(bytes.buffer);
            if (!playingRef.current) playNext();
          } catch (err) {
            console.warn("[Audio] chunk error:", err);
          }
        }
      };
    }

    connect();
    return () => {
      dead = true;
      if (ws && ws.readyState < 2) ws.close();
      wsRef.current = null;
    };
  }, [userId, playNext]);

  // ── Health check ────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(r => r.json())
      .then(d => setPipeline(d.pipeline ?? {}))
      .catch(() => {});
  }, []);

  // ── Recording ───────────────────────────────────────────────
  const startRecording = async () => {
    if (!wsReady) { setWsError("Not connected — please wait…"); return; }

    // Resume AudioContext if suspended (browser autoplay policy)
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setWsError("Microphone access denied.");
      return;
    }

    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
    ].find(t => MediaRecorder.isTypeSupported(t)) ?? "";

    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recRef.current  = rec;
    chunksRef.current = [];

    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (chunksRef.current.length === 0) { setStatus("ready"); return; }
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      const buf  = await blob.arrayBuffer();
      const ws   = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buf);
      } else {
        setStatus("ready");
        setWsError("Connection lost — please wait for reconnect.");
      }
    };

    rec.start(); // no timeslice — full blob at stop
    (rec as any)._t0 = Date.now();
    setStatus("recording");
    setWsError("");
  };

  const stopRecording = () => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    const elapsed = Date.now() - ((rec as any)._t0 ?? 0);
    const doStop  = () => { rec.stop(); setStatus("transcribing"); };
    if (elapsed < 600) setTimeout(doStop, 600 - elapsed);
    else doStop();
  };

  const emo  = EMOTION_STYLE[emotion] ?? EMOTION_STYLE.neutral;
  const busy = status === "thinking" || status === "speaking" || status === "transcribing";

  return (
    <div style={s.wrapper}>
      {/* 3D Orb */}
      <div style={s.canvasWrap}>
        <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} style={{ background: "transparent" }}>
          <ambientLight intensity={0.3} />
          <Suspense fallback={null}>
            <VoiceOrb status={status} emotion={emotion} />
          </Suspense>
        </Canvas>
      </div>

      {/* Connection indicator */}
      <div style={{ ...s.connDot, background: wsReady ? "#10b981" : "#f59e0b" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: wsReady ? "#10b981" : "#f59e0b", display: "inline-block" }} />
        <span style={{ fontSize: 11, color: wsReady ? "#10b981" : "#f59e0b" }}>
          {wsReady ? "Connected" : "Connecting…"}
        </span>
      </div>

      {/* Status hint */}
      <div style={s.statusHint}>{STATUS_HINT[status]}</div>

      {/* Emotion badge */}
      <div style={{ ...s.emoBadge, background: emo.bg }}>{emo.label}</div>

      {/* Error message */}
      {wsError && (
        <div style={s.errorBanner}>⚠ {wsError}</div>
      )}

      {/* Hold button */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={e => { e.preventDefault(); startRecording(); }}
        onTouchEnd={e => { e.preventDefault(); stopRecording(); }}
        disabled={busy || !wsReady}
        style={{
          ...s.holdBtn,
          background: status === "recording" ? "#ef4444"
            : (busy || !wsReady) ? "#1e1b2e"
            : "linear-gradient(135deg,#4f46e5,#7c3aed)",
          cursor: (busy || !wsReady) ? "not-allowed" : "pointer",
          transform: status === "recording" ? "scale(1.06)" : "scale(1)",
          opacity: !wsReady ? 0.5 : 1,
        }}
      >
        {status === "recording" ? "🔴 Release to send"
          : busy ? "⏳ Processing…"
          : !wsReady ? "⟳ Connecting…"
          : "🎙 Hold to Talk"}
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
          <span style={{ ...s.latVal, color: "#10b981", fontWeight: 600 }}>
            Total {latency.total_ms.toFixed(0)}ms
          </span>
        </div>
      )}

      {/* Conversation */}
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
    gap: 14, padding: "24px 24px 48px", minHeight: "calc(100vh - 64px)",
  },
  canvasWrap: {
    width: 260, height: 260, borderRadius: "50%", overflow: "hidden",
    background: "radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)",
    boxShadow: "0 0 60px rgba(99,102,241,0.18)",
  },
  connDot: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "3px 10px", borderRadius: 99,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
  },
  statusHint: {
    fontSize: 12, color: "#64748b", fontFamily: "monospace",
    textTransform: "uppercase", letterSpacing: "0.1em",
  },
  emoBadge: {
    padding: "4px 16px", borderRadius: 999, fontSize: 13, fontWeight: 600, color: "#fff",
  },
  errorBanner: {
    fontSize: 13, color: "#f87171", padding: "8px 16px",
    background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
    borderRadius: 8, maxWidth: 400, textAlign: "center",
  },
  holdBtn: {
    padding: "14px 40px", borderRadius: 12, border: "none",
    color: "#fff", fontSize: 15, fontWeight: 600,
    transition: "all 0.18s ease", userSelect: "none",
    boxShadow: "0 4px 20px rgba(79,70,229,0.3)",
    WebkitUserSelect: "none",
  },
  badges: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  badge: {
    fontSize: 10, padding: "2px 8px", borderRadius: 20,
    background: "rgba(79,70,229,0.12)", border: "1px solid rgba(79,70,229,0.25)",
    color: "#818cf8", fontFamily: "monospace",
  },
  latencyStrip: {
    display: "flex", gap: 8, fontSize: 11, fontFamily: "monospace",
    background: "rgba(255,255,255,0.03)", padding: "5px 14px",
    borderRadius: 20, border: "1px solid rgba(255,255,255,0.07)",
  },
  latVal: { color: "#94a3b8" },
  latSep: { color: "#334155" },
  panels: { width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 10 },
  panel: {
    padding: "14px 16px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
  },
  panelLabel: {
    fontSize: 10, color: "#64748b",
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5,
  },
  panelText: { fontSize: 14, color: "#e0e7ff", lineHeight: 1.6 },
};
