import io
import re
import numpy as np
import soundfile as sf
import torch
from pathlib import Path
from .prosody_extractor import ProsodyFeatures

class ProsodyTransferTTS:
    """
    Uses StyleTTS2 to synthesize speech conditioned on extracted
    prosody features from the real speaker — preserving accent,
    rhythm, and intonation patterns.
    """

    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._models = {}   # cache loaded models per speaker
        print("[ProsodyTTS] Initialized")

    def _load_styletts2(self):
        """Load base StyleTTS2 model."""
        if "base" in self._models:
            return self._models["base"]

        # StyleTTS2 setup
        # git clone https://github.com/yl4579/StyleTTS2
        import sys
        sys.path.insert(0, "StyleTTS2")
        from models import build_model
        from utils import recursive_munch
        import yaml

        config_path = "StyleTTS2/Models/LibriTTS/config.yml"
        model_path = "StyleTTS2/Models/LibriTTS/epochs_2nd_00020.pth"

        with open(config_path) as f:
            config = yaml.safe_load(f)

        model_params = recursive_munch(config["model_params"])
        model = build_model(model_params, text_aligner=None, pitch_extractor=None)

        checkpoint = torch.load(model_path, map_location="cpu")
        for key in model:
            if key in checkpoint["net"]:
                model[key].load_state_dict(checkpoint["net"][key])
            model[key].eval()
            model[key].to(self.device)

        self._models["base"] = model
        print("[ProsodyTTS] StyleTTS2 loaded")
        return model

    def _build_prosody_style_vector(
        self,
        prosody: ProsodyFeatures,
        ref_wav_path: str,
    ) -> torch.Tensor:
        """
        Build a style vector that encodes the speaker's prosody.
        StyleTTS2 uses this to condition ALL aspects of synthesis.
        """
        import sys
        sys.path.insert(0, "StyleTTS2")
        from inference import compute_style

        # Start with reference-based style (captures timbre)
        style = compute_style(ref_wav_path)   # shape: [1, style_dim]

        # The style vector encodes everything — we inject prosody
        # by scaling dimensions that correspond to pitch/rhythm
        # (StyleTTS2 style space: first ~64 dims = prosody, last = timbre)
        style = style.clone()

        # Normalize speaker's F0 to a scale factor
        # Average English F0: ~120Hz male, ~210Hz female
        # This shift moves the prosody towards the speaker's actual pitch range
        f0_scale = prosody.f0_mean / 165.0      # 165 = average across genders
        style[0, :32] *= torch.tensor(f0_scale, dtype=style.dtype)

        # Encode speaking rate into style
        rate_scale = prosody.speaking_rate / 4.5  # 4.5 syl/s = average
        style[0, 32:48] *= torch.tensor(rate_scale, dtype=style.dtype)

        # Encode energy variation (expressiveness)
        energy_scale = min(prosody.energy_std / 0.05, 2.0)
        style[0, 48:64] *= torch.tensor(energy_scale, dtype=style.dtype)

        return style

    def synthesize(
        self,
        text: str,
        prosody: ProsodyFeatures,
        ref_wav_path: str,
        speed_scale: float = 1.0,
    ) -> bytes:
        """
        Synthesize text with prosody transferred from speaker.
        Returns WAV bytes.
        """
        import sys
        sys.path.insert(0, "StyleTTS2")
        from inference import inference

        model = self._load_styletts2()

        # Build prosody-conditioned style vector
        style = self._build_prosody_style_vector(prosody, ref_wav_path)

        # Adjust speed to match speaker's natural rate
        # (StyleTTS2 alpha param controls speaking rate)
        alpha = 1.0 / (prosody.speaking_rate / 4.5)  # slower speakers → higher alpha
        alpha = max(0.5, min(alpha * speed_scale, 1.8))

        # Synthesize with full prosody conditioning
        wav = inference(
            model,
            text,
            ref_s=style,
            alpha=alpha,
            beta=0.9,         # diffusion steps (higher = more stable)
            diffusion_steps=5,
            embedding_scale=1.0,
        )

        # Resample to 24kHz if needed
        if model.get("sr", 24000) != 24000:
            import torchaudio
            wav_t = torch.from_numpy(wav).unsqueeze(0)
            wav = torchaudio.transforms.Resample(model["sr"], 24000)(wav_t).squeeze().numpy()

        buf = io.BytesIO()
        sf.write(buf, wav, 24000, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    def synthesize_stream(
        self,
        text: str,
        prosody: ProsodyFeatures,
        ref_wav_path: str,
        speed_scale: float = 1.0,
    ):
        """Yield WAV bytes sentence by sentence for streaming."""
        sentences = re.split(r'(?<=[.!?,;])\s+', text.strip())
        for sentence in sentences:
            if sentence.strip():
                yield self.synthesize(sentence, prosody, ref_wav_path, speed_scale)

prosody_tts = ProsodyTransferTTS()