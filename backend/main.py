import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"  # Fix Intel OpenMP duplicate on Windows

from fastapi import FastAPI, UploadFile, File, Depends, WebSocket, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from auth import create_access_token, verify_password, hash_password, get_current_user
from voice_clone import voice_manager
from websocket import voice_conversation_handler
from config import settings
from dialogue_router import router as dialogue_router
import torch

app = FastAPI(title="VoiceAI Hybrid", version="3.0.0")

app.include_router(dialogue_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Simple in-memory user store (swap with PostgreSQL for prod) ──
USERS: dict = {}

@app.on_event("startup")
async def startup():
    print("=" * 50)
    print("VoiceAI Hybrid Pipeline")
    print(f"  ASR  → LOCAL  Whisper {settings.WHISPER_MODEL_SIZE} ({settings.WHISPER_DEVICE})")
    print(f"  LLM  → API    {settings.LLM_PROVIDER}")
    print(f"  TTS  → LOCAL  XTTS-v2 ({settings.TTS_DEVICE})")
    if torch.cuda.is_available():
        try:
            vram = torch.cuda.get_device_properties(0).total_memory // 1024**2
            print(f"  VRAM → {vram}MB available")
        except Exception:
            print("  VRAM → (could not read)")
    else:
        print("  VRAM → CUDA not available, running on CPU")
    print("=" * 50)

# ── Auth ─────────────────────────────────────────────────────────

@app.post("/auth/signup")
async def signup(username: str = Form(...), password: str = Form(...)):
    if username in USERS:
        raise HTTPException(400, "Username already taken")
    USERS[username] = hash_password(password)
    token = create_access_token({"sub": username})
    return {"access_token": token, "token_type": "bearer"}

@app.post("/auth/token")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    hashed = USERS.get(form.username)
    if not hashed or not verify_password(form.password, hashed):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token({"sub": form.username})
    return {"access_token": token, "token_type": "bearer"}

# ── Voice Profile ─────────────────────────────────────────────────

@app.post("/voice/upload")
async def upload_voice(
    files: list[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    """
    Upload 1–5 WAV files (6–30s each, clean speech).
    XTTS-v2 does zero-shot cloning — no training, just reference audio.
    """
    if len(files) > 5:
        raise HTTPException(400, "Maximum 5 files per upload")
    audio_data = [await f.read() for f in files]
    ref_path = voice_manager.create_profile(user["user_id"], audio_data)
    return {"message": "Voice profile created", "ref_path": ref_path}

@app.get("/voice/status")
async def voice_status(user: dict = Depends(get_current_user)):
    return {
        "has_profile": voice_manager.has_profile(user["user_id"]),
        "user_id": user["user_id"],
    }

@app.delete("/voice/profile")
async def delete_voice(user: dict = Depends(get_current_user)):
    voice_manager.delete_profile(user["user_id"])
    return {"message": "Voice profile deleted"}

# ── Real-time Conversation ────────────────────────────────────────

@app.websocket("/ws/conversation/{user_id}")
async def conversation_ws(websocket: WebSocket, user_id: str):
    await voice_conversation_handler(websocket, user_id)

# ── System Status ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    gpu_info = {}
    if torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        allocated = torch.cuda.memory_allocated(0) // 1024**2
        total = props.total_memory // 1024**2
        gpu_info = {
            "gpu": props.name,
            "vram_total_mb": total,
            "vram_used_mb": allocated,
            "vram_free_mb": total - allocated,
        }
    return {
        "status": "ok",
        "pipeline": {
            "asr": f"local:whisper-{settings.WHISPER_MODEL_SIZE}",
            "llm": f"api:{settings.LLM_PROVIDER}",
            "tts": "local:xtts-v2",
        },
        **gpu_info,
    }