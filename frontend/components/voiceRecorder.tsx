import React, { useState, useRef, useEffect } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export default function VoiceConversation({ userId }: { userId: string }) {
  const [status, setStatus]       = useState<Status>("ready");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse]   = useState("");
  const [emotion, setEmotion]     = useState("neutral");
  const [pipeline, setPipeline]   = useState<Record<string, string>>({});

  const wsRef      = useRef<WebSocket | null>(null);
  const recRef     = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const audioCtx   = useRef<AudioContext | null>(null);
  const isPlaying  = useRef(false);

  // Fetch pipeline info on mount
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/health`).then(r => r.json()).then(d => setPipeline(d.pipeline ?? {}));
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
      if (msg.error)         console.error("[WS error]", msg.error);

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
    if (!audioCtx.current || audioQueue.current.length === 0) {
      isPlaying.current = false;
      return;
    }
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
    // Use timeslice to collect data every 100ms so we always have chunks
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recRef.current  = rec;
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      if (chunksRef.current.length === 0) {
        setStatus("ready");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      wsRef.current?.send(await blob.arrayBuffer());
    };
    rec.start(100); // collect data every 100ms
    (rec as any)._startTime = Date.now();
    setStatus("recording");
  };

  const stopRecording = () => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    // Ensure at least 500ms of audio before stopping
    const elapsed = Date.now() - (recRef.current as any)._startTime;
    const stop = () => { rec.stop(); setStatus("transcribing"); };
    if (elapsed < 500) {
      setTimeout(stop, 500 - elapsed);
    } else {
      stop();
    }
  };

  const emo = EMOTION_STYLE[emotion] ?? EMOTION_STYLE.neutral;

  return (
    <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">

      {/* Pipeline badges */}
      <div className="flex gap-2 flex-wrap justify-center">
        {Object.entries(pipeline).map(([k, v]) => (
          <span key={k}
            className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800
                       text-gray-600 dark:text-gray-300 font-mono">
            {k}: {v}
          </span>
        ))}
      </div>

      {/* Status */}
      <p className="text-sm font-mono uppercase tracking-widest text-gray-400">
        {status}
      </p>

      {/* Emotion badge */}
      <div className="px-5 py-1.5 rounded-full text-white text-sm font-semibold shadow"
           style={{ backgroundColor: emo.bg }}>
        {emo.label}
      </div>

      {/* Push-to-talk */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={status === "thinking" || status === "speaking"}
        className={`w-24 h-24 rounded-full text-white font-semibold text-sm
                    shadow-lg transition-all select-none active:scale-95
                    ${status === "recording"
                      ? "bg-red-500 animate-pulse"
                      : "bg-indigo-600 hover:bg-indigo-700"}`}
      >
        {status === "recording" ? "🔴 Rec" : "🎙 Hold"}
      </button>

      {/* Transcript */}
      {transcript && (
        <div className="w-full p-4 rounded-xl bg-gray-100 dark:bg-gray-800">
          <p className="text-xs text-gray-400 mb-1">You said</p>
          <p className="text-gray-800 dark:text-gray-100">{transcript}</p>
        </div>
      )}

      {/* AI Response */}
      {response && (
        <div className="w-full p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900">
          <p className="text-xs mb-1" style={{ color: emo.bg }}>
            AI · {emo.label}
          </p>
          <p className="text-indigo-900 dark:text-indigo-100">{response}</p>
        </div>
      )}
    </div>
  );
}