import asyncio
import base64
import time
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from asr import asr_engine
from llm import llm_engine
from emotion import parse_emotion
from tts import tts_engine
from voice_clone import voice_manager
import metrics


def _is_open(ws: WebSocket) -> bool:
    """Safe check — avoid sending on a closed/closing socket."""
    return ws.client_state == WebSocketState.CONNECTED


async def _send(ws: WebSocket, data: dict):
    """Send JSON only if socket is still open."""
    if _is_open(ws):
        try:
            await ws.send_json(data)
        except Exception:
            pass


async def voice_conversation_handler(websocket: WebSocket, user_id: str):
    """
    Hybrid pipeline per turn:
      audio → [LOCAL Whisper] → text + detected language
           → [API Groq/GPT]  → response + emotion tag
           → [LOCAL XTTS-v2] → cloned voice audio streamed sentence-by-sentence

    Control messages (JSON text frames):
      {"set_language": "hi"}   # pin to Hindi
      {"set_language": null}   # back to auto-detect
    """
    await websocket.accept()

    ref_wav = voice_manager.get_reference_path(user_id)
    if not ref_wav:
        await _send(websocket, {"error": "No voice profile found. Please upload voice samples first."})
        await websocket.close()
        return

    print(f"[WS] User {user_id} connected. ref={ref_wav}")
    pinned_language: str | None = None

    try:
        while True:
            if not _is_open(websocket):
                break

            message = await websocket.receive()

            # ── JSON control message ──────────────────────────────
            if "text" in message:
                import json
                try:
                    ctrl = json.loads(message["text"])
                    if "set_language" in ctrl:
                        pinned_language = ctrl["set_language"] or None
                        label = pinned_language or "auto-detect"
                        print(f"[WS] Language pinned to: {label}")
                        await _send(websocket, {"language_set": label})
                except Exception:
                    pass
                continue

            # ── Audio bytes ───────────────────────────────────────
            audio_bytes = message.get("bytes", b"")
            if len(audio_bytes) < 200:
                await _send(websocket, {"status": "ready", "info": "Audio too short"})
                continue

            await _send(websocket, {"status": "transcribing"})

            # ── ASR ───────────────────────────────────────────────
            t_asr = time.perf_counter()
            try:
                asr_result = await asr_engine.transcribe_async(audio_bytes, language=pinned_language)
            except Exception as e:
                print(f"[ASR] Error: {e}")
                await _send(websocket, {"status": "ready", "info": "Audio processing failed — try again"})
                continue
            asr_ms = (time.perf_counter() - t_asr) * 1000

            transcript = asr_result["text"]
            detected_language = asr_result["language"]

            metrics.record_latency("asr", asr_ms, language=detected_language,
                                   text_length=len(transcript))
            if pinned_language:
                metrics.record_lang_detection(pinned_language, detected_language)

            if not transcript.strip():
                await _send(websocket, {"status": "ready", "info": "No speech detected — try again"})
                continue

            await _send(websocket, {"transcript": transcript, "language": detected_language})

            # ── LLM ───────────────────────────────────────────────
            await _send(websocket, {"status": "thinking"})
            t_llm = time.perf_counter()
            try:
                llm_response = await llm_engine.chat_async(transcript)
            except Exception as e:
                print(f"[LLM] Error: {e}")
                await _send(websocket, {"status": "ready", "info": "LLM error — try again"})
                continue
            llm_ms = (time.perf_counter() - t_llm) * 1000
            metrics.record_latency("llm", llm_ms, language=detected_language,
                                   text_length=len(llm_response))

            # ── Emotion ───────────────────────────────────────────
            emotion, clean_text, prosody = parse_emotion(llm_response)
            await _send(websocket, {"response_text": clean_text, "emotion": emotion})

            # ── TTS (stream sentence-by-sentence) ─────────────────
            await _send(websocket, {"status": "speaking"})
            loop = asyncio.get_event_loop()
            t_tts = time.perf_counter()
            tts_first_chunk = True

            def generate_and_send():
                nonlocal tts_first_chunk
                if not _is_open(websocket):
                    return
                for wav_chunk in tts_engine.stream_sentences(
                    clean_text, ref_wav,
                    speed=prosody["speed"],
                    temperature=prosody["temperature"],
                    language=detected_language,
                ):
                    if not _is_open(websocket):
                        break
                    encoded = base64.b64encode(wav_chunk).decode()
                    fut = asyncio.run_coroutine_threadsafe(
                        _send(websocket, {"audio_chunk": encoded, "format": "wav"}),
                        loop,
                    )
                    try:
                        fut.result(timeout=10)
                    except Exception:
                        break
                    if tts_first_chunk:
                        tts_first_chunk = False
                        try:
                            metrics.record_voice_similarity(user_id, ref_wav, wav_chunk)
                        except Exception:
                            pass

            await loop.run_in_executor(None, generate_and_send)
            tts_ms = (time.perf_counter() - t_tts) * 1000
            metrics.record_latency("tts", tts_ms, language=detected_language,
                                   text_length=len(clean_text))

            total_ms = asr_ms + llm_ms + tts_ms
            metrics.record_latency("total", total_ms, language=detected_language,
                                   text_length=len(transcript))

            await _send(websocket, {
                "status": "ready",
                "latency": {
                    "asr_ms": round(asr_ms, 1),
                    "llm_ms": round(llm_ms, 1),
                    "tts_ms": round(tts_ms, 1),
                    "total_ms": round(total_ms, 1),
                }
            })

    except WebSocketDisconnect:
        print(f"[WS] User {user_id} disconnected")
    except Exception as e:
        print(f"[WS] Unhandled error: {e}")
        try:
            await _send(websocket, {"error": str(e)})
        except Exception:
            pass
