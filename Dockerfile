FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV KMP_DUPLICATE_LIB_OK=TRUE
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    libsndfile1 \
    libsndfile1-dev \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend code
COPY backend/ ./

# Install Python dependencies
RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    "uvicorn[standard]==0.30.0" \
    python-multipart==0.0.9 \
    websockets==12.0 \
    httpx==0.27.0 \
    "python-jose[cryptography]==3.3.0" \
    bcrypt==4.0.1 \
    pydantic-settings==2.2.1 \
    sqlalchemy==2.0.30 \
    asyncpg==0.29.0 \
    soundfile==0.12.1 \
    "numpy==1.26.4" \
    librosa==0.11.0 \
    av \
    pydub \
    "faster-whisper>=1.1.0" \
    coqui-tts \
    f5-tts \
    eng_to_ipa inflect unidecode pypinyin cn2an jieba langid

# Install OpenVoice
RUN git clone https://github.com/myshell-ai/OpenVoice.git /tmp/openvoice && \
    pip install --no-deps -e /tmp/openvoice

# Download OpenVoice V2 checkpoints
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download(repo_id='myshell-ai/OpenVoice-v2', local_dir='/app/checkpoints_v2')"

# Pre-download F5-TTS model (so first request isn't slow)
RUN python -c "\
from f5_tts.api import F5TTS; \
print('F5-TTS model downloaded')" || echo "F5-TTS will download on first run"

# Pre-download Whisper small model
RUN python -c "\
from faster_whisper import WhisperModel; \
WhisperModel('small', device='cpu', compute_type='int8'); \
print('Whisper downloaded')"

# Create necessary directories
RUN mkdir -p voice_profiles renders temp_voices

# Expose port
EXPOSE 8000

# Start the backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
