import io
import json
import shutil
import pickle
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Callable, Awaitable
from config import settings
from .prosody_extractor import prosody_extractor, ProsodyFeatures

PROFILES_DIR = Path(settings.VOICE_PROFILES_DIR)
PROFILES_DIR.mkdir(exist_ok=True)


class CloneStatus(str, Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    READY      = "ready"
    FAILED     = "failed"


@dataclass
class VoiceProfile:
    user_id: str
    speaker_name: str
    status: CloneStatus
    xtts_checkpoint: str | None = None
    rvc_model: str | None = None
    reference_wav: str | None = None
    prosody_profile: str | None = None   # ← path to pickled ProsodyFeatures
    duration_seconds: float = 0.0
    num_files: int = 0
    quality_score: float = 0.0
    error: str | None = None


class CloneManager:
    """
    Manages voice cloning profiles — stores reference WAV,
    prosody features, and optional fine-tuned checkpoints.
    """

    def _user_dir(self, user_id: str) -> Path:
        d = PROFILES_DIR / user_id
        d.mkdir(exist_ok=True)
        return d

    def _profile_path(self, user_id: str) -> Path:
        return self._user_dir(user_id) / "profile.json"

    def save_profile(self, profile: VoiceProfile):
        path = self._profile_path(profile.user_id)
        data = {
            "user_id": profile.user_id,
            "speaker_name": profile.speaker_name,
            "status": profile.status.value,
            "xtts_checkpoint": profile.xtts_checkpoint,
            "rvc_model": profile.rvc_model,
            "reference_wav": profile.reference_wav,
            "prosody_profile": profile.prosody_profile,
            "duration_seconds": profile.duration_seconds,
            "num_files": profile.num_files,
            "quality_score": profile.quality_score,
            "error": profile.error,
        }
        with open(str(path), "w") as f:
            json.dump(data, f, indent=2)

    def load_profile(self, user_id: str) -> VoiceProfile | None:
        path = self._profile_path(user_id)
        if not path.exists():
            return None
        with open(str(path)) as f:
            data = json.load(f)
        return VoiceProfile(
            user_id=data["user_id"],
            speaker_name=data["speaker_name"],
            status=CloneStatus(data["status"]),
            xtts_checkpoint=data.get("xtts_checkpoint"),
            rvc_model=data.get("rvc_model"),
            reference_wav=data.get("reference_wav"),
            prosody_profile=data.get("prosody_profile"),
            duration_seconds=data.get("duration_seconds", 0.0),
            num_files=data.get("num_files", 0),
            quality_score=data.get("quality_score", 0.0),
            error=data.get("error"),
        )

    def has_profile(self, user_id: str) -> bool:
        profile = self.load_profile(user_id)
        return profile is not None and profile.status == CloneStatus.READY

    def get_reference_path(self, user_id: str) -> str | None:
        profile = self.load_profile(user_id)
        if profile and profile.reference_wav:
            ref = Path(profile.reference_wav)
            return str(ref) if ref.exists() else None
        # Fallback: check legacy reference.wav
        legacy = PROFILES_DIR / user_id / "reference.wav"
        return str(legacy) if legacy.exists() else None

    def get_prosody(self, user_id: str) -> ProsodyFeatures | None:
        """Load the pickled ProsodyFeatures for a user."""
        profile = self.load_profile(user_id)
        if not profile or not profile.prosody_profile:
            return None
        try:
            with open(profile.prosody_profile, "rb") as f:
                return pickle.load(f)
        except Exception:
            return None

    def delete_profile(self, user_id: str):
        d = PROFILES_DIR / user_id
        if d.exists():
            shutil.rmtree(d)
            print(f"[CloneManager] Deleted profile for {user_id}")

    async def clone_voice(
        self,
        user_id: str,
        speaker_name: str,
        audio_files: list[bytes],
        notify: Callable[[CloneStatus, str, int], Awaitable[None]] | None = None,
    ) -> VoiceProfile:
        """
        Full voice cloning pipeline:
          1. Merge & validate audio
          1b. Extract prosody features
          2. Save reference WAV for XTTS-v2 zero-shot cloning
          3. Save profile

        Args:
            user_id:      Unique user identifier
            speaker_name: Display name for the speaker
            audio_files:  List of raw audio bytes (any format)
            notify:       Optional async callback(status, message, percent)
        """

        async def _notify(status: CloneStatus, msg: str, pct: int):
            print(f"[CloneManager] [{pct}%] {msg}")
            if notify:
                await notify(status, msg, pct)

        profile = VoiceProfile(
            user_id=user_id,
            speaker_name=speaker_name,
            status=CloneStatus.PROCESSING,
        )
        self.save_profile(profile)

        try:
            # ── Step 1: Merge & validate audio ───────────────────
            await _notify(CloneStatus.PROCESSING, "Processing audio files...", 10)

            combined = []
            sr_ref = 22050

            for raw in audio_files:
                try:
                    data, sr = librosa.load(io.BytesIO(raw), sr=sr_ref, mono=True)
                    combined.append(data)
                except Exception as e:
                    print(f"[CloneManager] Warning: could not load audio: {e}")
                    continue

            if not combined:
                raise ValueError("No valid audio data found in uploaded files.")

            merged = np.concatenate(combined)
            max_samples = int(30 * sr_ref)
            merged = merged[:max_samples]

            if np.abs(merged).max() > 0:
                merged = merged / np.abs(merged).max() * 0.9

            duration = len(merged) / sr_ref
            if duration < 3.0:
                raise ValueError(f"Audio too short ({duration:.1f}s). Please upload at least 6 seconds.")

            # ── Step 1b: Extract prosody features ────────────────
            await _notify(CloneStatus.PROCESSING, "Extracting accent and prosody features...", 15)

            prosody = prosody_extractor.extract_from_multiple(audio_files)

            # Save prosody profile to disk
            prosody_path = self._user_dir(user_id) / "prosody.pkl"
            with open(str(prosody_path), "wb") as f:
                pickle.dump(prosody, f)
            profile.prosody_profile = str(prosody_path)

            print(
                f"[CloneManager] Prosody: F0={prosody.f0_mean:.1f}Hz, "
                f"rate={prosody.speaking_rate:.1f}syl/s, "
                f"F1={prosody.vowel_formants['F1_mean']:.0f}Hz"
            )

            # ── Step 2: Save reference WAV ────────────────────────
            await _notify(CloneStatus.PROCESSING, "Saving voice reference...", 50)

            ref_path = self._user_dir(user_id) / "reference.wav"
            sf.write(str(ref_path), merged, sr_ref, subtype="PCM_16")

            profile.reference_wav = str(ref_path)
            profile.duration_seconds = round(duration, 2)
            profile.num_files = len(audio_files)
            profile.quality_score = min(1.0, duration / 30.0)

            # ── Step 3: Finalize ──────────────────────────────────
            await _notify(CloneStatus.READY, "Voice profile ready!", 100)

            profile.status = CloneStatus.READY
            self.save_profile(profile)

            print(f"[CloneManager] Profile ready for {user_id} ({duration:.1f}s, "
                  f"quality={profile.quality_score:.2f})")
            return profile

        except Exception as e:
            profile.status = CloneStatus.FAILED
            profile.error = str(e)
            self.save_profile(profile)
            print(f"[CloneManager] Failed for {user_id}: {e}")
            raise


clone_manager = CloneManager()
