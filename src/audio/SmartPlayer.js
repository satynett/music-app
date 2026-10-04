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

  createAudio(track, initialGain = 1) {
    const ctx = this.ensureContext();
    const element = new Audio();
    element.src = track.url;
    element.preload = "auto";

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = initialGain;

    source.connect(gain).connect(ctx.destination);
    return { track, element, source, gain };
  }

  load(track, startAt = 0) {
    if (this.current) this.stopSource(this.current);

    const item = this.createAudio(track, 1);
    this.current = item;

    item.element.addEventListener("timeupdate", () => {
      this.emit();
      this.maybeTransition();
    });
    item.element.addEventListener("loadedmetadata", () => this.emit());
    item.element.addEventListener("ended", () => this.emit({ ended: true }));

    item.element.currentTime = startAt;
    return item.element;
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

    [0.75, 0.5, 0.25, 0].forEach((value, i) => {
      gain.gain.linearRampToValueAtTime(value, now + step * (i + 1));
    });

    await new Promise((resolve) => window.setTimeout(resolve, duration));

    element.pause();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    this.emit({ playing: false });
  }

  scheduleTransition(nextTrack, transition, onComplete) {
    this.transition = { nextTrack, transition, started: false, onComplete };
    this.maybeTransition();
  }

  maybeTransition() {
    if (!this.current || !this.transition || this.transition.started) return;

    if (this.current.element.currentTime >= this.transition.transition.exitAt) {
      this.transition.started = true;
      this.crossfade(
        this.transition.nextTrack,
        this.transition.transition,
        this.transition.onComplete
      ).catch(console.error);
    }
  }

  async crossfade(nextTrack, transition = {}, onComplete) {
    const { crossfadeSeconds = 4, entryAt = 0 } = transition;
    const ctx = this.ensureContext();

    if (!this.current) {
      await this.play(nextTrack, entryAt);
      onComplete?.();
      return;
    }

    const old = this.current;
    const next = this.createAudio(nextTrack, 0);
    this.next = next;

    await new Promise((resolve, reject) => {
      const start = () => {
        next.element.currentTime = entryAt;
        next.element.play().then(resolve).catch(reject);
      };
      if (next.element.readyState >= 2) start();
      else next.element.addEventListener("canplay", start, { once: true });
    });

    const now = ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    next.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    next.gain.gain.setValueAtTime(0, now);

    old.gain.gain.linearRampToValueAtTime(0, now + crossfadeSeconds);
    next.gain.gain.linearRampToValueAtTime(1, now + crossfadeSeconds);

    await new Promise((resolve) => window.setTimeout(resolve, crossfadeSeconds * 1000));

    this.stopSource(old);
    this.current = next;
    this.next = null;
    this.transition = null;

    this.emit({
      playing: true,
      transitionComplete: true,
      transitionTrackId: nextTrack.id,
    });
    onComplete?.();
  }

  setVolume(value) {
    if (this.current) this.current.gain.gain.value = value;
    if (this.next) this.next.gain.gain.value = value;
  }

  stopSource(item) {
    if (!item) return;
    item.element.pause();
    item.element.removeAttribute("src");
    item.element.load();
    try { item.source.disconnect(); } catch {}
    try { item.gain.disconnect(); } catch {}
  }

  destroy() {
    this.stopSource(this.current);
    this.stopSource(this.next);
    this.audioContext?.close();
  }
}
