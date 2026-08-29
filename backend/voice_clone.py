import io
import shutil
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path
from config import settings

PROFILES_DIR = Path(settings.VOICE_PROFILES_DIR)
PROFILES_DIR.mkdir(exist_ok=True)


class VoiceProfileManager:
    """
    Hybrid voice cloning:
    - reference.wav  → best 30s segment for XTTS-v2 (voice texture)
    - full_audio.wav → full audio for OpenVoice V2 speaker embedding (accent accuracy)

    Longer audio = better accent cloning. 10 minutes is ideal.
    """

    def _user_dir(self, user_id: str) -> Path:
        d = PROFILES_DIR / user_id
        d.mkdir(exist_ok=True)
        return d

    def _find_best_segment(self, audio: np.ndarray, sr: int, seg_len: int = 30) -> np.ndarray:
        """
        Find the best 30s segment — picks the one with most voiced speech,
        not just loudest (avoids picking music/jingles from commercials).
        """
        total = len(audio)
        seg_samples = seg_len * sr

        if total <= seg_samples:
            return audio

        hop = sr * 5  # 5s hop
        best_score = -1
        best_start = 0

        for start in range(0, total - seg_samples, hop):
            segment = audio[start:start + seg_samples]

            # Score by zero-crossing rate (speech has moderate ZCR, music has high ZCR)
            # and RMS energy — speech has consistent energy, music has peaks
            rms = float(np.sqrt(np.mean(segment ** 2)))

            # Zero crossing rate — lower = more voiced speech, higher = music/noise
            zcr = float(np.mean(np.abs(np.diff(np.sign(segment)))) / 2)

            # Spectral flatness — speech is less flat than music
            fft = np.abs(np.fft.rfft(segment[:sr]))  # first 1s
            geometric_mean = np.exp(np.mean(np.log(fft + 1e-10)))
            arithmetic_mean = np.mean(fft) + 1e-10
            flatness = geometric_mean / arithmetic_mean

            # Score: high RMS + low ZCR + low flatness = clean speech
            score = rms * (1.0 - min(zcr * 10, 0.9)) * (1.0 - min(flatness, 0.9))

            if score > best_score:
                best_score = score
                best_start = start

        return audio[best_start:best_start + seg_samples]

    def create_profile(self, user_id: str, audio_files: list[bytes]) -> str:
        """
        Process uploaded audio files:
        1. Merge all files into one long audio
        2. Save full audio for OpenVoice V2 embedding (up to 10 min)
        3. Extract best 30s segment for XTTS-v2 reference
        """
        combined = []
        sr_ref = 22050

        for raw in audio_files:
            try:
                data, sr = librosa.load(io.BytesIO(raw), sr=sr_ref, mono=True)
                combined.append(data)
            except Exception as e:
                print(f"[VoiceClone] Warning: could not load audio: {e}")
                continue

        if not combined:
            raise ValueError("No valid audio data found in uploaded files")

        merged = np.concatenate(combined)
        duration = len(merged) / sr_ref
        print(f"[VoiceClone] Total audio: {duration:.1f}s")

        # Normalize loudness
        if np.abs(merged).max() > 0:
            merged = merged / np.abs(merged).max() * 0.9

        user_dir = self._user_dir(user_id)

        # ── Save full audio for OpenVoice V2 (up to 10 min) ──────────────────
        # More audio = better accent embedding
        max_full = int(600 * sr_ref)  # 10 minutes max
        full_audio = merged[:max_full]
        full_path = user_dir / "full_audio.wav"
        sf.write(str(full_path), full_audio, sr_ref, subtype="PCM_16")
        print(f"[VoiceClone] Full audio saved: {len(full_audio)/sr_ref:.1f}s for accent embedding")

        # ── Extract best 30s segment for XTTS-v2 ─────────────────────────────
        best_segment = self._find_best_segment(merged, sr_ref, seg_len=30)
        ref_path = user_dir / "reference.wav"
        sf.write(str(ref_path), best_segment, sr_ref, subtype="PCM_16")
        print(f"[VoiceClone] Best 30s segment saved for XTTS-v2 reference")

        # Clear cached OpenVoice embedding so it gets re-extracted with new audio
        self._clear_ov_cache(str(full_path))

        return str(ref_path)

    def _clear_ov_cache(self, audio_path: str):
        """Clear OpenVoice speaker embedding cache for this user."""
        try:
            from tts import _se_cache
            # Remove both reference and full audio from cache
            keys_to_remove = [k for k in _se_cache if audio_path in k or "reference" in k]
            for k in keys_to_remove:
                del _se_cache[k]
        except Exception:
            pass

    def get_reference_path(self, user_id: str) -> str | None:
        """Returns the 30s XTTS-v2 reference WAV path."""
        ref = PROFILES_DIR / user_id / "reference.wav"
        return str(ref) if ref.exists() else None

    def get_full_audio_path(self, user_id: str) -> str | None:
        """
        Returns the full audio path for OpenVoice V2 embedding.
        Falls back to reference.wav if full audio not available.
        """
        full = PROFILES_DIR / user_id / "full_audio.wav"
        if full.exists():
            return str(full)
        # Fallback to reference for older profiles
        return self.get_reference_path(user_id)

    def has_profile(self, user_id: str) -> bool:
        return self.get_reference_path(user_id) is not None

    def delete_profile(self, user_id: str):
        d = PROFILES_DIR / user_id
        if d.exists():
            shutil.rmtree(d)
            print(f"[VoiceClone] Deleted profile for {user_id}")


voice_manager = VoiceProfileManager()
