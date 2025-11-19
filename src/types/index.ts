// Authentication types
export interface FanoAuth {
  type: "bearer";
  token: string;
  header_name: "authorization";
  method?: "query" | "message";
}

// WebSocket message types
export interface FanoWSMessage {
  event: "request" | "response" | "error" | "close" | "auth" | "ping" | "pong";
  data: any;
}

export interface FanoPingMessage {
  event: "ping";
  timestamp: number;
}

export interface FanoPongResponse {
  event: "response";
  data: {
    pong: true;
    timestamp: number;
  };
}

export interface FanoSTTConfig {
  languageCode: string;
  sampleRateHertz: number;
  encoding:
    | "LINEAR16"
    | "FLAC"
    | "MULAW"
    | "AMR"
    | "AMR_WB"
    | "OGG_OPUS"
    | "SPEEX_WITH_HEADER_BYTE";
  enableAutomaticPunctuation: boolean;
  singleUtterance: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  profanityFilter?: boolean;
  speechContexts?: Array<{
    phrases: string[];
    boost?: number;
  }>;
}

export interface StreamingConfig {
  config: FanoSTTConfig;
}

export interface FanoSTTRequest {
  event: "request" | "auth" | "ping";
  data:
    | {
        streamingConfig?: StreamingConfig;
        audioContent?: string;
      }
    | "EOF"
    | { Authorization?: string }
    | { timestamp: number };
}

export interface FanoSTTResponse {
  event: "response" | "error";
  data: {
    results?: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
        words?: Array<{
          word: string;
          startTime: string;
          endTime: string;
          confidence: number;
        }>;
      }>;
      isFinal: boolean;
      stability?: number;
      resultEndTime?: string;
    }>;
    error?: {
      code: number;
      message: string;
      details?: any;
    };
    speechEventType?: "SPEECH_EVENT_UNSPECIFIED" | "END_OF_SINGLE_UTTERANCE";
    pong?: boolean;
    timestamp?: number;
  };
}

// Audio processing types
export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  encoding: string;
}

export interface AudioChunk {
  data: ArrayBufferLike;
  timestamp: number;
  duration: number;
}

export interface AudioVisualizationData {
  frequencyData: Uint8Array;
  timeData: Uint8Array;
  volume: number;
  pitch?: number;
}

// Recording states and types
export type RecordingState =
  | "idle"
  | "initializing"
  | "recording"
  | "processing"
  | "paused"
  | "stopped"
  | "error";

export interface RecordingSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  audioConfig: AudioConfig;
  chunks: AudioChunk[];
  transcripts: TranscriptSegment[];
  status: RecordingState;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  confidence: number;
  startTime: number;
  endTime: number;
  isFinal: boolean;
  speaker?: string;
  words?: Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
}

// File upload types
export interface UploadableFile {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  duration?: number;
  audioConfig?: AudioConfig;
}

export interface FileUploadState {
  status: "idle" | "uploading" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
  result?: TranscriptResult;
}

export interface TranscriptResult {
  id: string;
  text: string;
  confidence: number;
  duration: number;
  segments: TranscriptSegment[];
  metadata: {
    audioConfig: AudioConfig;
    processingTime: number;
    modelVersion: string;
    language: string;
  };
  createdAt: Date;
}

// WebSocket connection types
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface WebSocketConfig {
  url: string;
  auth: FanoAuth;
  reconnectAttempts: number;
  reconnectInterval: number;
  heartbeatInterval?: number;
  useQueryAuth?: boolean;
}

export interface ConnectionStatus {
  state: ConnectionState;
  error?: string | undefined;
  lastConnected?: Date;
  reconnectAttempts: number;
  latency?: number;
}

// UI Component types
export interface ToastNotification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  children: React.ReactNode;
}

export interface ButtonProps {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

// App state types
export interface AppSettings {
  audioConfig: {
    sampleRate: number;
    channels: number;
    bitDepth: number;
    autoGainControl: boolean;
    noiseSuppression: boolean;
    echoCancellation: boolean;
  };
  sttConfig: FanoSTTConfig;
  ui: {
    theme: "light" | "dark" | "system";
    language: string;
    showAdvancedOptions: boolean;
    autoSave: boolean;
  };
  privacy: {
    saveTranscripts: boolean;
    shareAnalytics: boolean;
  };
}

export interface AppState {
  connectionStatus: ConnectionStatus;
  currentRecording?: RecordingSession;
  recordings: RecordingSession[];
  transcripts: TranscriptResult[];
  uploads: Record<string, FileUploadState>;
  settings: AppSettings;
  ui: {
    activeTab: "upload" | "record" | "history" | "settings";
    isSettingsOpen: boolean;
    notifications: ToastNotification[];
    loading: boolean;
  };
}

// Hook return types
export interface UseWebSocketReturn {
  connectionStatus: ConnectionStatus;
  sendMessage: (message: FanoSTTRequest) => void;
  connect: () => void;
  disconnect: () => void;
  lastMessage?: FanoSTTResponse | undefined;
}

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  audioLevel: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  audioData?: AudioVisualizationData | undefined;
  error?: string | undefined;
}

export interface UseFileUploadReturn {
  uploadFile: (file: File) => Promise<void>;
  uploadProgress: number;
  isUploading: boolean;
  error?: string;
  result?: TranscriptResult;
  reset: () => void;
}

// API response types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  services: {
    websocket: "up" | "down";
    auth: "up" | "down";
    stt: "up" | "down";
  };
}

// Event types
export interface AudioProcessingEvent {
  type: "chunk" | "level" | "error" | "end";
  data?: any;
  timestamp: number;
}

export interface TranscriptionEvent {
  type: "start" | "interim" | "final" | "error" | "complete";
  transcript?: string;
  confidence?: number;
  isFinal?: boolean;
  error?: string;
  timestamp: number;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Error types
export class FanoSTTError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message);
    this.name = "FanoSTTError";
  }
}

export class WebSocketError extends Error {
  constructor(
    message: string,
    public code?: number,
    public reason?: string,
  ) {
    super(message);
    this.name = "WebSocketError";
  }
}

export class AudioProcessingError extends Error {
  constructor(
    message: string,
    public source?: "microphone" | "processing" | "encoding",
  ) {
    super(message);
    this.name = "AudioProcessingError";
  }
}

// Constants
export const SUPPORTED_AUDIO_FORMATS = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/m4a",
  "audio/aac",
] as const;

export const DEFAULT_STT_CONFIG: FanoSTTConfig = {
  languageCode: "en-SG-x-multi",
  sampleRateHertz: 16000,
  encoding: "LINEAR16",
  enableAutomaticPunctuation: true,
  singleUtterance: false,
  interimResults: true,
  maxAlternatives: 1,
  profanityFilter: false,
} as const;

export const WEBSOCKET_URL = "wss://143.198.192.233.nip.io/ws/";

export const AUTH_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYW5vX2RlbmllZF9hY2Nlc3MiOlsiY2FsbGludGVyOndvcmtzcGFjZS0qIiwiY2FsbGludGVyOnZvaWNlcHJpbnQtKiIsImNhbGxpbnRlcjp3b3JkLWNsb3VkLSoiLCJjYWxsaW50ZXI6cHJvLXNlYXJjaC1hbmQtc2F2ZS1xdWVyeSIsImNhbGxpbnRlcjp3b3Jrc3BhY2Utbm90aWZpY2F0aW9uLXRhcmdldCIsImNhbGxpbnRlcjpub3RpZmljYXRpb24tdGFyZ2V0IiwiSW50ZW50OioiLCJQb3J0YWw6c3VwZXItdXNlciJdLCJmYW5vX3NwZWVjaF9kaWFyaXplX3F1b3RhX3N0cmF0ZWd5IjoiZGVmYXVsdCIsImZhbm9fc3BlZWNoX2dlbmVyYXRlX3ZvaWNlcHJpbnRfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfcmVjb2duaXplX3F1b3RhX3N0cmF0ZWd5IjoiZGVmYXVsdCIsImZhbm9fc3BlZWNoX3N0cmVhbWluZ19kZXRlY3RfYWN0aXZpdHlfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfc3RyZWFtaW5nX3JlY29nbml6ZV9xdW90YV9zdHJhdGVneSI6ImRlZmF1bHQiLCJmYW5vX3NwZWVjaF9yZXBsYWNlX3BocmFzZXNfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfc3ludGhlc2l6ZV9zcGVlY2hfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiaWF0IjoxNzYyNzM4ODg3LCJleHAiOjE3NjUzODI0MDAsImF1ZCI6InRlbXAtb2NiYy1ydHN0dC1wb2MiLCJzdWIiOiJPQ0JDIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLmZhbm8uYWkifQ.Gj3qIyhD2aZvNADKSlOPKnI4w8dMgEDcgiybx8vGn5xTSdYeBw_d9AiyoCjOQb0m-FAJRRL73ykXYLV_Q5EjzvCt4Kmigdb40N5aFCssQ2rq0yUry2rxhT84eBNptfwOy6SJPoZOTkrTm026W8DkFOzNO_NxFWJLmjMZiRfJAGhOBmfEZlDJxmfTaVNKWC-qD2b-p09JoXsRU7hOcvHrmST7igbEwiHunA9ig1T9dfFoxPulMCsIDl7VsCK_AbbjWWpAJ2mkqjyDyzMLlTxBKbVIKX_s8V9dG9VgiHzCGTBiV4uuoiAsoupJ7GOdov6xmvdG2UMVuUv1yh3D78JTSA";

export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];
