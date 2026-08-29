import io
import numpy as np
import soundfile as sf
import librosa
import torch
from dataclasses import dataclass
from pathlib import Path

@dataclass
class ProsodyFeatures:
    """All prosody features extracted from a speaker's real audio."""
    # Pitch (F0) — how the speaker's voice rises and falls
    f0_mean: float            # average pitch in Hz
    f0_std: float             # pitch variation (flat vs expressive)
    f0_contour: np.ndarray    # full pitch curve over time
    f0_voiced_ratio: float    # fraction of time speaker is voiced

    # Rhythm — how fast/slow the speaker talks
    speaking_rate: float      # syllables per second
    pause_duration_mean: float  # avg pause length in seconds
    pause_duration_std: float
    syllable_durations: np.ndarray  # duration of each syllable

    # Energy — loudness patterns, stress
    energy_mean: float
    energy_std: float
    energy_contour: np.ndarray    # loudness curve over time

    # Accent-specific features
    vowel_formants: dict          # F1/F2 formants per vowel (accent fingerprint)
    spectral_tilt: float          # how bright/dark the voice sounds
    jitter: float                 # pitch irregularity (voice texture)
    shimmer: float                # amplitude irregularity

    sample_rate: int
    duration: float

class ProsodyExtractor:
    """
    Extracts detailed prosody features from speaker audio.
    These features capture HOW the speaker speaks — not just the voice color.
    """

    def extract(self, audio_bytes: bytes) -> ProsodyFeatures:
        audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        duration = len(audio) / sr

        # ── F0 (Pitch) extraction ─────────────────────────────
        # Use CREPE for high-accuracy pitch tracking
        f0, voiced_flag, voiced_probs = self._extract_f0(audio, sr)

        voiced_f0 = f0[voiced_flag]
        f0_mean = float(np.median(voiced_f0)) if len(voiced_f0) > 0 else 150.0
        f0_std = float(np.std(voiced_f0)) if len(voiced_f0) > 0 else 20.0
        f0_voiced_ratio = float(voiced_flag.sum() / len(voiced_flag))

        # ── Energy envelope ───────────────────────────────────
        frame_length = int(0.025 * sr)   # 25ms frames
        hop_length = int(0.010 * sr)     # 10ms hop
        energy = librosa.feature.rms(
            y=audio, frame_length=frame_length, hop_length=hop_length
        )[0]
        energy_mean = float(np.mean(energy))
        energy_std = float(np.std(energy))

        # ── Speaking rate & rhythm ────────────────────────────
        speaking_rate, pause_mean, pause_std, syl_durs = self._extract_rhythm(audio, sr)

        # ── Accent features (formants) ────────────────────────
        vowel_formants = self._extract_vowel_formants(audio, sr)

        # ── Voice quality features ────────────────────────────
        spectral_tilt = self._compute_spectral_tilt(audio, sr)
        jitter, shimmer = self._compute_jitter_shimmer(f0, energy, voiced_flag)

        return ProsodyFeatures(
            f0_mean=f0_mean,
            f0_std=f0_std,
            f0_contour=f0,
            f0_voiced_ratio=f0_voiced_ratio,
            speaking_rate=speaking_rate,
            pause_duration_mean=pause_mean,
            pause_duration_std=pause_std,
            syllable_durations=syl_durs,
            energy_mean=energy_mean,
            energy_std=energy_std,
            energy_contour=energy,
            vowel_formants=vowel_formants,
            spectral_tilt=spectral_tilt,
            jitter=jitter,
            shimmer=shimmer,
            sample_rate=sr,
            duration=duration,
        )

    def _extract_f0(self, audio: np.ndarray, sr: int):
        """Extract F0 using pYIN — most accurate open-source pitch tracker."""
        f0, voiced_flag, voiced_probs = librosa.pyin(
            audio,
            fmin=librosa.note_to_hz('C2'),   # 65 Hz — covers very deep voices
            fmax=librosa.note_to_hz('C7'),   # 2093 Hz — covers high voices
            sr=sr,
            frame_length=2048,
            hop_length=256,
        )
        f0 = np.nan_to_num(f0, nan=0.0)
        return f0, voiced_flag, voiced_probs

    def _extract_rhythm(self, audio: np.ndarray, sr: int):
        """Extract speaking rate, pauses, and syllable durations."""
        # Detect syllable nuclei via energy peaks
        hop = 256
        energy = librosa.feature.rms(y=audio, hop_length=hop)[0]

        # Smooth energy
        from scipy.signal import find_peaks, savgol_filter
        smooth = savgol_filter(energy, window_length=11, polyorder=2)

        # Find syllable peaks
        peaks, _ = find_peaks(smooth, height=np.mean(smooth) * 0.5, distance=int(0.08 * sr / hop))
        num_syllables = len(peaks)
        duration = len(audio) / sr
        speaking_rate = num_syllables / duration if duration > 0 else 4.0

        # Find pauses (silence regions)
        silence_threshold = np.mean(energy) * 0.1
        is_silence = energy < silence_threshold
        pause_durations = []
        in_pause = False
        pause_start = 0

        for i, silent in enumerate(is_silence):
            t = i * hop / sr
            if silent and not in_pause:
                in_pause = True
                pause_start = t
            elif not silent and in_pause:
                in_pause = False
                pause_dur = t - pause_start
                if pause_dur > 0.1:    # ignore very short gaps
                    pause_durations.append(pause_dur)

        pause_durs = np.array(pause_durations) if pause_durations else np.array([0.3])

        # Syllable durations (inter-peak intervals)
        if len(peaks) > 1:
            syl_durs = np.diff(peaks) * hop / sr
        else:
            syl_durs = np.array([0.2])

        return (
            speaking_rate,
            float(np.mean(pause_durs)),
            float(np.std(pause_durs)),
            syl_durs,
        )

    def _extract_vowel_formants(self, audio: np.ndarray, sr: int) -> dict:
        """
        Extract F1/F2 formant frequencies for vowel sounds.
        These are the acoustic signature of accent — British vs American vs
        Indian English all have characteristically different vowel formants.
        """
        try:
            import parselmouth
            from parselmouth.praat import call

            snd = parselmouth.Sound(audio, sampling_frequency=sr)
            formants = call(snd, "To Formant (burg)", 0, 5, 5500, 0.025, 50)

            f1_values, f2_values = [], []
            duration = snd.duration

            for t in np.arange(0.1, duration - 0.1, 0.05):
                try:
                    f1 = call(formants, "Get value at time", 1, t, "Hertz", "Linear")
                    f2 = call(formants, "Get value at time", 2, t, "Hertz", "Linear")
                    if not (np.isnan(f1) or np.isnan(f2)):
                        f1_values.append(f1)
                        f2_values.append(f2)
                except Exception:
                    pass

            return {
                "F1_mean": float(np.mean(f1_values)) if f1_values else 500.0,
                "F1_std":  float(np.std(f1_values)) if f1_values else 80.0,
                "F2_mean": float(np.mean(f2_values)) if f2_values else 1500.0,
                "F2_std":  float(np.std(f2_values)) if f2_values else 200.0,
            }
        except ImportError:
            # parselmouth not installed — return neutral values
            return {"F1_mean": 500.0, "F1_std": 80.0, "F2_mean": 1500.0, "F2_std": 200.0}

    def _compute_spectral_tilt(self, audio: np.ndarray, sr: int) -> float:
        """Spectral tilt: ratio of low-freq to high-freq energy. Accent indicator."""
        stft = np.abs(librosa.stft(audio))
        freqs = librosa.fft_frequencies(sr=sr)
        mid = len(freqs) // 2
        low_energy = float(np.mean(stft[:mid]))
        high_energy = float(np.mean(stft[mid:]))
        return low_energy / (high_energy + 1e-8)

    def _compute_jitter_shimmer(self, f0, energy, voiced):
        """Jitter (pitch stability) and shimmer (amplitude stability) — voice texture."""
        voiced_f0 = f0[voiced]
        voiced_e = energy[:len(voiced)][voiced] if len(energy) >= len(voiced) else energy[voiced[:len(energy)]]

        if len(voiced_f0) < 2:
            return 0.01, 0.05

        f0_diffs = np.abs(np.diff(voiced_f0))
        jitter = float(np.mean(f0_diffs) / (np.mean(voiced_f0) + 1e-8))

        if len(voiced_e) >= 2:
            e_diffs = np.abs(np.diff(voiced_e))
            shimmer = float(np.mean(e_diffs) / (np.mean(voiced_e) + 1e-8))
        else:
            shimmer = 0.05

        return jitter, shimmer

    def extract_from_multiple(self, audio_files: list[bytes]) -> ProsodyFeatures:
        """Extract prosody from multiple files and average the features."""
        features_list = [self.extract(f) for f in audio_files]

        # Average scalar features across all recordings
        avg = features_list[0]
        for feat in features_list[1:]:
            avg.f0_mean = (avg.f0_mean + feat.f0_mean) / 2
            avg.f0_std = (avg.f0_std + feat.f0_std) / 2
            avg.speaking_rate = (avg.speaking_rate + feat.speaking_rate) / 2
            avg.pause_duration_mean = (avg.pause_duration_mean + feat.pause_duration_mean) / 2
            avg.energy_mean = (avg.energy_mean + feat.energy_mean) / 2
            avg.spectral_tilt = (avg.spectral_tilt + feat.spectral_tilt) / 2
            avg.jitter = (avg.jitter + feat.jitter) / 2
            avg.shimmer = (avg.shimmer + feat.shimmer) / 2

        return avg

prosody_extractor = ProsodyExtractor()