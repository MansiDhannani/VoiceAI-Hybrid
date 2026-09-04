"""
FastAPI router for revenue recovery endpoints.
"""

import asyncio
import io
import os
import time
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks, Form, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from recovery.dataset import (
    get_all, get_by_id, get_at_risk, get_recoverable,
    get_summary, update_transaction
)
from recovery.ai_agent import decide, get_stopping_rules
from recovery import audit
import metrics

router = APIRouter(prefix="/recovery", tags=["Revenue Recovery"])

RECOVERY_AUDIO_DIR = Path("recovery_audio")
RECOVERY_AUDIO_DIR.mkdir(exist_ok=True)


# ── Dashboard summary ─────────────────────────────────────────────────────────

@router.get("/summary")
async def recovery_summary():
    """Overall revenue recovery dashboard metrics."""
    ds = get_summary()
    audit_summary = audit.get_summary()
    return {
        # Normalised keys used by the frontend
        "total_transactions": ds["total_transactions"],
        "total_revenue_at_risk": ds["revenue_at_risk"],
        "potentially_recoverable": ds["potentially_recoverable"],
        "recovered_count": ds["recovered_count"],
        "total_recovered": ds["total_recovered"],
        "recovery_rate": round(ds["recovered_count"] / max(ds["at_risk_count"], 1), 3),
        "at_risk_count": ds["at_risk_count"],
        "recoverable_count": ds["recoverable_count"],
        "stopped_count": ds["stopped_count"],
        "audit": audit_summary,
        "stopping_rules": get_stopping_rules(),
    }


# ── Transaction endpoints ──────────────────────────────────────────────────────

@router.get("/transactions")
async def list_transactions(status: str | None = None, min_amount: float = 0):
    """List all transactions, optionally filtered by status."""
    txs = get_all()
    if status:
        txs = [t for t in txs if t.payment_status == status.upper()]
    if min_amount:
        txs = [t for t in txs if t.amount >= min_amount]
    return {"transactions": [t.dict() for t in txs], "count": len(txs)}


@router.get("/transactions/at-risk")
async def at_risk_transactions():
    """Transactions representing recoverable revenue."""
    txs = get_recoverable()
    total = sum(t.amount for t in txs)
    return {
        "transactions": [t.dict() for t in txs],
        "count": len(txs),
        "total_at_risk": total,
    }


@router.get("/transactions/{tx_id}")
async def get_transaction(tx_id: str):
    tx = get_by_id(tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")
    audit_trail = audit.get_by_transaction(tx_id)
    return {"transaction": tx.dict(), "audit_trail": [a.dict() for a in audit_trail]}


# ── AI decision engine ─────────────────────────────────────────────────────────

@router.post("/transactions/{tx_id}/decide")
async def ai_decide(tx_id: str):
    """Run AI decision engine on a specific transaction."""
    tx = get_by_id(tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")

    t0 = time.perf_counter()
    decision = decide(tx)
    decision_ms = (time.perf_counter() - t0) * 1000

    # Record metrics
    metrics.record_recovery_decision(
        tx_id=tx_id,
        action=decision["action"],
        prob=tx.recovery_probability,
        latency_ms=decision_ms,
    )

    # Log to audit trail
    audit_entry = audit.log(
        transaction=tx,
        decision=decision,
        status="pending",
        outcome="pending",
    )

    # Update transaction with AI action
    update_transaction(tx_id, ai_action=decision["action"])

    return {
        "transaction_id": tx_id,
        "decision": decision,
        "audit_id": audit_entry.audit_id,
    }


@router.post("/transactions/{tx_id}/generate-voice")
async def generate_voice_message(tx_id: str, voice_profile: str = "default"):
    """
    Generate a voice recovery message for a transaction.
    Uses the existing TTS pipeline with a business voice profile.
    """
    import traceback
    from datetime import datetime as _dt

    tx = get_by_id(tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")

    if tx.stop_contacting or tx.contact_attempts >= 2:
        raise HTTPException(400, "Contact limit reached for this customer")

    decision = decide(tx)

    if not decision.get("message"):
        raise HTTPException(400, f"No message to generate for action: {decision['action']}")

    lang = decision.get("tts_language", "en")
    message = decision["message"]

    # ── Find authorized voice reference ──────────────────────────────────────
    try:
        from voice_clone import PROFILES_DIR
    except Exception as e:
        raise HTTPException(500, f"Could not load voice profiles: {e}")

    ref_wav = None
    profiles_path = PROFILES_DIR
    if profiles_path.exists():
        for profile_dir in sorted(profiles_path.iterdir()):
            if profile_dir.is_dir() and not profile_dir.name.startswith("__temp"):
                ref = profile_dir / "reference.wav"
                if ref.exists():
                    ref_wav = str(ref)
                    break

    if not ref_wav:
        # List available profiles for debugging
        available_profiles = []
        if profiles_path.exists():
            for profile_dir in profiles_path.iterdir():
                if profile_dir.is_dir():
                    available_profiles.append(profile_dir.name)
        
        raise HTTPException(
            400, 
            f"No voice profile with reference.wav found. Available profiles: {available_profiles}. "
            f"Go to Dashboard → Upload Voice Profile first, then return here."
        )

    # ── Run TTS in thread pool (heavy GPU work) ───────────────────────────────
    def _run_tts():
        # Import here so the module is fully loaded in the worker thread context
        import sys
        import os
        # Ensure backend dir is in path for the thread
        backend_dir = os.path.dirname(os.path.dirname(__file__))
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)

        if ref_wav:
            # Use voice cloning if profile available
            from tts import tts_engine as _engine
            if _engine is None:
                raise RuntimeError("TTS engine is None — module failed to load")
            return _engine.synthesize_full(message, ref_wav, language=lang)
        else:
            # Return the pre-generated demo audio
            return wav_bytes

    try:
        if ref_wav:
            loop = asyncio.get_event_loop()
            wav_bytes = await loop.run_in_executor(None, _run_tts)
        # else: wav_bytes already set above
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[Recovery] Voice generation error:\n{tb}")
        raise HTTPException(500, f"Voice generation failed: {e}")

    # ── Save audio file ───────────────────────────────────────────────────────
    audio_id = str(uuid.uuid4())[:8]
    audio_path = RECOVERY_AUDIO_DIR / f"recovery_{tx_id}_{audio_id}.wav"
    audio_path.write_bytes(wav_bytes)

    # ── Update transaction + audit ────────────────────────────────────────────
    update_transaction(
        tx_id,
        contact_attempts=tx.contact_attempts + 1,
        ai_action=decision["action"],
        last_contact=_dt.now().strftime("%Y-%m-%d"),
    )
    audit_entry = audit.log(
        transaction=get_by_id(tx_id),
        decision=decision,
        status="delivered",
        outcome="pending",
        notes=f"Voice message generated in {lang}, audio_id={audio_id}",
    )

    return {
        "transaction_id": tx_id,
        "audio_id": audio_id,
        "message": message,
        "language": lang,
        "action": decision["action"],
        "download_url": f"/recovery/audio/{tx_id}/{audio_id}",
        "audit_id": audit_entry.audit_id,
    }


@router.get("/audio/{tx_id}/{audio_id}")
async def download_recovery_audio(tx_id: str, audio_id: str):
    path = RECOVERY_AUDIO_DIR / f"recovery_{tx_id}_{audio_id}.wav"
    if not path.exists():
        raise HTTPException(404, "Audio file not found")
    return FileResponse(str(path), media_type="audio/wav", filename=f"recovery_{tx_id}.wav")


# ── Outcome recording ──────────────────────────────────────────────────────────

class OutcomeUpdate(BaseModel):
    outcome: str           # recovered | failed | escalated | stopped
    recovered_amount: float = 0.0
    notes: str = ""

@router.post("/transactions/{tx_id}/outcome")
async def record_outcome(tx_id: str, body: OutcomeUpdate):
    """Record the outcome of a recovery action."""
    tx = get_by_id(tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")

    new_status = "RECOVERED" if body.outcome == "recovered" else tx.payment_status
    stop = body.outcome in ("stopped", "escalated")

    update_transaction(
        tx_id,
        outcome=body.outcome,
        payment_status=new_status,
        recovered_amount=body.recovered_amount,
        stop_contacting=stop,
    )

    # Find latest audit entry and update it
    trail = audit.get_by_transaction(tx_id)
    if trail:
        last = trail[-1]
        last_copy = last.copy(update={
            "outcome": body.outcome,
            "recovered_amount": body.recovered_amount,
            "notes": body.notes,
        })
        idx = audit._AUDIT_LOG.index(last)
        audit._AUDIT_LOG[idx] = last_copy

    return {"transaction_id": tx_id, "outcome": body.outcome, "updated": True}


# ── Customer opt-out ───────────────────────────────────────────────────────────

@router.post("/transactions/{tx_id}/stop")
async def stop_contacting(tx_id: str, reason: str = "customer_request"):
    """Immediately stop all AI contact for a customer."""
    tx = get_by_id(tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")

    update_transaction(tx_id, stop_contacting=True)
    decision = {"action": "stop_contacting", "reason": reason, "message": None, "tts_language": None}
    audit.log(transaction=get_by_id(tx_id), decision=decision, status="delivered", outcome="stopped")

    return {"transaction_id": tx_id, "stopped": True, "reason": reason}


# ── Batch processing ───────────────────────────────────────────────────────────

@router.post("/run-batch")
async def run_batch(background_tasks: BackgroundTasks, max_transactions: int = 20):
    """
    Run AI decision engine on all recoverable transactions.
    Returns decisions without executing them — for human review before action.
    """
    txs = get_recoverable()[:max_transactions]
    decisions = []

    for tx in txs:
        t0 = time.perf_counter()
        decision = decide(tx)
        decision_ms = (time.perf_counter() - t0) * 1000

        metrics.record_recovery_decision(
            tx_id=tx.transaction_id,
            action=decision["action"],
            prob=tx.recovery_probability,
            latency_ms=decision_ms,
        )
        audit_entry = audit.log(
            transaction=tx,
            decision=decision,
            status="pending" if decision["action"] != "no_action" else "skipped",
            outcome="pending",
        )
        update_transaction(tx.transaction_id, ai_action=decision["action"])
        decisions.append({
            "transaction_id": tx.transaction_id,
            "customer_name": tx.customer_name,
            "amount": tx.amount,
            "status": tx.payment_status,
            "action": decision["action"],
            "reason": decision["reason"],
            "message_ready": bool(decision.get("message")),
            "audit_id": audit_entry.audit_id,
        })

    total_value = sum(d["amount"] for d in decisions)
    return {
        "transactions_analyzed": len(decisions),
        "total_value_at_risk": total_value,
        "decisions": decisions,
    }


# ── Audit trail ────────────────────────────────────────────────────────────────

@router.get("/audit")
async def get_audit_trail(tx_id: str | None = None):
    if tx_id:
        entries = audit.get_by_transaction(tx_id)
    else:
        entries = audit.get_all()
    return {
        "entries": [e.dict() for e in entries],
        "count": len(entries),
        "summary": audit.get_summary(),
    }


# ── Data management endpoints ─────────────────────────────────────────────

class AddTransactionBody(BaseModel):
    customer_name: str
    amount: float
    currency: str = "INR"
    payment_status: str
    failure_reason: str = "unknown"
    customer_language: str = "en"
    customer_type: str = "new"
    phone: str = ""
    email: str = ""

@router.post("/transactions/add")
async def add_transaction(body: AddTransactionBody):
    """Add a new transaction manually."""
    from recovery.dataset import _add_transaction
    
    tx = _add_transaction(
        customer_name=body.customer_name,
        amount=body.amount,
        currency=body.currency,
        payment_status=body.payment_status,
        failure_reason=body.failure_reason,
        customer_language=body.customer_language,
        customer_type=body.customer_type,
        phone=body.phone,
        email=body.email,
    )
    return {"transaction_id": tx.transaction_id, "message": "Transaction added successfully"}


@router.post("/generate-synthetic")
async def generate_synthetic_data(body: dict):
    """Generate additional synthetic transactions."""
    count = body.get("count", 50)
    from recovery.dataset import _generate_more_transactions
    
    new_count = _generate_more_transactions(count)
    total = len(get_all())
    
    return {
        "generated_count": new_count,
        "total_count": total,
        "message": f"Generated {new_count} new transactions"
    }


@router.post("/import-csv")
async def import_csv(file: UploadFile = File(...)):
    """Import transactions from CSV file."""
    import csv
    import io
    
    content = await file.read()
    csv_data = csv.DictReader(io.StringIO(content.decode('utf-8')))
    
    from recovery.dataset import _add_transaction
    imported_count = 0
    
    for row in csv_data:
        try:
            _add_transaction(
                customer_name=row.get('customer_name', 'Unknown'),
                amount=float(row.get('amount', 0)),
                currency=row.get('currency', 'INR'),
                payment_status=row.get('payment_status', 'FAILED'),
                failure_reason=row.get('failure_reason', 'unknown'),
                customer_language=row.get('customer_language', 'en'),
                customer_type=row.get('customer_type', 'new'),
                phone=row.get('phone', ''),
                email=row.get('email', ''),
            )
            imported_count += 1
        except Exception as e:
            print(f"Error importing row: {e}")
    
    return {"imported_count": imported_count, "message": f"Imported {imported_count} transactions"}


# ── Stopping rules ─────────────────────────────────────────────────────────────

@router.get("/stopping-rules")
async def stopping_rules():
    return {"rules": get_stopping_rules()}
