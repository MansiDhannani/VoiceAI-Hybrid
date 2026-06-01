import React, { useState, useRef } from "react";

// Backend API URL - configured via Vercel environment variables
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? "ws://localhost:8000";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true" };

const EXAMPLE_SCRIPT = `A: [neutral] Hey, did you hear about the new AI tools coming out?
B: [excited] Yes! I've been reading about them all morning. It's incredible.
C: [happy] 저도 들었어요! 정말 대단하네요.
A: [calm] I think it's impressive, but we should be thoughtful about how we use them.
B: [neutral] Totally agree. The key is using them to help people, not replace them.
C: [neutral] 맞아요. 사람을 돕는 데 써야죠.
A: [happy] Anyway, want to grab coffee and talk more about it?
B: [happy] Absolutely, let's go!
C: [excited] 저도 같이 가요!`;

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ar", label: "Arabic" },
];

type RenderResult = {
  render_id: string;
  duration_seconds: number;
  lines_rendered: number;
  file_size_kb: number;
  download_url: string;
};

type ProgressInfo = {
  line: number;
  total: number;
  speaker: string;
  text: string;
  emotion: string;
  percent: number;
};

const EMOTION_COLOR: Record<string, string> = {
  happy: "#f59e0b", excited: "#ef4444", sad: "#3b82f6",
  calm: "#10b981", neutral: "#6b7280", angry: "#dc2626", fearful: "#8b5cf6",
};
const SPEAKER_COLOR: Record<string, string> = {
  A: "#6366f1", B: "#f97316", C: "#10b981",
};

export default function DialogueStudio() {
  const [script, setScript]             = useState(EXAMPLE_SCRIPT);
  const [speakerA, setSpeakerA]         = useState("A");
  const [speakerB, setSpeakerB]         = useState("B");
  const [speakerC, setSpeakerC]         = useState("C");
  const [voiceA, setVoiceA]             = useState<File | null>(null);
  const [voiceB, setVoiceB]             = useState<File | null>(null);
  const [voiceC, setVoiceC]             = useState<File | null>(null);
  const [langA, setLangA]               = useState("en");
  const [langB, setLangB]               = useState("en");
  const [langC, setLangC]               = useState("ko");
  const [enableC, setEnableC]           = useState(true);
  const [gap, setGap]                   = useState(0.4);
  const [renderStatus, setRenderStatus] = useState<"idle" | "uploading" | "rendering" | "done" | "error">("idle");
  const [progress, setProgress]         = useState<ProgressInfo | null>(null);
  const [statusMsg, setStatusMsg]       = useState("");
  const [result, setResult]             = useState<RenderResult | null>(null);
  const [errorMsg, setErrorMsg]         = useState("");
  const [previewLines, setPreview]      = useState<any[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);

  const previewScript = async () => {
    try {
      const fd = new FormData();
      fd.append("script", script);
      const res = await fetch(`${API_URL}/dialogue/preview-script`, {
        method: "POST", body: fd, headers: NGROK_HEADER,
      });
      const data = await res.json();
      setPreview(data.preview ?? []);
    } catch (e: any) {
      setErrorMsg("Preview failed: " + e.message);
    }
  };

  // Step 1: Upload voice files, get temp user IDs back
  const uploadVoices = async (): Promise<{ userA: string; userB: string; userC: string | null }> => {
    const fd = new FormData();
    fd.append("voice_a", voiceA!);
    fd.append("voice_b", voiceB!);
    if (enableC && voiceC) fd.append("voice_c", voiceC);
    fd.append("speaker_a_name", speakerA);
    fd.append("speaker_b_name", speakerB);
    fd.append("speaker_c_name", speakerC);
    fd.append("language_a", langA);
    fd.append("language_b", langB);
    fd.append("language_c", enableC ? langC : "");
    fd.append("gap_seconds", String(gap));
    fd.append("script", script);

    const res = await fetch(`${API_URL}/dialogue/upload-voices`, {
      method: "POST",
      headers: NGROK_HEADER,
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(err.detail ?? "Voice upload failed");
    }
    return await res.json();
  };

  // Step 2: Render via WebSocket (no timeout)
  const renderViaWebSocket = (
    sessionId: string,
    userA: string, userB: string, userC: string | null,
  ): Promise<RenderResult> => {
    return new Promise((resolve, reject) => {
      const wsBase = WS_URL.replace(/^http/, "ws");
      const ws = new WebSocket(`${wsBase}/dialogue/render-live/${sessionId}`);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          script,
          user_id_a: userA,
          user_id_b: userB,
          user_id_c: userC ?? "",
          speaker_a_name: speakerA,
          speaker_b_name: speakerB,
          speaker_c_name: speakerC,
          language_a: langA,
          language_b: langB,
          language_c: enableC ? langC : "",
          gap_seconds: gap,
        }));
      };

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.status === "rendering") {
          setProgress({
            line: msg.line, total: msg.total,
            speaker: msg.speaker, text: msg.text,
            emotion: msg.emotion, percent: msg.percent,
          });
          setStatusMsg(`Line ${msg.line}/${msg.total} — ${msg.speaker}: "${msg.text}"`);
        } else if (msg.status === "parsing") {
          setStatusMsg("Parsing script...");
        } else if (msg.status === "done") {
          resolve({
            render_id: msg.render_id,
            duration_seconds: msg.duration_seconds,
            lines_rendered: msg.lines_rendered,
            file_size_kb: msg.file_size_kb,
            download_url: msg.download_url,
          });
        } else if (msg.status === "error" || msg.error) {
          reject(new Error(msg.error ?? "Render failed"));
        }
      };

      ws.onerror = () => reject(new Error("WebSocket connection failed. Is the backend running?"));
      ws.onclose = (e) => {
        if (e.code !== 1000 && e.code !== 1005) {
          reject(new Error(`Connection closed unexpectedly (code ${e.code})`));
        }
      };
    });
  };

  const renderDialogue = async () => {
    if (!voiceA || !voiceB) {
      setErrorMsg("Please upload voice files for Speaker A and Speaker B.");
      setRenderStatus("error");
      return;
    }
    if (enableC && !voiceC) {
      setErrorMsg("Please upload a voice file for Speaker C, or disable Speaker C.");
      setRenderStatus("error");
      return;
    }

    const totalMB = ((voiceA?.size ?? 0) + (voiceB?.size ?? 0) + (voiceC?.size ?? 0)) / (1024 * 1024);
    if (totalMB > 45) {
      setErrorMsg(`Total file size is ${totalMB.toFixed(1)}MB — too large. Please compress your audio files first.`);
      setRenderStatus("error");
      return;
    }

    setResult(null);
    setErrorMsg("");
    setProgress(null);

    try {
      // Step 1: Upload voices (fast HTTP call)
      setRenderStatus("uploading");
      setStatusMsg("Uploading voice files...");
      const { userA, userB, userC } = await uploadVoices();

      // Step 2: Render via WebSocket (long-running, no timeout)
      setRenderStatus("rendering");
      setStatusMsg("Starting render...");
      const sessionId = Math.random().toString(36).slice(2, 10);
      const renderResult = await renderViaWebSocket(sessionId, userA, userB, userC);

      setResult(renderResult);
      setRenderStatus("done");
    } catch (e: any) {
      setErrorMsg(e.message);
      setRenderStatus("error");
    }
  };

  const isRendering = renderStatus === "uploading" || renderStatus === "rendering";
  const canRender = voiceA && voiceB && (!enableC || voiceC);

  return (
    <div style={s.container}>
      <h2 style={s.title}>🎬 Dialogue Studio</h2>
      <p style={s.subtitle}>
        Upload voice samples for each speaker, set their language, write a script, and render a full
        multi-language conversation in cloned voices.
      </p>

      {/* Speaker cards */}
      <div style={s.grid3}>
        <VoiceUploadCard
          label="Speaker A" speakerLabel={speakerA} onSpeakerChange={setSpeakerA}
          file={voiceA} onFile={setVoiceA} color={SPEAKER_COLOR.A}
          language={langA} onLanguage={setLangA}
        />
        <VoiceUploadCard
          label="Speaker B" speakerLabel={speakerB} onSpeakerChange={setSpeakerB}
          file={voiceB} onFile={setVoiceB} color={SPEAKER_COLOR.B}
          language={langB} onLanguage={setLangB}
        />
        <div style={{ position: "relative" }}>
          <VoiceUploadCard
            label="Speaker C" speakerLabel={speakerC} onSpeakerChange={setSpeakerC}
            file={voiceC} onFile={setVoiceC} color={SPEAKER_COLOR.C}
            language={langC} onLanguage={setLangC} disabled={!enableC}
          />
          <label style={s.toggleRow}>
            <input type="checkbox" checked={enableC}
              onChange={e => setEnableC(e.target.checked)} style={{ marginRight: 6 }} />
            <span style={{ color: "#94a3b8", fontSize: 12 }}>Enable Speaker C</span>
          </label>
        </div>
      </div>

      {/* Script editor */}
      <div style={s.section}>
        <div style={s.row}>
          <span style={s.sectionLabel}>Conversation Script</span>
          <button onClick={previewScript} style={s.previewBtn}>Preview Lines</button>
        </div>
        <textarea value={script} onChange={e => setScript(e.target.value)}
          rows={12} style={s.textarea}
          placeholder={`A: Hello!\nB: Hi there!\nC: [happy] 안녕하세요!`} />
        <p style={s.hint}>
          Format: <code style={s.code}>SpeakerLabel: [emotion] Text</code> — emotion optional.
          Add a language override per line: <code style={s.code}>[happy|ko]</code>.
          Supported emotions: neutral, happy, sad, excited, calm, angry, fearful.
        </p>
      </div>

      {/* Gap slider */}
      <div style={s.row}>
        <span style={{ ...s.label, width: 160 }}>Pause between lines</span>
        <input type="range" min={0.1} max={2.0} step={0.1}
          value={gap} onChange={e => setGap(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ ...s.label, width: 40, textAlign: "right" }}>{gap.toFixed(1)}s</span>
      </div>

      {/* Preview table */}
      {previewLines.length > 0 && (
        <div style={s.table}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                {["#", "Speaker", "Emotion", "Lang", "Text"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#94a3b8" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewLines.map((l) => (
                <tr key={l.line} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "8px 12px", color: "#64748b" }}>{l.line}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ ...s.badge, background: SPEAKER_COLOR[l.speaker] ?? "#888" }}>{l.speaker}</span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ ...s.badge, background: EMOTION_COLOR[l.emotion] ?? "#888" }}>{l.emotion}</span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 11 }}>{l.language ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#cbd5e1" }}>{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Render button */}
      <button onClick={renderDialogue} disabled={isRendering || !canRender}
        style={{ ...s.renderBtn, opacity: (!canRender || isRendering) ? 0.5 : 1 }}>
        {renderStatus === "uploading" ? "⬆ Uploading voices..."
          : renderStatus === "rendering" ? "⏳ Rendering..."
          : "🎬 Render Dialogue"}
      </button>

      {/* Progress */}
      {isRendering && (
        <div style={s.progressBox}>
          {progress && (
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${progress.percent}%`, transition: "width 0.5s" }} />
            </div>
          )}
          <p style={{ ...s.hint, textAlign: "center", marginTop: 8 }}>{statusMsg}</p>
          {progress && (
            <p style={{ ...s.hint, textAlign: "center", color: "#94a3b8" }}>
              {progress.percent}% — Line {progress.line}/{progress.total}
            </p>
          )}
        </div>
      )}

      {/* Result */}
      {renderStatus === "done" && result && (
        <div style={s.resultBox}>
          <div style={s.row}>
            <div>
              <p style={{ color: "#34d399", fontWeight: 600, margin: 0 }}>✅ Render Complete</p>
              <p style={{ color: "#6ee7b7", fontSize: 12, margin: "4px 0 0" }}>
                {result.lines_rendered} lines · {result.duration_seconds}s · {result.file_size_kb}KB
              </p>
            </div>
            <a href={`${API_URL}${result.download_url}`}
              download={`dialogue_${result.render_id}.wav`} style={s.downloadBtn}>
              ⬇ Download WAV
            </a>
          </div>
          <audio ref={audioRef} controls src={`${API_URL}${result.download_url}`}
            style={{ width: "100%", marginTop: 12 }} />
        </div>
      )}

      {renderStatus === "error" && (
        <div style={s.errorBox}>❌ {errorMsg}</div>
      )}
    </div>
  );
}

function VoiceUploadCard({
  label, speakerLabel, onSpeakerChange, file, onFile, color,
  language, onLanguage, disabled = false,
}: {
  label: string; speakerLabel: string; onSpeakerChange: (v: string) => void;
  file: File | null; onFile: (f: File) => void; color: string;
  language: string; onLanguage: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div style={{ ...s.speakerCard, borderColor: color, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <p style={{ ...s.label, color, marginBottom: 6 }}>{label}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>Script label:</span>
        <input value={speakerLabel} onChange={e => onSpeakerChange(e.target.value)}
          style={{ ...s.speakerInput, color }} maxLength={10} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>Language:</span>
        <select value={language} onChange={e => onLanguage(e.target.value)} style={s.langSelect}>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>
      <label style={{ ...s.uploadLabel, borderColor: color }}>
        {file ? `✅ ${file.name}` : "📁 Upload WAV/MP3/MP4 file"}
        <input type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,.mp4,.mpeg,.mov,.webm" style={{ display: "none" }}
          onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {file && (
        <p style={{ color: file.size > 45 * 1024 * 1024 ? "#f87171" : "#64748b", fontSize: 11, marginTop: 4 }}>
          {(file.size / 1024).toFixed(0)}KB · {file.type || "audio"}
          {file.size > 45 * 1024 * 1024 && " ⚠️ Too large"}
        </p>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { maxWidth: 860, margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 },
  title: { color: "#e0e7ff", fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle: { color: "#94a3b8", fontSize: 14, margin: 0 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  speakerCard: { padding: 16, borderRadius: 12, border: "2px solid", background: "rgba(255,255,255,0.03)" },
  speakerInput: { background: "transparent", border: "none", outline: "none", fontSize: 16, fontWeight: 700, width: 60 },
  langSelect: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "#e0e7ff", fontSize: 12, padding: "3px 6px", outline: "none" },
  uploadLabel: { display: "block", padding: "10px 14px", borderRadius: 8, border: "1px dashed", textAlign: "center" as const, color: "#94a3b8", cursor: "pointer", fontSize: 13 },
  toggleRow: { display: "flex", alignItems: "center", marginTop: 8, cursor: "pointer" },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  sectionLabel: { color: "#cbd5e1", fontSize: 14, fontWeight: 600 },
  row: { display: "flex", alignItems: "center", gap: 12 },
  label: { color: "#94a3b8", fontSize: 13 },
  hint: { color: "#64748b", fontSize: 12, margin: 0 },
  code: { background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" },
  textarea: { width: "100%", padding: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e0e7ff", fontFamily: "monospace", fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box" },
  previewBtn: { padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, marginLeft: "auto" },
  table: { borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" },
  badge: { padding: "2px 8px", borderRadius: 20, color: "#fff", fontSize: 11, fontWeight: 600 },
  renderBtn: { padding: "12px 0", borderRadius: 10, border: "none", background: "#4f46e5", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%" },
  progressBox: { padding: 16, borderRadius: 10, background: "rgba(255,255,255,0.04)" },
  progressTrack: { height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, background: "#6366f1" },
  resultBox: { padding: 20, borderRadius: 12, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" },
  downloadBtn: { padding: "8px 16px", borderRadius: 8, background: "#059669", color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 600 },
  errorBox: { padding: 16, borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 14 },
};
