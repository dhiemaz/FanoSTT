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
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/outline";
import {
  MicrophoneIcon as MicrophoneIconSolid,
  PauseIcon as PauseIconSolid,
} from "@heroicons/react/24/solid";
import { MicrophoneIcon as MicrophoneIconOutline } from "@heroicons/react/24/outline";

import { useWebSocket } from "@/hooks/useWebSocket";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import {
  FanoSTTRequest,
  TranscriptSegment,
  DEFAULT_STT_CONFIG,
  SUPPORTED_AUDIO_FORMATS,
  ConnectionState,
  createSTTConfigForFile,
  getEncodingFromExtension,
  getEncodingFromMimeType,
  AUTH_TOKEN,
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

  const [isDragOver, setIsDragOver] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [useQueryAuth, setUseQueryAuth] = useState(false);
  const [lastRequest, setLastRequest] = useState<FanoSTTRequest | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [hasActiveRequest, setHasActiveRequest] = useState(false);
  const [isSendingFile, setIsSendingFile] = useState(false);
  // 2-second interval audio sending - no loading state needed
  const [eofSent, setEofSent] = useState(false);

  // Manual audio level for testing
  const [manualAudioLevel, setManualAudioLevel] = useState<number | null>(null);

  // Toast counter for unique IDs
  const toastCounterRef = useRef<number>(0);

  // Segment counter for unique transcript IDs
  const segmentCounterRef = useRef<number>(0);

  // Microphone permission state
  const [micPermission, setMicPermission] = useState<
    "granted" | "denied" | "prompt" | "checking"
  >("checking");
  const [showMicModal, setShowMicModal] = useState(false);
  const [audioQuality, setAudioQuality] = useState<
    "excellent" | "good" | "fair" | "poor"
  >("good");

  // Streaming status state
  const [chunksStreamed, setChunksStreamed] = useState(0);
  const [streamingRate, setStreamingRate] = useState(0);
  const [lastChunkTime, setLastChunkTime] = useState<number | null>(null);
  const [bytesStreamed, setBytesStreamed] = useState(0);

  // Recovery state
  const [isRecovering, setIsRecovering] = useState(false);

  const [recoveryAttempts, setRecoveryAttempts] = useState(0);

  const [wasRecordingBeforeDisconnect, setWasRecordingBeforeDisconnect] =
    useState(false);
  const [pendingChunks, setPendingChunks] = useState<any[]>([]);

  // Transcript persistence during recovery
  const [bufferedTranscripts, setBufferedTranscripts] = useState<
    TranscriptSegment[]
  >([]);
  const [bufferedFinalTranscript, setBufferedFinalTranscript] = useState("");
  const [bufferedInterimTranscript, setBufferedInterimTranscript] =
    useState("");

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToTranscriptRef = useRef<boolean>(false);

  // Toast management
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: Toast["type"], title: string, message: string) => {
      toastCounterRef.current += 1;
      const id = `toast-${Date.now()}-${toastCounterRef.current}`;
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);

      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast],
  );

  // WebSocket message handler - moved up before hook initialization
  function handleWebSocketMessage(message: any) {
    console.log("[FANO MESSAGE] Received message:", message);

    // Handle EOF response (end of file upload processing)
    if (message.event === "response" && message.data === "EOF") {
      console.log("[FANO] File processing completed - EOF received");
      console.log(`[FANO] Final aggregated transcript: "${finalTranscript}"`);
      console.log(`[FANO] Total transcript segments: ${transcripts.length}`);
      setIsProcessing(false);
      setHasActiveRequest(false); // Clear active request on completion
      setIsSendingFile(false); // Clear file sending state on completion
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
              `[FANO] Final transcript segment: "${transcript}" (${confidence.toFixed(3)})`,
            );

            segmentCounterRef.current += 1;
            const segment: TranscriptSegment = {
              id: `segment-${Date.now()}-${segmentCounterRef.current}`,
              text: transcript,
              confidence,
              startTime: Date.now(),
              endTime: Date.now(),
              isFinal: true,
            };

            if (isRecovering && wasRecordingBeforeDisconnect) {
              // Buffer transcripts during recovery
              setBufferedFinalTranscript(
                (prev) => prev + (prev ? " " : "") + transcript,
              );
              setBufferedTranscripts((prev) => [...prev, segment]);
              console.log(
                "[FANO] Buffered transcript during recovery:",
                transcript,
              );
            } else {
              // Normal operation
              setFinalTranscript(
                (prev) => prev + (prev ? " " : "") + transcript,
              );
              setInterimTranscript("");
              setTranscripts((prev) => {
                const newTranscripts = [...prev, segment];
                // Scroll to transcript area on first transcript during recording
                if (
                  newTranscripts.length === 1 &&
                  !hasScrolledToTranscriptRef.current
                ) {
                  setTimeout(() => scrollToFirstTranscript(), 100);
                }
                return newTranscripts;
              });
            }

            // Log aggregated transcript progress for file uploads
            if (isProcessing) {
              console.log(
                `[FANO] Aggregated ${transcripts.length + 1} segments. Current: "${finalTranscript}"`,
              );
            }
          } else {
            if (isRecovering && wasRecordingBeforeDisconnect) {
              // Buffer interim transcript during recovery
              setBufferedInterimTranscript(transcript);
              console.log(
                "[FANO] Buffered interim transcript during recovery:",
                transcript,
              );
            } else {
              // Normal operation
              setInterimTranscript(transcript);
              // Scroll to transcript on first interim result if no final transcripts yet
              if (
                transcripts.length === 0 &&
                transcript.trim() &&
                !hasScrolledToTranscriptRef.current
              ) {
                setTimeout(() => scrollToFirstTranscript(), 100);
              }
            }
          }
        }
      });
    }

    // Handle error responses
    if (message.data?.error) {
      console.error("❌ [FANO] STT Error:", message.data.error);

      // Check for DEADLINE_EXCEEDED error
      if (
        message.data.error.code === 4 &&
        message.data.error.message?.includes("DEADLINE_EXCEEDED")
      ) {
        console.log(
          "[FANO] DEADLINE_EXCEEDED detected - will retry after reconnection",
        );

        if (!isRetrying) {
          setIsRetrying(true);
          showToast(
            "warning",
            "Request Timeout",
            "Reconnecting and retrying request...",
          );
        }
        return;
      }

      showToast("error", "Transcription Error", message.data.error.message);
      setIsProcessing(false);
      setHasActiveRequest(false); // Clear active request on error
      setIsSendingFile(false); // Clear file sending state on error
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
        console.log("[FANO] Connected with token in URL");

        // Handle live recording recovery
        if (wasRecordingBeforeDisconnect && isRecording) {
          console.log("[FANO] Recovering live recording session");

          // Send configuration first
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

          setLastRequest(configMessage);
          sendMessage(configMessage);

          // Send any pending chunks
          if (pendingChunks.length > 0) {
            console.log(
              `[FANO] Sending ${pendingChunks.length} buffered chunks`,
            );
            pendingChunks.forEach((chunk, index) => {
              setTimeout(() => {
                sendMessage(chunk);
              }, index * 50); // Send with small delay to avoid overwhelming
            });
            setPendingChunks([]);
          }

          setIsRecovering(false);
          setRecoveryAttempts(0);

          // Restore buffered transcripts
          if (bufferedTranscripts.length > 0) {
            setTranscripts(bufferedTranscripts);
            setFinalTranscript(bufferedFinalTranscript);
            setInterimTranscript(bufferedInterimTranscript);
          }

          showToast(
            "success",
            "Recording Recovered",
            "Live recording session restored",
          );
        } else {
          // do nothing here
        }
      },
      onDisconnect: () => {
        console.log("[FANO] Disconnected");

        // Reset EOF flag on disconnect to allow fresh EOF sending on new connection
        setEofSent(false);

        // If we had an active file sending request when disconnected, mark for retry
        if (isSendingFile && hasActiveRequest && lastRequest && !isRetrying) {
          console.log(
            "[FANO] Connection lost during file upload - will retry after reconnection",
          );
          setIsRetrying(true);
          showToast(
            "warning",
            "Upload Interrupted",
            "Reconnecting and retrying file upload...",
          );
        } else if (isRecording && wasRecordingBeforeDisconnect) {
          // Increment recovery attempts for live recording
          setRecoveryAttempts((prev) => prev + 1);

          if (recoveryAttempts < 5) {
            showToast(
              "warning",
              "Connection Lost",
              `Attempting to reconnect... (${recoveryAttempts + 1}/5)`,
            );
          } else {
            setIsRecovering(false);
            setWasRecordingBeforeDisconnect(false);
            stopRecording();
            showToast(
              "error",
              "Recovery Failed",
              "Max reconnection attempts reached. Recording stopped.",
            );
          }
        } else {
          //showToast("warning", "Reconnecting...", "");
        }
      },
    });

  // Handle DEADLINE_EXCEEDED error with reconnection and retry
  const handleDeadlineExceeded = useCallback(() => {
    console.log("[MAIN] Starting DEADLINE_EXCEEDED recovery process");
    console.log(
      `[MAIN] Current connection state before disconnect:`,
      connectionStatus.state,
    );

    // Step 1: Disconnect current connection
    disconnect();

    // Step 2: Wait and reconnect
    setTimeout(() => {
      console.log("[FANO] Reconnecting after DEADLINE_EXCEEDED...");
      connect();
    }, 1000);
  }, [disconnect, connect]);

  // Effect to handle DEADLINE_EXCEEDED retry logic (only for file uploads)
  useEffect(() => {
    if (
      lastMessage?.data?.error?.code === 4 &&
      lastMessage?.data?.error?.message?.includes("DEADLINE_EXCEEDED") &&
      isSendingFile
    ) {
      if (!isRetrying) {
        setIsRetrying(true);
        handleDeadlineExceeded();
      }
    }
  }, [lastMessage, isRetrying, handleDeadlineExceeded, isSendingFile]);

  // Effect to handle request retry after reconnection
  useEffect(() => {
    if (connectionStatus.state === "connected" && isRetrying && lastRequest) {
      console.log("[FANO] Resending request after reconnection:", lastRequest);

      setTimeout(() => {
        sendMessage(lastRequest);
        setIsRetrying(false);
      }, 1000);
    }
  }, [connectionStatus.state, isRetrying, lastRequest, sendMessage]);

  // Reset upload state when connection is lost during file upload
  useEffect(() => {
    if (
      connectionStatus.state === "disconnected" &&
      (isProcessing || isSendingFile)
    ) {
      console.log(
        "[FANO] Connection lost during upload - resetting upload state",
      );
      setIsProcessing(false);
      setUploadProgress(0);
      setIsSendingFile(false);
      setHasActiveRequest(false);
      showToast(
        "error",
        "Upload Interrupted",
        "Connection lost during upload. Please try again.",
      );
    }
  }, [connectionStatus.state, isProcessing, isSendingFile, showToast]);

  // Connection will be established on demand (upload/record)

  // Scroll to top when page loads
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, []);

  // Check microphone permission on mount
  useEffect(() => {
    const checkMicPermission = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setMicPermission("denied");
          return;
        }

        const permission = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        setMicPermission(permission.state as "granted" | "denied" | "prompt");

        permission.onchange = () => {
          setMicPermission(permission.state as "granted" | "denied" | "prompt");
        };
      } catch (error) {
        console.log("Permission API not supported, will check on first use");
        setMicPermission("prompt");
      }
    };

    checkMicPermission();

    // Periodic permission check every 5 seconds
    const permissionCheckInterval = setInterval(async () => {
      try {
        if (!navigator.permissions) return;

        const permission = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });

        const currentState = permission.state as
          | "granted"
          | "denied"
          | "prompt";
        if (currentState !== micPermission && micPermission !== "checking") {
          setMicPermission(currentState);

          // Show toast for permission changes
          if (currentState === "granted") {
            showToast(
              "success",
              "Microphone Enabled",
              "🎙️ Microphone access granted",
            );
          } else if (currentState === "denied" && micPermission === "granted") {
            showToast(
              "warning",
              "Microphone Disabled",
              "🚫 Microphone access has been revoked",
            );
          }
        }
      } catch (error) {
        // Silently handle errors in periodic check
        console.log("Periodic permission check failed:", error);
      }
    }, 5000);

    return () => {
      clearInterval(permissionCheckInterval);
    };
  }, [micPermission, showToast]);

  // Function to explicitly request microphone permission
  const requestMicrophonePermission = useCallback(async () => {
    try {
      setMicPermission("checking");
      showToast(
        "info",
        "Requesting Permission",
        "Please allow microphone access when prompted",
      );

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicPermission("denied");
        showToast(
          "error",
          "Not Supported",
          "Microphone access is not supported in this browser",
        );
        return;
      }

      // Request permission by trying to get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // Stop the stream immediately as we only needed permission
      stream.getTracks().forEach((track) => track.stop());

      setMicPermission("granted");
      showToast(
        "success",
        "Permission Granted",
        "Microphone access has been enabled",
      );
    } catch (error) {
      console.error("Permission request failed:", error);
      setMicPermission("denied");

      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          showToast(
            "error",
            "Permission Denied",
            "Please click the microphone icon in your browser's address bar to enable access",
          );
        } else if (error.name === "NotFoundError") {
          showToast(
            "error",
            "No Microphone",
            "No microphone was found on your device",
          );
        } else {
          showToast(
            "error",
            "Permission Error",
            "Failed to request microphone permission",
          );
        }
      }
    }
  }, [showToast]);

  // Audio recorder hook - placeholder for handleAudioChunk to avoid circular dependency
  const handleAudioChunkRef = useRef<((chunk: any) => void) | null>(null);

  const handleAudioChunkPlaceholder = useCallback((chunk: any) => {
    if (handleAudioChunkRef.current) {
      handleAudioChunkRef.current(chunk);
    }
  }, []);

  // Handle interval audio sending (every 2 seconds during recording)
  const handleIntervalAudio = useCallback(
    async (intervalAudio: Int16Array, duration: number) => {
      try {
        console.log(
          `[FANO LIVE STREAM] Processing 2s audio segment for live recording: ${intervalAudio.length} samples, ${duration}ms`,
        );

        if (connectionStatus.state === "connected") {
          // Convert interval audio to base64
          const bytes = new Uint8Array(intervalAudio.buffer);
          let binary = "";
          const chunkSize = 0x8000; // 32KB chunks to avoid call stack overflow

          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(
              i,
              Math.min(i + chunkSize, bytes.length),
            );
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }

          const base64Audio = btoa(binary);

          // Send interval audio
          const intervalAudioMessage: FanoSTTRequest = {
            event: "request",
            data: {
              audioContent: base64Audio,
            },
          };

          console.log(
            `[FANO LIVE STREAM] Sending 2s audio segment (${base64Audio.length} chars base64)`,
          );
          setLastRequest(intervalAudioMessage);
          sendMessage(intervalAudioMessage);

          // showToast(
          //   "info",
          //   "Audio Segment Sent",
          //   `📤 Sent 2s audio segment to FANO STT`,
          // );
        } else {
          console.warn(
            "[FANO LIVE STREAM] Not connected, cannot send interval audio",
          );
        }
      } catch (error) {
        console.error(
          "[FANO LIVE STREAM] Failed to process interval audio:",
          error,
        );
      }
    },
    [connectionStatus.state, sendMessage, showToast],
  );

  // Handle complete recording when recording stops (now just for logging)
  const handleRecordingComplete = useCallback(
    async (completeAudio: Int16Array, duration: number) => {
      console.log(
        `[FANO COMPLETE] Recording completed: ${completeAudio.length} samples, ${Math.round(duration / 1000)}s duration`,
      );

      // Complete audio is no longer sent, only used for statistics
      showToast(
        "success",
        "Recording Complete",
        `🎙️ Recorded ${Math.round(duration / 1000)}s of audio`,
      );
    },
    [showToast],
  );

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
    onAudioChunk: handleAudioChunkPlaceholder,
    onIntervalAudio: handleIntervalAudio,
    onRecordingComplete: handleRecordingComplete,
    intervalDuration: 5, // Send audio every 5 seconds to match Fano's processing rhythm
    onError: (error) => {
      showToast("error", "Recording Error", error.message);
      if (
        error.message.includes("Permission denied") ||
        error.message.includes("NotAllowedError")
      ) {
        setMicPermission("denied");
      }
    },
  });

  // Reset recording state when connection is lost during recording
  useEffect(() => {
    if (connectionStatus.state === "disconnected" && isRecording) {
      console.log(
        "[FANO] Connection lost during recording - stopping recording",
      );
      stopRecording();
      setIsRecovering(false);
      setRecoveryAttempts(0);
      setWasRecordingBeforeDisconnect(false);
      setPendingChunks([]);
      setBufferedTranscripts([]);
      setBufferedFinalTranscript("");
      setBufferedInterimTranscript("");
      showToast(
        "error",
        "Recording Interrupted",
        "Connection lost during recording. Recording has been stopped.",
      );
    }
  }, [
    connectionStatus.state,
    isRecording,
    stopRecording,
    showToast,
    setIsRecovering,
    setRecoveryAttempts,
    setWasRecordingBeforeDisconnect,
    setPendingChunks,
    setBufferedTranscripts,
    setBufferedFinalTranscript,
    setBufferedInterimTranscript,
  ]);

  // Audio chunk handler for real-time recording (defined after useAudioRecorder)
  const handleAudioChunk = useCallback(
    (chunk: any) => {
      // Skip individual chunk sending during live recording
      // Use only interval audio (2-second segments) for live streaming to prevent transcript gaps
      if (isRecording) {
        // Still update statistics for live recording feedback, but don't send individual chunks
        // console.log(
        //   "[FANO LIVE STREAM] Skipping individual chunk - using interval audio for live recording",
        // );
        setChunksStreamed((prev) => prev + 1);
        const now = Date.now();
        if (lastChunkTime) {
          const timeDiff = now - lastChunkTime;
          setStreamingRate(1000 / timeDiff);
        }
        setLastChunkTime(now);
        return; // Exit early - interval audio will handle transmission
      }

      const int16Data = new Int16Array(chunk.data);
      const base64Data = audioBufferToBase64(int16Data);

      const message: FanoSTTRequest = {
        event: "request",
        data: {
          audioContent: base64Data,
        },
      };

      console.log(
        "[FANO FILE UPLOAD] Sending individual audio chunk for file processing",
      );

      if (connectionStatus.state === "connected") {
        try {
          setLastRequest(message);
          sendMessage(message);

          // Update streaming statistics
          setChunksStreamed((prev) => prev + 1);
          setBytesStreamed((prev) => prev + base64Data.length);

          const now = Date.now();
          if (lastChunkTime) {
            const timeDiff = now - lastChunkTime;
            setStreamingRate(1000 / timeDiff); // chunks per second
          }
          setLastChunkTime(now);

          // Clear pending chunks on successful send
          if (pendingChunks.length > 0) {
            setPendingChunks([]);
          }
        } catch (error) {
          console.error("Failed to send audio chunk:", error);
          // Store chunk for retry
          setPendingChunks((prev) => [...prev, message].slice(-50)); // Keep last 50 chunks
        }
      } else if (isRecording && !isRecovering) {
        // Store chunks while disconnected
        setPendingChunks((prev) => [...prev, message].slice(-50));

        // Start recovery if not already recovering
        if (!isRecovering && connectionStatus.state !== "connecting") {
          setIsRecovering(true);
          setWasRecordingBeforeDisconnect(true);
          setRecoveryAttempts((prev) => prev + 1);

          if (recoveryAttempts < 5) {
            showToast(
              "warning",
              "Connection Lost",
              `Attempting to reconnect... (${recoveryAttempts + 1}/5)`,
            );

            // Attempt to reconnect with exponential backoff
            const delay = Math.min(1000 * Math.pow(2, recoveryAttempts), 10000);
            setTimeout(() => {
              console.log(
                `[MAIN] Attempting connection after DEADLINE_EXCEEDED with delay ${delay}ms`,
              );
              // console.log(
              //   `[MAIN] Current connection state:`,
              //   connectionStatus.state,
              // );
              connect();
            }, delay);
          } else {
            // Max attempts reached
            setIsRecovering(false);
            setWasRecordingBeforeDisconnect(false);
            setPendingChunks([]);
            stopRecording();
            showToast(
              "error",
              "Recovery Failed",
              "Unable to reconnect. Recording stopped.",
            );
          }
        }
      }
    },
    [
      connectionStatus.state,
      sendMessage,
      setLastRequest,
      lastChunkTime,
      pendingChunks,
      isRecording,
      isRecovering,
      recoveryAttempts,
      connect,
      showToast,
      stopRecording,
    ],
  );

  // Update the ref with the actual function
  useEffect(() => {
    handleAudioChunkRef.current = handleAudioChunk;
  }, [handleAudioChunk]);

  // Update audio quality based on level
  // Audio quality based on level
  useEffect(() => {
    const effectiveLevel =
      manualAudioLevel !== null ? manualAudioLevel : audioLevel;
    if (isRecording && effectiveLevel > 0) {
      if (effectiveLevel > 0.7) setAudioQuality("excellent");
      else if (effectiveLevel > 0.4) setAudioQuality("good");
      else if (effectiveLevel > 0.1) setAudioQuality("fair");
      else setAudioQuality("poor");
    }
  }, [isRecording, audioLevel, manualAudioLevel]);

  // Debug function to test audio visualization
  const testAudioVisualization = useCallback(() => {
    const effectiveLevel =
      manualAudioLevel !== null ? manualAudioLevel : audioLevel;
    console.log("[AUDIO VIZ DEBUG] Testing visualization:", {
      isRecording,
      audioLevel,
      manualAudioLevel,
      effectiveLevel,
      audioData: audioData ? "present" : "missing",
      recordingError,
    });

    showToast(
      "info",
      "Audio Debug",
      `Level: ${Math.round((effectiveLevel || 0) * 100)}% | Recording: ${isRecording ? "Yes" : "No"} | Manual: ${manualAudioLevel !== null ? "Yes" : "No"}`,
    );
  }, [
    isRecording,
    audioLevel,
    manualAudioLevel,
    audioData,
    recordingError,
    showToast,
  ]);

  // Manual audio level test for debugging
  const testManualAudioLevel = useCallback(() => {
    let testLevel = 0;
    let direction = 1;

    const interval = setInterval(() => {
      testLevel += direction * 0.1;
      if (testLevel >= 1) {
        testLevel = 1;
        direction = -1;
      } else if (testLevel <= 0) {
        testLevel = 0;
        direction = 1;
      }

      // Manually set audio level for testing
      setManualAudioLevel(testLevel);

      console.log(
        "[MANUAL TEST] Setting audio level to:",
        testLevel.toFixed(2),
      );
    }, 100);

    // Stop test after 3 seconds
    setTimeout(() => {
      clearInterval(interval);
      setManualAudioLevel(null);
      console.log("[MANUAL TEST] Test completed, reset to null");
    }, 3000);

    showToast(
      "info",
      "Manual Test",
      "Testing audio level animation for 3 seconds",
    );
  }, [showToast]);

  // Scroll to transcript area when recording starts
  const scrollToTranscript = useCallback(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      showToast(
        "info",
        "Ready to Transcribe",
        "📝 Transcript area is now visible - start speaking!",
      );
    }
  }, [showToast]);

  // Scroll to transcript on first transcript received
  const scrollToFirstTranscript = useCallback(() => {
    if (!hasScrolledToTranscriptRef.current && transcriptContainerRef.current) {
      hasScrolledToTranscriptRef.current = true;
      transcriptContainerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      showToast(
        "success",
        "Transcription Started!",
        "🎙️ Your speech is being transcribed below",
      );
    }
  }, [showToast]);

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
    if (!selectedFile) {
      showToast("error", "No File Selected", "Please select a file first");
      return;
    }

    setIsProcessing(true);
    setTranscripts([]);
    setFinalTranscript("");
    setUploadProgress(0);
    setIsSendingFile(true);

    try {
      // Step 1: Establish connection to Fano with Auth
      if (connectionStatus.state !== "connected") {
        console.log(
          `[MAIN] processUploadedFile - Connection needed. Current state:`,
          connectionStatus.state,
        );
        // console.log(
        //   `[MAIN] Auth token being used:`,
        //   AUTH_TOKEN.substring(0, 50) + "...",
        // );
        showToast(
          "info",
          "Connecting",
          "Establishing connection to Fano STT...",
        );

        connect();
        // Give a brief moment for connection to establish
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      showToast(
        "success",
        "Connected",
        "Connection established, processing file...",
      );

      // Step 2: Send initial configuration with dynamic encoding based on file type
      const dynamicConfig = createSTTConfigForFile(selectedFile);
      const configMessage: FanoSTTRequest = {
        event: "request",
        data: {
          streamingConfig: {
            config: dynamicConfig,
          },
        },
      };

      console.log(
        "[FANO AUTH] Sending file processing config (requires auth token):",
        configMessage,
      );
      console.log(
        `[FILE PROCESSING] File: ${selectedFile.name}, Type: ${selectedFile.type}, Encoding: ${dynamicConfig.encoding}, Sample Rate: ${dynamicConfig.sampleRateHertz}Hz`,
      );
      console.log(
        "[FANO AUTH] Using authenticated connection for file processing",
      );
      setLastRequest(configMessage);
      setHasActiveRequest(true);
      sendMessage(configMessage);

      console.log(
        `[FANO] Starting audio processing section for file: ${selectedFile.name}`,
      );
      console.log(
        `[FANO] Connection status before audio processing: ${connectionStatus.state}`,
      );

      // Convert raw file to base64 (don't decode/re-encode for file uploads)
      console.log(
        `[FANO] Converting file to base64: ${selectedFile.name} (${selectedFile.size} bytes)`,
      );
      const arrayBuffer = await selectedFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      console.log(
        `[FANO] ArrayBuffer created, size: ${uint8Array.length} bytes`,
      );

      // Convert to base64 efficiently for large files
      console.log(
        `[FANO] Starting base64 conversion for ${uint8Array.length} bytes`,
      );
      let binary = "";
      const chunkSize = 0x8000; // 32KB chunks to avoid call stack overflow
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(
          i,
          Math.min(i + chunkSize, uint8Array.length),
        );
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64Data = btoa(binary);
      console.log(
        `[FANO] Base64 conversion completed, length: ${base64Data.length} chars`,
      );

      // Send entire audio file as single message
      console.log(
        `[FANO] Creating audio message with ${base64Data.length} chars of base64 data`,
      );
      const audioMessage: FanoSTTRequest = {
        event: "request",
        data: {
          audioContent: base64Data,
        },
      };
      console.log(`[FANO] Audio message created:`, {
        event: audioMessage.event,
        dataKeys: Object.keys(audioMessage.data),
        audioContentLength: (audioMessage.data as any).audioContent?.length,
      });

      console.log(
        "[FANO] Sending complete audio file via authenticated connection",
      );
      console.log(
        "[FANO] Starting transcript aggregation - waiting for response segments...",
      );
      console.log(`[FANO] About to call sendMessage with audio data`);
      setLastRequest(audioMessage);
      setHasActiveRequest(true);
      sendMessage(audioMessage);
      console.log(`[FANO] sendMessage called for audio data`);
      setUploadProgress(100);

      showToast(
        "info",
        "Processing Audio",
        "Audio sent, waiting for transcription results...",
      );

      // Send EOF to signal end of audio file
      const eofMessage: FanoSTTRequest = {
        event: "request",
        data: "EOF",
      };

      // Send EOF immediately - WebSocket is functional (receiving responses)

      // console.log(
      //   "[FANO AUTH] Sending EOF message via authenticated connection:",
      //   eofMessage,
      // );
      console.log(
        "[FANO AUTH] File upload complete - now aggregating transcript responses...",
      );
      setLastRequest(eofMessage);
      setHasActiveRequest(true);
      sendMessage(eofMessage);
      // Clear sending state before disconnect to prevent false interruption detection
      setIsSendingFile(false);
      setIsProcessing(false);
      // Let Fano server close the connection after processing EOF
      // Don't show completion toast here - wait for EOF response
    } catch (error) {
      console.error("File processing error:", error);
      showToast("error", "Processing Error", "Failed to process audio file");
      setIsProcessing(false);
      setIsSendingFile(false); // Clear file sending state on error
    } finally {
      setUploadProgress(0);
    }
  }, [selectedFile, connectionStatus.state, sendMessage, showToast, connect]);

  // Recording controls
  const handleStartRecording = useCallback(async () => {
    console.log(
      "Starting recording, connection state:",
      connectionStatus.state,
    );

    // Check microphone permission first
    if (micPermission === "denied") {
      showToast(
        "error",
        "Microphone Access Denied",
        "Please enable microphone access in your browser settings",
      );
      return;
    }

    if (micPermission === "prompt") {
      showToast(
        "info",
        "Requesting Permission",
        "Please allow microphone access when prompted",
      );
      setMicPermission("checking");
    }

    if (connectionStatus.state !== "connected") {
      console.log(
        `[MAIN] handleStartRecording - Not connected, attempting to connect...`,
      );
      //console.log(`[MAIN] Current connection state:`, connectionStatus.state);
      // console.log(
      //   `[MAIN] Auth token being used:`,
      //   AUTH_TOKEN.substring(0, 50) + "...",
      // );
      showToast("info", "Connecting", "Establishing connection to Fano STT...");

      connect();
      // Give a brief moment for connection to establish
      await new Promise((resolve) => setTimeout(resolve, 1000));
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

    // console.log(
    //   "[FANO AUTH] Sending recording config (requires valid bearer token):",
    //   configMessage,
    // );
    console.log(
      "[FANO AUTH] Starting real-time transcription with authenticated connection",
    );
    setLastRequest(configMessage);
    sendMessage(configMessage);
    setTranscripts([]);
    setFinalTranscript("");
    setInterimTranscript("");

    // Clear transcript buffers for new recording
    setBufferedTranscripts([]);
    setBufferedFinalTranscript("");
    setBufferedInterimTranscript("");

    // Reset EOF flag for new recording session
    setEofSent(false);

    // Reset scroll tracking for new recording
    hasScrolledToTranscriptRef.current = false;

    // Scroll to transcript area after a short delay
    setTimeout(() => {
      scrollToTranscript();
    }, 1000);

    try {
      // Reset streaming statistics
      setChunksStreamed(0);
      setStreamingRate(0);
      setBytesStreamed(0);
      setLastChunkTime(null);

      await startRecording();
      setMicPermission("granted");
      console.log("Recording started successfully");
      showToast("success", "Recording Started", "🎙️ Listening for audio...");
    } catch (error) {
      console.error("Failed to start recording:", error);

      if (error instanceof Error) {
        if (
          error.name === "NotAllowedError" ||
          error.message.includes("Permission denied")
        ) {
          setMicPermission("denied");
          setShowMicModal(true);
          showToast(
            "error",
            "Microphone Access Denied",
            "Please enable microphone access to start recording",
          );
        } else if (error.name === "NotFoundError") {
          setMicPermission("denied");
          showToast(
            "error",
            "No Microphone Found",
            "Please connect a microphone and try again",
          );
        } else if (error.name === "NotReadableError") {
          showToast(
            "error",
            "Microphone Busy",
            "Microphone is being used by another application",
          );
        } else if (error.name === "OverconstrainedError") {
          showToast(
            "error",
            "Microphone Settings Error",
            "Please check your microphone settings and try again",
          );
        } else if (error.name === "NotSupportedError") {
          showToast(
            "error",
            "Not Supported",
            "Your browser doesn't support audio recording",
          );
        } else if (error.message.includes("microphone")) {
          setMicPermission("denied");
          setShowMicModal(true);
          showToast(
            "error",
            "Microphone Error",
            "There was an issue accessing your microphone",
          );
        } else {
          showToast(
            "error",
            "Recording Error",
            "Failed to start recording. Please try again.",
          );
        }
      } else {
        showToast("error", "Recording Error", "An unexpected error occurred");
      }
    }
  }, [
    connectionStatus.state,
    connect,
    sendMessage,
    startRecording,
    showToast,
    scrollToTranscript,
  ]);

  const handleStopRecording = useCallback(() => {
    console.log("[FANO] Stopping recording and sending EOF...");

    // Stop the recording (this will send any remaining interval audio)
    stopRecording();

    // Reset recovery state
    setIsRecovering(false);
    setRecoveryAttempts(0);
    setWasRecordingBeforeDisconnect(false);
    setPendingChunks([]);

    // Clear transcript buffers
    setBufferedTranscripts([]);
    setBufferedFinalTranscript("");
    setBufferedInterimTranscript("");

    // Send EOF only once and only if connected and not already sent
    if (connectionStatus.state === "connected" && !eofSent) {
      const eofMessage: FanoSTTRequest = {
        event: "request",
        data: "EOF",
      };

      console.log(
        "[FANO AUTH] Sending EOF to complete transcription:",
        eofMessage,
      );
      setLastRequest(eofMessage);
      sendMessage(eofMessage);
      setEofSent(true); // Mark EOF as sent to prevent duplicates
      // Let Fano server close the connection after processing EOF
    } else if (eofSent) {
      console.log("[FANO AUTH] EOF already sent, skipping duplicate");
    } else {
      console.log("[FANO AUTH] Not connected, cannot send EOF");
    }

    showToast("success", "Recording Stopped", "🔴 Transcription completed");
  }, [stopRecording, connectionStatus.state, sendMessage, showToast, eofSent]);

  const handlePauseRecording = useCallback(() => {
    pauseRecording();
    showToast("info", "Recording Muted", "🔇 Recording has been muted");
  }, [pauseRecording, showToast]);

  const handleResumeRecording = useCallback(() => {
    resumeRecording();
    showToast("info", "Recording Unmuted", "🔊 Recording has been unmuted");
  }, [resumeRecording, showToast]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, interimTranscript]);

  // Auto-connect enabled on page load

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
    const currentLevel =
      manualAudioLevel !== null ? manualAudioLevel : audioLevel || 0;

    // Show animated waiting bars when not recording
    if (!isRecording) {
      return (
        <div className="h-32 flex items-center justify-center">
          <div className="flex space-x-1">
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                className="w-2 bg-primary-500/20 rounded-full"
                initial={{ height: 8 }}
                animate={{
                  height: [8, 16, 8],
                  opacity: [0.2, 0.6, 0.2],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.1,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
          <div className="absolute text-xs text-white/40 mt-16">
            Start recording to see visualization
          </div>
        </div>
      );
    }

    // Fallback visualization using audio level when frequency data is not available
    if (
      !audioData ||
      !audioData.frequencyData ||
      audioData.frequencyData.length === 0
    ) {
      // console.log(
      //   "[AUDIO VIZ] Using fallback visualization, audioLevel:",
      //   currentLevel,
      // );

      return (
        <div className="h-32 flex items-end justify-center space-x-0.5">
          {[...Array(24)].map((_, i) => {
            // Create pseudo-frequency bars based on audio level and position
            const position = i / 23; // Normalize position 0-1
            const centerDistance = Math.abs(position - 0.5) * 2; // Distance from center
            const baseHeight = Math.max(
              4,
              currentLevel * 80 * (1 - centerDistance * 0.7),
            );

            // Add some variation
            const variation =
              Math.sin(Date.now() / 100 + i) * currentLevel * 10;
            const finalHeight = Math.min(
              120,
              Math.max(4, baseHeight + variation),
            );

            const intensity = currentLevel;
            const colorClass =
              intensity > 0.6
                ? "from-green-400 to-green-600"
                : intensity > 0.3
                  ? "from-blue-400 to-blue-600"
                  : intensity > 0.1
                    ? "from-yellow-400 to-yellow-600"
                    : "from-primary-500 to-secondary-500";

            return (
              <motion.div
                key={i}
                className={`w-2 bg-gradient-to-t ${colorClass} rounded-full shadow-sm`}
                animate={{
                  height: `${finalHeight}px`,
                  opacity: intensity > 0.05 ? 1 : 0.3,
                }}
                transition={{
                  duration: 0.1,
                  ease: "easeOut",
                }}
              />
            );
          })}

          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 text-xs text-white/60 mb-1 text-center">
            <div>Level: {Math.round(currentLevel * 100)}%</div>
            <div className="text-yellow-400/60">Fallback Mode</div>
          </div>
        </div>
      );
    }

    // Active visualization with frequency data
    try {
      const frequencyBars = Array.from(audioData.frequencyData).slice(0, 24);
      console.log(
        "[AUDIO VIZ] Using frequency data, bars:",
        frequencyBars.length,
        "level:",
        currentLevel,
      );

      return (
        <div className="h-32 flex items-end justify-center space-x-0.5">
          {frequencyBars.map((value, i) => {
            // Enhanced height calculation with minimum threshold
            const normalizedValue = Math.max(0, Math.min(1, value / 255));
            const baseHeight = Math.max(4, normalizedValue * 100);

            // Add boost from overall audio level
            const levelBoost = currentLevel * 15;
            const finalHeight = Math.min(120, baseHeight + levelBoost);

            // Dynamic color based on frequency intensity
            const intensity = Math.max(normalizedValue, currentLevel * 0.5);
            const colorClass =
              intensity > 0.7
                ? "from-green-400 to-green-600"
                : intensity > 0.4
                  ? "from-blue-400 to-blue-600"
                  : intensity > 0.2
                    ? "from-yellow-400 to-yellow-600"
                    : "from-primary-500 to-secondary-500";

            return (
              <motion.div
                key={i}
                className={`w-2 bg-gradient-to-t ${colorClass} rounded-full shadow-sm`}
                animate={{
                  height: `${finalHeight}px`,
                  boxShadow:
                    intensity > 0.5
                      ? `0 0 6px ${intensity > 0.7 ? "#10b981" : "#3b82f6"}55`
                      : "none",
                }}
                transition={{
                  duration: 0.08,
                  ease: "easeOut",
                }}
              />
            );
          })}

          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 text-xs text-white/60 mb-1 text-center">
            <div>Level: {Math.round(currentLevel * 100)}%</div>
            <div className="text-green-400/60">Frequency Data</div>
          </div>
        </div>
      );
    } catch (error) {
      console.error("[AUDIO VIZ] Error rendering frequency data:", error);

      // Error fallback - show simple level indicator
      return (
        <div className="h-32 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full border-4 border-red-500/30 flex items-center justify-center mb-2">
              <span className="text-red-400 text-lg font-bold">
                {Math.round(currentLevel * 100)}%
              </span>
            </div>
            <div className="text-xs text-red-400">Visualization Error</div>
          </div>
        </div>
      );
    }
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
    <>
      {/* Navigation Header */}
      <header className="relative z-50">
        <nav className="fixed top-0 left-0 right-0 bg-black/20 backdrop-blur-xl border-b border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-secondary-500 rounded-lg flex items-center justify-center shadow-lg">
                    <svg
                      className="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  <h1 className="text-xl font-bold gradient-text">
                    Cortex STT
                  </h1>
                  <p className="text-xs text-white/60 font-medium">
                    Advanced Speech-to-Text (Demo Version)
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div
                  className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg border backdrop-blur-sm transition-all duration-300 ${
                    connectionStatus.state === "connected"
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : connectionStatus.state === "connecting"
                        ? "bg-amber-500/5 border-amber-500/20"
                        : connectionStatus.state === "reconnecting"
                          ? "bg-orange-500/5 border-orange-500/20"
                          : connectionStatus.state === "error"
                            ? "bg-red-500/5 border-red-500/20"
                            : "bg-slate-500/5 border-slate-500/20"
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full shadow-sm ${
                      connectionStatus.state === "connected"
                        ? "bg-emerald-400 animate-pulse"
                        : connectionStatus.state === "connecting"
                          ? "bg-amber-400 animate-pulse"
                          : connectionStatus.state === "reconnecting"
                            ? "bg-orange-400"
                            : connectionStatus.state === "error"
                              ? "bg-red-400"
                              : "bg-slate-400"
                    }`}
                  ></div>
                  <span
                    className={`text-xs font-medium tracking-wide ${
                      connectionStatus.state === "connected"
                        ? "text-emerald-400"
                        : connectionStatus.state === "connecting"
                          ? "text-amber-400"
                          : connectionStatus.state === "reconnecting"
                            ? "text-orange-400"
                            : connectionStatus.state === "error"
                              ? "text-red-400"
                              : "text-slate-400"
                    }`}
                  >
                    {connectionStatus.state === "connected"
                      ? "Connected"
                      : connectionStatus.state === "connecting"
                        ? "Connecting"
                        : connectionStatus.state === "reconnecting"
                          ? "Reconnecting"
                          : connectionStatus.state === "error"
                            ? "Error"
                            : "Disconnected"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </nav>
      </header>

      <div className="pt-20 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}

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
                          ? `${formatFileSize(selectedFile.size)} • ${createSTTConfigForFile(selectedFile).encoding} encoding • Ready to process`
                          : "Or click to browse files"}
                      </p>

                      <div className="flex justify-center space-x-3">
                        <button
                          onClick={() => {
                            fileInputRef.current?.click();
                          }}
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
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                uploadProgress === 0 ? (
                                  <>
                                    <span className="loading-dots">
                                      <span></span>
                                      <span></span>
                                      <span></span>
                                    </span>
                                    <span className="ml-2">
                                      Sending Audio...
                                    </span>
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
                        e.target.files?.[0] &&
                        handleFileSelect(e.target.files[0])
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
                    {/* Recording Control Center */}
                    <div className="glass rounded-2xl p-6 flex flex-col min-h-[480px]">
                      <div className="flex flex-col h-full">
                        {/* Header Section */}
                        <div className="text-center mb-6">
                          <h3 className="text-lg font-semibold text-white mb-4 flex items-center justify-center gap-2">
                            <MicrophoneIcon className="w-5 h-5" />
                            Live Audio Control Center
                          </h3>

                          {/* Status Indicator */}
                          <div className="flex items-center justify-center space-x-3 mb-4">
                            <div
                              className={`w-4 h-4 rounded-full flex items-center justify-center ${
                                micPermission === "granted"
                                  ? "bg-green-500 shadow-green-500/50 shadow-lg"
                                  : micPermission === "denied"
                                    ? "bg-red-500 shadow-red-500/50 shadow-lg"
                                    : micPermission === "checking"
                                      ? "bg-yellow-500 animate-pulse shadow-yellow-500/50 shadow-lg"
                                      : "bg-gray-500"
                              }`}
                            >
                              {micPermission === "granted" && (
                                <CheckCircleIcon className="w-2.5 h-2.5 text-white" />
                              )}
                              {micPermission === "denied" && (
                                <XCircleIcon className="w-2.5 h-2.5 text-white" />
                              )}
                            </div>
                            <span className="text-base font-medium text-white">
                              {micPermission === "granted"
                                ? "✓ Microphone Ready"
                                : micPermission === "denied"
                                  ? "✗ Access Blocked"
                                  : micPermission === "checking"
                                    ? "⏳ Requesting Access..."
                                    : "⚡ Permission Required"}
                            </span>
                          </div>
                        </div>

                        {/* Permission Status Details */}
                        <div className="flex-1 flex flex-col justify-center">
                          {micPermission === "granted" && (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-4">
                              <p className="text-sm text-green-400 font-medium mb-1">
                                🎙️ Microphone Access Granted
                              </p>
                              <p className="text-xs text-green-300/80">
                                You can now start live audio processing. Your
                                audio transcript will be processed in real-time.
                              </p>
                            </div>
                          )}

                          {micPermission === "denied" && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 space-y-4">
                              <div className="text-left">
                                <p className="text-sm text-red-400 font-medium mb-2">
                                  🚫 Microphone Access Blocked
                                </p>
                                <p className="text-xs text-red-300/80 mb-3">
                                  To use live recording, please enable
                                  microphone access:
                                </p>
                              </div>

                              <button
                                onClick={requestMicrophonePermission}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-blue-500/30 transform hover:scale-[1.02] flex items-center justify-center gap-2"
                              >
                                <MicrophoneIcon className="w-4 h-4" />
                                Try Again
                              </button>

                              <div className="text-left bg-gray-900/30 rounded-lg p-3 space-y-2">
                                <p className="text-xs text-gray-300 font-medium">
                                  Manual Setup Instructions:
                                </p>
                                <div className="text-xs text-gray-400 space-y-1">
                                  <p>
                                    • Chrome: Click 🔒 or 🎙️ icon in address bar
                                  </p>
                                  <p>
                                    • Firefox: Click 🔒 icon, then "Permissions"
                                  </p>
                                  <p>
                                    • Safari: Safari menu → Settings → Websites
                                    → Microphone
                                  </p>
                                  <p>• Edge: Click 🔒 icon next to the URL</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {micPermission === "prompt" && (
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-4 space-y-3">
                              <div className="text-center">
                                <p className="text-sm text-yellow-400 font-medium mb-2">
                                  🎤 Enable Microphone Access
                                </p>
                                <p className="text-xs text-yellow-300/80 mb-4">
                                  Click the button below and allow microphone
                                  access when prompted by your browser.
                                </p>
                              </div>

                              <button
                                onClick={requestMicrophonePermission}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-lg hover:shadow-green-500/30 transform hover:scale-[1.02] flex items-center justify-center gap-2"
                              >
                                <MicrophoneIcon className="w-4 h-4" />
                                Enable Microphone
                              </button>
                            </div>
                          )}

                          {micPermission === "checking" && (
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
                              <div className="flex items-center justify-center gap-2 mb-2">
                                <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-sm text-yellow-400 font-medium">
                                  Requesting Permission...
                                </p>
                              </div>
                              <p className="text-xs text-yellow-300/80">
                                Please respond to your browser's permission
                                prompt
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Recording Controls */}
                        <div className="flex justify-center space-x-4 mb-6">
                          {!isRecording ? (
                            <button
                              onClick={() => {
                                if (
                                  micPermission === "denied" ||
                                  micPermission === "prompt"
                                ) {
                                  setShowMicModal(true);
                                } else {
                                  handleStartRecording();
                                }
                              }}
                              className="relative group"
                            >
                              <div
                                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 group-hover:scale-105 ${
                                  micPermission === "denied" ||
                                  micPermission === "prompt"
                                    ? "bg-orange-500 hover:bg-orange-600 cursor-pointer"
                                    : "bg-gradient-to-br from-red-500 to-red-600 group-hover:shadow-red-500/30 group-hover:shadow-2xl"
                                }`}
                              >
                                <MicrophoneIconSolid className="w-8 h-8 text-white" />
                              </div>
                              {micPermission !== "denied" && (
                                <div className="absolute -inset-2 bg-red-500/20 rounded-full opacity-0 group-hover:opacity-100 animate-ping"></div>
                              )}
                            </button>
                          ) : (
                            <div className="flex items-center space-x-4">
                              {/* Mute/Unmute Button */}
                              <button
                                onClick={
                                  isPaused
                                    ? handleResumeRecording
                                    : handlePauseRecording
                                }
                                className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-105 bg-gradient-to-br from-blue-500 to-blue-600 hover:shadow-blue-500/30 hover:shadow-xl"
                              >
                                {isPaused ? (
                                  <MicrophoneIconSolid className="w-6 h-6 text-white" />
                                ) : (
                                  <div className="relative">
                                    <MicrophoneIconSolid className="w-5 h-5 text-white" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="w-6 h-0.5 bg-red-500 rotate-45 rounded-full"></div>
                                    </div>
                                  </div>
                                )}
                              </button>

                              {/* Stop Button */}
                              <button
                                onClick={handleStopRecording}
                                className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-105 bg-gradient-to-br from-gray-600 to-gray-700 hover:shadow-gray-500/30 hover:shadow-xl"
                              >
                                <StopIcon className="w-5 h-5 text-white" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Status Text */}
                        <div className="text-center mb-6">
                          <p className="text-sm text-white/60">
                            {!isRecording
                              ? micPermission === "denied"
                                ? "🎙️ Click to enable microphone access"
                                : micPermission === "prompt"
                                  ? "🎤 Click to request microphone permission"
                                  : micPermission === "checking"
                                    ? "⏳ Requesting microphone access..."
                                    : "🎙️ Click to start live audio processing"
                              : isPaused
                                ? "🔇 Recording muted - click to resume"
                                : "🔴 Recording in progress..."}
                          </p>
                          {isRecording && (
                            <div className="mt-2 text-xs text-white/40">
                              Duration: {formatDuration(recordingTime)}
                            </div>
                          )}
                        </div>

                        {/* Audio Visualization */}
                        <div className="border-t border-white/10 pt-6 flex-1">
                          <h4 className="text-md font-semibold text-white mb-4">
                            Audio Visualization
                          </h4>
                          {isRecording && (
                            <div className="space-y-2 mb-4">
                              <div className="space-y-1">
                                <p className="text-sm text-white/60">
                                  Level:{" "}
                                  {Math.round(
                                    (manualAudioLevel !== null
                                      ? manualAudioLevel
                                      : audioLevel || 0) * 100,
                                  )}
                                  % • {formatDuration(recordingTime)}
                                  {manualAudioLevel !== null && (
                                    <span className="text-blue-400 ml-1">
                                      (Manual)
                                    </span>
                                  )}
                                </p>
                                <div className="flex items-center justify-center space-x-4 text-xs">
                                  <span className="text-white/40">
                                    Data: {audioData ? "✓" : "✗"}
                                  </span>
                                  <span className="text-white/40">
                                    Quality: {audioQuality}
                                  </span>
                                  <button
                                    onClick={testAudioVisualization}
                                    className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white/80 transition-colors"
                                  >
                                    Debug
                                  </button>
                                  <button
                                    onClick={testManualAudioLevel}
                                    className="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 rounded text-blue-400/60 hover:text-blue-400/80 transition-colors"
                                  >
                                    Test Level
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center justify-center space-x-2">
                                <div
                                  className={`w-2 h-2 rounded-full ${
                                    audioQuality === "excellent"
                                      ? "bg-green-500"
                                      : audioQuality === "good"
                                        ? "bg-blue-500"
                                        : audioQuality === "fair"
                                          ? "bg-yellow-500"
                                          : "bg-red-500"
                                  }`}
                                ></div>
                                <span className="text-xs text-white/60 capitalize">
                                  {audioQuality} Quality
                                </span>
                              </div>
                            </div>
                          )}
                          {renderAudioVisualizer()}
                        </div>
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
              className="space-y-6 min-h-[480px] flex flex-col"
            >
              <div
                ref={transcriptContainerRef}
                className="transcript-container h-96 overflow-y-auto scroll-mt-20"
              >
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
              <div
                className={`glass rounded-2xl p-4 ${isRecording && activeTab === "record" ? "flex-1" : "flex-[2]"}`}
              >
                <h4 className="text-sm font-semibold text-white/80 mb-3">
                  Statistics
                </h4>
                {finalTranscript || transcripts.length > 0 ? (
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
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="text-white/40 mb-2">📊</div>
                    <p className="text-sm text-white/50">
                      Statistics will appear after transcription
                    </p>
                    <p className="text-xs text-white/40 mt-1">
                      Start recording or upload a file to see results
                    </p>
                  </div>
                )}
              </div>

              {/* Streaming Status */}
              {isRecording && activeTab === "record" && (
                <div className="glass rounded-2xl p-6 flex-1">
                  <div className="text-center mb-4">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      Streaming Status
                    </h3>
                    {isRecovering && (
                      <div className="mb-4 p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                          <span className="text-sm text-yellow-200">
                            Recovering Connection... (Attempt {recoveryAttempts}
                            /5)
                          </span>
                        </div>
                        {pendingChunks.length > 0 && (
                          <div className="text-xs text-yellow-300 mt-1">
                            {pendingChunks.length} chunks buffered
                          </div>
                        )}
                        {bufferedTranscripts.length > 0 && (
                          <div className="text-xs text-yellow-300 mt-1">
                            {bufferedTranscripts.length} transcripts preserved
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-400">
                          {chunksStreamed}
                        </div>
                        <div className="text-xs text-white/60">Chunks Sent</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-400">
                          {streamingRate.toFixed(1)}
                        </div>
                        <div className="text-xs text-white/60">Chunks/sec</div>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-center space-x-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isRecovering
                            ? "bg-yellow-500 animate-pulse"
                            : connectionStatus.state === "connected"
                              ? "bg-green-500 animate-pulse"
                              : "bg-red-500"
                        }`}
                      ></div>
                      <span className="text-sm text-white/80">
                        {isRecovering
                          ? "Reconnecting to FANO"
                          : connectionStatus.state === "connected"
                            ? "Live Streaming to FANO"
                            : "Connection Lost"}
                      </span>
                      <div className="text-xs text-white/60">
                        ({(bytesStreamed / 1024).toFixed(1)}KB sent)
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {/* Microphone Permission Modal */}
        <AnimatePresence>
          {showMicModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowMicModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-gradient-to-br from-gray-900 to-black border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MicrophoneIcon className="w-8 h-8 text-white" />
                  </div>

                  <h3 className="text-xl font-bold text-white mb-2">
                    Microphone Access Required
                  </h3>

                  <p className="text-gray-300 text-sm mb-6">
                    To use live recording, please enable microphone access for
                    this website.
                  </p>

                  {micPermission === "denied" && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 text-left">
                      <p className="text-red-400 text-sm font-medium mb-2">
                        Manual Setup Required
                      </p>
                      <div className="text-xs text-red-300/80 space-y-1">
                        <p>
                          1. Click the 🔒 or 🎙️ icon in your browser's address
                          bar
                        </p>
                        <p>2. Select "Allow" for microphone access</p>
                        <p>3. Refresh the page if needed</p>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowMicModal(false)}
                      className="flex-1 px-4 py-2 text-gray-400 hover:text-white transition-colors border border-gray-600 hover:border-gray-500 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setShowMicModal(false);
                        await requestMicrophonePermission();
                      }}
                      className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white font-medium rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-lg hover:shadow-green-500/30"
                    >
                      Enable Access
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toast Notifications */}
        <div className="fixed top-20 right-4 z-50 space-y-2">
          <AnimatePresence>
            {toasts.map((toast) => renderToast(toast))}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
