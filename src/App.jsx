import { useEffect, useMemo, useRef, useState } from "react";
import { SmartPlayer } from "./audio/SmartPlayer";
import { analyzeTrack, decodeAudioFile, chooseTransition } from "./audio/analyzer";

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

export default function App() {
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [smart, setSmart] = useState(true);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Add your local music to get started.");
  const [analysis, setAnalysis] = useState(null);

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
        ? chooseTransition(a, b)
        : {
            exitAt: Math.max(0, a.duration - 4),
            entryAt: 0,
            crossfadeSeconds: 4,
            bpmA: a.bpm,
            bpmB: b.bpm,
          };

      setAnalysis({ ...transition, nextTitle: nextTrack.title });

      if (smart) {
        localPlayer.scheduleTransition(
          nextTrack,
          transition,
          () => setIndex(nextIndex)
        );
        setMessage(
          `Smart transition: ${formatTime(transition.exitAt)} → ${transition.entryAt.toFixed(1)}s`
        );
      } else {
        await localPlayer.crossfade(nextTrack, transition);
        setIndex(nextIndex);
        setMessage("Crossfade complete.");
      }
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

  async function addFiles(event) {
    const files = [...event.target.files];
    if (!files.length) return;

    try {
      const additions = [];

      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        const ctx = new AudioContext();
        const buffer = await decodeAudioFile(file, ctx);
        const result = analyzeTrack(buffer);
        await ctx.close();

        const id = `${file.name}-${file.lastModified}`;
        const track = {
          id,
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Local file",
          color: "#20242d",
          url: objectUrl,
          source: "local",
        };

        analyses.current.set(id, result);
        additions.push(track);
      }

      setQueue((items) => [...items, ...additions]);
      if (!queue.length && additions.length) setIndex(0);
      setMessage(`${additions.length} track(s) added and analyzed.`);
    } catch (error) {
      setMessage(`Could not add music: ${error.message}`);
    }

    event.target.value = "";
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

          <label className="upload">
            + Add music
            <input
              type="file"
              accept="audio/*"
              multiple
              onChange={addFiles}
            />
          </label>
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
          <p className="eyebrow">LOCAL · NOW PLAYING</p>
          <h1>{current?.title || "Your music library"}</h1>
          <p className="artist">{current?.artist || "Add music to begin"}</p>
          <p className="status">{message}</p>

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
