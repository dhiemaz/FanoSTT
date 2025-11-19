import {
  AudioConfig,
  AudioChunk,
  SupportedAudioFormat,
  SUPPORTED_AUDIO_FORMATS,
  AudioProcessingError,
} from "@/types";

/**
 * Audio utility functions for processing and formatting
 */

// Constants
export const BYTES_PER_SAMPLE = {
  8: 1,
  16: 2,
  24: 3,
  32: 4,
} as const;

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 48000;
export const DEFAULT_CHUNK_SIZE = 4096;

/**
 * Validate audio file format
 */
export function isValidAudioFormat(file: File): boolean {
  return SUPPORTED_AUDIO_FORMATS.includes(file.type as SupportedAudioFormat);
}

/**
 * Validate audio file size
 */
export function isValidFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE;
}

/**
 * Get audio file metadata
 */
export async function getAudioMetadata(file: File): Promise<AudioConfig> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);

      // Basic metadata from HTML5 Audio API
      const config: AudioConfig = {
        sampleRate: 44100, // Default, actual value would need Web Audio API
        channels: 2, // Default, actual value would need Web Audio API
        bitDepth: 16, // Default assumption
        encoding: file.type,
      };

      resolve(config);
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new AudioProcessingError("Failed to load audio metadata"));
    });

    audio.src = url;
  });
}

/**
 * Get detailed audio metadata using Web Audio API
 */
export async function getDetailedAudioMetadata(
  file: File,
): Promise<AudioConfig> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const config: AudioConfig = {
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      bitDepth: 32, // AudioBuffer uses 32-bit float
      encoding: file.type,
    };

    audioContext.close();
    return config;
  } catch (error) {
    throw new AudioProcessingError(`Failed to analyze audio file: ${error}`);
  }
}

/**
 * Convert Float32Array to Int16Array (LINEAR16 format)
 */
export function float32ToInt16(buffer: Float32Array): Int16Array {
  const int16Buffer = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, buffer[i] || 0));
    int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16Buffer;
}

/**
 * Convert Int16Array to Float32Array
 */
export function int16ToFloat32(buffer: Int16Array): Float32Array {
  const float32Buffer = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i] || 0;
    float32Buffer[i] = sample / (sample < 0 ? 0x8000 : 0x7fff);
  }
  return float32Buffer;
}

/**
 * Resample audio buffer to target sample rate
 */
export function resampleBuffer(
  buffer: Float32Array,
  fromSampleRate: number,
  toSampleRate: number,
): Float32Array {
  if (fromSampleRate === toSampleRate) {
    return buffer;
  }

  const sampleRateRatio = fromSampleRate / toSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  // Linear interpolation resampling
  for (let i = 0; i < newLength; i++) {
    const index = i * sampleRateRatio;
    const indexFloor = Math.floor(index);
    const indexCeil = Math.min(Math.ceil(index), buffer.length - 1);

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
}

/**
 * Convert stereo to mono
 */
export function stereoToMono(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
): Float32Array {
  const length = Math.min(leftChannel.length, rightChannel.length);
  const mono = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    mono[i] = ((leftChannel[i] || 0) + (rightChannel[i] || 0)) * 0.5;
  }

  return mono;
}

/**
 * Convert audio buffer to base64 string
 */
export function audioBufferToBase64(buffer: Int16Array): string {
  const bytes = new Uint8Array(buffer.buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks to avoid call stack overflow

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary);
}

/**
 * Convert base64 string to audio buffer
 */
export function base64ToAudioBuffer(base64: string): Int16Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Int16Array(bytes.buffer);
  } catch (error) {
    throw new AudioProcessingError(
      `Failed to decode base64 audio data: ${error}`,
    );
  }
}

/**
 * Calculate audio duration from buffer
 */
export function calculateDuration(
  bufferLength: number,
  sampleRate: number,
): number {
  return (bufferLength / sampleRate) * 1000; // Return duration in milliseconds
}

/**
 * Calculate RMS (Root Mean Square) volume level
 */
export function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i] || 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Calculate peak volume level
 */
export function calculatePeak(buffer: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i] || 0);
    if (abs > peak) {
      peak = abs;
    }
  }
  return peak;
}

/**
 * Normalize audio buffer
 */
export function normalizeBuffer(
  buffer: Float32Array,
  targetLevel: number = 0.8,
): Float32Array {
  const peak = calculatePeak(buffer);
  if (peak === 0) return buffer;

  const scaleFactor = targetLevel / peak;
  const normalized = new Float32Array(buffer.length);

  for (let i = 0; i < buffer.length; i++) {
    normalized[i] = (buffer[i] || 0) * scaleFactor;
  }

  return normalized;
}

/**
 * Apply fade in/out to audio buffer
 */
export function applyFade(
  buffer: Float32Array,
  fadeInSamples: number = 0,
  fadeOutSamples: number = 0,
): Float32Array {
  const result = new Float32Array(buffer);

  // Apply fade in
  for (let i = 0; i < Math.min(fadeInSamples, buffer.length); i++) {
    const factor = i / (fadeInSamples || 1);
    result[i] = (result[i] || 0) * factor;
  }

  // Apply fade out
  const fadeOutStart = buffer.length - fadeOutSamples;
  for (let i = fadeOutStart; i < buffer.length; i++) {
    const factor = (buffer.length - i) / (fadeOutSamples || 1);
    result[i] = (result[i] || 0) * factor;
  }

  return result;
}

/**
 * Create WAV file from audio data
 */
export function createWAVFile(
  audioData: Int16Array,
  sampleRate: number,
  channels: number = 1,
  bitDepth: number = 16,
): Blob {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = audioData.length * 2; // 2 bytes per sample for Int16
  const fileSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF"); // ChunkID
  view.setUint32(4, fileSize, true); // ChunkSize
  writeString(8, "WAVE"); // Format
  writeString(12, "fmt "); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, channels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample
  writeString(36, "data"); // Subchunk2ID
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Audio data
  let offset = 44;
  for (let i = 0; i < audioData.length; i++) {
    view.setInt16(offset, audioData[i] || 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Split audio into chunks
 */
export function splitAudioIntoChunks(
  buffer: Int16Array,
  chunkDurationMs: number,
  sampleRate: number,
): AudioChunk[] {
  const samplesPerChunk = Math.floor((sampleRate * chunkDurationMs) / 1000);
  const chunks: AudioChunk[] = [];

  for (let i = 0; i < buffer.length; i += samplesPerChunk) {
    const end = Math.min(i + samplesPerChunk, buffer.length);
    const chunkData = buffer.slice(i, end);

    chunks.push({
      data: chunkData.buffer,
      timestamp: Date.now(),
      duration: (chunkData.length / sampleRate) * 1000,
    });
  }

  return chunks;
}

/**
 * Merge audio chunks
 */
export function mergeAudioChunks(chunks: AudioChunk[]): Int16Array {
  const totalLength = chunks.reduce((sum, chunk) => {
    return sum + new Int16Array(chunk.data).length;
  }, 0);

  const merged = new Int16Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    const chunkData = new Int16Array(chunk.data);
    merged.set(chunkData, offset);
    offset += chunkData.length || 0;
  });

  return merged;
}

/**
 * Detect silence in audio buffer
 */
export function detectSilence(
  buffer: Float32Array,
  threshold: number = 0.01,
  minSilenceDuration: number = 1000, // ms
  sampleRate: number = 16000,
): Array<{ start: number; end: number }> {
  const minSilenceSamples = Math.floor(
    (minSilenceDuration * sampleRate) / 1000,
  );
  const silenceRegions: Array<{ start: number; end: number }> = [];

  let silenceStart = -1;
  let silenceSampleCount = 0;

  for (let i = 0; i < buffer.length; i++) {
    const isSilent = Math.abs(buffer[i] || 0) < threshold;

    if (isSilent) {
      if (silenceStart === -1) {
        silenceStart = i;
      }
      silenceSampleCount++;
    } else {
      if (silenceStart !== -1 && silenceSampleCount >= minSilenceSamples) {
        silenceRegions.push({
          start: (silenceStart / sampleRate) * 1000,
          end: (i / sampleRate) * 1000,
        });
      }
      silenceStart = -1;
      silenceSampleCount = 0;
    }
  }

  // Handle silence at the end
  if (silenceStart !== -1 && silenceSampleCount >= minSilenceSamples) {
    silenceRegions.push({
      start: (silenceStart / sampleRate) * 1000,
      end: (buffer.length / sampleRate) * 1000,
    });
  }

  return silenceRegions;
}

/**
 * Format time duration
 */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const ms = Math.floor((milliseconds % 1000) / 10);

  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  } else {
    return `${seconds}.${ms.toString().padStart(2, "0")}s`;
  }
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Get audio format display name
 */
export function getAudioFormatName(mimeType: string): string {
  const formatMap: Record<string, string> = {
    "audio/wav": "WAV",
    "audio/mpeg": "MP3",
    "audio/mp3": "MP3",
    "audio/ogg": "OGG",
    "audio/flac": "FLAC",
    "audio/m4a": "M4A",
    "audio/aac": "AAC",
  };

  return formatMap[mimeType] || mimeType.toUpperCase();
}

/**
 * Validate audio configuration
 */
export function validateAudioConfig(config: Partial<AudioConfig>): string[] {
  const errors: string[] = [];

  if (
    config.sampleRate &&
    (config.sampleRate < MIN_SAMPLE_RATE || config.sampleRate > MAX_SAMPLE_RATE)
  ) {
    errors.push(
      `Sample rate must be between ${MIN_SAMPLE_RATE} and ${MAX_SAMPLE_RATE} Hz`,
    );
  }

  if (config.channels && (config.channels < 1 || config.channels > 8)) {
    errors.push("Channels must be between 1 and 8");
  }

  if (config.bitDepth && ![8, 16, 24, 32].includes(config.bitDepth)) {
    errors.push("Bit depth must be 8, 16, 24, or 32");
  }

  return errors;
}

/**
 * Check if Web Audio API is supported
 */
export function isWebAudioSupported(): boolean {
  return !!(window.AudioContext || (window as any).webkitAudioContext);
}

/**
 * Check if MediaStream API is supported
 */
export function isMediaStreamSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Get optimal audio settings for the current device
 */
export async function getOptimalAudioSettings(): Promise<Partial<AudioConfig>> {
  try {
    if (!isMediaStreamSupported()) {
      throw new AudioProcessingError("MediaStream API not supported");
    }

    // Test different sample rates to find the best supported one
    const testRates = [16000, 22050, 44100, 48000];
    let bestRate = 16000;

    for (const rate of testRates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: rate },
        });
        stream.getTracks().forEach((track) => track.stop());
        bestRate = rate;
        break;
      } catch {
        // Continue to next rate
      }
    }

    return {
      sampleRate: bestRate,
      channels: 1, // Mono for STT
      bitDepth: 16,
      encoding: "LINEAR16",
    };
  } catch (error) {
    throw new AudioProcessingError(
      `Failed to determine optimal audio settings: ${error}`,
    );
  }
}

/**
 * Create audio visualization data from buffer
 */
export function createVisualizationData(
  buffer: Float32Array,
  fftSize: number = 256,
): { frequencies: number[]; waveform: number[] } {
  // Simple frequency analysis using basic FFT approximation
  const frequencies: number[] = [];
  const waveform: number[] = [];

  // Downsample waveform for visualization
  const step = Math.max(1, Math.floor(buffer.length / 100));
  for (let i = 0; i < buffer.length; i += step) {
    waveform.push(buffer[i] || 0);
  }

  // Create frequency bins (simplified)
  const binSize = Math.floor(buffer.length / fftSize);
  for (let i = 0; i < fftSize / 2; i++) {
    let sum = 0;
    const start = i * binSize;
    const end = Math.min(start + binSize, buffer.length);

    for (let j = start; j < end; j++) {
      sum += Math.abs(buffer[j] || 0);
    }

    frequencies.push(sum / (end - start || 1));
  }

  return { frequencies, waveform };
}
