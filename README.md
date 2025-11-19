# Fano STT - Advanced Speech-to-Text Web Application

<div align="center">
  <img src="https://img.shields.io/badge/Next.js-14.0.4-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.3.3-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4.0-38B2AC?style=for-the-badge&logo=tailwind-css" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/WebSocket-Real--time-green?style=for-the-badge" alt="WebSocket" />
</div>

<p align="center">
  <strong>Professional speech-to-text transcription powered by Fano AI with real-time streaming and enterprise-grade accuracy</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#api">API</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## 🌟 Features

### 🎙️ Real-time Speech Recognition
- **Live Audio Recording**: Stream audio directly from your microphone
- **Real-time Transcription**: Get instant transcription results as you speak
- **Audio Visualization**: Beautiful waveform visualization during recording
- **Pause/Resume**: Control recording with pause and resume functionality

### 📁 File Upload & Processing
- **Multiple Audio Formats**: Support for WAV, MP3, OGG, FLAC, M4A, and AAC
- **Drag & Drop Interface**: Intuitive file upload with drag and drop
- **Chunk Processing**: Efficient processing of large audio files
- **Progress Tracking**: Real-time upload and processing progress

### 🎨 Modern UI/UX
- **Glass Morphism Design**: Sophisticated glass-effect interface
- **Animated Components**: Smooth animations using Framer Motion
- **Responsive Layout**: Optimized for desktop, tablet, and mobile
- **Dark Theme**: Modern dark theme with gradient accents
- **Toast Notifications**: User-friendly feedback system

### ⚡ Technical Excellence
- **WebSocket Integration**: Real-time bidirectional communication
- **Audio Processing**: Advanced audio processing and encoding
- **Error Handling**: Comprehensive error handling and recovery
- **Performance Optimized**: Efficient audio chunking and streaming
- **TypeScript**: Full type safety and developer experience

### 🌐 Multi-language Support
- English (Singapore) with multi-accent support
- Automatic punctuation and formatting
- Confidence scores for accuracy assessment
- Word-level timing information

## 🚀 Demo

![Fano STT Demo](demo-screenshot.png)

### Live Features
- **Upload Audio**: Drag and drop or select audio files for transcription
- **Record Live**: Real-time recording with audio visualization
- **View Transcripts**: Live transcript updates with confidence scores
- **Statistics**: Word count, character count, and accuracy metrics

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (version 18.0 or higher)
- **npm** or **yarn** package manager
- Modern web browser with WebSocket support
- Microphone access for live recording features

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/fano-stt.git
cd fano-stt
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Environment Setup

Copy the environment variables template:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
NEXT_PUBLIC_FANO_WEBSOCKET_URL=wss://ocbc-poc.fano.ai/speech/streaming-recognize
NEXT_PUBLIC_FANO_AUTH_TOKEN=your_jwt_token_here
NEXT_PUBLIC_DEFAULT_LANGUAGE_CODE=en-SG-x-multi
```

### 4. Start Development Server

```bash
npm run dev
# or
yarn dev
```

Visit `http://localhost:3000` to see the application running.

### 5. Docker Setup (Alternative)

If you prefer using Docker:

```bash
# Copy environment file
cp .env.docker .env.local

# Edit .env.local with your credentials
# Then run with Docker
./docker-run.sh run

# Or use Docker Compose
docker-compose up
```

## 🎯 Usage

### Audio File Upload

1. **Select File**: Click "Select File" or drag and drop an audio file
2. **Supported Formats**: WAV, MP3, OGG, FLAC, M4A, AAC (max 100MB)
3. **Process**: Click "Process File" to start transcription
4. **View Results**: Watch the live transcript appear in real-time

### Live Recording

1. **Start Recording**: Click the red microphone button
2. **Audio Visualization**: See real-time audio waveforms
3. **Control Recording**: Use pause/resume or stop buttons
4. **Live Transcript**: View transcription results as you speak

### Transcript Management

- **Copy**: Click the copy icon to copy transcript to clipboard
- **Clear**: Click the trash icon to clear current transcript
- **Statistics**: View word count, character count, and confidence scores

## 🔧 Configuration

### Audio Settings

```typescript
const audioConfig = {
  sampleRate: 16000,        // Sample rate in Hz
  channels: 1,              // Mono audio
  bitDepth: 16,             // Bit depth
  chunkDuration: 1000,      // Chunk duration in ms
}
```

### WebSocket Configuration

```typescript
const wsConfig = {
  url: 'wss://ocbc-poc.fano.ai/speech/streaming-recognize',
  reconnectAttempts: 5,
  reconnectInterval: 3000,
  heartbeatInterval: 30000,
}
```

### STT Configuration

```typescript
const sttConfig = {
  languageCode: 'en-SG-x-multi',
  sampleRateHertz: 16000,
  encoding: 'LINEAR16',
  enableAutomaticPunctuation: true,
  singleUtterance: false,
  interimResults: true,
}
```

## 🏗️ Project Structure

```
FanoSTT/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── globals.css      # Global styles
│   │   ├── layout.tsx       # Root layout
│   │   └── page.tsx         # Main page component
│   ├── components/          # Reusable components
│   ├── hooks/               # Custom React hooks
│   │   ├── useWebSocket.ts  # WebSocket hook
│   │   └── useAudioRecorder.ts # Audio recording hook
│   ├── types/               # TypeScript definitions
│   ├── utils/               # Utility functions
│   │   └── audio.ts         # Audio processing utilities
│   └── lib/                 # External library configurations
├── public/                  # Static assets
├── tailwind.config.js       # Tailwind CSS configuration
├── next.config.js           # Next.js configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Project dependencies
```

## 🔌 API Reference

### WebSocket Messages

#### Authentication
```json
{
  "event": "auth",
  "data": {
    "authorization": "Bearer your_jwt_token"
  }
}
```

#### Start Stream
```json
{
  "event": "request",
  "data": {
    "streamingConfig": {
      "config": {
        "languageCode": "en-SG-x-multi",
        "sampleRateHertz": 16000,
        "encoding": "LINEAR16",
        "enableAutomaticPunctuation": true,
        "singleUtterance": false,
        "interimResults": true
      }
    }
  }
}
```

#### Send Audio Data
```json
{
  "event": "request",
  "data": {
    "audioContent": "base64_encoded_audio_data"
  }
}
```

#### End Stream
```json
{
  "event": "request",
  "data": "EOF"
}
```

### Response Format

```json
{
  "event": "response",
  "data": {
    "results": [{
      "alternatives": [{
        "transcript": "Hello world",
        "confidence": 0.95,
        "words": [{
          "word": "Hello",
          "startTime": "0s",
          "endTime": "0.5s",
          "confidence": 0.98
        }]
      }],
      "isFinal": true,
      "stability": 0.9
    }]
  }
}
```

## 🚀 Deployment

### Docker (Recommended)

1. **Setup Environment**:
```bash
cp .env.docker .env.local
# Edit .env.local with your Fano STT credentials
```

2. **Using Docker Compose**:
```bash
docker-compose up -d
```

3. **Using Docker Run Script**:
```bash
./docker-run.sh run
```

4. **View Logs**:
```bash
./docker-run.sh logs
```

### Manual Docker Commands

1. **Build Image**:
```bash
docker build -t fano-stt .
```

2. **Run Container**:
```bash
docker run -d -p 3000:3000 --env-file .env.local --name fano-stt-app fano-stt
```

### Vercel

1. **Install Vercel CLI**:
```bash
npm i -g vercel
```

2. **Deploy**:
```bash
vercel
```

3. **Set Environment Variables** in Vercel dashboard

## 🔍 Troubleshooting

### Common Issues

#### WebSocket Connection Failed
- Check if the WebSocket URL is correct
- Verify authentication token is valid
- Ensure network connectivity

#### Microphone Access Denied
- Grant microphone permissions in browser
- Check browser security settings
- Use HTTPS in production

#### Audio File Not Supported
- Verify file format is supported
- Check file size (max 100MB)
- Ensure file is not corrupted

#### Poor Transcription Quality
- Use high-quality audio (16kHz recommended)
- Ensure clear speech without background noise
- Check microphone quality

### Debug Mode

Enable debug mode in `.env.local`:

```env
NEXT_PUBLIC_DEBUG=true
NEXT_PUBLIC_LOG_LEVEL=debug
```

### Docker Issues

If you encounter issues with Docker:

```bash
# Check container status
./docker-run.sh status

# View container logs
./docker-run.sh logs

# Restart container
./docker-run.sh restart

# Clean up and rebuild
./docker-run.sh clean
./docker-run.sh run
```

## 🧪 Testing

### Run Tests
```bash
npm run test
```

### Run E2E Tests
```bash
npm run test:e2e
```

### Lint Code
```bash
npm run lint
```

## 📊 Performance

### Optimizations Implemented
- Audio chunk streaming (1-second chunks)
- Efficient base64 encoding/decoding
- WebSocket connection pooling
- React component memoization
- Lazy loading of components
- Docker standalone output for optimized builds

### Metrics
- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 2.5s
- **Audio Latency**: < 200ms
- **Memory Usage**: < 50MB typical
- **Docker Image Size**: ~200MB

## 🐳 Docker Commands

Quick reference for Docker operations:

```bash
# Build and run
./docker-run.sh run

# View logs
./docker-run.sh logs

# Stop container
./docker-run.sh stop

# Restart container  
./docker-run.sh restart

# Check status
./docker-run.sh status

# Clean up everything
./docker-run.sh clean
```

Using Docker Compose:

```bash
# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Run tests**: `npm test`
5. **Commit changes**: `git commit -m 'Add amazing feature'`
6. **Push to branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Code Style

- Use TypeScript for all new code
- Follow ESLint configuration
- Use Prettier for code formatting
- Write meaningful commit messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Fano AI** for providing the speech-to-text API
- **Vercel** for hosting and deployment platform
- **Next.js** team for the amazing framework
- **Tailwind CSS** for the utility-first CSS framework
- **Framer Motion** for smooth animations

## 📞 Support

- **Documentation**: [Wiki](https://github.com/your-username/fano-stt/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-username/fano-stt/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/fano-stt/discussions)
- **Email**: support@fano-stt.com

---

<div align="center">
  <p>Made with ❤️ by the Fano STT Team</p>
  <p>
    <a href="https://github.com/your-username/fano-stt">⭐ Star us on GitHub</a> •
    <a href="https://twitter.com/fano_stt">🐦 Follow us on Twitter</a>
  </p>
</div>