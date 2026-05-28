/**
 * AudioWorklet processor for capturing raw 16-bit PCM audio from the
 * microphone and sending it to the main thread in fixed-size chunks.
 *
 * This file runs in the AudioWorklet thread. It accumulates samples
 * and posts ArrayBuffer messages to the main thread at regular intervals.
 *
 * Must be loaded via: audioContext.audioWorklet.addModule('/audio-capture-processor.js')
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  /** Buffer to accumulate samples — send every ~100ms (1600 samples at 16kHz) */
  _buffer = new Float32Array(0);
  _chunkSize = 1600; // 100ms at 16kHz — but sampleRate might be 44.1/48kHz

  constructor() {
    super();
    // At 16kHz we want 100ms chunks = 1600 samples
    // But AudioContext might run at 44100 or 48000; we'll downsample on main thread
    // Here we just send 128-sample frames as they come and let main thread batch
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono channel
    // Convert Float32 [-1,1] to Int16 PCM
    const pcm = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
