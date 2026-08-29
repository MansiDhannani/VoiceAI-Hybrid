import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"  # Fix Intel OpenMP duplicate on Windows

import io
import asyncio
import numpy as np
import librosa
from faster_whisper import WhisperModel
from config import settings

class ASREngine:
    def __init__(self):
        print(f"[ASR] Loading Whisper {settings.WHISPER_MODEL_SIZE} on {settings.WHISPER_DEVICE}...")
        self.model = WhisperModel(
            settings.WHISPER_MODEL_SIZE,
            device=settings.WHISPER_DEVICE,
            compute_type=settings.WHISPER_COMPUTE_TYPE,  # int8 → ~1GB VRAM
        )
        print("[ASR] Ready ✓")

    def _preprocess(self, audio_bytes: bytes) -> np.ndarray:
        """Convert any audio format → 16kHz mono float32."""
        import tempfile, os

        if len(audio_bytes) < 100:
            return np.zeros(16000, dtype=np.float32)

        header = audio_bytes[:4].hex()
        print(f"[ASR] Audio header: {header}, len={len(audio_bytes)}")

        # Strategy 1: Try soundfile directly (works for WAV)
        try:
            import soundfile as sf2
            data, sr = sf2.read(io.BytesIO(audio_bytes), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            if sr != 16000:
                import torchaudio, torch
                t = torch.from_numpy(data).unsqueeze(0)
                data = torchaudio.transforms.Resample(sr, 16000)(t).squeeze().numpy()
            print(f"[ASR] Decoded via soundfile, sr={sr}")
            return data.astype(np.float32)
        except Exception:
            pass

        # Strategy 2: Try PyAV with webm extension (browser default)
        import av as pyav
        for ext in [".webm", ".ogg", ".wav", ".mp3"]:
            tmp = tempfile.mktemp(suffix=ext)
            try:
                with open(tmp, "wb") as f:
                    f.write(audio_bytes)
                container = pyav.open(tmp)
                streams = list(container.streams.audio)
                if not streams:
                    container.close()
                    os.unlink(tmp)
                    continue
                samples, sr = [], None
                for frame in container.decode(audio=0):
                    if sr is None:
                        sr = frame.sample_rate
                    arr = frame.to_ndarray()
                    if arr.ndim > 1:
                        arr = arr.mean(axis=0)
                    samples.append(arr.astype(np.float32))
                container.close()
                os.unlink(tmp)
                if samples:
                    audio = np.concatenate(samples)
                    if sr and sr != 16000:
                        import torchaudio, torch
                        t = torch.from_numpy(audio).unsqueeze(0)
                        audio = torchaudio.transforms.Resample(sr, 16000)(t).squeeze().numpy()
                    print(f"[ASR] Decoded via PyAV ext={ext}, sr={sr}")
                    return audio.astype(np.float32)
            except Exception as e:
                print(f"[ASR] ext={ext} failed: {e}")
                try: os.unlink(tmp)
                except: pass

        # Strategy 3: Use pydub (handles webm via built-in codec)
        try:
            from pydub import AudioSegment
            tmp_in = tempfile.mktemp(suffix=".webm")
            tmp_out = tempfile.mktemp(suffix=".wav")
            with open(tmp_in, "wb") as f:
                f.write(audio_bytes)
            seg = AudioSegment.from_file(tmp_in)
            seg = seg.set_frame_rate(16000).set_channels(1)
            seg.export(tmp_out, format="wav")
            data, sr = sf2.read(tmp_out, dtype="float32")
            os.unlink(tmp_in)
            os.unlink(tmp_out)
            print(f"[ASR] Decoded via pydub")
            return data.astype(np.float32)
        except Exception as e:
            print(f"[ASR] pydub failed: {e}")

        print("[ASR] All decoders failed, returning silence")
        return np.zeros(16000, dtype=np.float32)

    def transcribe(self, audio_bytes: bytes, language: str | None = None) -> dict:
        """
        Transcribe audio and return transcript + detected language.

        Args:
            audio_bytes: Raw audio bytes in any supported format.
            language: BCP-47 language code (e.g. "en", "hi", "fr", "es").
                      Pass None to auto-detect.

        Returns:
            dict with keys:
              - "text"     : transcribed string
              - "language" : detected/used language code (e.g. "en", "hi")
        """
        audio_np = self._preprocess(audio_bytes)
        segments, info = self.model.transcribe(
            audio_np,
            beam_size=3,
            language=language,         # None = auto-detect
            vad_filter=True,           # skip silence automatically
            vad_parameters={"min_silence_duration_ms": 300},
            condition_on_previous_text=False,
        )
        transcript = " ".join(s.text.strip() for s in segments).strip()
        detected = info.language or (language or "en")
        print(f"[ASR] lang={detected} '{transcript}' ({info.duration:.1f}s audio)")
        return {"text": transcript, "language": detected}

    async def transcribe_async(self, audio_bytes: bytes, language: str | None = None) -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.transcribe, audio_bytes, language)

# Singleton — loaded once at startup
asr_engine = ASREngine()