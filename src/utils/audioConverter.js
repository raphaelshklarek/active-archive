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
  let audioDataOffset = 0;
  let audioDataSize = 0;

  let offset = 12; // Skip FORM header

  while (offset < dataView.byteLength) {
    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );

    // Chunk size is big-endian
    const chunkSize = dataView.getUint32(offset + 4, false);

    if (chunkId === 'COMM') {
      // Common chunk - contains audio format info (numSampleFrames skipped)
      numChannels = dataView.getUint16(offset + 8, false);
      bitsPerSample = dataView.getUint16(offset + 14, false);
      sampleRate = readExtended(dataView, offset + 16);
    } else if (chunkId === 'SSND') {
      const ssndOffset = dataView.getUint32(offset + 8, false);
      audioDataOffset = offset + 16 + ssndOffset;
      audioDataSize = chunkSize - 8 - ssndOffset;
      break; // We have what we need
    }

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
    if (bitsPerSample === 16) {
      // Swap byte order for 16-bit samples
      pcmData[i] = dataView.getUint8(audioDataOffset + i + 1);
      pcmData[i + 1] = dataView.getUint8(audioDataOffset + i);
    } else {
      // For 8-bit or other formats, copy as-is
      pcmData[i] = dataView.getUint8(audioDataOffset + i);
    }
  }

  return createWavBuffer(pcmData, numChannels, sampleRate, bitsPerSample);
}

// Read an 80-bit IEEE 754 extended precision float (AIFF stores the sample
// rate this way). Simplified: good enough for standard sample rates.
function readExtended(dataView, offset) {
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
  view.setUint32(4, fileSize - 8, true);
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

  new Uint8Array(buffer).set(pcmData, headerSize);

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
