export class SmartPlayer {
  constructor({ onStateChange } = {}) {
    this.audioContext = null;
    this.current = null;
    this.next = null;
    this.transition = null;
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
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(ctx.destination);
    this.current = { track, element, source, gain };
    element.addEventListener("timeupdate", () => {
      this.emit();
      this.maybeTransition();
    });
    element.addEventListener("loadedmetadata", () => this.emit());
    element.addEventListener("ended", () => this.emit({ ended: true }));
    element.currentTime = startAt;
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
    [0.75, 0.5, 0.25, 0].forEach((value, i) =>
      gain.gain.linearRampToValueAtTime(value, now + step * (i + 1))
    );
    window.setTimeout(() => {
      element.pause();
      gain.gain.value = 1;
      this.emit({ playing: false });
    }, duration);
  }

  scheduleTransition(nextTrack, transition) {
    this.transition = { nextTrack, transition, started: false };
    this.maybeTransition();
  }

  maybeTransition() {
    if (!this.current || !this.transition || this.transition.started) return;
    if (this.current.element.currentTime >= this.transition.transition.exitAt) {
      this.transition.started = true;
      this.crossfade(this.transition.nextTrack, this.transition.transition).catch(console.error);
    }
  }

  async crossfade(nextTrack, transition = {}) {
    const { crossfadeSeconds = 4, entryAt = 0 } = transition;
    const ctx = this.ensureContext();
    if (!this.current) return this.play(nextTrack, entryAt);

    const old = this.current;
    const element = new Audio();
    element.src = nextTrack.url;
    element.preload = "auto";
    const source = ctx.createMediaElementSource(element);
    const newGain = ctx.createGain();
    newGain.gain.value = 0;
    source.connect(newGain).connect(ctx.destination);
    this.next = { track: nextTrack, element, source, gain: newGain };

    await new Promise((resolve, reject) => {
      const start = () => element.play().then(resolve).catch(reject);
      if (element.readyState >= 2) start();
      else element.addEventListener("canplay", start, { once: true });
    });
    element.currentTime = entryAt;

    const now = ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    newGain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    newGain.gain.setValueAtTime(0, now);
    old.gain.gain.linearRampToValueAtTime(0, now + crossfadeSeconds);
    newGain.gain.linearRampToValueAtTime(1, now + crossfadeSeconds);

    window.setTimeout(() => {
      this.stopSource(old);
      this.current = this.next;
      this.next = null;
      this.transition = null;
      this.emit({ playing: true, transitionComplete: true });
    }, crossfadeSeconds * 1000);
  }

  setVolume(value) {
    if (this.current) this.current.gain.gain.value = value;
    if (this.next) this.next.gain.gain.value = value;
  }

  stopSource(item) {
    if (!item) return;
    item.element.pause();
    item.element.src = "";
    try { item.source.disconnect(); } catch {}
    try { item.gain.disconnect(); } catch {}
  }

  destroy() {
    this.stopSource(this.current);
    this.stopSource(this.next);
    this.audioContext?.close();
  }
}
