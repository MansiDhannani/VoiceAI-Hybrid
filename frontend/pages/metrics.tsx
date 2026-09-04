import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

interface LatencyStage {
  count: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
}

interface Metrics {
  latency: {
    asr: LatencyStage;
    llm: LatencyStage;
    tts: LatencyStage;
    total: LatencyStage;
    recent_totals: { ts: string; ms: number; lang: string }[];
  };
  language_detection: {
    accuracy: number;
    total: number;
    correct: number;
    breakdown: Record<string, { total: number; correct: number; accuracy: number }>;
    recent_confusions: string[];
    recent_samples: { ts: string; spoken: string; detected: string; correct: boolean }[];
  };
  voice_similarity: {
    count: number;
    mean: number;
    max: number;
    min: number;
    p50: number;
    threshold_good: number;
    threshold_excellent: number;
    samples: { ts: string; user_id: string; score: number; ref_duration_s: number; rating: string }[];
  };
  recovery_decisions: {
    count: number;
    mean_decision_ms: number;
    p95_decision_ms: number;
    action_distribution: Record<string, number>;
    outcome_counts: Record<string, number>;
    samples: { ts: string; tx_id: string; action: string; prob: number; decision_ms: number; outcome: string }[];
  };
  summary: {
    total_conversations: number;
    total_voice_synths: number;
    total_lang_detections: number;
    total_recovery_decisions: number;
  };
}

export default function MetricsPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/metrics`, { headers: NGROK_HEADER });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data = await res.json();
      setMetrics(data);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/"); return; }
    loadMetrics();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadMetrics, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadMetrics]);

  const similarityColor = (score: number) => {
    if (score >= 0.85) return "#10b981";
    if (score >= 0.70) return "#f59e0b";
    if (score >= 0.50) return "#f97316";
    return "#ef4444";
  };

  const similarityLabel = (score: number) => {
    if (score >= 0.85) return "Excellent";
    if (score >= 0.70) return "Good";
    if (score >= 0.50) return "Fair";
    return "Poor";
  };

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.loading}>Loading evaluation metrics...</div>
      </div>
    );
  }

  const hasData = metrics && metrics.summary.total_conversations > 0;
  const hasSimilarity = metrics && metrics.voice_similarity.count > 0;
  const hasLang = metrics && metrics.language_detection.total > 0;
  const hasRecovery = metrics && metrics.recovery_decisions.count > 0;

  return (
    <div style={s.container}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .live-dot { animation: pulse 1.5s infinite; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>📊 Evaluation Metrics</h1>
          <div style={s.subtitle}>Live proof of system performance — not simulated numbers</div>
        </div>
        <div style={s.headerRight}>
          <div style={s.liveRow}>
            <span className="live-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: autoRefresh ? "#10b981" : "#64748b", display: "inline-block" }} />
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {autoRefresh ? `Auto-refresh · ${lastRefresh}` : "Paused"}
            </span>
            <button style={s.toggleBtn} onClick={() => setAutoRefresh(v => !v)}>
              {autoRefresh ? "Pause" : "Resume"}
            </button>
          </div>
          <button style={s.navBtn} onClick={() => router.push("/dashboard")}>← Dashboard</button>
        </div>
      </div>

      <div style={s.content}>

        {/* No data yet banner */}
        {!hasData && (
          <div style={s.noDataBanner}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
            <strong>No conversation data yet</strong>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
              Run a voice conversation to populate ASR, LLM, and TTS latency metrics.<br />
              Run Batch AI Analysis in the Recovery Dashboard to populate recovery decision metrics.
            </p>
          </div>
        )}

        {/* Summary strip */}
        {metrics && (
          <div style={s.summaryStrip}>
            {[
              { label: "Conversations", value: metrics.summary.total_conversations, icon: "🎙" },
              { label: "Voice Synths", value: metrics.summary.total_voice_synths, icon: "🔊" },
              { label: "Lang Detections", value: metrics.summary.total_lang_detections, icon: "🌐" },
              { label: "AI Decisions", value: metrics.summary.total_recovery_decisions, icon: "🤖" },
            ].map(item => (
              <div key={item.label} style={s.summaryItem}>
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <span style={s.summaryValue}>{item.value}</span>
                <span style={s.summaryLabel}>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Latency ─────────────────────────────────────── */}
        <Section title="⚡ Pipeline Latency" subtitle="Per-stage breakdown of every conversation turn">
          <div style={s.stageGrid}>
            {metrics && (["asr", "llm", "tts", "total"] as const).map(stage => {
              const d = metrics.latency[stage];
              const colors: Record<string, string> = {
                asr: "#6366f1", llm: "#f59e0b", tts: "#7c3aed", total: "#10b981"
              };
              const labels: Record<string, string> = {
                asr: "Whisper ASR", llm: "Groq LLM", tts: "XTTS-v2 TTS", total: "End-to-End"
              };
              return (
                <div key={stage} style={{ ...s.stageCard, borderTopColor: colors[stage] }}>
                  <div style={{ ...s.stageTitle, color: colors[stage] }}>{labels[stage]}</div>
                  {d.count === 0 ? (
                    <div style={s.noData}>No data yet</div>
                  ) : (
                    <>
                      <div style={s.stageMean}>{d.mean_ms}<span style={s.stageUnit}>ms avg</span></div>
                      <div style={s.stageRow}><span style={s.stageKey}>p50</span><span style={s.stageVal}>{d.p50_ms}ms</span></div>
                      <div style={s.stageRow}><span style={s.stageKey}>p95</span><span style={s.stageVal}>{d.p95_ms}ms</span></div>
                      <div style={s.stageRow}><span style={s.stageKey}>min</span><span style={s.stageVal}>{d.min_ms}ms</span></div>
                      <div style={s.stageRow}><span style={s.stageKey}>max</span><span style={s.stageVal}>{d.max_ms}ms</span></div>
                      <div style={s.stageRow}><span style={s.stageKey}>samples</span><span style={s.stageVal}>{d.count}</span></div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sparkline: recent total latencies */}
          {metrics && metrics.latency.recent_totals.length > 0 && (
            <div style={s.sparkContainer}>
              <div style={s.sparkTitle}>Recent end-to-end latency per turn</div>
              <div style={s.sparkRow}>
                {metrics.latency.recent_totals.map((pt, i) => {
                  const maxMs = Math.max(...metrics.latency.recent_totals.map(p => p.ms), 1);
                  const heightPct = Math.max(4, (pt.ms / maxMs) * 100);
                  const color = pt.ms < 3000 ? "#10b981" : pt.ms < 8000 ? "#f59e0b" : "#ef4444";
                  return (
                    <div key={i} style={s.sparkBarWrap} title={`${pt.ms}ms · ${pt.lang} · ${pt.ts}`}>
                      <div style={{ ...s.sparkBar, height: `${heightPct}%`, background: color }} />
                      <div style={s.sparkLang}>{pt.lang}</div>
                    </div>
                  );
                })}
              </div>
              <div style={s.sparkLegend}>
                <span style={{ color: "#10b981" }}>■ &lt;3s</span>
                <span style={{ color: "#f59e0b" }}>■ 3–8s</span>
                <span style={{ color: "#ef4444" }}>■ &gt;8s</span>
              </div>
            </div>
          )}
        </Section>

        {/* ── Language Detection ───────────────────────────── */}
        <Section title="🌐 Language Detection Accuracy" subtitle="Whisper auto-detect vs known spoken language">
          {!hasLang ? (
            <div style={s.noDataInline}>
              Speak in a pinned language (e.g. set Hindi in conversation) to measure accuracy.<br />
              Each turn where language is pinned counts as a labelled sample.
            </div>
          ) : (
            <>
              <div style={s.accuracyRow}>
                <div style={s.accuracyBig}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: metrics!.language_detection.accuracy >= 90 ? "#10b981" : "#f59e0b" }}>
                    {metrics!.language_detection.accuracy}%
                  </div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>
                    {metrics!.language_detection.correct} / {metrics!.language_detection.total} correct
                  </div>
                </div>
                <div style={s.breakdownGrid}>
                  {Object.entries(metrics!.language_detection.breakdown).map(([lang, stat]) => (
                    <div key={lang} style={s.langCard}>
                      <div style={s.langName}>{lang.toUpperCase()}</div>
                      <div style={s.langAcc}>{stat.accuracy}%</div>
                      <div style={s.langCount}>{stat.correct}/{stat.total}</div>
                      <div style={s.langBar}>
                        <div style={{ ...s.langBarFill, width: `${stat.accuracy}%`, background: stat.accuracy >= 90 ? "#10b981" : "#f59e0b" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {metrics!.language_detection.recent_confusions.length > 0 && (
                <div style={s.confusionBox}>
                  <div style={s.confusionTitle}>Detection errors (spoken→detected)</div>
                  <div style={s.confusionTags}>
                    {metrics!.language_detection.recent_confusions.map((c, i) => (
                      <span key={i} style={s.confusionTag}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              <Table
                headers={["Time", "Spoken", "Detected", "Result"]}
                rows={[...metrics!.language_detection.recent_samples].reverse().slice(0, 8).map(s => [
                  s.ts.split(" ")[1],
                  s.spoken.toUpperCase(),
                  s.detected.toUpperCase(),
                  s.correct
                    ? <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Correct</span>
                    : <span style={{ color: "#ef4444", fontWeight: 600 }}>✗ Wrong</span>
                ])}
              />
            </>
          )}
        </Section>

        {/* ── Voice Similarity ─────────────────────────────── */}
        <Section title="🎙 Voice Similarity Score" subtitle="Cosine similarity of MFCC speaker embeddings: reference vs synthesised">
          {!hasSimilarity ? (
            <div style={s.noDataInline}>
              Generate a voice message in Recovery Dashboard or run a conversation turn to measure similarity.
            </div>
          ) : (
            <>
              <div style={s.simRow}>
                <div style={s.simBig}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: similarityColor(metrics!.voice_similarity.mean) }}>
                    {(metrics!.voice_similarity.mean * 100).toFixed(1)}%
                  </div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>mean similarity</div>
                  <div style={{ marginTop: 8, fontSize: 14, color: similarityColor(metrics!.voice_similarity.mean), fontWeight: 600 }}>
                    {similarityLabel(metrics!.voice_similarity.mean)}
                  </div>
                </div>
                <div style={s.simThresholds}>
                  {[
                    { label: "Excellent clone", min: 0.85, color: "#10b981" },
                    { label: "Good clone", min: 0.70, color: "#f59e0b" },
                    { label: "Fair match", min: 0.50, color: "#f97316" },
                    { label: "Poor match", min: 0.0, color: "#ef4444" },
                  ].map(t => (
                    <div key={t.label} style={s.thresholdRow}>
                      <span style={{ color: t.color, fontWeight: 600, minWidth: 80 }}>{(t.min * 100).toFixed(0)}%+</span>
                      <span style={{ color: "#94a3b8", fontSize: 13 }}>{t.label}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, fontSize: 11, color: "#475569" }}>
                    Method: MFCC 40-coeff · mean+std · cosine distance
                  </div>
                </div>
              </div>

              <Table
                headers={["Time", "User", "Score", "Ref Duration", "Rating"]}
                rows={[...metrics!.voice_similarity.samples].reverse().slice(0, 8).map(s => [
                  s.ts.split(" ")[1],
                  s.user_id,
                  <span style={{ color: similarityColor(s.score), fontWeight: 600 }}>
                    {(s.score * 100).toFixed(1)}%
                  </span>,
                  `${s.ref_duration_s}s`,
                  <span style={{ color: similarityColor(s.score) }}>{s.rating}</span>
                ])}
              />
            </>
          )}
        </Section>

        {/* ── Recovery AI ──────────────────────────────────── */}
        <Section title="🤖 Recovery AI Decision Metrics" subtitle="Decision engine latency and action distribution">
          {!hasRecovery ? (
            <div style={s.noDataInline}>
              Run Batch AI Analysis or click Decide on any transaction to populate.
            </div>
          ) : (
            <>
              <div style={s.recoveryTopRow}>
                <div style={s.recoveryKpi}>
                  <div style={s.recoveryKpiValue}>{metrics!.recovery_decisions.mean_decision_ms.toFixed(1)}<span style={s.stageUnit}>ms</span></div>
                  <div style={s.recoveryKpiLabel}>Avg Decision Time</div>
                </div>
                <div style={s.recoveryKpi}>
                  <div style={s.recoveryKpiValue}>{metrics!.recovery_decisions.p95_decision_ms.toFixed(1)}<span style={s.stageUnit}>ms</span></div>
                  <div style={s.recoveryKpiLabel}>p95 Decision Time</div>
                </div>
                <div style={s.recoveryKpi}>
                  <div style={s.recoveryKpiValue}>{metrics!.recovery_decisions.count}</div>
                  <div style={s.recoveryKpiLabel}>Total Decisions</div>
                </div>
              </div>

              <div style={s.distributionRow}>
                <div style={{ flex: 1 }}>
                  <div style={s.distTitle}>Action Distribution</div>
                  {Object.entries(metrics!.recovery_decisions.action_distribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, count]) => {
                      const total = metrics!.recovery_decisions.count;
                      const pct = Math.round(count / total * 100);
                      return (
                        <div key={action} style={s.distRow}>
                          <span style={s.distLabel}>{action.replace(/_/g, " ")}</span>
                          <div style={s.distBarWrap}>
                            <div style={{ ...s.distBar, width: `${pct}%` }} />
                          </div>
                          <span style={s.distCount}>{count} ({pct}%)</span>
                        </div>
                      );
                    })}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={s.distTitle}>Outcome Counts</div>
                  {Object.entries(metrics!.recovery_decisions.outcome_counts).map(([outcome, count]) => {
                    const colors: Record<string, string> = {
                      recovered: "#10b981", pending: "#f59e0b",
                      escalated: "#ef4444", stopped: "#64748b"
                    };
                    return (
                      <div key={outcome} style={s.outcomeRow}>
                        <span style={{ ...s.outcomeDot, background: colors[outcome] ?? "#64748b" }} />
                        <span style={s.distLabel}>{outcome}</span>
                        <span style={{ ...s.distCount, color: colors[outcome] ?? "#fff" }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Table
                headers={["Time", "Transaction", "Action", "Prob", "Decision ms", "Outcome"]}
                rows={[...metrics!.recovery_decisions.samples].reverse().slice(0, 8).map(s => [
                  s.ts.split(" ")[1],
                  s.tx_id,
                  <span style={{ fontSize: 11 }}>{s.action.replace(/_/g, " ")}</span>,
                  `${(s.prob * 100).toFixed(0)}%`,
                  `${s.decision_ms}ms`,
                  <span style={{ color: s.outcome === "recovered" ? "#10b981" : s.outcome === "pending" ? "#f59e0b" : "#ef4444", fontSize: 11 }}>
                    {s.outcome}
                  </span>
                ])}
              />
            </>
          )}
        </Section>

        {/* Methodology note */}
        <div style={s.methodNote}>
          <strong>📐 Measurement methodology</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.8, fontSize: 13, color: "#94a3b8" }}>
            <li><strong>Latency</strong>: <code>time.perf_counter()</code> wrapping each pipeline stage in the WebSocket handler. Sub-millisecond precision.</li>
            <li><strong>Language accuracy</strong>: Whisper detected lang vs pinned language (ground truth). Recorded every turn where language is pinned.</li>
            <li><strong>Voice similarity</strong>: 40-coefficient MFCC extracted from reference WAV and synthesised audio. Mean + std concatenated → 80-dim vector → cosine similarity. Range 0–1.</li>
            <li><strong>Recovery decision latency</strong>: Time to run the 8-rule AI decision engine on a single transaction.</li>
          </ul>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <h2 style={s.sectionTitle}>{title}</h2>
        <div style={s.sectionSubtitle}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 16 }}>
      <table style={s.table}>
        <thead>
          <tr>
            {headers.map(h => <th key={h} style={s.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
              {row.map((cell, j) => <td key={j} style={s.td}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#0f0e1a", color: "#fff" },
  header: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "20px 32px", borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
  title: { margin: 0, fontSize: 22, color: "#e0e7ff" },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },
  headerRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  liveRow: { display: "flex", alignItems: "center", gap: 8 },
  toggleBtn: { padding: "4px 10px", fontSize: 11, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#94a3b8", cursor: "pointer" },
  navBtn: { padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 13 },
  content: { maxWidth: 1200, margin: "32px auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 24 },
  loading: { textAlign: "center", padding: 80, color: "#94a3b8" },
  noDataBanner: {
    textAlign: "center", padding: "32px 24px", borderRadius: 12,
    background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", color: "#a5b4fc"
  },
  summaryStrip: { display: "flex", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" },
  summaryItem: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    padding: "16px 8px", background: "rgba(255,255,255,0.03)",
    borderRight: "1px solid rgba(255,255,255,0.06)", gap: 4,
  },
  summaryValue: { fontSize: 28, fontWeight: 700, color: "#e0e7ff" },
  summaryLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" },
  section: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 },
  sectionHeader: { marginBottom: 20 },
  sectionTitle: { margin: "0 0 4px", fontSize: 16, fontWeight: 600, color: "#e0e7ff" },
  sectionSubtitle: { fontSize: 13, color: "#64748b" },
  stageGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 },
  stageCard: { background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 16, borderTop: "3px solid #6366f1" },
  stageTitle: { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 },
  stageMean: { fontSize: 32, fontWeight: 800, color: "#e0e7ff", marginBottom: 12 },
  stageUnit: { fontSize: 14, fontWeight: 400, color: "#64748b", marginLeft: 4 },
  stageRow: { display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  stageKey: { color: "#64748b" },
  stageVal: { color: "#e0e7ff", fontFamily: "monospace" },
  noData: { color: "#475569", fontSize: 13, fontStyle: "italic", padding: "16px 0" },
  noDataInline: { color: "#475569", fontSize: 13, padding: "16px 0", lineHeight: 1.7 },
  sparkContainer: { marginTop: 20, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 16 },
  sparkTitle: { fontSize: 12, color: "#64748b", marginBottom: 12 },
  sparkRow: { display: "flex", alignItems: "flex-end", height: 60, gap: 3 },
  sparkBarWrap: { display: "flex", flexDirection: "column", alignItems: "center", flex: 1, height: "100%" },
  sparkBar: { width: "100%", borderRadius: 2, minHeight: 2 },
  sparkLang: { fontSize: 8, color: "#475569", marginTop: 2, textTransform: "uppercase" },
  sparkLegend: { display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#64748b" },
  accuracyRow: { display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" },
  accuracyBig: { minWidth: 160, textAlign: "center" },
  breakdownGrid: { display: "flex", flexWrap: "wrap", gap: 12, flex: 1 },
  langCard: { background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, minWidth: 110 },
  langName: { fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 },
  langAcc: { fontSize: 24, fontWeight: 700, color: "#e0e7ff" },
  langCount: { fontSize: 11, color: "#64748b", marginBottom: 6 },
  langBar: { height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" },
  langBarFill: { height: "100%", borderRadius: 2 },
  confusionBox: { marginTop: 16, padding: 12, background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" },
  confusionTitle: { fontSize: 12, color: "#f87171", marginBottom: 8 },
  confusionTags: { display: "flex", flexWrap: "wrap", gap: 6 },
  confusionTag: { fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.15)", color: "#f87171", fontFamily: "monospace" },
  simRow: { display: "flex", gap: 40, alignItems: "flex-start", flexWrap: "wrap" },
  simBig: { minWidth: 160, textAlign: "center" },
  simThresholds: { flex: 1 },
  thresholdRow: { display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  recoveryTopRow: { display: "flex", gap: 16, marginBottom: 20 },
  recoveryKpi: { flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 16, textAlign: "center" },
  recoveryKpiValue: { fontSize: 32, fontWeight: 800, color: "#a5b4fc" },
  recoveryKpiLabel: { fontSize: 12, color: "#64748b", marginTop: 4 },
  distributionRow: { display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 16 },
  distTitle: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 },
  distRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },
  distLabel: { fontSize: 12, color: "#94a3b8", minWidth: 160 },
  distBarWrap: { flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" },
  distBar: { height: "100%", background: "#6366f1", borderRadius: 3 },
  distCount: { fontSize: 12, color: "#64748b", minWidth: 70, textAlign: "right" },
  outcomeRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" },
  outcomeDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid rgba(255,255,255,0.08)" },
  td: { padding: "8px 12px", fontSize: 12, color: "#e0e7ff", borderBottom: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace" },
  methodNote: { padding: 20, borderRadius: 8, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", fontSize: 13, color: "#e0e7ff" },
};
