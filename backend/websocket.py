import asyncio
import base64
from fastapi import WebSocket, WebSocketDisconnect
from asr import asr_engine
from llm import llm_engine
from emotion import parse_emotion
from tts import tts_engine
from voice_clone import voice_manager

async def voice_conversation_handler(websocket: WebSocket, user_id: str):
    """
    Hybrid pipeline per turn:
      audio → [LOCAL Whisper] → text + detected language
           → [API Groq/GPT]  → response + emotion tag
           → [LOCAL XTTS-v2] → cloned voice audio in same language (streamed)

    The client can optionally send a JSON message first to pin a language:
      {"set_language": "hi"}   # force Hindi
      {"set_language": null}   # auto-detect (default)
    """
    await websocket.accept()

    ref_wav = voice_manager.get_reference_path(user_id)
    if not ref_wav:
        await websocket.send_json({
            "error": "No voice profile found. Please upload voice samples first."
        })
        await websocket.close()
        return

    print(f"[WS] User {user_id} connected. Voice profile: {ref_wav}")

    # Language pin — None means auto-detect each turn
    pinned_language: str | None = None

    try:
        while True:
            # ── Step 1: Receive message from browser ─────────────
            # Accept either raw audio bytes or a JSON control message
            message = await websocket.receive()

            # Handle JSON control messages (e.g. language selection)
            if "text" in message:
                import json
                try:
                    ctrl = json.loads(message["text"])
                    if "set_language" in ctrl:
                        pinned_language = ctrl["set_language"] or None
                        lang_label = pinned_language or "auto-detect"
                        print(f"[WS] Language pinned to: {lang_label}")
                        await websocket.send_json({"language_set": lang_label})
                except Exception:
                    pass
                continue

            audio_bytes = message.get("bytes", b"")
            await websocket.send_json({"status": "transcribing"})

            # ── Step 2: LOCAL ASR (auto-detect or pinned language) ─
            try:
                asr_result = await asr_engine.transcribe_async(audio_bytes, language=pinned_language)
            except Exception as e:
                print(f"[ASR] Error: {e} — bytes length: {len(audio_bytes)}")
                await websocket.send_json({"status": "ready", "info": "Audio processing failed, please try again"})
                continue

            transcript = asr_result["text"]
            detected_language = asr_result["language"]

            if not transcript:
                await websocket.send_json({"status": "ready", "info": "No speech detected"})
                continue

            await websocket.send_json({
                "transcript": transcript,
                "language": detected_language,
            })

            # ── Step 3: API LLM ──────────────────────────────────
            await websocket.send_json({"status": "thinking"})
            llm_response = await llm_engine.chat_async(transcript)

            # ── Step 4: Emotion parsing ──────────────────────────
            emotion, clean_text, prosody = parse_emotion(llm_response)
            await websocket.send_json({
                "response_text": clean_text,
                "emotion": emotion,
            })

            # ── Step 5: LOCAL TTS (streaming by sentence) ────────
            # Speak the response in the same language the user spoke
            await websocket.send_json({"status": "speaking"})

            loop = asyncio.get_event_loop()

            def generate_and_send():
                for wav_chunk in tts_engine.stream_sentences(
                    clean_text,
                    ref_wav,
                    speed=prosody["speed"],
                    temperature=prosody["temperature"],
                    language=detected_language,
                ):
                    encoded = base64.b64encode(wav_chunk).decode()
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_json({"audio_chunk": encoded, "format": "wav"}),
                        loop,
                    ).result()

            await loop.run_in_executor(None, generate_and_send)
            await websocket.send_json({"status": "ready"})

    except WebSocketDisconnect:
        print(f"[WS] User {user_id} disconnected")
    except Exception as e:
        print(f"[WS] Error: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass