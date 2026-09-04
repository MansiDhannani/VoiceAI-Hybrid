"""
Synthetic payment transaction dataset for revenue recovery demo.
100 realistic transactions covering failed, abandoned, overdue, and recovered states.
No real customer data used.
"""

import random
from datetime import datetime, timedelta
from typing import List
from pydantic import BaseModel

random.seed(42)

class Transaction(BaseModel):
    transaction_id: str
    customer_id: str
    customer_name: str
    amount: float
    currency: str
    payment_status: str          # FAILED | ABANDONED | OVERDUE | RECOVERED | SUCCESS
    failure_reason: str | None   # insufficient_funds | bank_timeout | card_declined | etc.
    attempt_count: int
    customer_language: str       # en | hi | hinglish | te | ta | mr | bn
    customer_type: str           # new | returning | premium | churned
    invoice_due_date: str
    subscription_status: str     # active | expired | trial | none
    phone: str
    email: str
    last_contact: str | None
    recovery_probability: float  # 0.0 - 1.0 computed by detector
    ai_action: str | None        # filled by AI agent
    outcome: str                 # pending | recovered | failed | escalated | stopped
    recovered_amount: float
    contact_attempts: int
    stop_contacting: bool
    created_at: str

def _date(days_ago: int) -> str:
    return (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")

def _phone(i: int) -> str:
    return f"+91 98{i:08d}"

def _email(name: str, i: int) -> str:
    return f"{name.lower().replace(' ', '.')}{i}@email.com"

NAMES = [
    "Priya Sharma", "Rahul Verma", "Anjali Singh", "Vikram Patel", "Meera Nair",
    "Arjun Gupta", "Sunita Joshi", "Deepak Kumar", "Kavita Rao", "Rohit Mehta",
    "Pooja Iyer", "Suresh Pillai", "Nisha Agarwal", "Amit Chaudhary", "Divya Bose",
    "Kiran Reddy", "Manoj Tiwari", "Sneha Desai", "Ravi Sinha", "Pallavi Mishra",
    "Arun Nambiar", "Lakshmi Venkat", "Farhan Khan", "Neha Saxena", "Sanjay Dubey",
    "Preeti Jain", "Gaurav Bansal", "Swathi Murthy", "Tushar Shah", "Ananya Das",
    "Bharat Shukla", "Harsha Yadav", "Ishaan Roy", "Jyoti Kulkarni", "Kartik Malhotra",
    "Leela Subramaniam", "Manish Pandey", "Nalini Hegde", "Om Prakash", "Padma Krishnan",
    "Qureshi Aslam", "Rekha Chatterjee", "Siddharth Naik", "Tanvi Oza", "Usha Menon",
    "Varun Choudhury", "Wasim Ansari", "Xena Fernandez", "Yogesh Pawar", "Zara Sheikh",
]

FAILURE_REASONS = [
    "insufficient_funds", "bank_timeout", "card_declined", "invalid_cvv",
    "expired_card", "do_not_honor", "network_error", "authentication_failed",
    "limit_exceeded", "card_blocked",
]

LANGUAGES = ["en", "hi", "hinglish", "te", "ta", "mr", "bn"]
CUSTOMER_TYPES = ["new", "returning", "premium", "churned"]
SUB_STATUSES = ["active", "expired", "trial", "none"]

AMOUNTS = [
    499, 699, 999, 1199, 1499, 1999, 2499, 2999, 3499, 3999,
    4999, 5999, 7999, 9999, 12999, 14999, 19999, 24999, 29999, 49999
]

def _make_transaction(i: int) -> Transaction:
    name = NAMES[i % len(NAMES)]
    amount = float(random.choice(AMOUNTS))
    ctype = random.choice(CUSTOMER_TYPES)
    lang = random.choice(LANGUAGES)
    sub = random.choice(SUB_STATUSES)
    attempts = random.randint(1, 3)
    due_days = random.randint(-30, 15)

    # Determine status
    r = random.random()
    if r < 0.35:
        status = "FAILED"
        reason = random.choice(FAILURE_REASONS)
    elif r < 0.50:
        status = "ABANDONED"
        reason = "checkout_abandoned"
    elif r < 0.62:
        status = "OVERDUE"
        reason = "payment_not_initiated"
    elif r < 0.78:
        status = "RECOVERED"
        reason = random.choice(FAILURE_REASONS[:5])
    else:
        status = "SUCCESS"
        reason = None

    recovered = amount if status == "RECOVERED" else 0.0
    outcome = "recovered" if status == "RECOVERED" else (
        "pending" if status in ("FAILED", "ABANDONED", "OVERDUE") else "success"
    )

    # Simple recovery probability heuristic
    prob = 0.5
    if status == "SUCCESS":
        prob = 1.0
    elif status == "RECOVERED":
        prob = 1.0
    elif ctype == "premium":
        prob += 0.25
    elif ctype == "returning":
        prob += 0.15
    elif ctype == "churned":
        prob -= 0.2
    if reason == "bank_timeout":
        prob += 0.2
    elif reason in ("card_blocked", "do_not_honor"):
        prob -= 0.25
    if attempts >= 3:
        prob -= 0.1
    prob = round(max(0.05, min(0.95, prob)), 2)

    last_contact = _date(random.randint(1, 10)) if attempts > 0 else None

    return Transaction(
        transaction_id=f"TX{1000 + i:04d}",
        customer_id=f"C{200 + i:04d}",
        customer_name=name,
        amount=amount,
        currency="INR",
        payment_status=status,
        failure_reason=reason,
        attempt_count=attempts,
        customer_language=lang,
        customer_type=ctype,
        invoice_due_date=_date(-due_days),
        subscription_status=sub,
        phone=_phone(i),
        email=_email(name, i),
        last_contact=last_contact,
        recovery_probability=prob,
        ai_action=None,
        outcome=outcome,
        recovered_amount=recovered,
        contact_attempts=0,
        stop_contacting=False,
        created_at=_date(random.randint(0, 30)),
    )

# Generate dataset once at module load
_TRANSACTIONS: List[Transaction] = [_make_transaction(i) for i in range(100)]
_TX_MAP: dict[str, Transaction] = {t.transaction_id: t for t in _TRANSACTIONS}

def get_all() -> List[Transaction]:
    return _TRANSACTIONS

def get_by_id(tx_id: str) -> Transaction | None:
    return _TX_MAP.get(tx_id)

def get_at_risk() -> List[Transaction]:
    return [t for t in _TRANSACTIONS if t.payment_status in ("FAILED", "ABANDONED", "OVERDUE")]

def get_recoverable(min_prob: float = 0.4) -> List[Transaction]:
    return [t for t in get_at_risk() if t.recovery_probability >= min_prob and not t.stop_contacting]

def update_transaction(tx_id: str, **kwargs) -> Transaction | None:
    tx = _TX_MAP.get(tx_id)
    if not tx:
        return None
    updated = tx.copy(update=kwargs)
    _TX_MAP[tx_id] = updated
    idx = next(i for i, t in enumerate(_TRANSACTIONS) if t.transaction_id == tx_id)
    _TRANSACTIONS[idx] = updated
    return updated

def get_summary() -> dict:
    total_at_risk = sum(t.amount for t in get_at_risk())
    recoverable = get_recoverable()
    total_recoverable = sum(t.amount for t in recoverable)
    recovered = [t for t in _TRANSACTIONS if t.payment_status == "RECOVERED"]
    total_recovered = sum(t.recovered_amount for t in recovered)
    total = len(_TRANSACTIONS)
    at_risk_count = len(get_at_risk())
    recovery_rate = round(len(recovered) / max(at_risk_count, 1) * 100, 1)

    return {
        "total_transactions": total,
        "revenue_at_risk": round(total_at_risk, 2),
        "potentially_recoverable": round(total_recoverable, 2),
        "total_recovered": round(total_recovered, 2),
        "recovery_rate_pct": recovery_rate,
        "at_risk_count": at_risk_count,
        "recoverable_count": len(recoverable),
        "recovered_count": len(recovered),
        "stopped_count": sum(1 for t in _TRANSACTIONS if t.stop_contacting),
    }


def _add_transaction(
    customer_name: str,
    amount: float,
    currency: str = "INR",
    payment_status: str = "FAILED",
    failure_reason: str = "unknown",
    customer_language: str = "en",
    customer_type: str = "new",
    phone: str = "",
    email: str = "",
) -> Transaction:
    """Add a new transaction to the dataset."""
    global _TRANSACTIONS, _TX_MAP
    
    # Generate new ID
    next_id = len(_TRANSACTIONS) + 1000
    tx_id = f"TX{next_id:04d}"
    
    # Create transaction
    tx = Transaction(
        transaction_id=tx_id,
        customer_id=f"C{next_id + 200:04d}",
        customer_name=customer_name,
        amount=amount,
        currency=currency,
        payment_status=payment_status,
        failure_reason=failure_reason,
        attempt_count=1,
        customer_language=customer_language,
        customer_type=customer_type,
        invoice_due_date=_date(random.randint(-30, 15)),
        subscription_status=random.choice(SUB_STATUSES),
        phone=phone or _phone(next_id),
        email=email or _email(customer_name, next_id),
        last_contact=None,
        recovery_probability=round(random.uniform(0.1, 0.9), 2),
        ai_action=None,
        outcome="pending",
        recovered_amount=0.0,
        contact_attempts=0,
        stop_contacting=False,
        created_at=_date(0),
    )
    
    _TRANSACTIONS.append(tx)
    _TX_MAP[tx_id] = tx
    return tx


def _generate_more_transactions(count: int = 50) -> int:
    """Generate additional synthetic transactions."""
    global _TRANSACTIONS, _TX_MAP
    
    start_idx = len(_TRANSACTIONS)
    for i in range(count):
        tx = _make_transaction(start_idx + i)
        _TRANSACTIONS.append(tx)
        _TX_MAP[tx.transaction_id] = tx
    
    return count
