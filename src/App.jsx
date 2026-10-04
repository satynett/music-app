import { useEffect, useMemo, useRef, useState } from "react";
import { SmartPlayer } from "./audio/SmartPlayer";
import { analyzeTrack, chooseTransition } from "./audio/analyzer";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { searchYoutube, getStreamInfo, createYoutubeTrack } from "./api";

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
  const [message, setMessage] = useState("Search YouTube for music.");
  const [analysis, setAnalysis] = useState(null);
  const [blend, setBlend] = useState(null);
  const [ytResults, setYtResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState(null);

  const queueRef = useRef(queue);
  const analyses = useRef(new Map());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const player = useMemo(() => new SmartPlayer({
    onStateChange: (state) => {
      setPosition(state.currentTime);
      setDuration(state.duration);
      if (state.playing !== undefined) setPlaying(state.playing);
      if (state.ended) setPlaying(false);

      if (state.transitionStart) {
        const currentTrack = queueRef.current.find((t) => t.id === state.transitionFromTrackId);
        const nextTrack = queueRef.current.find((t) => t.id === state.transitionTrackId);
        setBlend({
          currentTitle: currentTrack?.title || "Current",
          nextTitle: nextTrack?.title || "Next",
          seconds: state.transitionSeconds || 6,
        });
        window.setTimeout(() => setBlend(null), (state.transitionSeconds || 6) * 1000);
      }

      if (state.transitionTrackId) {
        const nextIndex = queueRef.current.findIndex((t) => t.id === state.transitionTrackId);
        if (nextIndex >= 0) setIndex(nextIndex);
      }
    },
  }), []);

  const current = queue[index];

  useEffect(() => () => player.destroy(), [player]);

  async function getAnalysis(track) {
    if (analyses.current.has(track.id)) return analyses.current.get(track.id);

    const ctx = new AudioContext();

    try {
      const response = await fetch(track.url);
      if (!response.ok) throw new Error("Failed to fetch audio");

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const result = analyzeTrack(audioBuffer, {
        analysisSeconds: 25,
        maxEntry: 12,
      });

      analyses.current.set(track.id, result);
      return result;
    } catch (err) {
      console.warn("Analysis failed for", track.title, err);
      const fallback = {
        duration: track.duration || 180,
        bpm: null,
        recommendedStart: 0,
        reason: "Fallback - analysis failed",
      };
      analyses.current.set(track.id, fallback);
      return fallback;
    } finally {
      await ctx.close();
    }
  }

  async function playTrack(track, trackIndex = null) {
    if (!track) return;
    const nextIndex = trackIndex ?? queue.findIndex((item) => item.id === track.id);
    if (nextIndex >= 0) setIndex(nextIndex);
    setMessage(`Playing “${track.title}”`);
    await player.play(track);
  }

  async function togglePlay() {
    if (!current) return setMessage("Search and play a track first.");
    try {
      if (playing) {
        setMessage("Fading out…");
        await player.fadePause(2000);
      } else {
        await player.play(current);
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
      setMessage("Preparing smart transition…");

      const [currentAnalysis, nextAnalysis] = await Promise.all([
        getAnalysis(current),
        getAnalysis(nextTrack),
      ]);

      let transition;

      if (smart) {
        const base = chooseTransition(currentAnalysis, nextAnalysis);
        const crossfadeSeconds = Math.max(5, Math.min(base.crossfadeSeconds || 6, 9));

        transition = {
          exitAt: Math.max(0, (currentAnalysis.duration || current.duration || 180) - crossfadeSeconds),
          entryAt: nextAnalysis.recommendedStart ?? 0,
          crossfadeSeconds,
          bpmA: currentAnalysis.bpm,
          bpmB: nextAnalysis.bpm,
        };
      } else {
        transition = {
          exitAt: currentAnalysis.duration || 180,
          entryAt: 0,
          crossfadeSeconds: 4,
        };
      }

      setAnalysis({ ...transition, nextTitle: nextTrack.title });
      await player.crossfade(nextTrack, transition);

      setIndex(nextIndex);
      setMessage(
        smart
          ? `Smart blend → next song starts at ${transition.entryAt.toFixed(1)}s`
          : "Crossfade done"
      );
    } catch (error) {
      console.error(error);
      setMessage("Transition failed: " + error.message);
      setIndex(nextIndex);
      await player.play(nextTrack);
    }
  }

  async function previous() {
    if (!queue.length) return;
    const prevIndex = (index - 1 + queue.length) % queue.length;
    setIndex(prevIndex);
    setAnalysis(null);
    await player.play(queue[prevIndex]);
    setMessage("Playing previous track.");
  }

  function seek(e) {
    const value = Number(e.target.value);
    if (player.current?.element) player.current.element.currentTime = value;
    setPosition(value);
  }

  function changeVolume(e) {
    const value = Number(e.target.value);
    setVolume(value);
    player.setVolume(value);
  }

  async function handleSearch() {
    if (!query.trim()) return;

    setSearching(true);
    setYtResults([]);
    setMessage("Searching YouTube…");

    try {
      const results = await searchYoutube(query.trim());
      setYtResults(results);
      setMessage(results.length ? `Found ${results.length} results.` : "No results found.");
    } catch (err) {
      setMessage(err.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function playYoutubeResult(result) {
    setLoadingTrackId(result.id);
    setMessage(`Getting stream for “${result.title}”…`);

    try {
      const streamInfo = await getStreamInfo(result.id);
      const track = createYoutubeTrack(streamInfo);

      setQueue((prev) => {
        if (prev.some((t) => t.id === track.id)) return prev;
        return [...prev, track];
      });

      const existingIndex = queue.findIndex((t) => t.id === track.id);
      const nextIndex = existingIndex >= 0 ? existingIndex : queue.length;
      setIndex(nextIndex);

      await player.play(track);
      setMessage(`Playing “${track.title}”`);
      setYtResults([]);
    } catch (err) {
      setMessage(err.message || "Failed to load track");
    } finally {
      setLoadingTrackId(null);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-dot" />PULSE</div>
      </header>

      <section className="search-panel">
        <div className="search-mode">
          <button className="active">YouTube</button>
        </div>

        <div className="search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search YouTube Music / songs…"
          />
          <button onClick={handleSearch} disabled={searching}>
            {searching ? "…" : "Search"}
          </button>
        </div>
      </section>

      {ytResults.length > 0 && (
        <section className="yt-results">
          <div className="queue-head">
            <h2>YouTube Results</h2>
            <span>{ytResults.length} tracks</span>
          </div>
          {ytResults.map((item) => (
            <button key={item.id} className="track" disabled={loadingTrackId === item.id} onClick={() => playYoutubeResult(item)}>
              <span className="track-number">▶</span>
              <span className="track-info">
                <strong>{item.title}</strong>
                <small>{item.artist} · {formatTime(item.duration)} · YouTube</small>
              </span>
              <span>{loadingTrackId === item.id ? "Loading…" : "Play"}</span>
            </button>
          ))}
        </section>
      )}

      <section className="hero">
        <div className="art-column">
          <AudioVisualizer
            player={player}
            playing={playing}
            blending={Boolean(blend)}
            currentTitle={blend?.currentTitle || current?.title || "Current track"}
            nextTitle={blend?.nextTitle || ""}
          />
        </div>

        <div className="details">
          <p className="eyebrow">YOUTUBE · NOW PLAYING</p>
          <h1>{current?.title || "Search for music"}</h1>
          <p className="artist">{current?.artist || "Search YouTube to start listening"}</p>
          <p className="status">{message}</p>

          <div className="now-playing-meta">
            <span className={playing ? "live-dot" : ""}>{playing ? "LIVE" : "PAUSED"}</span>
            <span>{queue.length} tracks</span>
            {analysis?.bpmA && <span>{analysis.bpmA} BPM</span>}
            {blend && <span className="blend-chip">↗ {blend.currentTitle} → {blend.nextTitle}</span>}
          </div>

          <div className="progress-row">
            <span>{formatTime(position)}</span>
            <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={seek} />
            <span>{formatTime(duration)}</span>
          </div>

          <div className="controls">
            <button onClick={previous}>↶</button>
            <button className="play" onClick={togglePlay}>{playing ? "Ⅱ" : "▶"}</button>
            <button onClick={next}>↷</button>
          </div>

          <div className="settings">
            <label>
              Smart transition
              <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
            </label>
            <label className="volume">
              Vol
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={changeVolume} />
            </label>
          </div>

          {analysis && (
            <div className="analysis-card">
              <strong>Smart transition plan</strong>
              <span>Exit A: {formatTime(analysis.exitAt)}</span>
              <span>Entry B: {analysis.entryAt.toFixed(1)}s</span>
              <span>Blend: {analysis.crossfadeSeconds}s</span>
              <span>BPM: {analysis.bpmA ?? "?"} → {analysis.bpmB ?? "?"}</span>
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
            <strong>Queue is empty.</strong>
            <span>Search YouTube to add music.</span>
          </div>
        ) : (
          queue.map((track, i) => (
            <button className={`track ${i === index ? "active" : ""}`} key={track.id} onClick={() => playTrack(track, i)}>
              <span className="track-number">{i + 1}</span>
              <span className="track-info">
                <strong>{track.title}</strong>
                <small>{track.artist} · YouTube</small>
              </span>
              <span>{i === index && playing ? "Playing" : "Play"}</span>
            </button>
          ))
        )}
      </section>
    </main>
  );
}