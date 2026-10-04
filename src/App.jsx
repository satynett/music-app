import { useEffect, useMemo, useRef, useState } from "react";
import { SmartPlayer } from "./audio/SmartPlayer";
import { analyzeTrack, chooseTransition } from "./audio/analyzer";
import { localTracks } from "./music/library";
import { AudioVisualizer } from "./components/AudioVisualizer";

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

export default function App() {
  const [queue, setQueue] = useState(localTracks);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [smart, setSmart] = useState(true);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Add your local music to get started.");
  const [analysis, setAnalysis] = useState(null);
  const [blend, setBlend] = useState(null);

  const queueRef = useRef(queue);
  const analyses = useRef(new Map());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const localPlayer = useMemo(() => new SmartPlayer({
    onStateChange: (state) => {
      setPosition(state.currentTime);
      setDuration(state.duration);
      if (state.playing !== undefined) setPlaying(state.playing);
      if (state.ended) setPlaying(false);

      if (state.transitionStart) {
        setBlend({
          title: queueRef.current.find((track) => track.id === state.transitionTrackId)?.title || "Next track",
          seconds: state.transitionSeconds || 6,
        });
        window.setTimeout(() => setBlend(null), (state.transitionSeconds || 6) * 1000);
      }

      if (state.transitionTrackId) {
        const nextIndex = queueRef.current.findIndex(
          (track) => track.id === state.transitionTrackId
        );
        if (nextIndex >= 0) setIndex(nextIndex);
      }
    },
  }), []);

  const current = queue[index];

  useEffect(() => () => localPlayer.destroy(), [localPlayer]);

  async function getAnalysis(track) {
    if (analyses.current.has(track.id)) return analyses.current.get(track.id);

    const ctx = new AudioContext();
    const response = await fetch(track.url);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const result = analyzeTrack(buffer);
    await ctx.close();

    analyses.current.set(track.id, result);
    return result;
  }

  async function playLocal(track, trackIndex = null) {
    if (!track) return;

    const nextIndex = trackIndex ?? queue.findIndex((item) => item.id === track.id);
    if (nextIndex >= 0) setIndex(nextIndex);

    setMessage("Playing local audio.");
    await localPlayer.play(track);
  }

  async function togglePlay() {
    if (!current) {
      setMessage("Add a music file first.");
      return;
    }

    try {
      if (playing) {
        setMessage("Fading out…");
        await localPlayer.fadePause(2000);
      } else {
        await localPlayer.play(current);
        setMessage("Playing.");
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function next() {
    if (!queue.length || !current) return;

    const nextIndex = (index + 1) % queue.length;
    const nextTrack = queue[nextIndex];

    try {
      const [a, b] = await Promise.all([
        getAnalysis(current),
        getAnalysis(nextTrack),
      ]);

      const transition = smart
        ? {
            // Manual Next should crossfade NOW.
            // Smart analysis still chooses the blend duration and B's entry point.
            exitAt: a.duration,
            entryAt: b.recommendedStart ?? 0,
            crossfadeSeconds: Math.max(6, chooseTransition(a, b).crossfadeSeconds),
            bpmA: a.bpm,
            bpmB: b.bpm,
          }
        : {
            exitAt: a.duration,
            entryAt: 0,
            crossfadeSeconds: 4,
            bpmA: a.bpm,
            bpmB: b.bpm,
          };

      setAnalysis({ ...transition, nextTitle: nextTrack.title });

      // The Next button means "change now", so start both tracks together.
      await localPlayer.crossfade(nextTrack, transition);
      setIndex(nextIndex);
      setMessage(
        smart
          ? `Smart crossfade: new track starts at ${transition.entryAt.toFixed(1)}s`
          : "Crossfade complete."
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function previous() {
    if (!queue.length) return;

    const previousIndex = (index - 1 + queue.length) % queue.length;
    setIndex(previousIndex);
    setAnalysis(null);
    await localPlayer.play(queue[previousIndex]);
    setMessage("Playing previous track.");
  }

  function seek(event) {
    const value = Number(event.target.value);
    if (localPlayer.current?.element) {
      localPlayer.current.element.currentTime = value;
    }
    setPosition(value);
  }

  function changeVolume(event) {
    const value = Number(event.target.value);
    setVolume(value);
    localPlayer.setVolume(value);
  }

  function refreshLibrary() {
    setQueue(localTracks);
    setIndex((currentIndex) => Math.min(currentIndex, Math.max(localTracks.length - 1, 0)));
    setMessage(
      localTracks.length
        ? `${localTracks.length} local track(s) loaded from src/music/audio.`
        : "Add audio files to src/music/audio, then restart Vite."
    );
  }

  function searchLocal() {
    if (!query.trim()) return;

    const matchIndex = queue.findIndex((track) =>
      `${track.title} ${track.artist}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );

    if (matchIndex >= 0) {
      setIndex(matchIndex);
      setMessage(`Found “${queue[matchIndex].title}”.`);
    } else {
      setMessage("No matching local track found.");
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-dot" />PULSE</div>

        <div className="top-actions">
          <span className="pill active">Local Music</span>

          <button className="upload" onClick={refreshLibrary}>
            ↻ Reload library
          </button>
        </div>
      </header>

      <section className="search-panel">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchLocal()}
          placeholder="Search your music…"
        />
        <button onClick={searchLocal}>Search</button>
      </section>

      <section className="hero">
        <div
          className="art"
          style={{
            background: `linear-gradient(135deg, ${current?.color || "#4c5cff"}, #10131a)`,
          }}
        >
          <span>♫</span>
        </div>

        <div className="details">
          <AudioVisualizer
            player={localPlayer}
            playing={playing}
            blending={Boolean(blend)}
            currentTitle={current?.title || "Current track"}
            nextTitle={blend?.title || ""}
          />
          <p className="eyebrow">LOCAL · NOW PLAYING</p>
          <h1>{current?.title || "Your music library"}</h1>
          <p className="artist">{current?.artist || "Add music to begin"}</p>
          <p className="status">{message}</p>

          <div className="now-playing-meta">
            <span className={playing ? "live-dot" : ""}>{playing ? "LIVE" : "PAUSED"}</span>
            <span>{queue.length} tracks</span>
            {analysis?.bpmA && <span>{analysis.bpmA} BPM</span>}
            {blend && <span className="blend-chip">↗ {blend.seconds}s blend</span>}
          </div>

          <div className="progress-row">
            <span>{formatTime(position)}</span>
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(position, duration || 1)}
              onChange={seek}
            />
            <span>{formatTime(duration)}</span>
          </div>

          <div className="controls">
            <button onClick={previous}>↶</button>
            <button className="play" onClick={togglePlay}>
              {playing ? "Ⅱ" : "▶"}
            </button>
            <button onClick={next}>↷</button>
          </div>

          <div className="settings">
            <label>
              Smart transition
              <input
                type="checkbox"
                checked={smart}
                onChange={(e) => setSmart(e.target.checked)}
              />
            </label>

            <label className="volume">
              Vol
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={changeVolume}
              />
            </label>
          </div>

          <div className="feature-grid">
            <div className="feature-card">
              <strong>2s Stop Fade</strong>
              <span>100% → 75% → 50% → 25% → 0%</span>
            </div>

            <div className="feature-card">
              <strong>Smart Crossfade</strong>
              <span>Old track fades while the next track fades in.</span>
            </div>
          </div>

          {analysis && (
            <div className="analysis-card">
              <strong>Smart transition plan</strong>
              <span>Exit A: {formatTime(analysis.exitAt)}</span>
              <span>Entry B: {analysis.entryAt.toFixed(1)}s</span>
              <span>Blend: {analysis.crossfadeSeconds}s</span>
              <span>BPM: {analysis.bpmA ?? "?"} → {analysis.bpmB ?? "?"}</span>
              <span>Next: {analysis.nextTitle}</span>
            </div>
          )}
        </div>
      </section>

      <section className="queue">
        <div className="queue-head">
          <h2>Queue</h2>
          <span>{queue.length} tracks</span>
        </div>

        {queue.length === 0 ? (
          <div className="empty-state">
            <strong>Your library is empty.</strong>
            <span>Use “+ Add music” to load your local audio files.</span>
          </div>
        ) : (
          queue.map((track, i) => (
            <button
              className={`track ${i === index ? "active" : ""}`}
              key={track.id}
              onClick={() => playLocal(track, i)}
            >
              <span className="track-number">{i + 1}</span>
              <span className="track-info">
                <strong>{track.title}</strong>
                <small>{track.artist} · Local</small>
              </span>
              <span>{i === index && playing ? "Playing" : "Play"}</span>
            </button>
          ))
        )}
      </section>
    </main>
  );
}
