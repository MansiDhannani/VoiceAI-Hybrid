# VoiceAI Hybrid 🎙

VoiceAI Hybrid is a high-performance, hybrid conversational AI and voice-cloning platform. It features local speech-to-text (ASR) and text-to-speech (TTS) combined with an API-based LLM brain, allowing you to clone voices in real-time, engage in voice chats, and render complex scripts with multiple speakers and emotions.

---

## 🚀 Key Features

* **Zero-Shot Voice Cloning**: Clone any voice using just 6 to 30 seconds of audio samples. Uses a combination of **XTTS-v2** and **OpenVoice V2** for highly accurate vocal characteristics and natural accents.
* **Real-time Spoken Conversation**: Low-latency voice chat over WebSockets. Speaks back to you in your own cloned voice!
  * **ASR**: Local **Faster-Whisper** for instant transcribing and language detection.
  * **LLM**: Cloud-based API LLM (Groq / OpenAI) for generating responses dynamically tagged with emotions.
  * **TTS**: Local **XTTS-v2** streaming emotional speech sentence-by-sentence.
* **Dialogue Studio (Script Renderer)**: 
  * Parse written screenplay scripts (e.g., `A: [happy] Hello!`, `B: [neutral|ko] 안녕하세요`).
  * Assign up to 3 speakers with individual cloned voices and native languages.
  * Preview, render, and download the conversation as a high-quality consolidated WAV file.

---

## 📁 Project Structure

```
├── backend/            # FastAPI web server, Whisper ASR, XTTS-v2 TTS, dialogue engine
├── frontend/           # Next.js (React + TypeScript) client app
├── checkpoints_v2/     # OpenVoice V2 speaker embedding models (locally cached)
├── openvoice_src/      # Sub-module source code for OpenVoice integration
├── TTS-0.22.0/         # Local patched Coqui TTS library source code
├── start.bat           # Easy-start script for Windows
├── requirements.txt    # Python requirements
└── .gitignore          # Configured to ignore models, nodes, envs, and caches
```

---

## 🛠 Prerequisites

* **OS**: Windows (with CUDA-capable Nvidia GPU recommended for fast inference).
* **Python**: `3.10` or `3.12` installed.
* **Node.js**: `v18+` and `npm`.
* **API Key**: A [Groq API Key](https://console.groq.com/) (recommended for speed) or OpenAI API Key.

---

## ⚙ Setup & Installation

### 1. Configure Environment Variables
Create a `.env` file in the root directory (or copy `vastai.env` to `.env`):
```ini
KMP_DUPLICATE_LIB_OK=TRUE

# LLM API Configuration
GROQ_API_KEY=your_groq_api_key_here
LLM_PROVIDER=groq

# Local Model Configurations
WHISPER_MODEL_SIZE=small
WHISPER_COMPUTE_TYPE=int8
WHISPER_DEVICE=cuda
TTS_DEVICE=cuda

# Security & DB (optional defaults)
SECRET_KEY=generate-a-secure-random-key
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/voiceai
```

### 2. Install Backend Dependencies
Create a virtual environment and install the requirements:
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Install Frontend Dependencies
```bash
cd frontend
npm install
```

---

## 🏃 Running the Project

### On Windows (Fast Start)
Double-click the **`start.bat`** file in the root folder. This script will automatically:
1. Stop any dangling backend/frontend tasks.
2. Start the FastAPI backend on port `8080`.
3. Start the Next.js frontend on port `3000`.
4. Launch the application in your default web browser at `http://localhost:3000`.

### Running Manually

**Start the Backend:**
```bash
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8080
```

**Start the Frontend:**
```bash
cd frontend
npm run dev
```

---

## 🔒 Security Notice
The `.gitignore` has been configured to block `.env`, `vastai.env`, and large checkpoint binary weights (`.pth`, `.bin`) from being committed to public repositories. Ensure you keep your API keys private!
