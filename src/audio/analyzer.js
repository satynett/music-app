export async function decodeAudioFile(file, audioContext = new AudioContext()) {
  const bytes = await file.arrayBuffer();
  return audioContext.decodeAudioData(bytes);
}

export function analyzeTrack(audioBuffer, options = {}) {
  const { analysisSeconds = 20, frameMs = 50, minEntry = 0, maxEntry = 8 } = options;
  const sampleRate = audioBuffer.sampleRate;
  const length = Math.min(audioBuffer.length, Math.floor(analysisSeconds * sampleRate));
  const mono = new Float32Array(length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }

  const frameSize = Math.max(512, Math.floor(sampleRate * frameMs / 1000));
  const frames = [];

  for (let start = 0; start + frameSize < length; start += frameSize) {
    let energy = 0;
    let peak = 0;
    for (let i = start; i < start + frameSize; i++) {
      const value = Math.abs(mono[i]);
      energy += value * value;
      peak = Math.max(peak, value);
    }
    frames.push({ time: start / sampleRate, rms: Math.sqrt(energy / frameSize), peak });
  }

  const maxRms = Math.max(...frames.map((f) => f.rms), 0.000001);
  const noiseFloor = percentile(frames.map((f) => f.rms), 20);

  frames.forEach((frame, index) => {
    frame.energy = frame.rms / maxRms;
    frame.silence = frame.rms <= noiseFloor * 1.6;
    const previous = frames[index - 1]?.rms ?? frame.rms;
    frame.onset = Math.max(0, frame.rms - previous) / maxRms;
  });

  const candidates = frames.filter(
    (frame) => frame.time >= minEntry && frame.time <= maxEntry && !frame.silence && frame.energy >= 0.18
  );

  const best = candidates
    .map((frame) => ({
      ...frame,
      score: frame.energy * 0.55 + Math.min(frame.onset * 4, 1) * 0.25 + 0.2,
    }))
    .sort((a, b) => b.score - a.score)[0];

  const bpm = estimateBpm(frames);
  return {
    duration: audioBuffer.duration,
    bpm,
    recommendedStart: best?.time ?? 0,
    frames,
    reason: best
      ? "Selected a strong, non-silent intro frame with high energy/onset."
      : "No strong intro frame found; starting from the beginning.",
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p / 100)];
}

function estimateBpm(frames) {
  const onsets = frames.filter((f) => f.onset > 0.12).map((f) => f.time);
  if (onsets.length < 4) return null;

  const intervals = [];
  for (let i = 1; i < onsets.length; i++) {
    const delta = onsets[i] - onsets[i - 1];
    if (delta >= 0.25 && delta <= 1.5) intervals.push(delta);
  }
  if (!intervals.length) return null;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return Math.round(normalizeBpm(60 / median));
}

function normalizeBpm(bpm) {
  let value = bpm;
  while (value < 70) value *= 2;
  while (value > 180) value /= 2;
  return value;
}

export function chooseTransition(currentAnalysis, nextAnalysis) {
  const currentDuration = currentAnalysis?.duration ?? 0;
  const nextStart = nextAnalysis?.recommendedStart ?? 0;
  const bpmA = currentAnalysis?.bpm;
  const bpmB = nextAnalysis?.bpm;

  let duration = 4;
  if (bpmA && bpmB) {
    const ratio = Math.min(bpmA, bpmB) / Math.max(bpmA, bpmB);
    if (ratio > 0.9) duration = 6;
    else if (ratio < 0.75) duration = 3;
  }

  return {
    exitAt: Math.max(0, currentDuration - duration),
    entryAt: nextStart,
    crossfadeSeconds: duration,
    bpmA,
    bpmB,
  };
}
