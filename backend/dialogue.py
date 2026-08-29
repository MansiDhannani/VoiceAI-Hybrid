import io
import re
import json
import asyncio
import numpy as np
import soundfile as sf
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
from voice_clone import voice_manager
from tts import tts_engine
from emotion import parse_emotion, EMOTION_PROSODY
from config import settings

@dataclass
class DialogueLine:
    speaker: str          # "A", "B", or "C"
    text: str
    emotion: str = "neutral"
    pause_after: float = 0.4   # seconds of silence after this line
    language: str | None = None  # per-line language override (e.g. "ko", "en")

@dataclass
class DialogueResult:
    audio_bytes: bytes        # final merged WAV
    duration_seconds: float
    lines_rendered: int
    sample_rate: int

def parse_script(raw_script: str) -> list[DialogueLine]:
    """
    Parse a conversation script into DialogueLine objects.

    Supported formats:

    Format 1 — Simple speaker labels:
        A: Hello, how are you?
        B: I'm doing great, thanks!
        C: [happy] 안녕하세요!
        A: [happy] That's wonderful to hear.

    Inline language override (appended to emotion tag with |):
        C: [neutral|ko] 안녕하세요, 잘 지내셨어요?

    Format 2 — JSON array:
        [
          {"speaker": "A", "text": "Hello!", "emotion": "happy", "language": "en"},
          {"speaker": "B", "text": "Hi there.", "emotion": "neutral"},
          {"speaker": "C", "text": "안녕하세요", "emotion": "happy", "language": "ko"}
        ]
    """
    raw = raw_script.strip()

    # ── JSON format ─────────────────────────────────────────
    if raw.startswith("["):
        try:
            items = json.loads(raw)
            lines = []
            for item in items:
                lines.append(DialogueLine(
                    speaker=item["speaker"].upper(),
                    text=item["text"].strip(),
                    emotion=item.get("emotion", "neutral"),
                    pause_after=float(item.get("pause_after", 0.4)),
                    language=item.get("language", None),
                ))
            return lines
        except (json.JSONDecodeError, KeyError) as e:
            raise ValueError(f"Invalid JSON script: {e}")

    # ── Plain text format ────────────────────────────────────
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue

        # Match: "A: [happy] Some text." or "B: Some text."
        match = re.match(r"^([A-Za-z0-9_]+)\s*:\s*(.*)", line)
        if not match:
            continue

        speaker = match.group(1).upper()
        content = match.group(2).strip()

        # Extract inline emotion tag — supports [happy] or [happy|ko] for language override
        emotion_match = re.match(r"^\[(\w+)(?:\|(\w+))?\]\s*(.*)", content)
        if emotion_match:
            emotion = emotion_match.group(1).lower()
            lang_override = emotion_match.group(2)  # e.g. "ko" from [happy|ko], or None
            text = emotion_match.group(3).strip()
        else:
            emotion = "neutral"
            lang_override = None
            text = content

        if text:
            lines.append(DialogueLine(
                speaker=speaker,
                text=text,
                emotion=emotion,
                language=lang_override,
            ))

    if not lines:
        raise ValueError("Could not parse any dialogue lines from script.")

    return lines


def make_silence(seconds: float, sample_rate: int) -> np.ndarray:
    """Generate silence as numpy array."""
    return np.zeros(int(seconds * sample_rate), dtype=np.float32)


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    """Normalize audio to consistent loudness."""
    peak = np.abs(audio).max()
    if peak > 0:
        return audio / peak * 0.85
    return audio


class DialogueEngine:

    async def render(
        self,
        script: str,
        user_id_a: str,
        user_id_b: str,
        user_id_c: str | None = None,        # optional third speaker
        speaker_a_name: str = "A",
        speaker_b_name: str = "B",
        speaker_c_name: str = "C",
        language_a: str | None = None,       # default language for speaker A (None = auto per line)
        language_b: str | None = None,       # default language for speaker B
        language_c: str | None = None,       # default language for speaker C
        gap_between_lines: float = 0.4,
        intro_silence: float = 0.5,
        outro_silence: float = 1.0,
        output_sample_rate: int = 24000,
        on_progress=None,                    # async callback(line_index, total, speaker, text, emotion)
    ) -> DialogueResult:
        """
        Render a full dialogue to a single merged WAV.
        Supports 2 or 3 speakers, each with their own cloned voice and language.

        Language priority per line:
          1. Inline override in script tag: [happy|ko]
          2. Per-speaker language_a / language_b / language_c param
          3. None — TTS engine auto-selects best path

        XTTS-v2 is used for Korean (ko) and other non-English languages.
        F5-TTS is used for English (en) for best accent cloning quality.
        """

        # ── Validate voice profiles ──────────────────────────
        ref_a = voice_manager.get_reference_path(user_id_a)
        ref_b = voice_manager.get_reference_path(user_id_b)
        ref_c = voice_manager.get_reference_path(user_id_c) if user_id_c else None

        if not ref_a:
            raise ValueError(f"No voice profile for speaker A (user: {user_id_a}). Upload samples first.")
        if not ref_b:
            raise ValueError(f"No voice profile for speaker B (user: {user_id_b}). Upload samples first.")
        if user_id_c and not ref_c:
            raise ValueError(f"No voice profile for speaker C (user: {user_id_c}). Upload samples first.")

        # ── Parse script ─────────────────────────────────────
        lines = parse_script(script)
        if not lines:
            raise ValueError("Script produced no dialogue lines.")

        # Map speaker label → (user_id, ref_wav, default_language)
        # Both the custom name and the canonical A/B/C are registered
        speaker_map: dict[str, tuple[str, str, str | None]] = {
            speaker_a_name.upper(): (user_id_a, ref_a, language_a),
            speaker_b_name.upper(): (user_id_b, ref_b, language_b),
            "A": (user_id_a, ref_a, language_a),
            "B": (user_id_b, ref_b, language_b),
        }
        if user_id_c and ref_c:
            speaker_map[speaker_c_name.upper()] = (user_id_c, ref_c, language_c)
            speaker_map["C"] = (user_id_c, ref_c, language_c)

        # ── Synthesize each line ─────────────────────────────
        segments: list[np.ndarray] = []
        sr = output_sample_rate

        segments.append(make_silence(intro_silence, sr))

        loop = asyncio.get_event_loop()

        for i, line in enumerate(lines):
            speaker_key = line.speaker.upper()
            mapping = speaker_map.get(speaker_key)

            if not mapping:
                print(f"[Dialogue] Warning: unknown speaker '{line.speaker}' on line {i+1}, skipping.")
                continue

            user_id, ref_wav, speaker_lang = mapping
            prosody = EMOTION_PROSODY.get(line.emotion, EMOTION_PROSODY["neutral"])

            # Language priority: inline script override > speaker-level default > None
            effective_lang = line.language or speaker_lang or None

            if on_progress:
                await on_progress(i, len(lines), line.speaker, line.text, line.emotion)

            print(
                f"[Dialogue] Line {i+1}/{len(lines)} | "
                f"{line.speaker} [{line.emotion}] lang={effective_lang or 'auto'}: "
                f"{line.text[:50]}"
            )

            def synth(
                text=line.text,
                ref=ref_wav,
                speed=prosody["speed"],
                temp=prosody["temperature"],
                lang=effective_lang,
            ):
                return tts_engine.synthesize_full(text, ref, speed=speed, temperature=temp, language=lang)

            wav_bytes = await loop.run_in_executor(None, synth)

            # Decode WAV bytes → numpy
            audio_np, file_sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            if audio_np.ndim > 1:
                audio_np = audio_np.mean(axis=1)

            # Resample if needed
            if file_sr != sr:
                import torch, torchaudio
                t = torch.from_numpy(audio_np).unsqueeze(0)
                audio_np = torchaudio.transforms.Resample(file_sr, sr)(t).squeeze().numpy()

            segments.append(normalize_audio(audio_np))

            pause = line.pause_after if line.pause_after != 0.4 else gap_between_lines
            segments.append(make_silence(pause, sr))

        segments.append(make_silence(outro_silence, sr))

        # ── Merge all segments ───────────────────────────────
        merged = np.concatenate(segments)

        # ── Upsample to 48kHz stereo 32-bit for professional output ──────────
        OUTPUT_SR = 48000
        if sr != OUTPUT_SR:
            import torch as _torch
            import torchaudio as _torchaudio
            t = _torch.from_numpy(merged).unsqueeze(0)  # (1, samples)
            resampler = _torchaudio.transforms.Resample(sr, OUTPUT_SR)
            merged = resampler(t).squeeze(0).numpy()

        # Convert mono → stereo (duplicate channel)
        stereo = np.stack([merged, merged], axis=1)  # (samples, 2)

        duration = len(merged) / OUTPUT_SR

        buf = io.BytesIO()
        sf.write(buf, stereo, OUTPUT_SR, format="WAV", subtype="FLOAT")  # 32-bit float
        wav_bytes = buf.getvalue()

        print(f"[Dialogue] Done — {len(lines)} lines, {duration:.1f}s, {len(wav_bytes)//1024}KB, 48kHz stereo 32-bit")

        return DialogueResult(
            audio_bytes=wav_bytes,
            duration_seconds=duration,
            lines_rendered=len(lines),
            sample_rate=OUTPUT_SR,
        )


dialogue_engine = DialogueEngine()
