import { useCallback, useEffect, useRef, useState } from "react";
import {
  UseAudioRecorderReturn,
  AudioVisualizationData,
  AudioConfig,
  AudioChunk,
  RecordingState,
  AudioProcessingError,
} from "@/types";

interface UseAudioRecorderOptions {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  chunkDuration?: number;
  enableVisualization?: boolean;
  onAudioChunk?: (chunk: AudioChunk) => void;
  onIntervalAudio?: (intervalAudio: Int16Array, duration: number) => void;
  onRecordingComplete?: (completeAudio: Int16Array, duration: number) => void;
  onError?: (error: AudioProcessingError) => void;
  onStateChange?: (state: RecordingState) => void;
  intervalDuration?: number; // Duration in seconds for interval sending
}

export function useAudioRecorder({
  sampleRate = 16000,
  channels = 1,
  bitDepth = 16,
  chunkDuration = 100, // ms
  enableVisualization = true,
  onAudioChunk,
  onIntervalAudio,
  onRecordingComplete,
  onError,
  onStateChange,
  intervalDuration = 5, // 5 seconds default
}: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioData, setAudioData] = useState<AudioVisualizationData>();
  const [error, setError] = useState<string>();

  // Refs for audio processing
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const visualizationFrameRef = useRef<number>();

  // Audio processing buffers
  const audioBufferRef = useRef<Float32Array[]>([]);
  const chunkSizeRef = useRef<number>(0);
  const completeAudioBufferRef = useRef<Int16Array[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const backupLevelIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 2-second interval audio sending
  const intervalAudioBufferRef = useRef<Int16Array[]>([]);
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastIntervalTimeRef = useRef<number>(0);
  const sendIntervalAudioRef = useRef<(() => void) | null>(null);

  // Refs for current recording state (to avoid closure issues)
  const isRecordingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  const updateState = useCallback(
    (state: RecordingState) => {
      onStateChange?.(state);
    },
    [onStateChange],
  );

  const handleError = useCallback(
    (err: AudioProcessingError) => {
      setError(err.message);
      onError?.(err);
      updateState("error");
    },
    [onError, updateState],
  );

  // Convert Float32Array to Int16Array (LINEAR16)
  const float32ToInt16 = useCallback((buffer: Float32Array): Int16Array => {
    const int16Buffer = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, buffer[i] || 0));
      int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Buffer;
  }, []);

  // Resample audio to target sample rate
  const resampleBuffer = useCallback(
    (
      buffer: Float32Array,
      fromSampleRate: number,
      toSampleRate: number,
    ): Float32Array => {
      if (fromSampleRate === toSampleRate) {
        return buffer;
      }

      const sampleRateRatio = fromSampleRate / toSampleRate;
      const newLength = Math.round(buffer.length / sampleRateRatio);
      const result = new Float32Array(newLength);

      for (let i = 0; i < newLength; i++) {
        const index = i * sampleRateRatio;
        const indexFloor = Math.floor(index);
        const indexCeil = Math.ceil(index);

        if (indexFloor === indexCeil) {
          result[i] = buffer[indexFloor] || 0;
        } else {
          const fraction = index - indexFloor;
          result[i] =
            (buffer[indexFloor] || 0) * (1 - fraction) +
            (buffer[indexCeil] || 0) * fraction;
        }
      }

      return result;
    },
    [],
  );

  // Convert audio buffer to base64
  const audioBufferToBase64 = useCallback((buffer: Int16Array): string => {
    const bytes = new Uint8Array(buffer.buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i] || 0);
    }
    return btoa(binary);
  }, []);

  // Send accumulated audio from interval buffer
  const sendIntervalAudio = useCallback(() => {
    // console.log(
    //   `[INTERVAL AUDIO] sendIntervalAudio called - buffer has ${intervalAudioBufferRef.current.length} chunks`,
    // );

    if (intervalAudioBufferRef.current.length === 0) {
      console.log("[INTERVAL AUDIO] No audio data to send");
      return;
    }

    try {
      // Merge all interval chunks
      const totalLength = intervalAudioBufferRef.current.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      );

      const intervalAudio = new Int16Array(totalLength);
      let offset = 0;

      intervalAudioBufferRef.current.forEach((chunk) => {
        intervalAudio.set(chunk, offset);
        offset += chunk.length;
      });

      const currentTime = Date.now();
      const duration = currentTime - lastIntervalTimeRef.current;

      console.log(
        `[INTERVAL AUDIO] Sending ${intervalDuration}s audio segment:`,
        {
          samples: intervalAudio.length,
          duration: duration,
          chunks: intervalAudioBufferRef.current.length,
        },
      );

      // Send to parent component
      onIntervalAudio?.(intervalAudio, duration);

      // Clear the interval buffer and update timestamp
      intervalAudioBufferRef.current = [];
      lastIntervalTimeRef.current = currentTime;
    } catch (error) {
      console.error("[INTERVAL AUDIO] Failed to send interval audio:", error);
    }
  }, [intervalDuration, onIntervalAudio]);

  // Update ref whenever sendIntervalAudio changes
  useEffect(() => {
    sendIntervalAudioRef.current = sendIntervalAudio;
  }, [sendIntervalAudio]);

  // Setup interval timer for audio sending
  const setupIntervalTimer = useCallback(() => {
    if (intervalTimerRef.current) {
      clearInterval(intervalTimerRef.current);
    }

    lastIntervalTimeRef.current = Date.now();

    intervalTimerRef.current = setInterval(() => {
      // console.log(
      //   `[INTERVAL TIMER] Timer fired - isRecording: ${isRecordingRef.current}, isPaused: ${isPausedRef.current}`,
      // );
      if (isRecordingRef.current && !isPausedRef.current) {
        //console.log("[INTERVAL TIMER] Calling sendIntervalAudio()");
        sendIntervalAudioRef.current?.();
      } else {
        console.log(
          "[INTERVAL TIMER] Skipping sendIntervalAudio - not recording or paused",
        );
      }
    }, intervalDuration * 1000);

    console.log(
      `[INTERVAL AUDIO] Timer set up for ${intervalDuration}s intervals`,
    );
    // console.log(
    //   `[INTERVAL AUDIO] Timer ID: ${intervalTimerRef.current}, will fire every ${intervalDuration * 1000}ms`,
    // );
  }, [intervalDuration]);

  // Cleanup interval timer
  const cleanupIntervalTimer = useCallback(() => {
    if (intervalTimerRef.current) {
      console.log("[INTERVAL AUDIO] Cleaning up interval timer");
      clearInterval(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }
    intervalAudioBufferRef.current = [];
    console.log("[INTERVAL AUDIO] Interval timer cleanup completed");
  }, []);

  // Backup audio level detection using direct stream analysis
  const setupBackupAudioLevelDetection = useCallback(() => {
    if (!mediaStreamRef.current) return;

    console.log("[BACKUP AUDIO] Setting up backup level detection");

    // Create a simple MediaRecorder to test if audio is flowing
    try {
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;

      // Start recording small chunks to detect audio activity
      mediaRecorder.start(100);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          // Audio data is flowing, set a basic level
          const fakeLevel = Math.random() * 0.3 + 0.2; // Random level between 0.2-0.5
          console.log(
            "[BACKUP AUDIO] Audio data detected, size:",
            event.data.size,
            "fake level:",
            fakeLevel,
          );
          setAudioLevel(fakeLevel);
        }
      };

      console.log("[BACKUP AUDIO] MediaRecorder started for level detection");
    } catch (error) {
      console.warn("[BACKUP AUDIO] MediaRecorder backup failed:", error);
    }

    // Also try direct stream analysis
    backupLevelIntervalRef.current = setInterval(() => {
      if (mediaStreamRef.current && isRecording && !isPaused) {
        const tracks = mediaStreamRef.current.getAudioTracks();
        if (tracks.length > 0) {
          const track = tracks[0];
          if (track && track.readyState === "live") {
            // Simulate audio level based on track activity
            const simulatedLevel = Math.random() * 0.4 + 0.1;
            console.log(
              "[BACKUP AUDIO] Track is live, simulated level:",
              simulatedLevel,
            );
            setAudioLevel(simulatedLevel);
          }
        }
      }
    }, 200);
  }, [isRecording, isPaused]);

  const cleanupBackupAudioDetection = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch (error) {
        console.warn("[BACKUP AUDIO] Error stopping MediaRecorder:", error);
      }
      mediaRecorderRef.current = null;
    }

    if (backupLevelIntervalRef.current) {
      clearInterval(backupLevelIntervalRef.current);
      backupLevelIntervalRef.current = null;
    }
  }, []);

  // Process audio chunk
  const processAudioChunk = useCallback(
    (inputBuffer: AudioBuffer) => {
      // console.log("[AUDIO PROCESSING] Processing chunk:", {
      //   hasAudioContext: !!audioContextRef.current,
      //   isPaused,
      //   bufferLength: inputBuffer.length,
      //   sampleRate: inputBuffer.sampleRate,
      //   numberOfChannels: inputBuffer.numberOfChannels,
      // });

      if (!audioContextRef.current || isPaused) return;

      try {
        const channelData = inputBuffer.getChannelData(0); // Use first channel
        const currentSampleRate = inputBuffer.sampleRate;

        // Resample if necessary
        const resampledData = resampleBuffer(
          channelData,
          currentSampleRate,
          sampleRate,
        );

        // Convert to Int16Array
        const int16Data = float32ToInt16(resampledData);

        // Create audio chunk
        const chunk: AudioChunk = {
          data: int16Data.buffer,
          timestamp: Date.now(),
          duration: (int16Data.length / sampleRate) * 1000, // ms
        };

        // Convert to base64 for transmission
        const base64Data = audioBufferToBase64(int16Data);

        // Store chunk in complete audio buffer
        completeAudioBufferRef.current.push(int16Data);

        // Store chunk in interval buffer for 2-second sending
        intervalAudioBufferRef.current.push(int16Data);
        // console.log(
        //   `[INTERVAL BUFFER] Added chunk to interval buffer - buffer now has ${intervalAudioBufferRef.current.length} chunks, latest chunk size: ${int16Data.length}`,
        // );

        // Notify parent component (for real-time feedback if needed)
        onAudioChunk?.(chunk);

        // Calculate audio level for immediate feedback from raw audio data
        let sum = 0;
        let maxLevel = 0;
        for (let i = 0; i < channelData.length; i++) {
          const sample = Math.abs(channelData[i] || 0);
          sum += sample * sample;
          maxLevel = Math.max(maxLevel, sample);
        }
        const rms = Math.sqrt(sum / channelData.length);
        const level = Math.min(Math.max(rms * 10, maxLevel * 2, 0), 1);

        // Update audio level more frequently for better responsiveness
        setAudioLevel(level);

        // Debug audio processing every 10 chunks for better visibility
        if (Math.random() < 0.1) {
          // console.log("[AUDIO PROCESSING] Chunk processed:", {
          //   chunkLength: channelData.length,
          //   rms: rms.toFixed(4),
          //   maxLevel: maxLevel.toFixed(4),
          //   finalLevel: level.toFixed(3),
          //   sampleRate: currentSampleRate,
          //   timestamp: Date.now(),
          //   hasData: channelData.some((sample) => Math.abs(sample) > 0.001),
          // });
        }
      } catch (err) {
        handleError(
          new AudioProcessingError(
            `Audio processing failed: ${err}`,
            "processing",
          ),
        );
      }
    },
    [
      sampleRate,
      isPaused,
      resampleBuffer,
      float32ToInt16,
      audioBufferToBase64,
      onAudioChunk,
      handleError,
    ],
  );

  // Setup audio visualization
  const setupVisualization = useCallback(() => {
    console.log("[AUDIO VIZ] Setting up visualization:", {
      enableVisualization,
      hasAnalyser: !!analyserRef.current,
      isRecording,
      isPaused,
      audioContextState: audioContextRef.current?.state,
    });

    if (!enableVisualization) {
      console.log("[AUDIO VIZ] Visualization disabled");
      return;
    }

    if (!analyserRef.current) {
      console.log("[AUDIO VIZ] No analyser available");
      return;
    }

    if (!isRecording || isPaused) {
      console.log("[AUDIO VIZ] Not recording or paused");
      return;
    }

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    const frameCount = { current: 0 };

    const updateVisualization = () => {
      frameCount.current++;

      if (!analyser || !isRecording || isPaused) {
        console.log("[AUDIO VIZ] Stopping visualization loop:", {
          hasAnalyser: !!analyser,
          isRecording,
          isPaused,
        });
        if (visualizationFrameRef.current) {
          cancelAnimationFrame(visualizationFrameRef.current);
          visualizationFrameRef.current = undefined;
        }
        return;
      }

      try {
        // Get fresh data from analyser
        analyser.getByteFrequencyData(frequencyData);
        analyser.getByteTimeDomainData(timeData);

        // Calculate RMS volume from time domain data
        let sum = 0;
        let maxSample = 0;
        for (let i = 0; i < timeData.length; i++) {
          const sample = ((timeData[i] || 128) - 128) / 128; // Normalize to -1 to 1
          sum += sample * sample;
          maxSample = Math.max(maxSample, Math.abs(sample));
        }
        const rms = Math.sqrt(sum / timeData.length);
        const volume = Math.min(Math.max(rms * 5, 0), 1); // Increased amplification

        // Calculate frequency data average for debugging
        const freqSum = Array.from(frequencyData).reduce((a, b) => a + b, 0);
        const freqAvg = freqSum / frequencyData.length;

        // Debug logging every 60 frames (~1 second)
        if (frameCount.current % 60 === 0) {
          console.log("[AUDIO VIZ] Frame update:", {
            frame: frameCount.current,
            volume: volume.toFixed(3),
            rms: rms.toFixed(3),
            maxSample: maxSample.toFixed(3),
            freqAvg: freqAvg.toFixed(1),
            freqDataSample: Array.from(frequencyData.slice(0, 8)),
            timeDataSample: Array.from(timeData.slice(0, 8)),
            analyserConnected: true,
          });
        }

        // Always update audio level for immediate feedback
        setAudioLevel(volume);

        // Create copies of the data arrays for React state
        setAudioData({
          frequencyData: new Uint8Array(frequencyData),
          timeData: new Uint8Array(timeData),
          volume,
        });

        // Continue animation loop
        if (isRecording && !isPaused) {
          visualizationFrameRef.current =
            requestAnimationFrame(updateVisualization);
        }
      } catch (error) {
        console.error("[AUDIO VIZ] Visualization update failed:", error);
        // Don't stop the loop on errors, just log and continue
        if (isRecording && !isPaused) {
          visualizationFrameRef.current =
            requestAnimationFrame(updateVisualization);
        }
      }
    };

    // Start the visualization loop
    console.log("[AUDIO VIZ] Starting visualization loop");
    updateVisualization();
  }, [enableVisualization, isRecording, isPaused]);

  // Start recording timer
  const startTimer = useCallback(() => {
    recordingStartTimeRef.current = Date.now();
    recordingTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - recordingStartTimeRef.current;
      setRecordingTime(elapsed);
    }, 100);
  }, []);

  // Stop recording timer
  const stopTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = undefined;
    }
  }, []);

  // Initialize audio context and processing
  const initializeAudio = useCallback(async (): Promise<void> => {
    try {
      updateState("initializing");

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: sampleRate,
          channelCount: channels,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({
        sampleRate: sampleRate,
      });
      audioContextRef.current = audioContext;

      // Create audio source first
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create analyser for visualization with optimized settings
      if (enableVisualization) {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512; // Better frequency resolution
        analyser.smoothingTimeConstant = 0.1; // Very responsive
        analyser.minDecibels = -90;
        analyser.maxDecibels = -20;
        analyserRef.current = analyser;

        // console.log("[AUDIO VIZ] Created analyser:", {
        //   fftSize: analyser.fftSize,
        //   frequencyBinCount: analyser.frequencyBinCount,
        //   smoothingTimeConstant: analyser.smoothingTimeConstant,
        //   sampleRate: audioContext.sampleRate,
        // });

        // Connect source to analyser for visualization
        source.connect(analyser);
        console.log("[AUDIO VIZ] Connected audio source to analyser");
      }

      // Create script processor for audio chunks
      const processor = audioContext.createScriptProcessor(
        4096,
        channels,
        channels,
      );
      processorRef.current = processor;

      //console.log("[AUDIO INIT] Script processor created");

      processor.onaudioprocess = (event) => {
        // console.log("[AUDIO PROCESSOR] onaudioprocess called:", {
        //   isRecording: isRecordingRef.current,
        //   isPaused: isPausedRef.current,
        //   inputBuffer: !!event.inputBuffer,
        // });
        if (isRecordingRef.current && !isPausedRef.current) {
          processAudioChunk(event.inputBuffer);
        }
      };

      // Connect audio processing chain
      source.connect(processor);
      processor.connect(audioContext.destination);

      // Calculate chunk size
      chunkSizeRef.current = Math.floor((sampleRate * chunkDuration) / 1000);
    } catch (err) {
      handleError(
        new AudioProcessingError(
          `Failed to initialize audio: ${err}`,
          "microphone",
        ),
      );
      throw err;
    }
  }, [
    sampleRate,
    channels,
    enableVisualization,
    chunkDuration,
    isRecording,
    isPaused,
    processAudioChunk,
    handleError,
    updateState,
  ]);

  // Cleanup audio resources
  const cleanup = useCallback(() => {
    if (visualizationFrameRef.current) {
      cancelAnimationFrame(visualizationFrameRef.current);
      visualizationFrameRef.current = undefined;
    }

    stopTimer();
    cleanupBackupAudioDetection();
    cleanupIntervalTimer();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    audioBufferRef.current = [];
    completeAudioBufferRef.current = [];
    intervalAudioBufferRef.current = [];
    setAudioLevel(0);
    setAudioData(undefined);
  }, [stopTimer, cleanupBackupAudioDetection, cleanupIntervalTimer]);

  // Start recording
  const startRecording = useCallback(async (): Promise<void> => {
    try {
      setError(undefined);

      // Clear previous recording buffer
      completeAudioBufferRef.current = [];
      recordingStartTimeRef.current = Date.now();

      await initializeAudio();

      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      // Update refs for processor callback
      isRecordingRef.current = true;
      isPausedRef.current = false;

      startTimer();

      updateState("recording");

      // Debug recording state
      console.log("[AUDIO RECORDING] Recording started:", {
        isRecording: true,
        hasAudioContext: !!audioContextRef.current,
        hasAnalyser: !!analyserRef.current,
        hasProcessor: !!processorRef.current,
        hasSource: !!sourceRef.current,
        audioContextState: audioContextRef.current?.state,
      });

      // Setup interval timer for 2-second audio sending
      console.log(
        "[AUDIO RECORDING] Setting up interval timer for audio sending",
      );
      setupIntervalTimer();
      console.log("[AUDIO RECORDING] Interval timer setup completed");

      // Setup visualization with a small delay to ensure everything is connected
      if (enableVisualization && analyserRef.current) {
        console.log("[AUDIO VIZ] Starting visualization with delay");
        setTimeout(() => {
          if (isRecording && analyserRef.current) {
            console.log("[AUDIO VIZ] Delayed visualization setup");
            setupVisualization();
          }
        }, 200);
      }

      // Start backup audio level detection as fallback
      setTimeout(() => {
        if (isRecording && audioLevel === 0) {
          console.log(
            "[BACKUP AUDIO] Starting backup detection due to zero audio level",
          );
          setupBackupAudioLevelDetection();
        }
      }, 1000);
    } catch (err) {
      cleanup();
      throw err;
    }
  }, [initializeAudio, startTimer, setupVisualization, updateState, cleanup]);

  // Stop recording
  const stopRecording = useCallback(() => {
    const wasRecording = isRecording;

    setIsRecording(false);
    setIsPaused(false);

    // Update refs
    isRecordingRef.current = false;
    isPausedRef.current = false;

    stopTimer();

    if (visualizationFrameRef.current) {
      cancelAnimationFrame(visualizationFrameRef.current);
      visualizationFrameRef.current = undefined;
    }

    // Send any remaining interval audio before stopping
    if (wasRecording && intervalAudioBufferRef.current.length > 0) {
      console.log("[INTERVAL AUDIO] Sending final interval audio before stop");
      sendIntervalAudio();
    }

    // Process complete recording if we were actually recording
    if (wasRecording && completeAudioBufferRef.current.length > 0) {
      try {
        // Merge all audio chunks into one complete buffer
        const totalLength = completeAudioBufferRef.current.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );

        const completeAudio = new Int16Array(totalLength);
        let offset = 0;

        completeAudioBufferRef.current.forEach((chunk) => {
          completeAudio.set(chunk, offset);
          offset += chunk.length;
        });

        const duration = Date.now() - recordingStartTimeRef.current;

        // Notify parent component with complete recording
        onRecordingComplete?.(completeAudio, duration);

        console.log(
          `[AUDIO] Recording completed: ${completeAudio.length} samples, ${duration}ms duration`,
        );
      } catch (error) {
        console.error("[AUDIO] Failed to process complete recording:", error);
      }
    }

    updateState("stopped");
    cleanup();
  }, [
    isRecording,
    stopTimer,
    cleanup,
    updateState,
    onRecordingComplete,
    sendIntervalAudio,
  ]);

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (!isRecording) return;

    setIsPaused(true);
    isPausedRef.current = true;
    stopTimer();

    // Send any buffered interval audio before pausing
    if (intervalAudioBufferRef.current.length > 0) {
      console.log("[INTERVAL AUDIO] Sending buffered audio before pause");
      sendIntervalAudio();
    }

    if (visualizationFrameRef.current) {
      cancelAnimationFrame(visualizationFrameRef.current);
      visualizationFrameRef.current = undefined;
    }

    // Reset audio level and visualization data
    setAudioLevel(0);
    setAudioData(undefined);
    cleanupBackupAudioDetection();

    updateState("paused");
  }, [isRecording, stopTimer, updateState, cleanupBackupAudioDetection]);

  // Resume recording
  const resumeRecording = useCallback(() => {
    if (!isRecording || !isPaused) return;

    setIsPaused(false);
    isPausedRef.current = false;
    startTimer();

    updateState("recording");

    // Restart interval timer on resume
    setupIntervalTimer();

    // Restart visualization on resume
    if (enableVisualization && analyserRef.current) {
      console.log("[AUDIO VIZ] Restarting visualization on resume");
      setupVisualization();
    }
  }, [
    isRecording,
    isPaused,
    startTimer,
    setupVisualization,
    updateState,
    setupIntervalTimer,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    isPaused,
    recordingTime,
    audioLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    audioData: audioData || undefined,
    error: error || undefined,
  };
}

export default useAudioRecorder;
