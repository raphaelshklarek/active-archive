// Shared pipeline for turning a library file into something WaveSurfer can
// play: read from disk, build a streamable blob, and resolve waveform peaks.

import { fs } from './electron';
import { convertAiffToWav, isAiffFile } from './audioConverter';
import { readWavSampleRate, computeWavPeaks } from './wav';
import { getPlayable48kWav } from './playbackCache';
import { getWaveform, saveWaveform } from '../database';

const MIME_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg'
};

const extension = (filePath) => filePath.toLowerCase().split('.').pop();

const getMimeType = (filePath) => MIME_TYPES[extension(filePath)] || 'audio/*';

// Reads a file from disk. For WAV/AIFF, `wavBuffer` is the audio as WAV bytes
// (AIFF is converted) for header reads and peak computation; it's null for
// compressed formats.
export async function readAudioFile(location, signal) {
  const fileBuffer = await fs.promises.readFile(location, { signal });

  // Node Buffers can be views into a shared pool; slice out exactly this
  // file's bytes so the AIFF converter and WAV parsers read the right offsets.
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  let wavBuffer = null;
  if (isAiffFile(location)) wavBuffer = convertAiffToWav(arrayBuffer);
  else if (extension(location) === 'wav') wavBuffer = arrayBuffer;

  return { fileBuffer, wavBuffer };
}

// The blob the <audio> element streams. Chromium can't decode WAV above 48 kHz,
// so those are transcoded to a cached 48 kHz WAV; every other file streams its
// original bytes (AIFF as its converted WAV).
export async function makePlayableBlob(location, { fileBuffer, wavBuffer }) {
  if (wavBuffer && readWavSampleRate(wavBuffer) > 48000) {
    const wav48 = await getPlayable48kWav(wavBuffer, `${location}|${fileBuffer.byteLength}`);
    return new Blob([wav48], { type: 'audio/wav' });
  }
  if (isAiffFile(location)) return new Blob([wavBuffer], { type: 'audio/wav' });
  return new Blob([fileBuffer], { type: getMimeType(location) });
}

// Duration reported by an <audio> element, or 0 if it can't load the blob.
export function readMediaDuration(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = (duration) => {
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.addEventListener('loadedmetadata', () => finish(audio.duration));
    audio.addEventListener('error', () => finish(0));
    audio.src = url;
  });
}

// Cached peaks if present. Otherwise, for WAV/AIFF, compute them from the raw
// PCM (and cache) so WaveSurfer never has to decode the whole file. Null for
// compressed formats, which are small enough for WaveSurfer to decode itself.
async function getPeaks(fileId, wavBuffer) {
  const cached = await getWaveform(fileId);
  if (cached?.peaks?.length > 0) return cached.peaks;

  const peaks = wavBuffer ? computeWavPeaks(wavBuffer) : null;
  if (peaks) await saveWaveform(fileId, peaks);
  return peaks;
}

// Everything a player needs to load `file`: a playable blob and, when
// available, peaks to render without decoding.
export async function prepareAudio(file, signal) {
  const audio = await readAudioFile(file.location, signal);
  const blob = await makePlayableBlob(file.location, audio);
  const peaks = await getPeaks(file.id, audio.wavBuffer);
  return { blob, peaks };
}

// After WaveSurfer decodes a file itself (no peaks were supplied), cache the
// peaks it produced.
export async function cachePeaksFrom(ws, fileId) {
  const existing = await getWaveform(fileId);
  if (existing?.peaks?.length > 0) return;

  const peaks = ws.exportPeaks();
  if (peaks?.length > 0) await saveWaveform(fileId, peaks);
}
