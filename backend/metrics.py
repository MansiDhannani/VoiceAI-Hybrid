"""
Evaluation metrics collector for VoiceAI Hybrid.

Tracks and stores:
  - Per-stage latency: ASR, LLM, TTS
  - End-to-end conversation round-trip latency
  - Language detection accuracy (detected vs spoken language)
  - Voice similarity score (cosine similarity of speaker embeddings)
  - Recovery AI decision accuracy and throughput

All data is in-memory (resets on restart). Designed for demo/panel use.
"""

import time
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime


# ── Data Models ───────────────────────────────────────────────────────────────

@dataclass
class LatencySample:
    timestamp: str
    stage: str          # asr | llm | tts | total
    latency_ms: float
    language: str = "en"
    text_length: int = 0
    audio_duration_s: float = 0.0


@dataclass
class LangDetectionSample:
    timestamp: str
    spoken_language: str    # what user actually spoke (from pinned lang or ground truth)
    detected_language: str  # what Whisper returned
    correct: bool
    confidence: float = 1.0


@dataclass
class VoiceSimilaritySample:
    timestamp: str
    user_id: str
    similarity_score: float     # 0.0 – 1.0 cosine similarity
    reference_duration_s: float
    method: str = "speaker_embedding"  # speaker_embedding | mfcc_dtw


@dataclass
class RecoveryMetricSample:
    timestamp: str
    transaction_id: str
    decision_time_ms: float
    action: str
    recovery_probability: float
    outcome: str = "pending"


# ── In-Memory Store ───────────────────────────────────────────────────────────

_latency_log: List[LatencySample] = []
_lang_log: List[LangDetectionSample] = []
_similarity_log: List[VoiceSimilaritySample] = []
_recovery_log: List[RecoveryMetricSample] = []


# ── Collection Helpers ────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def record_latency(stage: str, latency_ms: float, language: str = "en",
                   text_length: int = 0, audio_duration_s: float = 0.0):
    _latency_log.append(LatencySample(
        timestamp=_now(), stage=stage, latency_ms=latency_ms,
        language=language, text_length=text_length,
        audio_duration_s=audio_duration_s
    ))
    # Keep last 500 samples
    if len(_latency_log) > 500:
        _latency_log.pop(0)


def record_lang_detection(spoken: str, detected: str, confidence: float = 1.0):
    correct = spoken.lower().strip() == detected.lower().strip()
    _lang_log.append(LangDetectionSample(
        timestamp=_now(), spoken_language=spoken,
        detected_language=detected, correct=correct,
        confidence=confidence
    ))
    if len(_lang_log) > 200:
        _lang_log.pop(0)


def record_voice_similarity(user_id: str, ref_path: str, synth_wav_bytes: bytes):
    """
    Compute cosine similarity between reference speaker embedding
    and synthesised audio embedding using SpeechBrain-style MFCC features.
    Falls back to MFCC+DTW if speaker model unavailable.
    """
    try:
        score = _compute_similarity(ref_path, synth_wav_bytes)
        try:
            import soundfile as sf2
            import io
            audio, sr = sf2.read(ref_path, dtype="float32")
            ref_dur = len(audio) / sr
        except Exception:
            ref_dur = 0.0

        _similarity_log.append(VoiceSimilaritySample(
            timestamp=_now(), user_id=user_id,
            similarity_score=round(score, 4),
            reference_duration_s=round(ref_dur, 1),
            method="mfcc_cosine"
        ))
        if len(_similarity_log) > 100:
            _similarity_log.pop(0)
        return score
    except Exception as e:
        print(f"[Metrics] Similarity computation failed: {e}")
        return None


def record_recovery_decision(tx_id: str, action: str, prob: float, latency_ms: float):
    _recovery_log.append(RecoveryMetricSample(
        timestamp=_now(), transaction_id=tx_id,
        decision_time_ms=latency_ms, action=action,
        recovery_probability=prob
    ))
    if len(_recovery_log) > 200:
        _recovery_log.pop(0)


def update_recovery_outcome(tx_id: str, outcome: str):
    for sample in reversed(_recovery_log):
        if sample.transaction_id == tx_id:
            sample.outcome = outcome
            break


# ── Similarity Computation ────────────────────────────────────────────────────

def _extract_mfcc_embedding(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Extract a fixed-dimension speaker embedding using MFCC statistics.
    Mean + std of 40 MFCC coefficients = 80-dim vector.
    """
    import librosa
    if len(audio) < sr * 0.5:
        return np.zeros(80)
    # Resample to 16kHz for consistency
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        sr = 16000
    mfccs = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=40, n_fft=512, hop_length=160)
    # Mean and std across time = speaker-level statistics
    emb = np.concatenate([mfccs.mean(axis=1), mfccs.std(axis=1)])
    return emb


def _compute_similarity(ref_path: str, synth_bytes: bytes) -> float:
    """
    Cosine similarity between reference voice and synthesised audio
    using MFCC speaker embeddings.

    Range: -1 to 1, where:
      > 0.85 = near-identical voice
      0.70–0.85 = good clone
      0.50–0.70 = recognizable but distinct
      < 0.50 = poor match
    """
    import soundfile as sf2
    import io

    ref_audio, ref_sr = sf2.read(ref_path, dtype="float32")
    if ref_audio.ndim > 1:
        ref_audio = ref_audio.mean(axis=1)

    synth_audio, synth_sr = sf2.read(io.BytesIO(synth_bytes), dtype="float32")
    if synth_audio.ndim > 1:
        synth_audio = synth_audio.mean(axis=1)

    ref_emb = _extract_mfcc_embedding(ref_audio, ref_sr)
    syn_emb = _extract_mfcc_embedding(synth_audio, synth_sr)

    # Cosine similarity
    denom = (np.linalg.norm(ref_emb) * np.linalg.norm(syn_emb))
    if denom < 1e-8:
        return 0.0
    sim = float(np.dot(ref_emb, syn_emb) / denom)
    # Clamp to [0, 1] for display (negative cosine = completely different)
    return max(0.0, sim)


# ── Aggregation ───────────────────────────────────────────────────────────────

def _percentile(data: list, p: float) -> float:
    if not data:
        return 0.0
    arr = sorted(data)
    idx = int(len(arr) * p / 100)
    return round(arr[min(idx, len(arr) - 1)], 1)


def get_latency_stats() -> dict:
    stages = ["asr", "llm", "tts", "total"]
    result = {}
    for stage in stages:
        samples = [s.latency_ms for s in _latency_log if s.stage == stage]
        if not samples:
            result[stage] = {"count": 0, "mean_ms": 0, "p50_ms": 0, "p95_ms": 0, "min_ms": 0, "max_ms": 0}
        else:
            result[stage] = {
                "count": len(samples),
                "mean_ms": round(np.mean(samples), 1),
                "p50_ms": _percentile(samples, 50),
                "p95_ms": _percentile(samples, 95),
                "min_ms": round(min(samples), 1),
                "max_ms": round(max(samples), 1),
            }
    # Recent 10 total latency samples for sparkline
    recent = [{"ts": s.timestamp, "ms": round(s.latency_ms, 1), "lang": s.language}
              for s in _latency_log if s.stage == "total"][-20:]
    result["recent_totals"] = recent
    return result


def get_lang_accuracy_stats() -> dict:
    if not _lang_log:
        return {"accuracy": 0, "total": 0, "correct": 0, "breakdown": {}}

    correct = sum(1 for s in _lang_log if s.correct)
    total = len(_lang_log)
    accuracy = round(correct / total * 100, 1)

    # Per-language breakdown
    lang_stats: dict = {}
    for s in _lang_log:
        lang = s.spoken_language
        if lang not in lang_stats:
            lang_stats[lang] = {"total": 0, "correct": 0}
        lang_stats[lang]["total"] += 1
        if s.correct:
            lang_stats[lang]["correct"] += 1

    breakdown = {
        lang: {
            "total": v["total"],
            "correct": v["correct"],
            "accuracy": round(v["correct"] / v["total"] * 100, 1)
        }
        for lang, v in lang_stats.items()
    }

    # Confusion: what did Whisper say when wrong?
    confusions = []
    for s in _lang_log:
        if not s.correct:
            confusions.append(f"{s.spoken_language}→{s.detected_language}")

    return {
        "accuracy": accuracy,
        "total": total,
        "correct": correct,
        "breakdown": breakdown,
        "recent_confusions": confusions[-10:],
        "recent_samples": [
            {"ts": s.timestamp, "spoken": s.spoken_language,
             "detected": s.detected_language, "correct": s.correct}
            for s in _lang_log[-15:]
        ]
    }


def get_similarity_stats() -> dict:
    if not _similarity_log:
        return {"count": 0, "mean": 0, "samples": []}

    scores = [s.similarity_score for s in _similarity_log]
    return {
        "count": len(scores),
        "mean": round(np.mean(scores), 4),
        "max": round(max(scores), 4),
        "min": round(min(scores), 4),
        "p50": _percentile(scores, 50),
        "threshold_good": 0.70,
        "threshold_excellent": 0.85,
        "samples": [
            {
                "ts": s.timestamp,
                "user_id": s.user_id,
                "score": s.similarity_score,
                "ref_duration_s": s.reference_duration_s,
                "rating": "excellent" if s.similarity_score >= 0.85
                          else "good" if s.similarity_score >= 0.70
                          else "fair" if s.similarity_score >= 0.50
                          else "poor"
            }
            for s in _similarity_log[-20:]
        ]
    }


def get_recovery_stats() -> dict:
    if not _recovery_log:
        return {"count": 0, "mean_decision_ms": 0, "samples": []}

    times = [s.decision_time_ms for s in _recovery_log]
    outcomes = [s.outcome for s in _recovery_log]
    actions = {}
    for s in _recovery_log:
        actions[s.action] = actions.get(s.action, 0) + 1

    return {
        "count": len(times),
        "mean_decision_ms": round(np.mean(times), 1),
        "p95_decision_ms": _percentile(times, 95),
        "action_distribution": actions,
        "outcome_counts": {
            "recovered": outcomes.count("recovered"),
            "pending": outcomes.count("pending"),
            "escalated": outcomes.count("escalated"),
            "stopped": outcomes.count("stopped"),
        },
        "samples": [
            {
                "ts": s.timestamp,
                "tx_id": s.transaction_id,
                "action": s.action,
                "prob": s.recovery_probability,
                "decision_ms": round(s.decision_time_ms, 1),
                "outcome": s.outcome,
            }
            for s in _recovery_log[-20:]
        ]
    }


def get_all_metrics() -> dict:
    return {
        "latency": get_latency_stats(),
        "language_detection": get_lang_accuracy_stats(),
        "voice_similarity": get_similarity_stats(),
        "recovery_decisions": get_recovery_stats(),
        "summary": {
            "total_conversations": len([s for s in _latency_log if s.stage == "total"]),
            "total_voice_synths": len(_similarity_log),
            "total_lang_detections": len(_lang_log),
            "total_recovery_decisions": len(_recovery_log),
        }
    }
