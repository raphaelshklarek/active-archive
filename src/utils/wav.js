// WAV header parsing and peak extraction, read straight from the bytes. No
// AudioBuffer is ever allocated, which matters: decodeAudioData needs ~2x the
// file size and can OOM-crash the renderer on large WAV/AIFF files.

const fourCC = (view, offset) => String.fromCharCode(
  view.getUint8(offset), view.getUint8(offset + 1),
  view.getUint8(offset + 2), view.getUint8(offset + 3)
);

// Walk the RIFF chunks and return the fmt fields plus the data chunk's
// position, or null if either is missing or the file is truncated.
function parseWav(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    let fmt = null;
    let offset = 12; // skip RIFF + size + WAVE

    while (offset + 8 <= view.byteLength) {
      const id = fourCC(view, offset);
      const size = view.getUint32(offset + 4, true);

      if (id === 'fmt ') {
        fmt = {
          audioFormat: view.getUint16(offset + 8, true), // 1 = PCM, 3 = IEEE float
          channels: view.getUint16(offset + 10, true),
          sampleRate: view.getUint32(offset + 12, true),
          byteRate: view.getUint32(offset + 16, true),
          bitsPerSample: view.getUint16(offset + 22, true)
        };
      } else if (id === 'data' && fmt) {
        const dataOffset = offset + 8;
        return { view, ...fmt, dataOffset, dataSize: Math.min(size, view.byteLength - dataOffset) };
      }

      offset += 8 + size + (size % 2); // chunks are word-aligned
    }
    return null;
  } catch (e) {
    console.warn('Could not parse WAV header:', e);
    return null;
  }
}

// Duration in seconds, or 0 if the header can't be parsed. Works for any
// sample rate / bit depth, so high-res files get an accurate duration at
// import time without the <audio> element's >48 kHz limitation.
export function readWavDuration(arrayBuffer) {
  const wav = parseWav(arrayBuffer);
  if (!wav) return 0;
  // Prefer byteRate (handles odd block alignments); fall back to the derived
  // frame size if it's missing.
  const bytesPerSecond = wav.byteRate || wav.sampleRate * wav.channels * (wav.bitsPerSample / 8);
  return bytesPerSecond ? wav.dataSize / bytesPerSecond : 0;
}

// Sample rate in Hz, or 0 if the header can't be parsed. Used to decide whether
// a file needs downsampling for <audio> playback.
export function readWavSampleRate(arrayBuffer) {
  return parseWav(arrayBuffer)?.sampleRate ?? 0;
}

// Per-channel peak arrays (~targetPeaks points each), or null if the bit depth
// is unsupported so WaveSurfer can decode the file itself instead.
export function computeWavPeaks(arrayBuffer, targetPeaks = 8000) {
  const wav = parseWav(arrayBuffer);
  if (!wav) return null;

  const { view, audioFormat, channels, bitsPerSample, dataOffset, dataSize } = wav;
  if (![8, 16, 24, 32].includes(bitsPerSample)) return null;

  const bytesPerSample = bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * channels;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const framesPerPeak = Math.max(1, Math.floor(totalFrames / targetPeaks));
  const numPeaks = Math.ceil(totalFrames / framesPerPeak);

  const readSample = (off) => {
    switch (bitsPerSample) {
      case 8:
        return (view.getUint8(off) - 128) / 128;
      case 16:
        return view.getInt16(off, true) / 32768;
      case 24: {
        const b2 = view.getInt8(off + 2); // signed for sign extension
        return ((b2 << 16) | (view.getUint8(off + 1) << 8) | view.getUint8(off)) / 8388608;
      }
      default: // 32
        return audioFormat === 3
          ? view.getFloat32(off, true)
          : view.getInt32(off, true) / 2147483648;
    }
  };

  const peaks = Array.from({ length: channels }, () => new Array(numPeaks));

  for (let p = 0; p < numPeaks; p++) {
    const startFrame = p * framesPerPeak;
    const endFrame = Math.min(startFrame + framesPerPeak, totalFrames);

    for (let ch = 0; ch < channels; ch++) {
      let peak = 0;
      for (let f = startFrame; f < endFrame; f++) {
        const off = dataOffset + f * bytesPerFrame + ch * bytesPerSample;
        if (off + bytesPerSample > view.byteLength) break;
        const abs = Math.abs(readSample(off));
        if (abs > peak) peak = abs;
      }
      // Match WaveSurfer exportPeaks precision (4 decimal places)
      peaks[ch][p] = Math.round(peak * 10000) / 10000;
    }
  }

  return peaks;
}
