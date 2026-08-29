import uuid
import asyncio
import tempfile
import os
import shutil
import io
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, WebSocket
from fastapi.responses import FileResponse
from auth import get_current_user
from dialogue import dialogue_engine, parse_script
from voice_clone import voice_manager

router = APIRouter(prefix="/dialogue", tags=["Dialogue"])

RENDERS_DIR = Path("renders")
RENDERS_DIR.mkdir(exist_ok=True)

TEMP_VOICES_DIR = Path("temp_voices")
TEMP_VOICES_DIR.mkdir(exist_ok=True)


@router.post("/preview-script")
async def preview_script(script: str = Form(...)):
    """Parse and preview a script before rendering."""
    try:
        lines = parse_script(script)
        return {
            "total_lines": len(lines),
            "speakers": list({l.speaker for l in lines}),
            "preview": [
                {
                    "line": i + 1,
                    "speaker": l.speaker,
                    "emotion": l.emotion,
                    "language": l.language,
                    "text": l.text,
                }
                for i, l in enumerate(lines)
            ],
        }
    except ValueError as e:
        raise HTTPException(400, str(e))


async def _save_voice_to_temp(upload: UploadFile, out_path: Path):
    """Load any audio/video format, extract audio, normalise, trim to 30s, save as WAV."""
    import numpy as np
    import soundfile as sf
    import librosa

    raw = await upload.read()
    filename = (upload.filename or "").lower()
    ext = os.path.splitext(filename)[1]

    audio = None
    sr = 22050

    # 1. Try librosa first — handles WAV, MP3, M4A, OGG, FLAC, and many video containers
    try:
        audio, sr = librosa.load(io.BytesIO(raw), sr=22050, mono=True)
    except Exception:
        pass

    # 2. Try soundfile (handles WAV/FLAC/AIFF cleanly)
    if audio is None:
        try:
            audio, sr = sf.read(io.BytesIO(raw), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            import resampy
            audio = resampy.resample(audio, sr, 22050)
            sr = 22050
        except Exception:
            pass

    # 3. Try moviepy (video files — MP4, MPEG, MOV, etc.)
    if audio is None:
        try:
            import moviepy.editor as mp
            tmp_in = tempfile.mktemp(suffix=ext or ".mp4")
            tmp_wav = tempfile.mktemp(suffix=".wav")
            with open(tmp_in, "wb") as f:
                f.write(raw)
            clip = mp.VideoFileClip(tmp_in)
            clip.audio.write_audiofile(tmp_wav, fps=22050, nbytes=2, verbose=False, logger=None)
            clip.close()
            audio, sr = sf.read(tmp_wav, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            os.unlink(tmp_in)
            os.unlink(tmp_wav)
        except Exception:
            pass

    # 4. Try ffmpeg CLI as last resort
    if audio is None:
        try:
            import subprocess
            tmp_in = tempfile.mktemp(suffix=ext or ".bin")
            tmp_wav = tempfile.mktemp(suffix=".wav")
            with open(tmp_in, "wb") as f:
                f.write(raw)
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_in, "-vn", "-ar", "22050", "-ac", "1", tmp_wav],
                check=True, capture_output=True
            )
            audio, sr = sf.read(tmp_wav, dtype="float32")
            os.unlink(tmp_in)
            os.unlink(tmp_wav)
        except Exception:
            pass

    if audio is None:
        raise HTTPException(
            400,
            f"Could not read audio from '{filename}'. "
            "Please upload a WAV, MP3, M4A, or OGG file."
        )

    max_samples = int(30 * sr)
    audio = audio[:max_samples]
    if abs(audio).max() > 0:
        audio = audio / abs(audio).max() * 0.9
    sf.write(str(out_path), audio, sr, subtype="PCM_16")


def _register_temp_profile(session_id: str, label: str, ref_path: Path) -> str:
    """Copy a temp WAV into voice_profiles so voice_manager can find it."""
    from voice_clone import PROFILES_DIR
    temp_user = f"__temp_{label}_{session_id}"
    user_dir = PROFILES_DIR / temp_user
    user_dir.mkdir(exist_ok=True)
    shutil.copy(str(ref_path), str(user_dir / "reference.wav"))
    return temp_user


@router.post("/upload-voices")
async def upload_voices_only(
    voice_a: UploadFile = File(...),
    voice_b: UploadFile = File(...),
    voice_c: UploadFile | None = File(None),
    speaker_a_name: str = Form("A"),
    speaker_b_name: str = Form("B"),
    speaker_c_name: str = Form("C"),
    language_a: str = Form("en"),
    language_b: str = Form("en"),
    language_c: str = Form("ko"),
    gap_seconds: float = Form(0.4),
    script: str = Form(""),
):
    """
    Upload voice files and register them as temp profiles.
    Returns temp user IDs to be used with /render-live WebSocket.
    This is a fast call — the actual render happens over WebSocket.
    """
    total_mb = (voice_a.size + voice_b.size + (voice_c.size if voice_c else 0)) / (1024 * 1024)
    if total_mb > 45:
        raise HTTPException(400, f"Total file size {total_mb:.1f}MB exceeds 45MB limit.")

    session_id = str(uuid.uuid4())[:8]

    ref_a_path = TEMP_VOICES_DIR / f"voice_a_{session_id}.wav"
    ref_b_path = TEMP_VOICES_DIR / f"voice_b_{session_id}.wav"
    ref_c_path = TEMP_VOICES_DIR / f"voice_c_{session_id}.wav" if voice_c else None

    await _save_voice_to_temp(voice_a, ref_a_path)
    await _save_voice_to_temp(voice_b, ref_b_path)
    if voice_c and ref_c_path:
        await _save_voice_to_temp(voice_c, ref_c_path)

    user_a = _register_temp_profile(session_id, "a", ref_a_path)
    user_b = _register_temp_profile(session_id, "b", ref_b_path)
    user_c = _register_temp_profile(session_id, "c", ref_c_path) if ref_c_path else None

    # Clean up temp wav files (profiles are now in voice_profiles dir)
    for p in [ref_a_path, ref_b_path, ref_c_path]:
        if p and p.exists():
            p.unlink(missing_ok=True)

    return {
        "userA": user_a,
        "userB": user_b,
        "userC": user_c,
        "session_id": session_id,
    }


@router.post("/render-with-voices")
async def render_with_voices(
    script: str = Form(...),
    voice_a: UploadFile = File(...),
    voice_b: UploadFile = File(...),
    voice_c: UploadFile | None = File(None),   # optional third speaker
    speaker_a_name: str = Form("A"),
    speaker_b_name: str = Form("B"),
    speaker_c_name: str = Form("C"),
    language_a: str = Form("en"),              # language for speaker A
    language_b: str = Form("en"),              # language for speaker B
    language_c: str = Form("ko"),              # language for speaker C (default Korean)
    gap_seconds: float = Form(0.4),
):
    """
    Render a dialogue using 2 or 3 uploaded voice files.
    Each speaker can have a different language — e.g. A=en, B=en, C=ko.
    No user account needed.
    """
    total_mb = (voice_a.size + voice_b.size + (voice_c.size if voice_c else 0)) / (1024 * 1024)
    if total_mb > 45:
        raise HTTPException(400, f"Total file size {total_mb:.1f}MB exceeds 45MB limit. Compress audio first.")

    session_id = str(uuid.uuid4())[:8]

    ref_a_path = TEMP_VOICES_DIR / f"voice_a_{session_id}.wav"
    ref_b_path = TEMP_VOICES_DIR / f"voice_b_{session_id}.wav"
    ref_c_path = TEMP_VOICES_DIR / f"voice_c_{session_id}.wav" if voice_c else None

    await _save_voice_to_temp(voice_a, ref_a_path)
    await _save_voice_to_temp(voice_b, ref_b_path)
    if voice_c and ref_c_path:
        await _save_voice_to_temp(voice_c, ref_c_path)

    temp_user_a = _register_temp_profile(session_id, "a", ref_a_path)
    temp_user_b = _register_temp_profile(session_id, "b", ref_b_path)
    temp_user_c = _register_temp_profile(session_id, "c", ref_c_path) if ref_c_path else None

    from voice_clone import PROFILES_DIR

    try:
        result = await dialogue_engine.render(
            script=script,
            user_id_a=temp_user_a,
            user_id_b=temp_user_b,
            user_id_c=temp_user_c,
            speaker_a_name=speaker_a_name,
            speaker_b_name=speaker_b_name,
            speaker_c_name=speaker_c_name,
            language_a=language_a or None,
            language_b=language_b or None,
            language_c=language_c or None,
            gap_between_lines=gap_seconds,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        # Cleanup temp profiles and files
        for uid in [temp_user_a, temp_user_b, temp_user_c]:
            if uid:
                shutil.rmtree(str(PROFILES_DIR / uid), ignore_errors=True)
        for p in [ref_a_path, ref_b_path, ref_c_path]:
            if p and p.exists():
                p.unlink(missing_ok=True)

    render_id = str(uuid.uuid4())[:8]
    out_path = RENDERS_DIR / f"dialogue_{render_id}.wav"
    out_path.write_bytes(result.audio_bytes)

    return {
        "render_id": render_id,
        "duration_seconds": round(result.duration_seconds, 2),
        "lines_rendered": result.lines_rendered,
        "file_size_kb": len(result.audio_bytes) // 1024,
        "download_url": f"/dialogue/download/{render_id}",
    }


@router.post("/render")
async def render_dialogue(
    script: str = Form(...),
    user_id_a: str = Form(...),
    user_id_b: str = Form(...),
    user_id_c: str = Form(""),              # optional — empty string = no third speaker
    speaker_a_name: str = Form("A"),
    speaker_b_name: str = Form("B"),
    speaker_c_name: str = Form("C"),
    language_a: str = Form("en"),
    language_b: str = Form("en"),
    language_c: str = Form("ko"),
    gap_seconds: float = Form(0.4),
    user: dict = Depends(get_current_user),
):
    """Render a full dialogue script to a WAV file using saved voice profiles."""
    try:
        result = await dialogue_engine.render(
            script=script,
            user_id_a=user_id_a,
            user_id_b=user_id_b,
            user_id_c=user_id_c or None,
            speaker_a_name=speaker_a_name,
            speaker_b_name=speaker_b_name,
            speaker_c_name=speaker_c_name,
            language_a=language_a or None,
            language_b=language_b or None,
            language_c=language_c or None,
            gap_between_lines=gap_seconds,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    render_id = str(uuid.uuid4())[:8]
    out_path = RENDERS_DIR / f"dialogue_{render_id}.wav"
    out_path.write_bytes(result.audio_bytes)

    return {
        "render_id": render_id,
        "duration_seconds": round(result.duration_seconds, 2),
        "lines_rendered": result.lines_rendered,
        "file_size_kb": len(result.audio_bytes) // 1024,
        "download_url": f"/dialogue/download/{render_id}",
    }


@router.get("/download/{render_id}")
async def download_render(render_id: str):
    """Download a previously rendered dialogue WAV."""
    path = RENDERS_DIR / f"dialogue_{render_id}.wav"
    if not path.exists():
        raise HTTPException(404, "Render not found or expired")
    return FileResponse(
        str(path),
        media_type="audio/wav",
        filename=f"dialogue_{render_id}.wav",
    )


@router.websocket("/render-live/{session_id}")
async def render_live(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for live progress updates during rendering.
    Client sends script + config as JSON, receives line-by-line progress.

    Config JSON fields:
      script, user_id_a, user_id_b, user_id_c (optional),
      speaker_a_name, speaker_b_name, speaker_c_name,
      language_a, language_b, language_c,
      gap_seconds
    """
    await websocket.accept()

    user_id_a = user_id_b = user_id_c = None  # ensure in scope for finally cleanup

    try:
        config = await websocket.receive_json()
        script      = config["script"]
        user_id_a   = config["user_id_a"]
        user_id_b   = config["user_id_b"]
        user_id_c   = config.get("user_id_c") or None
        speaker_a   = config.get("speaker_a_name", "A")
        speaker_b   = config.get("speaker_b_name", "B")
        speaker_c   = config.get("speaker_c_name", "C")
        language_a  = config.get("language_a") or None
        language_b  = config.get("language_b") or None
        language_c  = config.get("language_c") or None
        gap         = float(config.get("gap_seconds", 0.4))

        if not voice_manager.has_profile(user_id_a):
            await websocket.send_json({"error": f"No voice profile for {user_id_a}"})
            return
        if not voice_manager.has_profile(user_id_b):
            await websocket.send_json({"error": f"No voice profile for {user_id_b}"})
            return
        if user_id_c and not voice_manager.has_profile(user_id_c):
            await websocket.send_json({"error": f"No voice profile for {user_id_c}"})
            return

        await websocket.send_json({"status": "parsing", "message": "Parsing script..."})

        async def on_progress(line_idx, total, speaker, text, emotion):
            await websocket.send_json({
                "status": "rendering",
                "line": line_idx + 1,
                "total": total,
                "speaker": speaker,
                "text": text,
                "emotion": emotion,
                "percent": round((line_idx / total) * 100),
            })

        # Keepalive: send a ping every 30s to prevent tunnel/proxy timeouts on long renders
        import asyncio as _asyncio
        keepalive_running = True
        async def _keepalive():
            while keepalive_running:
                await _asyncio.sleep(25)
                if keepalive_running:
                    try:
                        await websocket.send_json({"status": "ping"})
                    except Exception:
                        break
        keepalive_task = _asyncio.create_task(_keepalive())

        result = await dialogue_engine.render(
            script=script,
            user_id_a=user_id_a,
            user_id_b=user_id_b,
            user_id_c=user_id_c,
            speaker_a_name=speaker_a,
            speaker_b_name=speaker_b,
            speaker_c_name=speaker_c,
            language_a=language_a,
            language_b=language_b,
            language_c=language_c,
            gap_between_lines=gap,
            on_progress=on_progress,
        )

        keepalive_running = False
        keepalive_task.cancel()

        render_id = str(uuid.uuid4())[:8]
        out_path = RENDERS_DIR / f"dialogue_{render_id}.wav"
        out_path.write_bytes(result.audio_bytes)

        await websocket.send_json({
            "status": "done",
            "render_id": render_id,
            "duration_seconds": round(result.duration_seconds, 2),
            "lines_rendered": result.lines_rendered,
            "file_size_kb": len(result.audio_bytes) // 1024,
            "download_url": f"/dialogue/download/{render_id}",
        })

    except Exception as e:
        await websocket.send_json({"status": "error", "error": str(e)})
    finally:
        # Clean up any temp profiles that were created by /upload-voices
        from voice_clone import PROFILES_DIR
        for uid in [user_id_a, user_id_b, user_id_c]:
            if uid and uid.startswith("__temp_"):
                shutil.rmtree(str(PROFILES_DIR / uid), ignore_errors=True)
        await websocket.close()
