import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true", "bypass-tunnel-reminder": "true" };

interface Transaction {
  transaction_id: string;
  customer_name: string;
  amount: number;
  currency: string;
  payment_status: string;
  failure_reason: string | null;
  contact_attempts: number;
  ai_action: string | null;
  outcome: string | null;
}

interface Summary {
  total_transactions: number;
  total_revenue_at_risk: number;
  potentially_recoverable: number;
  recovered_count: number;
  total_recovered: number;
  recovery_rate: number;
  audit: {
    total_decisions: number;
    recovered_count: number;
    total_recovered_amount: number;
    voice_messages_generated: number;
  };
}

interface VoiceResult {
  transaction_id: string;
  audio_id: string;
  message: string;
  language: string;
  action: string;
  download_url: string;
  audit_id: string;
}

export default function RecoveryDashboard() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/"); return; }
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load summary
      const summaryRes = await fetch(`${API_URL}/recovery/summary`, { headers: NGROK_HEADER });
      const summaryData = await summaryRes.json();
      setSummary(summaryData);

      // Load at-risk transactions
      const txRes = await fetch(`${API_URL}/recovery/transactions/at-risk`, { headers: NGROK_HEADER });
      const txData = await txRes.json();
      setTransactions(txData.transactions);
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const runAIDecision = async (txId: string) => {
    setProcessing(txId);
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/recovery/transactions/${txId}/decide`, {
        method: "POST",
        headers: { ...NGROK_HEADER },
      });
      if (!res.ok) throw new Error("AI decision failed");
      const data = await res.json();
      setMessage(`✅ AI Decision: ${data.decision.action} - ${data.decision.reason}`);
      await loadData();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const generateVoice = async (txId: string) => {
    setProcessing(txId);
    setMessage("");
    setVoiceResult(null);
    try {
      // Show immediate feedback that AI is working
      setMessage("🤖 AI is generating personalized recovery message...");
      
      const res = await fetch(`${API_URL}/recovery/transactions/${txId}/generate-voice`, {
        method: "POST",
        headers: { ...NGROK_HEADER },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "Voice generation failed");
      }
      
      // Update message during processing
      setMessage("🎙️ Cloning voice using XTTS-v2 AI model (30-60s)...");
      
      const data = await res.json();
      setVoiceResult(data);
      setMessage(`✅ Voice message ready! Generated in ${data.language.toUpperCase()} using AI voice cloning`);
      await loadData();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const recordOutcome = async (txId: string, outcome: string, amount: number = 0) => {
    setProcessing(txId);
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/recovery/transactions/${txId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...NGROK_HEADER },
        body: JSON.stringify({ outcome, recovered_amount: amount, notes: "Manually recorded" }),
      });
      if (!res.ok) throw new Error("Failed to record outcome");
      setMessage(`✅ Outcome recorded: ${outcome}`);
      await loadData();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const runBatchProcessing = async () => {
    setProcessing("batch");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/recovery/run-batch?max_transactions=20`, {
        method: "POST",
        headers: { ...NGROK_HEADER },
      });
      if (!res.ok) throw new Error("Batch processing failed");
      const data = await res.json();
      setMessage(`✅ Analyzed ${data.transactions_analyzed} transactions worth ₹${data.total_value_at_risk.toLocaleString()}`);
      await loadData();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const generateMoreData = async () => {
    setProcessing("generate");
    setMessage("🎲 Generating 50 additional synthetic transactions...");
    try {
      const res = await fetch(`${API_URL}/recovery/generate-synthetic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...NGROK_HEADER },
        body: JSON.stringify({ count: 50 }),
      });
      if (!res.ok) throw new Error("Failed to generate synthetic data");
      const data = await res.json();
      setMessage(`✅ Generated ${data.generated_count} new transactions. Total: ${data.total_count}`);
      await loadData();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <div style={styles.container}><div style={styles.loading}>Loading...</div></div>;
  }

  return (
    <div style={styles.container}>
      <style jsx global>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={styles.header}>
        <h1 style={styles.logo}>💰 Revenue Recovery Dashboard</h1>
        <div style={styles.headerRight}>
          <button style={styles.navBtn} onClick={() => router.push("/dashboard")}>← Dashboard</button>
          <button style={styles.navBtn} onClick={() => router.push("/audit")}>📋 Audit Trail</button>
        </div>
      </div>

      <div style={styles.content}>
        {message && (
          <div style={message.startsWith("✅") ? styles.successBanner : 
                      message.startsWith("🤖") || message.startsWith("🎙️") ? styles.processingBanner : styles.errorBanner}>
            {message.startsWith("🤖") || message.startsWith("🎙️") ? (
              <div style={styles.processingContent}>
                <div style={styles.processingSpinner}></div>
                <span>{message}</span>
              </div>
            ) : (
              message
            )}
          </div>
        )}

        {/* Recovery Result Panel */}
        {voiceResult && (
          <div style={styles.voicePanel}>
            <div style={styles.voicePanelHeader}>
              <span style={styles.voicePanelTitle}>🎙️ Voice Recovery Message Generated</span>
              <div style={styles.testBadge}>TEST SIMULATION</div>
              <button style={styles.closeVoiceBtn} onClick={() => setVoiceResult(null)}>✕</button>
            </div>
            <div style={styles.voicePanelBody}>
              <div style={styles.voiceMetaRow}>
                <span style={styles.voiceMetaLabel}>Transaction:</span>
                <span style={styles.voiceMetaValue}>{voiceResult.transaction_id}</span>
                <span style={styles.voiceMetaLabel}>Language:</span>
                <span style={{ ...styles.voiceMetaValue, color: "#a5b4fc" }}>{voiceResult.language.toUpperCase()}</span>
                <span style={styles.voiceMetaLabel}>AI Action:</span>
                <span style={{ ...styles.voiceMetaValue, color: "#fbbf24" }}>{voiceResult.action.replace(/_/g, " ")}</span>
              </div>
              <div style={styles.voiceMessage}>
                <span style={styles.voiceMessageLabel}>Personalized Recovery Message:</span>
                <span style={styles.voiceMessageText}>"{voiceResult.message}"</span>
              </div>
              <div style={styles.voiceActions}>
                <div style={styles.audioSection}>
                  <div style={styles.audioLabel}>🎧 Listen to AI-Generated Voice:</div>
                  <audio
                    controls
                    src={`${API_URL}${voiceResult.download_url}`}
                    style={styles.audioPlayer}
                  />
                </div>
                <a
                  href={`${API_URL}${voiceResult.download_url}`}
                  download={`recovery_${voiceResult.transaction_id}.wav`}
                  style={styles.downloadBtn}
                >
                  ⬇️ Download Audio File
                </a>
              </div>
              <div style={styles.voiceStats}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Processing Time:</span>
                  <span style={styles.statValue}>~45s</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>AI Model:</span>
                  <span style={styles.statValue}>XTTS-v2 + OpenVoice V2</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Quality:</span>
                  <span style={styles.statValue}>24kHz 16-bit</span>
                </div>
              </div>
              <div style={styles.simulationNote}>
                <strong>🧪 SIMULATED RECOVERY:</strong> This is a test demonstration using synthetic transaction data and AI-generated voice messages. No real customer contact or revenue recovery is performed.
              </div>
              <div style={styles.auditNote}>
                Audit ID: {voiceResult.audit_id} · Audio ID: {voiceResult.audio_id}
              </div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Revenue at Risk</div>
              <div style={styles.summaryValue}>₹{summary.total_revenue_at_risk.toLocaleString()}</div>
              <div style={styles.summarySubtext}>{summary.total_transactions} transactions · <span style={{color:"#f59e0b"}}>SIMULATED</span></div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>AI Recoverable</div>
              <div style={styles.summaryValue}>₹{summary.potentially_recoverable.toLocaleString()}</div>
              <div style={styles.summarySubtext}>AI-eligible</div>
            </div>
            <div style={{ ...styles.summaryCard, borderColor: "rgba(16,185,129,0.3)" }}>
              <div style={styles.summaryLabel}>Test Recovered</div>
              <div style={{ ...styles.summaryValue, color: "#10b981" }}>₹{summary.total_recovered.toLocaleString()}</div>
              <div style={styles.summarySubtext}>{summary.recovered_count} successful</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Recovery Rate</div>
              <div style={styles.summaryValue}>{(summary.recovery_rate * 100).toFixed(1)}%</div>
              <div style={styles.summarySubtext}>{summary.audit.voice_messages_generated} voice messages</div>
            </div>
          </div>
        )}

        {/* Data Management */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>📊 Transaction Data Management</h2>
          <p style={styles.hint}>
            Add new transactions manually, import from CSV, or generate additional synthetic data for testing.
          </p>
          <div style={styles.dataActions}>
            <button
              style={{ ...styles.btn, background: "#059669" }}
              onClick={() => setShowAddTransaction(true)}
            >
              ➕ Add Transaction
            </button>
            <button
              style={{ ...styles.btn, background: "#0891b2" }}
              onClick={() => setShowImportCsv(true)}
            >
              📁 Import CSV
            </button>
            <button
              style={{ ...styles.btn, background: "#7c2d12" }}
              onClick={() => generateMoreData()}
            >
              🎲 Generate +50 Synthetic
            </button>
          </div>
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Batch AI Analysis</h2>
          <p style={styles.hint}>
            Run the AI decision engine on all recoverable transactions. The system will analyze transaction patterns, 
            customer profiles, and failure reasons to recommend appropriate recovery actions using intelligent stopping rules.
          </p>
          <button
            style={{
              ...styles.btn,
              background: processing === "batch" ? "#6366f1" : "#4f46e5",
              position: "relative"
            }}
            onClick={runBatchProcessing}
            disabled={processing === "batch"}
          >
            {processing === "batch" ? (
              <div style={styles.batchLoadingContent}>
                <div style={styles.batchSpinner}></div>
                <span>Processing AI Decisions...</span>
              </div>
            ) : (
              "🤖 Run Batch AI Analysis"
            )}
          </button>
          <div style={styles.batchNote}>
            <strong>📊 AI Processing:</strong> Uses ML algorithms to score recovery probability, 
            select optimal contact strategy, and generate personalized voice messages in appropriate languages.
          </div>
          {processing === "batch" && (
            <div style={styles.batchProgress}>
              <div style={styles.progressBar}>
                <div style={styles.progressFill}></div>
              </div>
              <div style={styles.progressText}>Analyzing transaction patterns and customer profiles...</div>
            </div>
          )}
        </div>

        {/* Transactions Table */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Transactions at Risk ({transactions.length})</h2>
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <div style={{ ...styles.tableCell, flex: 1 }}>Customer</div>
              <div style={{ ...styles.tableCell, width: 120 }}>Amount</div>
              <div style={{ ...styles.tableCell, width: 140 }}>Status</div>
              <div style={{ ...styles.tableCell, width: 150 }}>AI Action</div>
              <div style={{ ...styles.tableCell, width: 100 }}>Contacts</div>
              <div style={{ ...styles.tableCell, width: 280 }}>Actions</div>
            </div>
            <div style={styles.tableBody}>
              {transactions.map((tx) => (
                <div key={tx.transaction_id} style={styles.tableRow}>
                  <div style={{ ...styles.tableCell, flex: 1 }}>
                    <div style={styles.customerName}>{tx.customer_name}</div>
                    <div style={styles.txId}>{tx.transaction_id}</div>
                    {tx.failure_reason && (
                      <div style={styles.failureReason}>{tx.failure_reason}</div>
                    )}
                  </div>
                  <div style={{ ...styles.tableCell, width: 120 }}>
                    <span style={styles.amount}>₹{tx.amount.toLocaleString()}</span>
                  </div>
                  <div style={{ ...styles.tableCell, width: 140 }}>
                    <span style={getStatusBadge(tx.payment_status)}>{tx.payment_status}</span>
                  </div>
                  <div style={{ ...styles.tableCell, width: 150 }}>
                    {tx.ai_action ? (
                      <span style={styles.aiActionBadge}>{tx.ai_action.replace(/_/g, " ")}</span>
                    ) : (
                      <span style={{ ...styles.aiActionBadge, opacity: 0.5 }}>—</span>
                    )}
                  </div>
                  <div style={{ ...styles.tableCell, width: 100 }}>
                    <span style={styles.contactAttempts}>{tx.contact_attempts}/2</span>
                  </div>
                  <div style={{ ...styles.tableCell, width: 280, gap: 6, flexDirection: "row", alignItems: "center" }}>
                    <button
                      style={styles.actionBtn}
                      onClick={() => runAIDecision(tx.transaction_id)}
                      disabled={processing === tx.transaction_id}
                      title="Run AI decision engine to analyze this transaction and recommend recovery action"
                    >
                      🤖 Decide
                    </button>
                    <div style={styles.voiceButtonContainer}>
                      <button
                        style={{ 
                          ...styles.actionBtn, 
                          background: processing === tx.transaction_id ? "#9333ea" : "#7c3aed",
                          width: 80,
                          position: "relative"
                        }}
                        onClick={() => generateVoice(tx.transaction_id)}
                        disabled={processing === tx.transaction_id || tx.contact_attempts >= 2}
                        title="Generate personalized voice message using AI voice cloning (takes 30-60s)"
                      >
                        {processing === tx.transaction_id ? (
                          <div style={styles.buttonLoading}>
                            <div style={styles.spinner}></div>
                            <span style={{fontSize: 9}}>AI</span>
                          </div>
                        ) : (
                          "🎙️ Voice"
                        )}
                      </button>
                      {processing === tx.transaction_id && (
                        <div style={styles.voiceTooltip}>
                          AI voice cloning in progress...
                          <br />
                          <span style={{fontSize: 10}}>XTTS-v2 + OpenVoice V2</span>
                        </div>
                      )}
                    </div>
                    {tx.outcome === null && (
                      <button
                        style={{ ...styles.actionBtn, background: "#10b981" }}
                        onClick={() => recordOutcome(tx.transaction_id, "recovered", tx.amount)}
                        disabled={processing === tx.transaction_id}
                        title="Mark this recovery as successful"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add Transaction Modal */}
        {showAddTransaction && (
          <AddTransactionModal 
            onClose={() => setShowAddTransaction(false)}
            onSuccess={() => {
              setShowAddTransaction(false);
              loadData();
              setMessage("✅ Transaction added successfully");
            }}
          />
        )}

        {/* Import CSV Modal */}
        {showImportCsv && (
          <ImportCsvModal
            onClose={() => setShowImportCsv(false)}
            onSuccess={(count: number) => {
              setShowImportCsv(false);
              loadData();
              setMessage(`✅ Imported ${count} transactions from CSV`);
            }}
          />
        )}
      </div>
    </div>
  );
}

const getStatusBadge = (status: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 4,
    fontWeight: 600,
    textTransform: "uppercase",
  };
  
  if (status === "FAILED") return { ...base, background: "#dc2626", color: "#fff" };
  if (status === "ABANDONED") return { ...base, background: "#f59e0b", color: "#fff" };
  if (status === "OVERDUE") return { ...base, background: "#ef4444", color: "#fff" };
  if (status === "RECOVERED") return { ...base, background: "#10b981", color: "#fff" };
  return { ...base, background: "#64748b", color: "#fff" };
};

// Add Transaction Modal Component
function AddTransactionModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    customer_name: "",
    amount: "",
    currency: "INR",
    payment_status: "FAILED",
    failure_reason: "insufficient_funds",
    customer_language: "en",
    customer_type: "new",
    phone: "",
    email: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/recovery/transactions/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...NGROK_HEADER },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to add transaction");
      onSuccess();
    } catch (err) {
      alert("Error adding transaction");
    }
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3>Add New Transaction</h3>
          <button onClick={onClose} style={modalStyles.closeBtn}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.row}>
            <input
              placeholder="Customer Name"
              value={formData.customer_name}
              onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
              style={modalStyles.input}
              required
            />
            <input
              placeholder="Amount"
              type="number"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
              style={modalStyles.input}
              required
            />
          </div>
          <div style={modalStyles.row}>
            <select
              value={formData.payment_status}
              onChange={(e) => setFormData({...formData, payment_status: e.target.value})}
              style={modalStyles.select}
            >
              <option value="FAILED">Failed</option>
              <option value="ABANDONED">Abandoned</option>
              <option value="OVERDUE">Overdue</option>
            </select>
            <select
              value={formData.customer_language}
              onChange={(e) => setFormData({...formData, customer_language: e.target.value})}
              style={modalStyles.select}
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>
          <div style={modalStyles.row}>
            <input
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              style={modalStyles.input}
            />
            <input
              placeholder="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              style={modalStyles.input}
            />
          </div>
          <button type="submit" style={modalStyles.submitBtn}>
            Add Transaction
          </button>
        </form>
      </div>
    </div>
  );
}

// Import CSV Modal Component
function ImportCsvModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (count: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const res = await fetch(`${API_URL}/recovery/import-csv`, {
        method: "POST",
        headers: { ...NGROK_HEADER },
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to import CSV");
      const data = await res.json();
      onSuccess(data.imported_count);
    } catch (err) {
      alert("Error importing CSV");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3>Import Transactions from CSV</h3>
          <button onClick={onClose} style={modalStyles.closeBtn}>✕</button>
        </div>
        <div style={modalStyles.form}>
          <p style={modalStyles.hint}>
            CSV should have columns: customer_name, amount, payment_status, failure_reason, customer_language, phone, email
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={modalStyles.fileInput}
          />
          <button 
            onClick={handleSubmit}
            disabled={!file || uploading}
            style={modalStyles.submitBtn}
          >
            {uploading ? "Uploading..." : "Import CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalStyles = {
  overlay: {
    position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#1a1825", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12, width: "90%", maxWidth: 500, padding: 0,
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)",
  },
  closeBtn: {
    background: "transparent", border: "none", color: "#94a3b8",
    fontSize: 20, cursor: "pointer",
  },
  form: { padding: 24, display: "flex", flexDirection: "column" as const, gap: 16 },
  row: { display: "flex", gap: 12 },
  input: {
    flex: 1, padding: 12, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14,
  },
  select: {
    flex: 1, padding: 12, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14,
  },
  fileInput: {
    padding: 12, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, width: "100%",
  },
  hint: { fontSize: 12, color: "#94a3b8", margin: 0 },
  submitBtn: {
    padding: "12px 24px", borderRadius: 8, border: "none",
    background: "#4f46e5", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
};

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#0f0e1a", color: "#fff" },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
  logo: { margin: 0, fontSize: 22, color: "#fbbf24" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  navBtn: {
    padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#fff", cursor: "pointer", fontSize: 13,
  },
  content: { maxWidth: 1400, margin: "40px auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 20 },
  loading: { textAlign: "center", padding: 60, color: "#94a3b8" },
  successBanner: { padding: 16, borderRadius: 8, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" },
  errorBanner: { padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 },
  summaryCard: {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12, padding: 20,
  },
  summaryLabel: { fontSize: 13, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" },
  summaryValue: { fontSize: 32, fontWeight: 700, color: "#fbbf24", marginBottom: 4 },
  summarySubtext: { fontSize: 13, color: "#64748b" },
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 },
  cardTitle: { margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#e0e7ff" },
  hint: { color: "#94a3b8", fontSize: 14, margin: "0 0 16px", lineHeight: 1.6 },
  btn: {
    padding: "10px 24px", borderRadius: 8, border: "none",
    background: "#4f46e5", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
  table: { marginTop: 16 },
  tableHeader: {
    display: "flex", padding: "12px 16px", background: "rgba(255,255,255,0.06)",
    borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase",
  },
  tableBody: { marginTop: 8 },
  tableRow: {
    display: "flex", padding: "16px", background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, marginBottom: 8,
    alignItems: "center",
  },
  tableCell: { display: "flex", flexDirection: "column" as const, gap: 4 },
  customerName: { fontSize: 14, fontWeight: 500, color: "#e0e7ff" },
  txId: { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  failureReason: { fontSize: 11, color: "#f59e0b", fontStyle: "italic" },
  amount: { fontSize: 16, fontWeight: 600, color: "#fbbf24" },
  aiActionBadge: { fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(79,70,229,0.2)", color: "#a5b4fc", textTransform: "capitalize" },
  contactAttempts: { fontSize: 13, color: "#94a3b8", fontFamily: "monospace" },
  actionBtn: {
    padding: "6px 12px", borderRadius: 6, border: "none",
    background: "#4f46e5", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
  },
  voicePanel: {
    background: "rgba(124,58,237,0.12)", border: "2px solid rgba(124,58,237,0.4)",
    borderRadius: 12, overflow: "hidden",
  },
  voicePanelHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 20px", background: "rgba(124,58,237,0.2)",
    borderBottom: "1px solid rgba(124,58,237,0.3)",
  },
  voicePanelTitle: { fontSize: 15, fontWeight: 700, color: "#c4b5fd" },
  closeVoiceBtn: {
    background: "transparent", border: "none", color: "#94a3b8",
    fontSize: 18, cursor: "pointer", lineHeight: 1,
  },
  voicePanelBody: { padding: 20, display: "flex", flexDirection: "column" as const, gap: 16 },
  voiceMetaRow: { display: "flex", gap: 16, flexWrap: "wrap" as const, alignItems: "center" },
  voiceMetaLabel: { fontSize: 12, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.5px" },
  voiceMetaValue: { fontSize: 13, color: "#e0e7ff", fontWeight: 600 },
  voiceMessage: { display: "flex", flexDirection: "column" as const, gap: 6 },
  voiceMessageLabel: { fontSize: 12, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.5px" },
  voiceMessageText: { fontSize: 14, color: "#e0e7ff", lineHeight: 1.6, fontStyle: "italic" },
  voiceActions: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" as const },
  audioPlayer: { flex: 1, minWidth: 280, height: 40, accentColor: "#7c3aed" },
  downloadBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "10px 20px", borderRadius: 8,
    background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 600,
    textDecoration: "none", whiteSpace: "nowrap" as const,
  },
  auditNote: { fontSize: 11, color: "#475569", fontFamily: "monospace" },
  testBadge: {
    fontSize: 10, padding: "2px 8px", borderRadius: 4,
    background: "#f59e0b", color: "#fff", fontWeight: 700, textTransform: "uppercase",
  },
  simulationNote: {
    fontSize: 12, padding: 12, borderRadius: 6,
    background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
    color: "#f59e0b", lineHeight: 1.5,
  },
  batchNote: {
    fontSize: 12, padding: 12, borderRadius: 6, marginTop: 12,
    background: "rgba(79,70,229,0.1)", border: "1px solid rgba(79,70,229,0.3)",
    color: "#a5b4fc", lineHeight: 1.5,
  },
  processingBanner: {
    padding: 16, borderRadius: 8, background: "rgba(79,70,229,0.15)", 
    border: "1px solid rgba(79,70,229,0.3)", color: "#a5b4fc",
  },
  processingContent: {
    display: "flex", alignItems: "center", gap: 12,
  },
  processingSpinner: {
    width: 20, height: 20, border: "2px solid rgba(165,180,252,0.3)",
    borderTop: "2px solid #a5b4fc", borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  buttonLoading: {
    display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 2,
  },
  spinner: {
    width: 12, height: 12, border: "1px solid rgba(255,255,255,0.3)",
    borderTop: "1px solid #fff", borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  batchLoadingContent: {
    display: "flex", alignItems: "center", gap: 8,
  },
  batchSpinner: {
    width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)",
    borderTop: "2px solid #fff", borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  batchProgress: {
    marginTop: 16, padding: 12, background: "rgba(79,70,229,0.05)",
    borderRadius: 6, border: "1px solid rgba(79,70,229,0.2)",
  },
  progressBar: {
    width: "100%", height: 4, background: "rgba(79,70,229,0.2)",
    borderRadius: 2, overflow: "hidden", marginBottom: 8,
  },
  progressFill: {
    height: "100%", background: "#4f46e5", borderRadius: 2,
    animation: "progress 2s ease-in-out infinite",
  },
  progressText: {
    fontSize: 11, color: "#64748b", textAlign: "center" as const,
    fontStyle: "italic",
  },
  audioSection: {
    display: "flex", flexDirection: "column" as const, gap: 8, flex: 1,
  },
  audioLabel: {
    fontSize: 12, color: "#94a3b8", fontWeight: 600,
  },
  voiceStats: {
    display: "flex", gap: 20, padding: 12, background: "rgba(124,58,237,0.05)",
    borderRadius: 6, fontSize: 11, marginTop: 8,
  },
  statItem: {
    display: "flex", flexDirection: "column" as const, gap: 2,
  },
  statLabel: {
    color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.5px",
  },
  statValue: {
    color: "#c4b5fd", fontWeight: 600,
  },
  voiceButtonContainer: {
    position: "relative" as const,
  },
  voiceTooltip: {
    position: "absolute" as const, top: "100%", left: "50%", transform: "translateX(-50%)",
    background: "#1a1825", border: "1px solid rgba(124,58,237,0.4)",
    borderRadius: 6, padding: "8px 12px", fontSize: 10, color: "#c4b5fd",
    whiteSpace: "nowrap" as const, zIndex: 10, marginTop: 4,
    animation: "pulse 2s infinite",
  },
  dataActions: {
    display: "flex", gap: 12, flexWrap: "wrap" as const,
  },
};
