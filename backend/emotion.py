import re

# Maps emotion → XTTS-v2 compatible prosody params
EMOTION_PROSODY = {
    "happy":   {"speed": 1.10, "temperature": 0.85},
    "excited": {"speed": 1.20, "temperature": 0.95},
    "sad":     {"speed": 0.82, "temperature": 0.60},
    "calm":    {"speed": 0.92, "temperature": 0.50},
    "angry":   {"speed": 1.15, "temperature": 0.90},
    "fearful": {"speed": 1.05, "temperature": 0.80},
    "neutral": {"speed": 1.00, "temperature": 0.70},
}

def parse_emotion(llm_response: str) -> tuple[str, str, dict]:
    """
    Extract [emotion] tag from LLM output.
    Returns: (emotion, clean_text, prosody_params)
    """
    match = re.match(r"^\[(\w+)\]\s*", llm_response.strip())
    if match:
        emotion = match.group(1).lower()
        clean_text = llm_response[match.end():].strip()
    else:
        emotion = "neutral"
        clean_text = llm_response.strip()

    prosody = EMOTION_PROSODY.get(emotion, EMOTION_PROSODY["neutral"])
    return emotion, clean_text, prosody