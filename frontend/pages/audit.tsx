
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

interface AuditEntry {
  audit_id: string;
  timestamp: string;
  transaction_id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  currency: string;
  detected_issue: string;
  failure_reason: string | null;
  ai_decision: string;
  decision_reason: string;
  action_taken: string;
  tts_language: string | null;
  voice_message_generated: boolean;
  status: string;
  outcome: string;
  recovered_amount: number;
  operator: string;
  notes: string;
}

interface AuditSummary {
  total_decisions: number;
  recovered_count: number;
  total_recovered_amount: number;
  escalated_count: number;
  stopped_count: number;
  voice_messages_generated: number;
  ai_decisions: number;
  human_decisions: number;
}

export default function AuditTrail() {
  const router = useRouter();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/"); return; }
    loadAuditData();
  }, []);

  const loadAuditData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/recovery/audit`, { headers: NGROK_HEADER });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      console.error("Failed to load audit data:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    if (filter === "all") return true;
    if (filter === "recovered") return e.outcome === "recovered";
    if (filter === "pending") return e.outcome === "pending";
    if (filter === "escalated") return e.outcome === "escalated";
    if (filter === "voice") return e.voice_message_generated;
    return true;
  });

  if (loading) {
    return <div style={styles.container}><div style={styles.loading}>Loading audit trail...</div></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.logo}>📋 Audit Trail</h1>
        <div style={styles.headerRight}>
          <button style={styles.navBtn} onClick={() => router.push("/recovery")}>← Recovery Dashboard</button>
          <button style={styles.navBtn} onClick={() => router.push("/dashboard")}>Dashboard</button>
        </div>
      </div>

      <div style={styles.content}>
        {/* Demo Notice */}
        <div style={styles.demoBanner}>
          <strong>🧪 RAZORPAY TRACK 3 DEMO:</strong> This audit trail shows AI decision-making processes for synthetic transaction data. 
          The system demonstrates intelligent revenue recovery using advanced voice cloning technology with full explainability and compliance tracking.
        </div>

        {/* Summary Cards */}
        {summary && (
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Decisions</div>
              <div style={styles.summaryValue}>{summary.total_decisions}</div>
              <div style={styles.summarySubtext}>
                {summary.ai_decisions} AI / {summary.human_decisions} Human
              </div>
            </div>
            <div style={{ ...styles.summaryCard, borderColor: "rgba(16,185,129,0.3)" }}>
              <div style={styles.summaryLabel}>Recovered</div>
              <div style={{ ...styles.summaryValue, color: "#10b981" }}>₹{summary.total_recovered_amount.toLocaleString()}</div>
              <div style={styles.summarySubtext}>{summary.recovered_count} transactions</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Voice Messages</div>
              <div style={styles.summaryValue}>{summary.voice_messages_generated}</div>
              <div style={styles.summarySubtext}>AI-generated calls</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Escalations</div>
              <div style={styles.summaryValue}>{summary.escalated_count}</div>
              <div style={styles.summarySubtext}>{summary.stopped_count} stopped</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={styles.filterBar}>
          <button
            style={filter === "all" ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter("all")}
          >
            All ({entries.length})
          </button>
          <button
            style={filter === "recovered" ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter("recovered")}
          >
            Recovered ({entries.filter((e) => e.outcome === "recovered").length})
          </button>
          <button
            style={filter === "pending" ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter("pending")}
          >
            Pending ({entries.filter((e) => e.outcome === "pending").length})
          </button>
          <button
            style={filter === "voice" ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter("voice")}
          >
            Voice Messages ({entries.filter((e) => e.voice_message_generated).length})
          </button>
          <button
            style={filter === "escalated" ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter("escalated")}
          >
            Escalated ({entries.filter((e) => e.outcome === "escalated").length})
          </button>
        </div>

        {/* Audit Entries */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Audit Log ({filteredEntries.length} entries)</h2>
          <div style={styles.auditList}>
            {filteredEntries.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>📋</div>
                <div style={styles.emptyTitle}>No audit entries yet</div>
                <div style={styles.emptyHint}>
                  Go to the Recovery Dashboard and run <strong>Batch AI Analysis</strong> or click <strong>🤖 Decide</strong> on a transaction to generate audit entries.
                </div>
              </div>
            ) : (
              filteredEntries.map((entry) => (
              <div
                key={entry.audit_id}
                style={styles.auditEntry}
                onClick={() => setSelectedEntry(entry)}
              >
                <div style={styles.auditHeader}>
                  <div style={styles.auditId}>{entry.audit_id}</div>
                  <div style={styles.auditTimestamp}>{entry.timestamp}</div>
                  <div style={styles.auditOperator}>
                    {entry.operator === "AI" ? "🤖" : "👤"} {entry.operator}
                  </div>
                  <div style={getOutcomeBadge(entry.outcome)}>{entry.outcome}</div>
                </div>

                <div style={styles.auditBody}>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>Transaction:</span>
                    <span style={styles.value}>{entry.transaction_id}</span>
                  </div>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>Customer:</span>
                    <span style={styles.value}>{entry.customer_name} ({entry.customer_id})</span>
                  </div>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>Amount:</span>
                    <span style={{ ...styles.value, color: "#fbbf24", fontWeight: 600 }}>
                      {entry.currency}{entry.amount.toLocaleString()}
                    </span>
                  </div>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>Detected Issue:</span>
                    <span style={styles.value}>{entry.detected_issue}</span>
                    {entry.failure_reason && (
                      <span style={styles.failureReason}>({entry.failure_reason})</span>
                    )}
                  </div>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>AI Decision:</span>
                    <span style={{ ...styles.value, color: "#a5b4fc" }}>{entry.action_taken}</span>
                  </div>
                  <div style={styles.auditRow}>
                    <span style={styles.label}>Reason:</span>
                    <span style={styles.value}>{entry.decision_reason}</span>
                  </div>
                  {entry.voice_message_generated && (
                    <div style={styles.auditRow}>
                      <span style={styles.label}>Voice:</span>
                      <span style={{ ...styles.value, color: "#7c3aed" }}>
                        🎙️ Generated in {entry.tts_language?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {entry.recovered_amount > 0 && (
                    <div style={styles.auditRow}>
                      <span style={styles.label}>Recovered:</span>
                      <span style={{ ...styles.value, color: "#10b981", fontWeight: 600 }}>
                        ₹{entry.recovered_amount.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {entry.notes && (
                    <div style={styles.auditRow}>
                      <span style={styles.label}>Notes:</span>
                      <span style={styles.value}>{entry.notes}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
            )}
          </div>
        </div>

        {/* Detail Modal */}
        {selectedEntry && (
          <div style={styles.modal} onClick={() => setSelectedEntry(null)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h2 style={styles.modalTitle}>Audit Entry Details</h2>
                <button style={styles.closeBtn} onClick={() => setSelectedEntry(null)}>✕</button>
              </div>
              <div style={styles.modalBody}>
                <pre style={styles.jsonView}>{JSON.stringify(selectedEntry, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const getOutcomeBadge = (outcome: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 4,
    fontWeight: 600,
    textTransform: "uppercase",
  };

  if (outcome === "recovered") return { ...base, background: "#10b981", color: "#fff" };
  if (outcome === "pending") return { ...base, background: "#f59e0b", color: "#fff" };
  if (outcome === "escalated") return { ...base, background: "#ef4444", color: "#fff" };
  if (outcome === "stopped") return { ...base, background: "#64748b", color: "#fff" };
  return { ...base, background: "#374151", color: "#9ca3af" };
};

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#0f0e1a", color: "#fff" },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
  logo: { margin: 0, fontSize: 22, color: "#a5b4fc" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  navBtn: {
    padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#fff", cursor: "pointer", fontSize: 13,
  },
  content: { maxWidth: 1200, margin: "40px auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 20 },
  loading: { textAlign: "center", padding: 60, color: "#94a3b8" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 },
  summaryCard: {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12, padding: 20,
  },
  summaryLabel: { fontSize: 13, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" },
  summaryValue: { fontSize: 32, fontWeight: 700, color: "#a5b4fc", marginBottom: 4 },
  summarySubtext: { fontSize: 13, color: "#64748b" },
  filterBar: {
    display: "flex", gap: 8, padding: 16, background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, flexWrap: "wrap",
  },
  filterBtn: {
    padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13,
  },
  filterBtnActive: {
    padding: "8px 16px", borderRadius: 6, border: "1px solid #4f46e5",
    background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
  },
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 },
  cardTitle: { margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#e0e7ff" },
  auditList: { display: "flex", flexDirection: "column", gap: 12 },
  auditEntry: {
    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8, padding: 16, cursor: "pointer", transition: "all 0.2s",
  },
  auditHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  auditId: { fontSize: 13, fontFamily: "monospace", color: "#64748b", fontWeight: 600 },
  auditTimestamp: { fontSize: 12, color: "#64748b", fontFamily: "monospace" },
  auditOperator: { fontSize: 12, color: "#a5b4fc", marginLeft: "auto" },
  auditBody: { display: "flex", flexDirection: "column", gap: 8 },
  auditRow: { display: "flex", gap: 8, fontSize: 13, alignItems: "center", flexWrap: "wrap" },
  label: { color: "#64748b", minWidth: 120 },
  value: { color: "#e0e7ff" },
  failureReason: { color: "#f59e0b", fontSize: 12, fontStyle: "italic" },
  modal: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  },
  modalContent: {
    background: "#1a1825", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12, maxWidth: 800, width: "90%", maxHeight: "80vh", overflow: "hidden",
    display: "flex", flexDirection: "column",
  },
  modalHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  modalTitle: { margin: 0, fontSize: 18, color: "#e0e7ff" },
  closeBtn: {
    background: "transparent", border: "none", color: "#94a3b8",
    fontSize: 24, cursor: "pointer", padding: "0 8px",
  },
  modalBody: { padding: 24, overflow: "auto" },
  jsonView: {
    background: "#0f0e1a", padding: 16, borderRadius: 8,
    fontSize: 12, fontFamily: "monospace", color: "#a5b4fc",
    overflow: "auto", margin: 0,
  },
  demoBanner: {
    padding: 16, borderRadius: 8, marginBottom: 20,
    background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)",
    color: "#f59e0b", lineHeight: 1.6,
  },
  emptyState: {
    display: "flex", flexDirection: "column" as const, alignItems: "center",
    padding: "48px 24px", gap: 12, textAlign: "center" as const,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: "#e0e7ff" },
  emptyHint: { fontSize: 14, color: "#64748b", maxWidth: 420, lineHeight: 1.6 },
};
