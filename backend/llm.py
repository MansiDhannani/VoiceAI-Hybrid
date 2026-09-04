import re
import httpx
from config import settings

SYSTEM_PROMPT = """You are a helpful, expressive, conversational AI assistant.
This is a VOICE conversation — keep every reply to 1–2 short sentences.
Always start your reply with one emotion tag: [neutral] [happy] [sad] [excited] [calm] [angry] [fearful]
Example: [happy] That's a great question! Let me explain."""

class LLMEngine:
    def __init__(self):
        if settings.LLM_PROVIDER == "groq":
            self.url = "https://api.groq.com/openai/v1/chat/completions"
            self.key = settings.GROQ_API_KEY
            self.model = "qwen/qwen3.8-27b"   # active on Groq as of 2026
        else:
            self.url = "https://api.openai.com/v1/chat/completions"
            self.key = settings.OPENAI_API_KEY
            self.model = "gpt-4o-mini"

        self.history: list[dict] = []
        print(f"[LLM] Using {settings.LLM_PROVIDER} → {self.model} ✓")

    async def chat_async(self, user_text: str) -> str:
        self.history.append({"role": "user", "content": user_text})
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + self.history[-10:]

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                self.url,
                headers={
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": 150,
                    "temperature": 0.75,
                },
            )
            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"].strip()

        # Strip <think>...</think> blocks that some Qwen models produce
        reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL).strip()

        self.history.append({"role": "assistant", "content": reply})
        print(f"[LLM] → {reply[:80]}")
        return reply

    def reset(self):
        self.history = []

llm_engine = LLMEngine()