export class SmartPlayer {
  constructor({ onStateChange } = {}) {
    this.audioContext = null;
    this.current = null;
    this.next = null;
    this.transition = null;
    this.onStateChange = onStateChange;
    this.volume = 0.9;
    this.analyser = null;
  }

  ensureContext() {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") this.audioContext.resume();
    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      this.analyser.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  getAnalyser() {
    this.ensureContext();
    return this.analyser;
  }

  emit(extra = {}) {
    this.onStateChange?.({
      currentTime: this.current?.element.currentTime || 0,
      duration: this.current?.element.duration || 0,
      ...extra,
    });
  }

  createAudio(track, initialGain = this.volume) {
    const ctx = this.ensureContext();
    const element = new Audio();
    element.src = track.url;
    element.preload = "auto";

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = initialGain;

    source.connect(gain).connect(this.analyser);
    return { track, element, source, gain };
  }

  load(track, startAt = 0, initialGain = 0) {
    if (this.current) this.stopSource(this.current);

    const item = this.createAudio(track, initialGain);
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

  fadeGain(gain, from, to, duration) {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(from, now);
    gain.gain.linearRampToValueAtTime(to, now + duration / 1000);
  }

  async play(track, startAt = 0) {
    const isNewTrack = !this.current || this.current.track.id !== track.id;

    if (isNewTrack) {
      this.load(track, startAt, 0);
    }

    const item = this.current;
    const ctx = this.ensureContext();

    await item.element.play();

    // Every explicit start/resume gets a smooth 2-second fade-in.
    this.fadeGain(item.gain, 0, this.volume, 2000);

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
    gain.gain.setValueAtTime(0, ctx.currentTime);

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

    this.emit({
      transitionStart: true,
      transitionTrackId: nextTrack.id,
      transitionSeconds: crossfadeSeconds,
    });

    old.gain.gain.cancelScheduledValues(now);
    next.gain.gain.cancelScheduledValues(now);

    // Equal-power style crossfade: both tracks are clearly audible in the middle.
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    next.gain.gain.setValueAtTime(0, now);

    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const time = now + t * crossfadeSeconds;
      const oldGain = Math.cos(t * Math.PI / 2) * this.volume;
      const nextGain = Math.sin(t * Math.PI / 2) * this.volume;

      old.gain.gain.linearRampToValueAtTime(oldGain, time);
      next.gain.gain.linearRampToValueAtTime(nextGain, time);
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, crossfadeSeconds * 1000)
    );

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
    this.volume = value;

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
    try { this.analyser?.disconnect(); } catch {}
    this.audioContext?.close();
  }
}
