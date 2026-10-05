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

  cancelTransition() {
    this._crossfadeToken += 1;

    if (this._transitionTimer) {
      window.clearTimeout(this._transitionTimer);
      this._transitionTimer = null;
    }

    this.transition = null;
    this.crossfading = false;

    if (this.next) {
      this.stopSource(this.next);
      this.next = null;
    }
  }

  load(track, startAt = 0, initialGain = 0) {
    this.cancelTransition();

    if (this.current) this.stopSource(this.current);

    const item = this.createAudio(track, initialGain);
    this.current = item;

    item.element.addEventListener("timeupdate", () => {
      this.emit();
      this.maybeTransition();
    });

    item.element.addEventListener("loadedmetadata", () => this.emit());

    item.element.addEventListener("ended", () => {
      if (this.current?.track.id === track.id && !this.crossfading) {
        this.emit({ ended: true });
      }
    });

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
    this.cancelTransition();

    this.transition = {
      nextTrack,
      transition,
      started: false,
      onComplete,
    };

    this.maybeTransition();
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

    if (this.current.element.currentTime >= this.transition.transition.exitAt) {
      const pending = this.transition;
      pending.started = true;

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
    // A new crossfade always owns the transition slot.
    this.cancelTransition();

    const crossfadeSeconds = Math.max(
      3,
      Math.min(Number(transition.crossfadeSeconds) || 4, 6)
    );
    const entryAt = Math.max(0, Number(transition.entryAt) || 0);
    const ctx = this.ensureContext();

    if (!this.current) {
      await this.play(nextTrack, entryAt);
      onComplete?.();
      return;
    }

    const token = ++this._crossfadeToken;
    const old = this.current;
    const next = this.createAudio(nextTrack, 0);
    this.next = next;
    this.crossfading = true;

    try {
      // Start the new media element immediately. The Next button is a
      // real user gesture, so this is the safest point to request playback.
      // Do not wait for canplay/canplaythrough before calling play().
      await next.element.play();

      if (next.element.paused) {
        throw new Error("Next track did not start playing");
      }

      if (token !== this._crossfadeToken) {
        throw new Error("Transition cancelled");
      }

      // Manual Next uses entryAt=0. Automatic transitions may choose a
      // later entry point; seek once metadata is available.
      if (Number.isFinite(entryAt) && entryAt > 0) {
        const seekNext = () => {
          if (token === this._crossfadeToken && next.element.readyState >= 1) {
            try { next.element.currentTime = entryAt; } catch {}
          }
        };
        if (next.element.readyState >= 1) seekNext();
        else next.element.addEventListener("loadedmetadata", seekNext, { once: true });
      }

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
      old.element.pause();
      this.stopSource(old);

      this.current = next;
      this.next = null;
      this.transition = null;
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
      this.emit({ playing: false, transitionError: error.message });
      if (this.next === next) {
        this.stopSource(next);
        this.next = null;
      }
      throw error;
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));

    if (this.current) this.current.gain.gain.value = this.volume;
    if (this.next) this.next.gain.gain.value = this.volume;
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
