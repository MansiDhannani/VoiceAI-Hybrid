"""
AI Decision Engine for Revenue Recovery.
Determines the appropriate intervention for each at-risk transaction.
Includes stopping rules to prevent customer harassment.
"""

from __future__ import annotations
from datetime import datetime
from typing import Literal

ActionType = Literal[
    "send_voice_reminder",
    "send_payment_link",
    "retry_payment",
    "follow_up_later",
    "escalate_to_human",
    "stop_contacting",
    "no_action",
]

MAX_CONTACT_ATTEMPTS = 2   # Hard limit — never contact more than twice

# Language → TTS language code for XTTS-v2
# NOTE: 'hi' causes CUDA device-side assert on this model build.
# All recovery messages are written in Latin script so 'en' works for all.
LANG_TO_SCRIPT_LANG = {
    "en": "en",
    "hi": "en",        # Force English — Hindi tokenizer not stable in this build
    "hinglish": "en",
    "te": "en",
    "ta": "en",
    "mr": "en",
    "bn": "en",
}

# Languages confirmed safe in this XTTS build
SUPPORTED_TTS_LANGS = {
    "en", "de", "fr", "es", "it", "pt", "pl", "zh", "ar",
    "cs", "ru", "nl", "tr", "ja", "hu", "ko",
}


def _safe_tts_lang(customer_lang: str) -> str:
    """Map customer language to a TTS lang code, always returns a supported value."""
    mapped = LANG_TO_SCRIPT_LANG.get(customer_lang, "en")
    return mapped if mapped in SUPPORTED_TTS_LANGS else "en"


RECOVERY_MESSAGES = {
    "en": {
        "FAILED": "Hello {name}, we noticed your payment of {amount} rupees could not be processed. This may be a temporary issue. Please retry or use a different payment method. We are here to help.",
        "ABANDONED": "Hi {name}, you left before completing your purchase of {amount} rupees. Your order is saved. Please click the link to complete your payment securely.",
        "OVERDUE": "Dear {name}, your invoice of {amount} rupees is now overdue. Please complete your payment at your earliest convenience to avoid any service interruption.",
    },
    "hi": {
        # Transliterated Hindi — spoken in English TTS, sounds natural for Hinglish customers
        "FAILED": "Namaste {name}, aapka {amount} rupees ka payment process nahi hua. Kripya dobara try karein ya doosra payment method use karein. Hum aapki help ke liye available hain.",
        "ABANDONED": "Namaste {name}, aapne {amount} rupees ki purchase complete nahi ki. Aapka order save hai. Payment link par click karke complete karein.",
        "OVERDUE": "Namaste {name}, aapka {amount} rupees ka invoice ab due ho gaya hai. Service continue rakhne ke liye please jaldi payment karein.",
    },
    "hinglish": {
        "FAILED": "Hello {name}, aapka {amount} rupees ka payment process nahi ho saka. Koi issue nahi, please retry karein ya different payment method try karein.",
        "ABANDONED": "Hi {name}, aapne apni {amount} rupees ki purchase complete nahi ki. Aapka order save hai, link pe click karke payment complete karein.",
        "OVERDUE": "Hey {name}, aapka {amount} rupees ka invoice overdue hai. Please jaldi payment karein taaki aapki service continue rahe.",
    },
}


def _get_message(lang: str, status: str, name: str, amount: float) -> str:
    lang_key = lang if lang in RECOVERY_MESSAGES else "en"
    status_key = status if status in ("FAILED", "ABANDONED", "OVERDUE") else "FAILED"
    template = RECOVERY_MESSAGES[lang_key].get(status_key, RECOVERY_MESSAGES["en"][status_key])
    return template.format(name=name.split()[0], amount=f"{amount:,.0f}")


def decide(transaction) -> dict:
    """
    Main AI decision function.
    Returns a dict with: action, reason, message, tts_language, should_stop
    """
    tx = transaction

    # Rule 1: Already recovered or succeeded — no action
    if tx.payment_status in ("RECOVERED", "SUCCESS"):
        return {
            "action": "no_action",
            "reason": "Transaction already completed successfully",
            "message": None,
            "tts_language": None,
            "should_stop": False,
        }

    # Rule 2: Hard stop — max attempts reached or explicitly stopped
    if tx.stop_contacting or tx.contact_attempts >= MAX_CONTACT_ATTEMPTS:
        return {
            "action": "stop_contacting",
            "reason": f"Maximum contact attempts ({MAX_CONTACT_ATTEMPTS}) reached or customer opted out",
            "message": None,
            "tts_language": None,
            "should_stop": True,
        }

    # Rule 3: Low recovery probability — don't waste attempts
    if tx.recovery_probability < 0.2:
        return {
            "action": "stop_contacting",
            "reason": f"Recovery probability too low ({tx.recovery_probability:.0%}) — not worth contacting",
            "message": None,
            "tts_language": None,
            "should_stop": True,
        }

    # Rule 4: Escalate if card is blocked or do_not_honor — human needed
    if tx.failure_reason in ("card_blocked", "do_not_honor", "authentication_failed"):
        return {
            "action": "escalate_to_human",
            "reason": f"Failure reason '{tx.failure_reason}' requires human agent assistance",
            "message": _get_message(tx.customer_language, tx.payment_status, tx.customer_name, tx.amount),
            "tts_language": _safe_tts_lang(tx.customer_language),
            "should_stop": False,
        }

    # Rule 5: Premium/returning customers with bank timeout → retry payment
    if tx.failure_reason in ("bank_timeout", "network_error") and tx.customer_type in ("premium", "returning"):
        return {
            "action": "retry_payment",
            "reason": f"Temporary {tx.failure_reason} — high-value {tx.customer_type} customer, safe to retry automatically",
            "message": _get_message(tx.customer_language, tx.payment_status, tx.customer_name, tx.amount),
            "tts_language": _safe_tts_lang(tx.customer_language),
            "should_stop": False,
        }

    # Rule 6: Abandoned checkout → send payment link with voice reminder
    if tx.payment_status == "ABANDONED":
        return {
            "action": "send_payment_link",
            "reason": "Customer abandoned checkout — send personalized payment link with voice reminder",
            "message": _get_message(tx.customer_language, "ABANDONED", tx.customer_name, tx.amount),
            "tts_language": _safe_tts_lang(tx.customer_language),
            "should_stop": False,
        }

    # Rule 7: High recovery probability → voice reminder
    if tx.recovery_probability >= 0.5:
        return {
            "action": "send_voice_reminder",
            "reason": f"High recovery probability ({tx.recovery_probability:.0%}) — personalized voice outreach recommended",
            "message": _get_message(tx.customer_language, tx.payment_status, tx.customer_name, tx.amount),
            "tts_language": _safe_tts_lang(tx.customer_language),
            "should_stop": False,
        }

    # Rule 8: First contact → send initial voice reminder
    if tx.contact_attempts == 0:
        return {
            "action": "send_voice_reminder",
            "reason": "First contact attempt — send initial voice reminder",
            "message": _get_message(tx.customer_language, tx.payment_status, tx.customer_name, tx.amount),
            "tts_language": _safe_tts_lang(tx.customer_language),
            "should_stop": False,
        }

    return {
        "action": "follow_up_later",
        "reason": "Previous contact attempt made — schedule follow-up after 24 hours",
        "message": None,
        "tts_language": None,
        "should_stop": False,
    }


def get_stopping_rules() -> list[dict]:
    """Return the human-readable stopping rules for display."""
    return [
        {"rule": "Max contact attempts", "value": str(MAX_CONTACT_ATTEMPTS), "description": "Never contact a customer more than twice"},
        {"rule": "Customer opt-out", "value": "Immediate", "description": "If customer declines, stop all contact immediately"},
        {"rule": "Payment success", "value": "Immediate", "description": "Stop all recovery actions once payment is confirmed"},
        {"rule": "Escalation trigger", "value": "On request", "description": "If customer requests human support, escalate and stop AI contact"},
        {"rule": "Low probability", "value": "< 20%", "description": "Don't contact customers with less than 20% recovery probability"},
        {"rule": "Hard stops", "value": "card_blocked, do_not_honor", "description": "Escalate to human — AI cannot resolve these"},
        {"rule": "No follow-up delay", "value": "24 hours", "description": "Minimum 24-hour gap between contact attempts"},
    ]
