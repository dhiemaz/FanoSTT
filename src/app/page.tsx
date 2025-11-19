"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MicrophoneIcon,
  StopIcon,
  PauseIcon,
  PlayIcon,
  DocumentArrowUpIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  Cog6ToothIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";
import {
  MicrophoneIcon as MicrophoneIconSolid,
  PauseIcon as PauseIconSolid,
} from "@heroicons/react/24/solid";

import { useWebSocket } from "@/hooks/useWebSocket";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import {
  FanoSTTRequest,
  TranscriptSegment,
  DEFAULT_STT_CONFIG,
  SUPPORTED_AUDIO_FORMATS,
  ConnectionState,
} from "@/types";
import {
  isValidAudioFormat,
  isValidFileSize,
  getDetailedAudioMetadata,
  formatDuration,
  formatFileSize,
  audioBufferToBase64,
  float32ToInt16,
  splitAudioIntoChunks,
} from "@/utils/audio";

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
}

export default function HomePage() {
  // State management
  const [activeTab, setActiveTab] = useState<"upload" | "record">("upload");
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [useQueryAuth, setUseQueryAuth] = useState(true);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Toast management
  const showToast = useCallback(
    (type: Toast["type"], title: string, message: string) => {
      const id = Date.now().toString();
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // WebSocket message handler - moved up before hook initialization
  function handleWebSocketMessage(message: any) {
    console.log("📨 [FANO MESSAGE] Received message:", message);

    // Handle EOF response (end of file upload processing)
    if (message.event === "response" && message.data === "EOF") {
      console.log("🏁 [FANO] File processing completed - EOF received");
      console.log(
        `📋 [FANO] Final aggregated transcript: "${finalTranscript}"`,
      );
      console.log(`📊 [FANO] Total transcript segments: ${transcripts.length}`);
      setIsProcessing(false);
      showToast(
        "success",
        "Transcription Complete",
        `Successfully processed audio file with ${transcripts.length} segments`,
      );
      return;
    }

    if (message.event === "response" && message.data?.results) {
      const results = message.data.results;

      results.forEach((result: any) => {
        if (result.alternatives && result.alternatives.length > 0) {
          const transcript = result.alternatives[0].transcript;
          const confidence = result.alternatives[0].confidence || 0;
          const startTime = result.alternatives[0].startTime || "0s";
          const endTime = result.alternatives[0].endTime || "0s";

          if (result.isFinal) {
            console.log(
              `📝 [FANO] Final transcript segment: "${transcript}" (${confidence.toFixed(3)})`,
            );

            // Add space only if there's existing content
            setFinalTranscript((prev) => prev + (prev ? " " : "") + transcript);
            setInterimTranscript("");

            const segment: TranscriptSegment = {
              id: `${Date.now()}-${Math.random()}`,
              text: transcript,
              confidence,
              startTime: Date.now(),
              endTime: Date.now(),
              isFinal: true,
            };

            setTranscripts((prev) => [...prev, segment]);

            // Log aggregated transcript progress for file uploads
            if (isProcessing) {
              console.log(
                `📊 [FANO] Aggregated ${transcripts.length + 1} segments. Current: "${finalTranscript}"`,
              );
            }
          } else {
            setInterimTranscript(transcript);
          }
        }
      });
    }

    if (message.data?.error) {
      console.error("❌ [FANO] STT Error:", message.data.error);
      showToast("error", "Transcription Error", message.data.error.message);
      setIsProcessing(false);
    }
  }

  // Custom hooks - moved down after message handler
  const { connectionStatus, sendMessage, connect, disconnect, lastMessage } =
    useWebSocket({
      onMessage: handleWebSocketMessage,
      onError: (error) => {
        console.error("❌ [FANO] WebSocket error:", error);
        showToast("error", "Connection Error", error.message);
      },
      onConnect: () => {
        console.log("✅ [FANO] Connected with token in URL");
        showToast("success", "Connected", "FANO STT connection established");
      },
      onDisconnect: () => {
        console.log("🔌 [FANO] Disconnected");
        showToast("warning", "Disconnected", "FANO STT connection lost");
      },
    });

  // Connection test function
  const testConnection = useCallback(() => {
    console.log("🧪 [FANO] Testing connection...");

    if (connectionStatus.state === "connected") {
      disconnect();
      setTimeout(() => connect(), 1000);
    } else {
      connect();
    }

    showToast("info", "Testing Connection", "Testing FANO STT connection...");
  }, [connectionStatus.state, connect, disconnect, showToast]);

  // Audio chunk handler for real-time recording
  const handleAudioChunk = useCallback(
    (chunk: any) => {
      if (connectionStatus.state === "connected") {
        const int16Data = new Int16Array(chunk.data);
        const base64Data = audioBufferToBase64(int16Data);

        const message: FanoSTTRequest = {
          event: "request",
          data: {
            audioContent: base64Data,
          },
        };

        sendMessage(message);
      }
    },
    [connectionStatus.state, sendMessage],
  );

  // Audio recorder hook

  const {
    isRecording,
    isPaused,
    recordingTime,
    audioLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    audioData,
    error: recordingError,
  } = useAudioRecorder({
    onAudioChunk: handleAudioChunk,
    onError: (error) => showToast("error", "Recording Error", error.message),
  });

  // File upload handlers
  const handleFileSelect = useCallback(
    (file: File) => {
      if (!isValidAudioFormat(file)) {
        showToast(
          "error",
          "Invalid Format",
          "Please select a supported audio format",
        );
        return;
      }

      if (!isValidFileSize(file)) {
        showToast(
          "error",
          "File Too Large",
          "File size must be less than 100MB",
        );
        return;
      }

      setSelectedFile(file);
      showToast(
        "success",
        "File Selected",
        `${file.name} (${formatFileSize(file.size)})`,
      );
    },
    [showToast],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0 && files[0]) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect],
  );

  // Process uploaded file
  const processUploadedFile = useCallback(async () => {
    if (!selectedFile || connectionStatus.state !== "connected") {
      showToast(
        "warning",
        "Not Connected",
        "Please wait for connection to be established",
      );
      return;
    }

    setIsProcessing(true);
    setTranscripts([]);
    setFinalTranscript("");
    setUploadProgress(0);

    try {
      // Send initial configuration with specific Fano STT format
      const configMessage: FanoSTTRequest = {
        event: "request",
        data: {
          streamingConfig: {
            config: {
              languageCode: "en-SG-x-multi",
              sampleRateHertz: 16000,
              encoding: "LINEAR16",
              enableAutomaticPunctuation: true,
              singleUtterance: false,
              interimResults: true,
            },
          },
        },
      };

      console.log(
        "📤 [FANO AUTH] Sending file processing config (requires auth token):",
        configMessage,
      );
      console.log(
        "📤 [FANO AUTH] Using authenticated connection for file processing",
      );
      sendMessage(configMessage);

      // Process entire file as single audio content
      const arrayBuffer = await selectedFile.arrayBuffer();
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Convert to mono if needed
      const channelData = audioBuffer.getChannelData(0);

      // Convert to Int16Array
      const int16Data = float32ToInt16(channelData);

      // Convert entire audio to base64
      const base64Data = audioBufferToBase64(int16Data);

      // Send entire audio file as single message
      const audioMessage: FanoSTTRequest = {
        event: "request",
        data: {
          audioContent: base64Data,
        },
      };

      console.log(
        "📤 [FANO AUTH] Sending complete audio file via authenticated connection",
      );
      console.log(
        "🔄 [FANO AUTH] Starting transcript aggregation - waiting for response segments...",
      );
      sendMessage(audioMessage);
      setUploadProgress(100);

      showToast(
        "info",
        "Processing Audio",
        "Audio sent, waiting for transcription results...",
      );

      // Send EOF
      const eofMessage: FanoSTTRequest = {
        event: "request",
        data: "EOF",
      };

      console.log(
        "📤 [FANO AUTH] Sending EOF message via authenticated connection:",
        eofMessage,
      );
      console.log(
        "📤 [FANO AUTH] File upload complete - now aggregating transcript responses...",
      );
      sendMessage(eofMessage);
      audioContext.close();
      // Don't show completion toast here - wait for EOF response
    } catch (error) {
      console.error("File processing error:", error);
      showToast("error", "Processing Error", "Failed to process audio file");
      setIsProcessing(false);
    } finally {
      setUploadProgress(0);
    }
  }, [selectedFile, connectionStatus.state, sendMessage, showToast]);

  // Recording controls
  const handleStartRecording = useCallback(async () => {
    console.log(
      "Starting recording, connection state:",
      connectionStatus.state,
    );

    if (connectionStatus.state !== "connected") {
      console.log("Not connected, attempting to connect...");
      showToast("info", "Connecting", "Establishing connection to Fano STT...");
      connect();

      // Wait for connection with timeout
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        if ((connectionStatus.state as ConnectionState) === "connected") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }

      if ((connectionStatus.state as ConnectionState) !== "connected") {
        showToast(
          "error",
          "Connection Failed",
          "Unable to establish connection to Fano STT. Please check your network.",
        );
        return;
      }
    }

    const configMessage: FanoSTTRequest = {
      event: "request",
      data: {
        streamingConfig: {
          config: {
            languageCode: "en-SG-x-multi",
            sampleRateHertz: 16000,
            encoding: "LINEAR16",
            enableAutomaticPunctuation: true,
            singleUtterance: false,
            interimResults: true,
          },
        },
      },
    };

    console.log(
      "📤 [FANO AUTH] Sending recording config (requires valid bearer token):",
      configMessage,
    );
    console.log(
      "📤 [FANO AUTH] Starting real-time transcription with authenticated connection",
    );
    sendMessage(configMessage);
    setTranscripts([]);
    setFinalTranscript("");
    setInterimTranscript("");

    try {
      await startRecording();
      console.log("Recording started successfully");
    } catch (error) {
      console.error("Failed to start recording:", error);
      showToast("error", "Recording Error", "Failed to start recording");
    }
  }, [connectionStatus.state, connect, sendMessage, startRecording, showToast]);

  const handleStopRecording = useCallback(() => {
    stopRecording();

    const eofMessage: FanoSTTRequest = {
      event: "request",
      data: "EOF",
    };

    sendMessage(eofMessage);
    showToast("success", "Recording Stopped", "Transcription completed");
  }, [stopRecording, sendMessage, showToast]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, interimTranscript]);

  // Auto-connect on mount disabled

  const renderConnectionStatus = () => {
    const statusConfig = {
      connected: {
        color: "text-green-400",
        bg: "bg-green-500/10",
        text: "Connected",
      },
      connecting: {
        color: "text-yellow-400",
        bg: "bg-yellow-500/10",
        text: "Connecting",
      },
      reconnecting: {
        color: "text-orange-400",
        bg: "bg-orange-500/10",
        text: "Reconnecting",
      },
      disconnected: {
        color: "text-red-400",
        bg: "bg-red-500/10",
        text: "Disconnected",
      },
      error: { color: "text-red-400", bg: "bg-red-500/10", text: "Error" },
    };

    const config = statusConfig[connectionStatus.state] || statusConfig.error;

    return (
      <div
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-full ${config.bg} border border-white/10`}
      >
        <div
          className={`w-2 h-2 rounded-full ${config.color.replace("text-", "bg-")} animate-pulse`}
        ></div>
        <span className={`text-sm font-medium ${config.color}`}>
          {config.text}
        </span>
      </div>
    );
  };

  const renderAudioVisualizer = () => {
    if (!isRecording || !audioData) {
      return (
        <div className="h-32 flex items-center justify-center">
          <div className="flex space-x-1">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-primary-500/30 rounded-full transition-all duration-300"
                style={{ height: "8px" }}
              />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="h-32 flex items-end justify-center space-x-1">
        {Array.from(audioData.frequencyData)
          .slice(0, 20)
          .map((value, i) => (
            <motion.div
              key={i}
              className="w-2 bg-gradient-to-t from-primary-500 to-secondary-500 rounded-full"
              style={{ height: `${Math.max(4, (value / 255) * 120)}px` }}
              animate={{ height: `${Math.max(4, (value / 255) * 120)}px` }}
              transition={{ duration: 0.1 }}
            />
          ))}
      </div>
    );
  };

  const renderToast = (toast: Toast) => {
    const icons = {
      success: <CheckCircleIcon className="w-5 h-5 text-green-400" />,
      error: <XCircleIcon className="w-5 h-5 text-red-400" />,
      warning: <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />,
      info: <ExclamationTriangleIcon className="w-5 h-5 text-blue-400" />,
    };

    const colors = {
      success: "border-green-400/20 bg-green-400/10",
      error: "border-red-400/20 bg-red-400/10",
      warning: "border-yellow-400/20 bg-yellow-400/10",
      info: "border-blue-400/20 bg-blue-400/10",
    };

    return (
      <motion.div
        key={toast.id}
        initial={{ opacity: 0, x: 300, scale: 0.8 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 300, scale: 0.8 }}
        className={`glass rounded-xl p-4 border ${colors[toast.type]} max-w-sm pointer-events-auto`}
      >
        <div className="flex items-start space-x-3">
          {icons[toast.type]}
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{toast.title}</p>
            <p className="text-sm text-white/70 mt-1">{toast.message}</p>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <XCircleIcon className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-6xl font-bold gradient-text mb-6">
              Advanced Speech-to-Text
            </h1>
            <p className="text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
              Professional transcription powered by Fano AI with real-time
              streaming and enterprise-grade accuracy
            </p>
          </motion.div>
        </div>

        {/* Status Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="flex items-center justify-between mb-8 p-4 glass rounded-2xl"
        >
          <div className="flex items-center space-x-6">
            {renderConnectionStatus()}
            <button
              onClick={testConnection}
              className="px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full hover:bg-blue-500/20 transition-colors"
              title="Test FANO STT connection and auth token"
            >
              🧪 Test Auth
            </button>
            {isRecording && (
              <div className="flex items-center space-x-2 text-red-400">
                <div className="w-3 h-3 bg-red-400 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  Recording • {formatDuration(recordingTime)}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Cog6ToothIcon className="w-5 h-5 text-white/60" />
          </button>
        </motion.div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Panel - Controls */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="space-y-6"
          >
            {/* Tab Navigation */}
            <div className="flex space-x-1 p-1 glass rounded-2xl">
              <button
                onClick={() => setActiveTab("upload")}
                className={`flex-1 py-3 px-6 rounded-xl font-medium transition-all duration-300 ${
                  activeTab === "upload"
                    ? "bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-lg"
                    : "text-white/60 hover:text-white/80 hover:bg-white/5"
                }`}
              >
                <DocumentArrowUpIcon className="w-5 h-5 inline mr-2" />
                Upload Audio
              </button>
              <button
                onClick={() => setActiveTab("record")}
                className={`flex-1 py-3 px-6 rounded-xl font-medium transition-all duration-300 ${
                  activeTab === "record"
                    ? "bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-lg"
                    : "text-white/60 hover:text-white/80 hover:bg-white/5"
                }`}
              >
                <MicrophoneIcon className="w-5 h-5 inline mr-2" />
                Record Live
              </button>
            </div>

            {/* Upload Tab */}
            <AnimatePresence mode="wait">
              {activeTab === "upload" && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  {/* File Drop Zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`upload-area p-8 text-center transition-all duration-300 ${
                      isDragOver ? "dragover" : ""
                    }`}
                  >
                    <DocumentArrowUpIcon className="w-16 h-16 mx-auto text-white/40 mb-4" />
                    <h3 className="text-xl font-semibold text-white mb-2">
                      {selectedFile
                        ? selectedFile.name
                        : "Drop your audio file here"}
                    </h3>
                    <p className="text-white/60 mb-6">
                      {selectedFile
                        ? `${formatFileSize(selectedFile.size)} • Ready to process`
                        : "Or click to browse files"}
                    </p>

                    <div className="flex justify-center space-x-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-primary"
                        disabled={isProcessing}
                      >
                        {selectedFile ? "Change File" : "Select File"}
                      </button>

                      {selectedFile && (
                        <>
                          <button
                            onClick={processUploadedFile}
                            className="btn-secondary"
                            disabled={
                              isProcessing ||
                              connectionStatus.state !== "connected"
                            }
                          >
                            {isProcessing ? (
                              uploadProgress === 0 ? (
                                <>
                                  <span className="loading-dots">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                  </span>
                                  <span className="ml-2">Sending Audio...</span>
                                </>
                              ) : uploadProgress === 100 ? (
                                <>
                                  <span className="loading-dots">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                  </span>
                                  <span className="ml-2">
                                    Processing Transcription...
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="loading-dots">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                  </span>
                                  <span className="ml-2">
                                    Aggregating Results...
                                  </span>
                                </>
                              )
                            ) : (
                              "Process File"
                            )}
                          </button>

                          <button
                            onClick={() => setSelectedFile(null)}
                            className="p-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                          >
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        </>
                      )}
                    </div>

                    {isProcessing && uploadProgress > 0 && (
                      <div className="mt-6">
                        <div className="progress-bar">
                          <div
                            className="bg-gradient-to-r from-primary-500 to-secondary-500 h-full rounded-lg transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-sm text-white/60 mt-2">
                          {uploadProgress}% processed
                        </p>
                      </div>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SUPPORTED_AUDIO_FORMATS.join(",")}
                    onChange={(e) =>
                      e.target.files?.[0] && handleFileSelect(e.target.files[0])
                    }
                    className="hidden"
                  />

                  {/* Supported Formats */}
                  <div className="text-center">
                    <p className="text-sm text-white/40 mb-2">
                      Supported formats:
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {["WAV", "MP3", "OGG", "FLAC", "M4A", "AAC"].map(
                        (format) => (
                          <span
                            key={format}
                            className="px-2 py-1 bg-white/5 rounded text-xs text-white/60"
                          >
                            {format}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Record Tab */}
              {activeTab === "record" && (
                <motion.div
                  key="record"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  {/* Audio Visualizer */}
                  <div className="glass rounded-2xl p-6">
                    <div className="text-center mb-4">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        Audio Visualization
                      </h3>
                      {isRecording && (
                        <p className="text-sm text-white/60">
                          Level: {Math.round(audioLevel * 100)}% •{" "}
                          {formatDuration(recordingTime)}
                        </p>
                      )}
                    </div>
                    {renderAudioVisualizer()}
                  </div>

                  {/* Recording Controls */}
                  <div className="glass rounded-2xl p-6">
                    <div className="flex justify-center space-x-4">
                      {!isRecording ? (
                        <button
                          onClick={handleStartRecording}
                          className="relative group"
                          disabled={connectionStatus.state !== "connected"}
                        >
                          <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg group-hover:shadow-red-500/30 group-hover:shadow-2xl transition-all duration-300 group-hover:scale-105">
                            <MicrophoneIconSolid className="w-8 h-8 text-white" />
                          </div>
                          <div className="absolute -inset-2 bg-red-500/20 rounded-full opacity-0 group-hover:opacity-100 animate-ping"></div>
                        </button>
                      ) : (
                        <div className="flex space-x-3">
                          <button
                            onClick={
                              isPaused ? resumeRecording : pauseRecording
                            }
                            className="w-12 h-12 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-full flex items-center justify-center shadow-lg hover:shadow-yellow-500/30 hover:shadow-xl transition-all duration-300 hover:scale-105"
                          >
                            {isPaused ? (
                              <PlayIcon className="w-6 h-6 text-white ml-1" />
                            ) : (
                              <PauseIconSolid className="w-6 h-6 text-white" />
                            )}
                          </button>

                          <button
                            onClick={handleStopRecording}
                            className="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-700 rounded-full flex items-center justify-center shadow-lg hover:shadow-gray-500/30 hover:shadow-xl transition-all duration-300 hover:scale-105"
                          >
                            <StopIcon className="w-6 h-6 text-white" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="text-center mt-4">
                      <p className="text-sm text-white/60">
                        {!isRecording
                          ? connectionStatus.state === "connected"
                            ? "Click to start recording"
                            : "Connecting..."
                          : isPaused
                            ? "Recording paused"
                            : "Recording in progress..."}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Right Panel - Transcript */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="space-y-6"
          >
            <div className="transcript-container h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Live Transcript
                </h3>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      const text = finalTranscript + interimTranscript;
                      navigator.clipboard.writeText(text);
                      showToast(
                        "success",
                        "Copied",
                        "Transcript copied to clipboard",
                      );
                    }}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    disabled={!finalTranscript && !interimTranscript}
                  >
                    <DocumentDuplicateIcon className="w-4 h-4 text-white/60" />
                  </button>
                  <button
                    onClick={() => {
                      setTranscripts([]);
                      setFinalTranscript("");
                      setInterimTranscript("");
                    }}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <TrashIcon className="w-4 h-4 text-white/60" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {finalTranscript && (
                  <div className="p-3 bg-white/5 rounded-lg border-l-4 border-green-400">
                    <p className="text-white leading-relaxed">
                      {finalTranscript}
                    </p>
                  </div>
                )}

                {interimTranscript && (
                  <div className="p-3 bg-white/5 rounded-lg border-l-4 border-yellow-400 opacity-70">
                    <p className="text-white/80 leading-relaxed italic">
                      {interimTranscript}
                    </p>
                    <p className="text-xs text-white/40 mt-1">
                      Interim result...
                    </p>
                  </div>
                )}

                {transcripts.length === 0 &&
                  !finalTranscript &&
                  !interimTranscript && (
                    <div className="text-center py-12">
                      <SpeakerWaveIcon className="w-12 h-12 mx-auto text-white/30 mb-4" />
                      <p className="text-white/40">
                        {activeTab === "upload"
                          ? "Upload an audio file to see transcription results"
                          : "Start recording to see live transcription"}
                      </p>
                    </div>
                  )}

                <div ref={transcriptEndRef} />
              </div>
            </div>

            {/* Statistics */}
            {(finalTranscript || transcripts.length > 0) && (
              <div className="glass rounded-2xl p-4">
                <h4 className="text-sm font-semibold text-white/80 mb-3">
                  Statistics
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-white/60">Words</p>
                    <p className="text-white font-medium">
                      {
                        finalTranscript.split(" ").filter((w) => w.length > 0)
                          .length
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-white/60">Characters</p>
                    <p className="text-white font-medium">
                      {finalTranscript.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/60">Segments</p>
                    <p className="text-white font-medium">
                      {transcripts.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/60">Avg Confidence</p>
                    <p className="text-white font-medium">
                      {transcripts.length > 0
                        ? Math.round(
                            (transcripts.reduce(
                              (sum, t) => sum + t.confidence,
                              0,
                            ) /
                              transcripts.length) *
                              100,
                          )
                        : 0}
                      %
                    </p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Toast Notifications */}
      <div className="fixed top-20 right-4 z-50 space-y-2">
        <AnimatePresence>
          {toasts.map((toast) => renderToast(toast))}
        </AnimatePresence>
      </div>
    </div>
  );
}
