#!/bin/bash
# VoiceAI startup script for Vast.ai
# This runs automatically when the container starts

echo "=== VoiceAI Backend Starting ==="

# Set environment
export KMP_DUPLICATE_LIB_OK=TRUE
export PYTHONUNBUFFERED=1

# Navigate to app directory
cd /app

# Check if voice_profiles directory exists
mkdir -p voice_profiles renders temp_voices

echo "=== Starting FastAPI server ==="
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
