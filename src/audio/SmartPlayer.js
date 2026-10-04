export class SmartPlayer {
  constructor({ onStateChange } = {}) {
    this.audioContext = null;
    this.current = null;
    this.next = null;
    this.currentGain = null;
    this.nextGain = null;
    this.timer = null;
    this.onStateChange = onStateChange;
  }

  ensureContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  emit(extra = {}) {
    this.onStateChange?.({
      currentTime: this.current?.element.currentTime || 0,
      duration: this.current?.element.duration || 0,
      ...extra,
    });
  }

  load(track, startAt = 0) {
    const ctx = this.ensureContext();
    if (this.current) this.stopSource(this.current);

    const element = new Audio();
    element.src = track.url;
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.currentTime = startAt;

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 1;

    source.connect(gain).connect(ctx.destination);

    this.current = { track, element, source, gain };
    element.addEventListener("timeupdate", () => this.emit());
    element.addEventListener("loadedmetadata", () => this.emit());
    element.addEventListener("ended", () => this.emit({ ended: true }));

    return element;
  }

  async play(track, startAt = 0) {
    if (!this.current || this.current.track.id !== track.id) {
      this.load(track, startAt);
    }
    await this.current.element.play();
    this.emit({ playing: true });
  }

  async fadePause(duration = 2000) {
    if (!this.current) return;

    const { element, gain } = this.current;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;

    gain.gain.cancelScheduledValues(now);
    const step = duration / 4 / 1000;
    gain.gain.setValueAtTime(1, now);
    gain.gain.linearRampToValueAtTime(0.75, now + step);
    gain.gain.linearRampToValueAtTime(0.5, now + step * 2);
    gain.gain.linearRampToValueAtTime(0.25, now + step * 3);
    gain.gain.linearRampToValueAtTime(0, now + step * 4);

    window.setTimeout(() => {
      element.pause();
      gain.gain.value = 1;
      this.emit({ playing: false });
    }, duration);
  }

  async crossfade(nextTrack, duration = 4000, startAt = 0) {
    const ctx = this.ensureContext();
    if (!this.current) {
      return this.play(nextTrack, startAt);
    }

    const old = this.current;
    const element = new Audio();
    element.src = nextTrack.url;
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.currentTime = startAt;

    const source = ctx.createMediaElementSource(element);
    const oldGain = old.gain;
    const newGain = ctx.createGain();

    newGain.gain.value = 0;
    source.connect(newGain).connect(ctx.destination);

    this.next = { track: nextTrack, element, source, gain: newGain };
    this.nextGain = newGain;

    await element.play();

    const now = ctx.currentTime;
    const seconds = duration / 1000;

    oldGain.gain.cancelScheduledValues(now);
    newGain.gain.cancelScheduledValues(now);
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    newGain.gain.setValueAtTime(0, now);

    oldGain.gain.linearRampToValueAtTime(0, now + seconds);
    newGain.gain.linearRampToValueAtTime(1, now + seconds);

    window.setTimeout(() => {
      this.stopSource(old);
      this.current = this.next;
      this.next = null;
      this.currentGain = this.current.gain;
      this.emit({ playing: true });
    }, duration);

    return element;
  }

  stopSource(item) {
    if (!item) return;
    item.element.pause();
    item.element.src = "";
    try { item.source.disconnect(); } catch {}
    try { item.gain.disconnect(); } catch {}
  }

  destroy() {
    window.clearTimeout(this.timer);
    this.stopSource(this.current);
    this.stopSource(this.next);
    this.audioContext?.close();
    this.audioContext = null;
  }
}

export function analyzeIntro(audioBuffer, seconds = 12) {
  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const length = Math.min(audioBuffer.length, Math.floor(seconds * sampleRate));

  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  const windowSize = Math.max(1024, Math.floor(sampleRate * 0.05));
  const frames = [];

  for (let start = 0; start + windowSize < length; start += windowSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) sum += mono[i] * mono[i];
    frames.push({ time: start / sampleRate, energy: Math.sqrt(sum / windowSize) });
  }

  const peak = Math.max(...frames.map((f) => f.energy), 0.000001);
  frames.forEach((frame) => {
    frame.normalized = frame.energy / peak;
  });

  const threshold = 0.08;
  const firstStrong = frames.find((frame) => frame.normalized >= threshold);

  return {
    recommendedStart: Math.max(0, Math.min(firstStrong?.time ?? 0, 5)),
    frames,
  };
}
