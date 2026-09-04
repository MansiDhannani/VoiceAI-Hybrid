# 🏆 VoiceAI Hybrid - AI Revenue Recovery Agent

**Razorpay Track 3 Submission** | AI-powered payment recovery system with advanced voice cloning technology

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-Latest-green.svg)
![Next.js](https://img.shields.io/badge/Next.js-16.x-black.svg)
![CUDA](https://img.shields.io/badge/CUDA-Enabled-brightgreen.svg)

## 🚀 Overview

VoiceAI Hybrid transforms failed payment transactions into successful recoveries using cutting-edge AI voice cloning technology. The system intelligently analyzes transaction patterns, customer profiles, and generates personalized voice messages in multiple languages (English, Hindi, Hinglish) to maximize recovery rates while maintaining customer experience.

### 🎯 Core Features

- **🤖 AI Decision Engine**: 8-rule intelligent system with stopping conditions
- **🎙️ Advanced Voice Cloning**: XTTS-v2 + OpenVoice V2 hybrid architecture  
- **📊 Real-time Analytics**: Dynamic revenue tracking and recovery metrics
- **🌐 Multi-language Support**: English, Hindi, Hinglish with smart TTS routing
- **📋 Complete Audit Trail**: Full explainability for every AI decision
- **🔒 Compliance Ready**: Bounded contact rules (max 2 attempts, opt-out respect)

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │     Backend      │    │   Voice AI      │
│   (Next.js)     │◄──►│   (FastAPI)      │◄──►│   (XTTS-v2)     │
│                 │    │                  │    │                 │
│ • Recovery UI   │    │ • AI Decisions   │    │ • Voice Cloning │
│ • Data Mgmt     │    │ • Audit Trail    │    │ • Multi-lang    │
│ • Analytics     │    │ • Synthetic Data │    │ • 24kHz Output  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🛠️ Tech Stack

### Backend
- **FastAPI**: High-performance API with async support
- **XTTS-v2**: Zero-shot voice cloning with GPU acceleration
- **OpenVoice V2**: Enhanced accent preservation
- **PyTorch**: CUDA-optimized for 4GB+ VRAM
- **Pydantic**: Data validation and serialization

### Frontend  
- **Next.js 16**: React with Turbopack bundling
- **TypeScript**: Type-safe development
- **CSS-in-JS**: Interactive animations and responsive design

### AI/ML Components
- **Whisper**: Automatic speech recognition
- **XTTS-v2**: Multi-language voice synthesis  
- **Custom Decision Engine**: Rule-based AI with ML scoring
- **Synthetic Data Generator**: Realistic transaction simulation

## 🚦 Quick Start

### Prerequisites
- **Python 3.10+** with CUDA support
- **Node.js 16+** and npm
- **4GB+ VRAM** (NVIDIA GPU recommended)
- **Git** for version control

### Installation

1. **Clone Repository**
   ```bash
   git clone https://github.com/MansiDhannani/VoiceAI-Hybrid.git
   cd VoiceAI-Hybrid
   ```

2. **Backend Setup**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   ```

4. **Environment Configuration**
   ```bash
   # Copy and configure environment files
   cp .env.example .env
   # Edit .env with your API keys (Groq LLM, etc.)
   ```

5. **Start Application**
   ```bash
   # Option 1: Use provided batch file (Windows)
   start.bat
   
   # Option 2: Manual start
   # Terminal 1: Backend
   cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload
   
   # Terminal 2: Frontend  
   cd frontend && npm run dev
   ```

6. **Access Application**
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:8080`
   - API Docs: `http://localhost:8080/docs`

## 💡 Usage Guide

### 1. Initial Setup
- **Upload Voice Profile**: Go to Dashboard → Upload 1-5 WAV files for voice cloning
- **View System Status**: Check GPU availability and model loading

### 2. Revenue Recovery Workflow
- **Access Recovery Dashboard**: Click "📊 Recovery Dashboard"
- **Run Batch AI Analysis**: Process all at-risk transactions
- **Generate Voice Messages**: Click "🎙️ Voice" (takes 30-60s for AI processing)
- **Track Outcomes**: Mark recoveries and view real-time metrics

### 3. Data Management
- **Add Transactions**: Manual entry via form interface
- **Import CSV**: Bulk upload with format validation
- **Generate Synthetic**: Create test data for demonstrations

### 4. Audit & Compliance
- **View Audit Trail**: Complete decision explainability
- **Monitor Stopping Rules**: Ensure compliance boundaries
- **Track Performance**: Recovery rates and AI effectiveness

## 📊 Sample Data

The system includes 100 realistic synthetic transactions:
- **Revenue at Risk**: ₹6,53,838
- **Customer Languages**: English (40%), Hindi (30%), Hinglish (30%)
- **Failure Types**: Insufficient funds, timeouts, card issues, abandonment
- **Recovery Probability**: AI-calculated 5%-95% range

### CSV Import Format
```csv
customer_name,amount,payment_status,failure_reason,customer_language,phone,email
Priya Sharma,2499,FAILED,insufficient_funds,hinglish,+91 9876543210,priya@email.com
Rahul Verma,999,ABANDONED,checkout_abandoned,en,+91 9876543211,rahul@email.com
```

## 🤖 AI Decision Engine

### Intelligence Rules
1. **Completion Check**: Skip already recovered transactions
2. **Contact Limits**: Maximum 2 attempts per customer  
3. **Probability Filter**: Ignore <20% recovery probability
4. **Escalation Logic**: Human handoff for card blocks
5. **Premium Priority**: Auto-retry for high-value customers
6. **Channel Selection**: Voice vs. link based on context
7. **Timing Optimization**: Smart contact scheduling
8. **Stopping Conditions**: Respect opt-outs immediately

### Stopping Rules Compliance
- ✅ Maximum 2 contact attempts
- ✅ Immediate stop on customer opt-out  
- ✅ Automatic stop after successful recovery
- ✅ Human escalation triggers
- ✅ 24-hour minimum between contacts
- ✅ Low-probability filtering

## 🎙️ Voice Cloning Pipeline

### Technology Stack
- **XTTS-v2**: Zero-shot multilingual synthesis
- **OpenVoice V2**: Cross-lingual voice conversion  
- **Hybrid Architecture**: Best of both models
- **GPU Acceleration**: CUDA optimization for speed

### Supported Languages  
- **English**: Native TTS quality
- **Hindi**: Transliterated input, natural speech
- **Hinglish**: Code-switching between languages

### Audio Specifications
- **Sample Rate**: 24kHz
- **Bit Depth**: 16-bit
- **Format**: WAV/MP3 compatible
- **Quality**: Professional voice synthesis

## 📈 Metrics & Analytics

### Key Performance Indicators
- **Revenue at Risk**: Total value of failed/abandoned transactions
- **AI Recoverable**: Amount eligible for automated recovery  
- **Recovery Rate**: Success percentage with confidence intervals
- **Voice Message Effectiveness**: Conversion rates by language

### Real-time Updates
- Dynamic calculation from live transaction data
- Instant metric updates after each recovery action
- Comprehensive audit trail for compliance reporting

## 🔒 Security & Compliance

### Data Privacy
- **Synthetic Data Only**: No real customer information in demo
- **Authorized Voices**: Only consensual voice profiles accepted
- **Audit Logging**: Complete decision trail for transparency
- **Opt-out Respect**: Immediate contact cessation

### Business Rules
- Customer contact frequency limits
- Recovery probability thresholds  
- Escalation triggers for complex cases
- Performance monitoring and alerting

## 🚀 Deployment

### Production Considerations
- **GPU Requirements**: NVIDIA GPU with 4GB+ VRAM
- **Scaling**: Horizontal scaling for high transaction volumes
- **Monitoring**: Real-time performance and error tracking  
- **Backup**: Transaction data and voice profile management

### Environment Variables
```bash
# LLM Configuration
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key

# TTS Configuration  
TTS_DEVICE=cuda
WHISPER_DEVICE=cuda

# Voice Profiles
VOICE_PROFILES_DIR=./voice_profiles
```

## 📋 API Documentation

### Recovery Endpoints
- `GET /recovery/summary` - Dashboard metrics
- `GET /recovery/transactions/at-risk` - Recoverable transactions
- `POST /recovery/transactions/{id}/decide` - AI decision engine
- `POST /recovery/transactions/{id}/generate-voice` - Voice synthesis
- `POST /recovery/transactions/{id}/outcome` - Record results

### Data Management  
- `POST /recovery/transactions/add` - Manual transaction entry
- `POST /recovery/import-csv` - Bulk CSV upload
- `POST /recovery/generate-synthetic` - Synthetic data creation

### Audit & Compliance
- `GET /recovery/audit` - Complete audit trail
- `GET /recovery/stopping-rules` - Compliance boundaries

Full API documentation available at `/docs` when running locally.

## 🏆 Razorpay Track 3 Alignment

### Core Requirements Met
- ✅ **AI-powered revenue recovery** with intelligent decision engine
- ✅ **Measured recovery tracking** with real-time metrics  
- ✅ **Audit trail** for complete decision explainability
- ✅ **Stopping rules** for customer protection
- ✅ **Voice AI integration** as core ML differentiator
- ✅ **Multi-language support** for Indian market
- ✅ **Scalable architecture** for enterprise deployment

### Differentiators
- **Advanced Voice Cloning**: Industry-leading XTTS-v2 + OpenVoice V2
- **Multi-language AI**: Hindi/Hinglish support with natural speech
- **Interactive UI**: Real-time feedback and professional design
- **Complete Compliance**: Built-in stopping rules and audit trails
- **Data Management**: Flexible input methods (manual, CSV, synthetic)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Razorpay** for the hackathon opportunity and problem statement
- **XTTS-v2 Team** for the excellent voice synthesis model  
- **OpenVoice** contributors for cross-lingual voice conversion
- **FastAPI** and **Next.js** communities for robust frameworks

---

**🎯 Built for Razorpay Track 3 | Transforming failed payments into recovered revenue through AI voice technology**

For questions, demo requests, or technical support, please open an issue or contact the development team.