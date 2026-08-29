import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["CUDA_LAUNCH_BLOCKING"] = "1"

import io
import re
import sys
import asyncio
import numpy as np
import soundfile as sf
import torch
from config import settings

# ── Add patched TTS source to path ────────────────────────────────────────────
_TTS_SRC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "TTS-0.22.0")
if _TTS_SRC not in sys.path:
    sys.path.insert(0, _TTS_SRC)

_XTTS_MODEL_DIR = os.path.join(
    os.path.expanduser("~"),
    "AppData", "Local", "tts",
    "tts_models--multilingual--multi-dataset--xtts_v2"
)

# ── XTTS-v2 loader ────────────────────────────────────────────────────────────
_xtts_model = None
_XTTS_READY = False

def _load_xtts():
    global _xtts_model, _XTTS_READY
    if _XTTS_READY:
        return _xtts_model
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    config_path = os.path.join(_XTTS_MODEL_DIR, "config.json")
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"XTTS config not found at {config_path}")
    print(f"[TTS] Loading XTTS-v2 on {settings.TTS_DEVICE}...")
    config = XttsConfig()
    config.load_json(config_path)
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=_XTTS_MODEL_DIR, use_deepspeed=False)
    model = model.to(settings.TTS_DEVICE)
    model.eval()
    _xtts_model = model
    _XTTS_READY = True
    print("[TTS] XTTS-v2 Ready ✓")
    return _xtts_model

# ── Language helpers ──────────────────────────────────────────────────────────
XTTS_LANGUAGES = {
    "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru",
    "nl", "cs", "ar", "zh", "hu", "ko", "ja", "hi"
}
_LANG_MAP = {
    "en-us": "en", "en-gb": "en", "en-au": "en", "en-br": "en", "en-india": "en",
    "zh-cn": "zh", "zh-tw": "zh", "pt-br": "pt",
}

def _normalize_lang(lang):
    lang = (lang or "en").lower().strip()
    lang = _LANG_MAP.get(lang, lang)
    if lang not in XTTS_LANGUAGES:
        print(f"[TTS] '{lang}' unsupported, using 'en'")
        lang = "en"
    return lang

def _get_gpt_cond_len(speaker_wav):
    try:
        audio, sr = sf.read(speaker_wav, dtype="float32")
        dur = len(audio) / sr
    except Exception:
        dur = 3.0
    # 3s = fastest synthesis with acceptable voice cloning quality
    return max(3, min(int(dur), 3))

def _detect_language(text):
    """Heuristic: detect language from character ranges."""
    if not text.strip():
        return "en"
    korean   = sum(1 for c in text if '\uAC00' <= c <= '\uD7A3' or '\u1100' <= c <= '\u11FF' or '\u3130' <= c <= '\u318F')
    japanese = sum(1 for c in text if '\u3040' <= c <= '\u309F' or '\u30A0' <= c <= '\u30FF')
    chinese  = sum(1 for c in text if '\u4E00' <= c <= '\u9FFF')
    arabic   = sum(1 for c in text if '\u0600' <= c <= '\u06FF')
    hindi    = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    latin    = sum(1 for c in text if c.isalpha() and ord(c) < 256)
    total = korean + japanese + chinese + arabic + hindi + latin
    if total == 0:
        return "en"
    if japanese / total > 0.2:
        return "ja"
    if korean / total > 0.3:
        return "ko"
    if arabic / total > 0.3:
        return "ar"
    if hindi / total > 0.3:
        return "hi"
    if chinese / total > 0.3:
        return "zh"
    return "en"

def _split_by_language(text):
    """Split mixed Korean/English text into [(segment, lang), ...] pairs."""
    parts = re.split(r'([.!?,;]\s*)', text)
    chunks, i = [], 0
    while i < len(parts):
        chunk = parts[i]
        if i + 1 < len(parts) and re.match(r'^[.!?,;]\s*$', parts[i + 1]):
            chunk += parts[i + 1]
            i += 2
        else:
            i += 1
        chunk = chunk.strip()
        if chunk:
            chunks.append(chunk)

    if not chunks:
        return [(text.strip(), _detect_language(text))]

    segments = []
    for chunk in chunks:
        lang = _detect_language(chunk)
        if segments and segments[-1][1] == lang:
            segments[-1] = (segments[-1][0] + " " + chunk, lang)
        else:
            segments.append((chunk, lang))
    return segments


# ── TTS Engine ────────────────────────────────────────────────────────────────
class TTSEngine:
    def __init__(self):
        self.sr = 24000
        self._initialized = False

    def _ensure_loaded(self):
        if self._initialized:
            return
        self._initialized = True
        _load_xtts()
        print("[TTS] Pipeline: XTTS-v2 direct (multilingual, zero-shot) ✓")

    def _synthesize_chunk(self, text, speaker_wav, speed, lang):
        """Synthesize one short chunk on CUDA."""
        print(f"[TTS] lang={lang}: {text[:70]}")
        model = _xtts_model
        gpt_cond_len = _get_gpt_cond_len(speaker_wav)
        with torch.no_grad():
            outputs = model.synthesize(
                text=text,
                config=model.config,
                speaker_wav=speaker_wav,
                language=lang,
                gpt_cond_len=gpt_cond_len,
                gpt_cond_chunk_len=4,
                temperature=0.65,
                speed=speed,
                enable_text_splitting=True,
            )
        wav = outputs["wav"]
        if isinstance(wav, torch.Tensor):
            wav = wav.cpu().numpy()
        wav = np.array(wav, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, wav, self.sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    def _synthesize_single(self, text, speaker_wav, speed, lang):
        """Synthesize text in one language, splitting into ≤150-char chunks."""
        lang = _normalize_lang(lang)
        MAX_CHARS = 150
        if len(text) <= MAX_CHARS:
            return self._synthesize_chunk(text, speaker_wav, speed, lang)
        sentences = re.split(r'(?<=[.!?])\s+', text)
        chunks, current = [], ""
        for s in sentences:
            if len(current) + len(s) + 1 <= MAX_CHARS:
                current = (current + " " + s).strip() if current else s
            else:
                if current:
                    chunks.append(current)
                current = s
        if current:
            chunks.append(current)
        all_wav = []
        for chunk in chunks:
            wav_bytes = self._synthesize_chunk(chunk, speaker_wav, speed, lang)
            audio, _ = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            all_wav.append(audio)
        combined = np.concatenate(all_wav)
        buf = io.BytesIO()
        sf.write(buf, combined, self.sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    def _synthesize(self, text, speaker_wav, speed=1.0, language=None):
        self._ensure_loaded()
        text = text.strip()
        if not text:
            silence = np.zeros(int(self.sr * 0.5), dtype=np.float32)
            buf = io.BytesIO()
            sf.write(buf, silence, self.sr, format="WAV", subtype="PCM_16")
            return buf.getvalue()

        # Auto-split mixed Korean/English into per-language segments
        segments = _split_by_language(text)

        # If caller specified a language but we detected mixed content, use detected langs
        # If single language detected, use caller's language (more accurate for edge cases)
        if len(segments) == 1:
            lang = _normalize_lang(language) if language else segments[0][1]
            return self._synthesize_single(text, speaker_wav, speed, lang)

        print(f"[TTS] Mixed language — {len(segments)} segments")
        all_wav = []
        for seg_text, seg_lang in segments:
            seg_text = seg_text.strip()
            if not seg_text:
                continue
            wav_bytes = self._synthesize_single(seg_text, speaker_wav, speed, seg_lang)
            audio, _ = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            all_wav.append(audio)
        if not all_wav:
            silence = np.zeros(int(self.sr * 0.5), dtype=np.float32)
            buf = io.BytesIO()
            sf.write(buf, silence, self.sr, format="WAV", subtype="PCM_16")
            return buf.getvalue()
        combined = np.concatenate(all_wav)
        buf = io.BytesIO()
        sf.write(buf, combined, self.sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    # ── Public API ────────────────────────────────────────────────────────────

    def synthesize_sentence(self, text, speaker_wav, speed=1.0, temperature=0.65, language=None):
        return self._synthesize(text, speaker_wav, speed, language=language)

    def synthesize_full(self, text, speaker_wav, speed=1.0, temperature=0.65, language=None):
        return self._synthesize(text, speaker_wav, speed, language=language)

    def stream_sentences(self, text, speaker_wav, speed=1.0, temperature=0.65, language=None):
        sentences = re.split(r'(?<=[.!?,;])\s+', text.strip())
        for sentence in sentences:
            if sentence.strip():
                yield self._synthesize(sentence, speaker_wav, speed, language=language)

    async def synthesize_async(self, text, speaker_wav, speed=1.0, temperature=0.65, language=None):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.synthesize_full, text, speaker_wav, speed, temperature, language
        )


tts_engine = TTSEngine()
