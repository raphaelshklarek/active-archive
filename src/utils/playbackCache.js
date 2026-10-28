// Disk-cached playback transcoding.
//
// Chromium's <audio> element streams normal-rate audio smoothly but its
// media-element decoder rejects WAV above 48 kHz. Rather than route ALL
// playback through Web Audio (which fully decodes every file up front and
// stutters in random mode), we keep the fast streaming <audio> path for every
// file and only transcode the rare >48 kHz files down to a 48 kHz WAV. The
// result is cached on disk, so the cost is paid once per file.

import { getAudioContext } from './audioContext';
import { ipcRenderer, fs, path } from './electron';

const TARGET_RATE = 48000;

let cacheDirPromise = null;
function getCacheDir() {
  if (!cacheDirPromise) {
    cacheDirPromise = ipcRenderer.invoke('playback:getCacheDir').catch(() => null);
  }
  return cacheDirPromise;
}

// FNV-1a → hex: a stable, filesystem-safe key from the file identity string.
function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Encode an AudioBuffer as a 32-bit IEEE-float WAV (format 3). Float keeps the
// full precision of the resample and is one of the PCM flavours Chromium's
// <audio> element can decode.
function encodeFloat32Wav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const numFrames = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const blockAlign = numCh * 4;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));

  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      view.setFloat32(off, channels[c][i], true);
      off += 4;
    }
  }
  return buffer;
}

// Decode (any sample rate / bit depth) and resample to 48 kHz via an
// OfflineAudioContext, then re-encode to a WAV ArrayBuffer.
async function resampleTo48kWav(wavArrayBuffer) {
  const ctx = getAudioContext();
  // decodeAudioData detaches the buffer it's given, so hand it a copy and leave
  // the caller's buffer (used for peak computation) intact.
  const decoded = await ctx.decodeAudioData(wavArrayBuffer.slice(0));
  const numCh = decoded.numberOfChannels;
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(numCh, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeFloat32Wav(rendered);
}

// Given a >48 kHz WAV ArrayBuffer and a stable identity key, return a 48 kHz WAV
// ArrayBuffer the <audio> element can stream. Reads from / writes to the disk
// cache so the resample happens at most once per file.
export async function getPlayable48kWav(wavArrayBuffer, cacheId) {
  const dir = await getCacheDir();
  let filePath = null;

  if (dir) {
    filePath = path.join(dir, `${hashKey(cacheId)}.wav`);
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    } catch (e) {
      // Fall through and regenerate on any read error.
    }
  }

  const resampled = await resampleTo48kWav(wavArrayBuffer);

  if (filePath) {
    try {
      fs.writeFileSync(filePath, Buffer.from(resampled));
    } catch (e) {
      console.warn('Could not write playback cache:', e);
    }
  }

  return resampled;
}
