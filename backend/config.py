from pydantic_settings import BaseSettings
import os

class Settings(BaseSettings):
    # Auth
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # ── API Keys (LLM only) ──────────────────────────────
    GROQ_API_KEY: str = ""           # free, ~500 tok/s
    OPENAI_API_KEY: str = ""         # fallback
    LLM_PROVIDER: str = "groq"       # "groq" | "openai"

    # ── LOCAL ASR ────────────────────────────────────────
    WHISPER_MODEL_SIZE: str = "small"
    WHISPER_COMPUTE_TYPE: str = "int8"
    WHISPER_DEVICE: str = "cuda"

    # ── LOCAL TTS (XTTS-v2) ──────────────────────────────
    XTTS_MODEL: str = "tts_models/multilingual/multi-dataset/xtts_v2"
    TTS_DEVICE: str = "cuda"
    SAMPLE_RATE: int = 24000

    # ── Voice Profiles ───────────────────────────────────
    VOICE_PROFILES_DIR: str = "voice_profiles"

    # ── DB / Cache ───────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://user:pass@localhost/voiceai"
    REDIS_URL: str = "redis://localhost:6379"

    class Config:
        # Look for .env in backend/ first, then parent directory
        env_file = (
            os.path.join(os.path.dirname(__file__), ".env"),          # backend/.env
            os.path.join(os.path.dirname(__file__), "..", ".env"),     # root .env
        )
        extra = "ignore"  # ignore unknown env vars like KMP_DUPLICATE_LIB_OK

settings = Settings()