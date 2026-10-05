export class SmartPlayer {
  constructor({ onStateChange } = {}) {
    this.audioContext = null;
    this.current = null;
    this.next = null;
    this.transition = null;
    this.onStateChange = onStateChange;
    this.volume = 0.9;
    this.analyser = null;
    this.crossfading = false;
    this._crossfadeToken = 0;
    this._transitionTimer = null;
  }

  ensureContext() {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.analyser = null;
    }
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
    element.crossOrigin = "anonymous";
    element.src = track.url;
    element.preload = "auto";

    element.addEventListener("error", () => {
      const mediaError = element.error;
      this.emit({
        mediaError: {
          code: mediaError?.code || 0,
          message: mediaError?.message || "Audio resource could not be loaded",
          trackId: track.id,
        },
      });
    });

    element.addEventListener("stalled", () => {
      this.emit({ mediaStalled: true, mediaTrackId: track.id });
    });

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = initialGain;

    source.connect(gain).connect(this.analyser);
    return { track, element, source, gain };
  }

  attachListeners(item) {
    const { element } = item;

    element.addEventListener("timeupdate", () => {
      if (this.current !== item) return;
      this.emit();
      this.maybeTransition();
    });

    element.addEventListener("loadedmetadata", () => {
      if (this.current === item) this.emit();
    });

    element.addEventListener("ended", () => {
      if (this.current === item && !this.crossfading) {
        this.emit({ ended: true });
      }
    });
  }

  abortCrossfade() {
    this._crossfadeToken += 1;

    if (this._transitionTimer) {
      window.clearTimeout(this._transitionTimer);
      this._transitionTimer = null;
    }

    if (this.crossfading && this.current && this.audioContext) {
      const g = this.current.gain.gain;
      const v = g.value;
      g.cancelScheduledValues(this.audioContext.currentTime);
      g.setValueAtTime(v, this.audioContext.currentTime);
    }

    this.crossfading = false;

    if (this.next) {
      this.stopSource(this.next);
      this.next = null;
    }
  }

  cancelTransition() {
    this.abortCrossfade();
    this.transition = null;
  }

  load(track, startAt = 0, initialGain = 0) {
    this.cancelTransition();

    if (this.current) this.stopSource(this.current);

    const item = this.createAudio(track, initialGain);
    this.current = item;
    this.attachListeners(item);

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
    this.cancelTransition();

    const isNewTrack = !this.current || this.current.track.id !== track.id;
    if (isNewTrack) this.load(track, startAt, 0);

    const item = this.current;
    this.ensureContext();

    await item.element.play();
    this.fadeGain(item.gain, 0, this.volume, 2000);
    this.emit({ playing: true });
  }

  async fadePause(duration = 2000) {
    if (!this.current) return;

    this.cancelTransition();

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

    if (this.current?.element !== element) return;

    element.pause();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    this.emit({ playing: false });
  }

  scheduleTransition(nextTrack, transition, onComplete) {
    this.transition = {
      nextTrack,
      transition,
      started: false,
      onComplete,
    };

    if (!this.crossfading) this.maybeTransition();
  }

  maybeTransition() {
    if (
      !this.current ||
      !this.transition ||
      this.transition.started ||
      this.crossfading
    ) {
      return;
    }

    const exitAt = Number(this.transition.transition?.exitAt);
    if (!Number.isFinite(exitAt)) return;

    if (this.current.element.currentTime >= exitAt) {
      const pending = this.transition;
      pending.started = true;
      this.transition = null;

      this.crossfade(
        pending.nextTrack,
        pending.transition,
        pending.onComplete
      ).catch((error) => {
        console.error("Crossfade failed:", error);
      });
    }
  }

  async crossfade(nextTrack, transition = {}, onComplete) {
    this.abortCrossfade();
    this.transition = null;

    const ctx = this.ensureContext();
    const entryAt = Math.max(0, Number(transition.entryAt) || 0);
    let crossfadeSeconds = Math.max(
      3,
      Math.min(Number(transition.crossfadeSeconds) || 4, 6)
    );

    if (!this.current) {
      await this.play(nextTrack, entryAt);
      onComplete?.();
      return;
    }

    const left =
      this.current.element.duration - this.current.element.currentTime;

    if (Number.isFinite(left) && left > 0.5) {
      crossfadeSeconds = Math.min(crossfadeSeconds, left);
    }

    const token = ++this._crossfadeToken;
    const old = this.current;
    const next = this.createAudio(nextTrack, 0);
    this.attachListeners(next);
    this.next = next;
    this.crossfading = true;

    try {
      next.element.currentTime = entryAt;
      await next.element.play();

      if (token !== this._crossfadeToken) return;

      const now = ctx.currentTime;

      this.emit({
        transitionStart: true,
        transitionFromTrackId: old.track.id,
        transitionTrackId: nextTrack.id,
        transitionSeconds: crossfadeSeconds,
      });

      old.gain.gain.cancelScheduledValues(now);
      next.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(this.volume, now);
      next.gain.gain.setValueAtTime(0, now);

      const steps = 32;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const time = now + t * crossfadeSeconds;

        old.gain.gain.linearRampToValueAtTime(
          Math.cos(t * Math.PI / 2) * this.volume,
          time
        );

        next.gain.gain.linearRampToValueAtTime(
          Math.sin(t * Math.PI / 2) * this.volume,
          time
        );
      }

      await new Promise((resolve) => {
        this._transitionTimer = window.setTimeout(
          resolve,
          crossfadeSeconds * 1000
        );
      });

      this._transitionTimer = null;

      if (token !== this._crossfadeToken) return;

      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(0, ctx.currentTime);
      this.stopSource(old);

      next.gain.gain.cancelScheduledValues(ctx.currentTime);
      next.gain.gain.setValueAtTime(this.volume, ctx.currentTime);

      this.current = next;
      this.next = null;
      this.crossfading = false;

      this.emit({
        playing: true,
        transitionComplete: true,
        transitionTrackId: nextTrack.id,
      });

      onComplete?.();
    } catch (error) {
      if (token !== this._crossfadeToken) return;

      this.crossfading = false;

      if (this.next === next) {
        this.stopSource(next);
        this.next = null;
      }

      this.emit({ playing: false, transitionError: error.message });
      throw error;
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));

    if (this.crossfading) return;

    if (this.current) this.current.gain.gain.value = this.volume;
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
    this.cancelTransition();
    this.stopSource(this.current);
    this.current = null;

    try { this.analyser?.disconnect(); } catch {}
    this.audioContext?.close();

    this.audioContext = null;
    this.analyser = null;
  }
}
