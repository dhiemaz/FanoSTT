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
  onError?: (error: AudioProcessingError) => void;
  onStateChange?: (state: RecordingState) => void;
}

export function useAudioRecorder({
  sampleRate = 16000,
  channels = 1,
  bitDepth = 16,
  chunkDuration = 100, // ms
  enableVisualization = true,
  onAudioChunk,
  onError,
  onStateChange,
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
  const recordingStartTimeRef = useRef<number>(0);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const visualizationFrameRef = useRef<number>();

  // Audio processing buffers
  const audioBufferRef = useRef<Float32Array[]>([]);
  const chunkSizeRef = useRef<number>(0);

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

  // Process audio chunk
  const processAudioChunk = useCallback(
    (inputBuffer: AudioBuffer) => {
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

        // Notify parent component
        onAudioChunk?.(chunk);

        // Calculate audio level
        let sum = 0;
        for (let i = 0; i < resampledData.length; i++) {
          const sample = resampledData[i] || 0;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / resampledData.length);
        const level = Math.min(Math.max(rms * 10, 0), 1);
        setAudioLevel(level);
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
    if (!enableVisualization || !analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    const updateVisualization = () => {
      if (!analyser || !isRecording) return;

      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeData);

      // Calculate volume
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const sample = (timeData[i] || 0) - 128;
        sum += sample * sample;
      }
      const volume = Math.sqrt(sum / timeData.length) / 128;

      setAudioData({
        frequencyData: new Uint8Array(frequencyData),
        timeData: new Uint8Array(timeData),
        volume,
      });

      if (isRecording) {
        visualizationFrameRef.current =
          requestAnimationFrame(updateVisualization);
      }
    };

    updateVisualization();
  }, [enableVisualization, isRecording]);

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

      // Create analyser for visualization
      if (enableVisualization) {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
      }

      // Create audio source
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create script processor for audio chunks
      const processor = audioContext.createScriptProcessor(
        4096,
        channels,
        channels,
      );
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (isRecording && !isPaused) {
          processAudioChunk(event.inputBuffer);
        }
      };

      // Connect nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      if (analyserRef.current) {
        source.connect(analyserRef.current);
      }

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
    setAudioLevel(0);
    setAudioData(undefined);
  }, [stopTimer]);

  // Start recording
  const startRecording = useCallback(async (): Promise<void> => {
    try {
      setError(undefined);

      await initializeAudio();

      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      startTimer();
      setupVisualization();

      updateState("recording");
    } catch (err) {
      cleanup();
      throw err;
    }
  }, [initializeAudio, startTimer, setupVisualization, updateState, cleanup]);

  // Stop recording
  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setIsPaused(false);
    stopTimer();

    if (visualizationFrameRef.current) {
      cancelAnimationFrame(visualizationFrameRef.current);
    }

    updateState("stopped");
    cleanup();
  }, [stopTimer, cleanup, updateState]);

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (!isRecording) return;

    setIsPaused(true);
    stopTimer();

    if (visualizationFrameRef.current) {
      cancelAnimationFrame(visualizationFrameRef.current);
    }

    updateState("paused");
  }, [isRecording, stopTimer, updateState]);

  // Resume recording
  const resumeRecording = useCallback(() => {
    if (!isRecording || !isPaused) return;

    setIsPaused(false);
    startTimer();
    setupVisualization();

    updateState("recording");
  }, [isRecording, isPaused, startTimer, setupVisualization, updateState]);

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
