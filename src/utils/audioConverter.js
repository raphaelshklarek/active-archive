// Converts AIFF audio files to WAV format for browser playback
// AIFF is not natively supported by Chromium, but WAV is

export function convertAiffToWav(aiffBuffer) {
  const dataView = new DataView(aiffBuffer);

  // Check if this is actually an AIFF file
  const formId = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );

  if (formId !== 'FORM') {
    throw new Error('Not a valid AIFF file');
  }

  // Parse AIFF chunks to extract audio parameters
  let numChannels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let audioData = null;
  let audioDataOffset = 0;
  let audioDataSize = 0;

  let offset = 12; // Skip FORM header

  while (offset < dataView.byteLength) {
    // Read chunk ID
    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );

    // Read chunk size (big-endian)
    const chunkSize = dataView.getUint32(offset + 4, false);

    if (chunkId === 'COMM') {
      // Common chunk - contains audio format info
      numChannels = dataView.getUint16(offset + 8, false);
      // Skip numSampleFrames (4 bytes)
      bitsPerSample = dataView.getUint16(offset + 14, false);
      // Sample rate is stored as 80-bit extended precision float
      // We'll extract it from the exponent and mantissa
      sampleRate = readExtended(dataView, offset + 16);
    } else if (chunkId === 'SSND') {
      // Sound data chunk
      const ssndOffset = dataView.getUint32(offset + 8, false);
      audioDataOffset = offset + 16 + ssndOffset;
      audioDataSize = chunkSize - 8 - ssndOffset;
      break; // We have what we need
    }

    // Move to next chunk (add 8 for chunk header)
    offset += 8 + chunkSize;
    // AIFF chunks are word-aligned
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (!audioDataSize) {
    throw new Error('No audio data found in AIFF file');
  }

  // Extract audio data and convert from big-endian to little-endian
  const pcmData = new Uint8Array(audioDataSize);
  for (let i = 0; i < audioDataSize; i += 2) {
    // Swap byte order for 16-bit samples
    if (bitsPerSample === 16) {
      pcmData[i] = dataView.getUint8(audioDataOffset + i + 1);
      pcmData[i + 1] = dataView.getUint8(audioDataOffset + i);
    } else {
      // For 8-bit or other formats, copy as-is
      pcmData[i] = dataView.getUint8(audioDataOffset + i);
    }
  }

  // Create WAV file
  const wavBuffer = createWavBuffer(pcmData, numChannels, sampleRate, bitsPerSample);
  return wavBuffer;
}

function readExtended(dataView, offset) {
  // Read 80-bit IEEE 754 extended precision float (used in AIFF for sample rate)
  // Simplified version - good enough for standard sample rates
  const exponent = ((dataView.getUint8(offset) & 0x7F) << 8) | dataView.getUint8(offset + 1);
  const mantissa = dataView.getUint32(offset + 2, false);

  if (exponent === 0 && mantissa === 0) {
    return 0;
  }

  const f = mantissa / Math.pow(2, 31);
  return f * Math.pow(2, exponent - 16383);
}

function createWavBuffer(pcmData, numChannels, sampleRate, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true); // File size - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const uint8View = new Uint8Array(buffer);
  uint8View.set(pcmData, 44);

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Helper to check if a file is AIFF based on extension
export function isAiffFile(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'aiff' || ext === 'aif';
}
