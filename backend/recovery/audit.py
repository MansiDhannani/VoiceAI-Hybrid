"""
Audit trail for all AI recovery decisions.
Every action taken by the AI is logged here for explainability.
"""

from datetime import datetime
from typing import List
from pydantic import BaseModel

class AuditEntry(BaseModel):
    audit_id: str
    timestamp: str
    transaction_id: str
    customer_id: str
    customer_name: str
    amount: float
    currency: str
    detected_issue: str
    failure_reason: str | None
    ai_decision: str
    decision_reason: str
    action_taken: str
    tts_language: str | None
    voice_message_generated: bool
    status: str           # delivered | pending | failed | skipped
    outcome: str          # recovered | not_recovered | escalated | stopped | pending
    recovered_amount: float
    operator: str         # "AI" or "HUMAN"
    notes: str

_AUDIT_LOG: List[AuditEntry] = []
_counter = 0

def log(
    transaction,
    decision: dict,
    status: str = "delivered",
    outcome: str = "pending",
    recovered_amount: float = 0.0,
    notes: str = "",
) -> AuditEntry:
    global _counter
    _counter += 1

    entry = AuditEntry(
        audit_id=f"AUD{_counter:05d}",
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        transaction_id=transaction.transaction_id,
        customer_id=transaction.customer_id,
        customer_name=transaction.customer_name,
        amount=transaction.amount,
        currency=transaction.currency,
        detected_issue=transaction.payment_status,
        failure_reason=transaction.failure_reason,
        ai_decision=decision["action"],
        decision_reason=decision["reason"],
        action_taken=decision["action"].replace("_", " ").title(),
        tts_language=decision.get("tts_language"),
        voice_message_generated=bool(decision.get("message")),
        status=status,
        outcome=outcome,
        recovered_amount=recovered_amount,
        operator="HUMAN" if decision["action"] == "escalate_to_human" else "AI",
        notes=notes,
    )
    _AUDIT_LOG.append(entry)
    return entry

def get_all() -> List[AuditEntry]:
    return list(reversed(_AUDIT_LOG))  # newest first

def get_by_transaction(tx_id: str) -> List[AuditEntry]:
    return [e for e in _AUDIT_LOG if e.transaction_id == tx_id]

def get_summary() -> dict:
    total = len(_AUDIT_LOG)
    recovered = [e for e in _AUDIT_LOG if e.outcome == "recovered"]
    escalated = [e for e in _AUDIT_LOG if e.outcome == "escalated"]
    stopped = [e for e in _AUDIT_LOG if e.outcome == "stopped"]
    voice_generated = sum(1 for e in _AUDIT_LOG if e.voice_message_generated)
    return {
        "total_decisions": total,
        "recovered_count": len(recovered),
        "total_recovered_amount": sum(e.recovered_amount for e in recovered),
        "escalated_count": len(escalated),
        "stopped_count": len(stopped),
        "voice_messages_generated": voice_generated,
        "ai_decisions": sum(1 for e in _AUDIT_LOG if e.operator == "AI"),
        "human_decisions": sum(1 for e in _AUDIT_LOG if e.operator == "HUMAN"),
    }
