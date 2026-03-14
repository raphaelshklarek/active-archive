/**
 * Custom WaveSurfer renderFunction: draws a smooth waveform shape
 * filled with a horizontal gradient whose color varies by local amplitude.
 *
 * Quiet sections → clean neutral grey
 * Medium sections → green
 * Loud sections → bright clear yellow
 *
 * WaveSurfer only calls renderFunction for the wave canvas. The progress
 * canvas is handled separately via drawImage + source-in compositing with
 * progressColor. Set progressColor to 'transparent' to keep played sections
 * visually identical to unplayed.
 */

function getAmplitudeColor(amp) {
  // Thresholds tuned for absolute peak-data averages:
  // smoothed peak averages are typically 0.02–0.05 (quiet), 0.08–0.20
  // (moderate), 0.25+ (loud).
  if (amp <= 0.02) {
    // Quiet: clean neutral grey
    return 'rgba(160, 160, 160, 0.85)';
  } else if (amp <= 0.10) {
    // Medium: grey → green
    const t = (amp - 0.02) / 0.08;
    const r = Math.round(160 - t * 65);   // 160 → 95
    const g = Math.round(160 + t * 55);   // 160 → 215
    const b = Math.round(160 - t * 70);   // 160 → 90
    return `rgba(${r}, ${g}, ${b}, 0.88)`;
  } else {
    // Loud: green → bright clear yellow
    const t = Math.min(1, (amp - 0.10) / 0.20);
    const r = Math.round(95 + t * 145);   // 95 → 240
    const g = Math.round(215 + t * 15);   // 215 → 230
    const b = Math.round(90 - t * 50);    // 90 → 40
    return `rgba(${r}, ${g}, ${b}, 0.90)`;
  }
}

export function renderAmplitudeColoredWaveform(peaks, ctx) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;

  const data = peaks[0];
  if (!data || data.length === 0) return;

  const step = width / data.length;

  // Smooth amplitude values for color gradient — small window keeps color
  // responsive to local amplitude (matching the meter) while avoiding noise.
  const smoothWindow = Math.max(2, Math.floor(data.length / 400));

  // Build horizontal gradient with absolute-amplitude-based color stops
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  const numStops = Math.min(data.length, 256);

  for (let s = 0; s <= numStops; s++) {
    const position = s / numStops;
    const dataIndex = Math.floor(position * (data.length - 1));

    // Local average for smooth color transitions
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, dataIndex - smoothWindow);
    const hi = Math.min(data.length - 1, dataIndex + smoothWindow);
    for (let j = lo; j <= hi; j++) {
      sum += Math.abs(data[j]);
      count++;
    }
    // Absolute amplitude — colors match the meters
    const smoothAmp = sum / count;

    gradient.addColorStop(Math.min(1, position), getAmplitudeColor(smoothAmp));
  }

  ctx.fillStyle = gradient;

  // Shape uses absolute amplitude with sqrt scaling (standard audio power
  // relationship). Quiet pieces stay visible while preserving meaningful
  // dynamic range between tracks.
  // sqrt(0.01)=0.10, sqrt(0.05)=0.22, sqrt(0.1)=0.32, sqrt(0.5)=0.71, sqrt(1.0)=1.0

  // Draw top half as a smooth filled path
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  for (let i = 0; i < data.length; i++) {
    const amp = Math.sqrt(Math.abs(data[i]));
    ctx.lineTo(i * step, centerY - amp * centerY);
  }
  ctx.lineTo(width, centerY);
  ctx.closePath();
  ctx.fill();

  // Draw bottom half (mirror)
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  for (let i = 0; i < data.length; i++) {
    const amp = Math.sqrt(Math.abs(data[i]));
    ctx.lineTo(i * step, centerY + amp * centerY);
  }
  ctx.lineTo(width, centerY);
  ctx.closePath();
  ctx.fill();
}
