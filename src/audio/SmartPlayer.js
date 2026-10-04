import { } from "./analyzer";

export class SmartPlayer {
  constructor({ onStateChange } = {}) {
    this.audioContext = null;
    this.current = null;
    this.next = null;
    this.timer = null;
    this.onStateChange = onStateChange;
  }

  ensureContext() {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") this.audioContext.resume();
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
    if (!this.current || this.current.track.id !== track.id) this.load(track, startAt);
    await this.current.element.play();
    this.emit({ playing: true });
  }

  async fadePause(duration = 2000) {
    if (!this.current) return;
    const { element, gain } = this.current;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const step = duration / 4 / 1000;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
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

  async crossfade(nextTrack, transition = {}) {
    const { crossfadeSeconds = 4, entryAt = 0 } = transition;
    const ctx = this.ensureContext();
    if (!this.current) return this.play(nextTrack, entryAt);

    const old = this.current;
    const element = new Audio();
    element.src = nextTrack.url;
    element.preload = "auto";
    element.currentTime = entryAt;

    const source = ctx.createMediaElementSource(element);
    const newGain = ctx.createGain();
    newGain.gain.value = 0;
    source.connect(newGain).connect(ctx.destination);
    this.next = { track: nextTrack, element, source, gain: newGain };
    await element.play();

    const now = ctx.currentTime;
    const seconds = crossfadeSeconds;
    old.gain.gain.cancelScheduledValues(now);
    newGain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    newGain.gain.setValueAtTime(0, now);
    old.gain.gain.linearRampToValueAtTime(0, now + seconds);
    newGain.gain.linearRampToValueAtTime(1, now + seconds);

    window.setTimeout(() => {
      this.stopSource(old);
      this.current = this.next;
      this.next = null;
      this.emit({ playing: true, transitionComplete: true });
    }, seconds * 1000);
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
  }
}
