import { useEffect, useMemo, useRef, useState } from "react";
import { SmartPlayer } from "./audio/SmartPlayer";
import { analyzeTrack, decodeAudioFile, chooseTransition } from "./audio/analyzer";

const demoTracks = [
  {
    id: "demo-1",
    title: "Midnight Drive",
    artist: "Demo Artist",
    color: "#6d5dfc",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  },
  {
    id: "demo-2",
    title: "Neon Rain",
    artist: "Demo Artist",
    color: "#00a896",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  },
];

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function App() {
  const playerRef = useRef(null);
  const [queue, setQueue] = useState(demoTracks);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [smart, setSmart] = useState(true);
  const analyses = useRef(new Map());
  const [message, setMessage] = useState("Ready for intelligent transitions.");
  const [analysis, setAnalysis] = useState(null);

  const current = queue[index];

  const player = useMemo(() => new SmartPlayer({
    onStateChange: (state) => {
      setPosition(state.currentTime);
      setDuration(state.duration);
      if (state.playing !== undefined) setPlaying(state.playing);
      if (state.ended) setPlaying(false);
    },
  }), []);

  useEffect(() => {
    playerRef.current = player;
    return () => player.destroy();
  }, [player]);

  async function togglePlay() {
    if (playing) {
      setMessage("Fading out…");
      await player.fadePause(2000);
      return;
    }
    setMessage("Playing");
    await player.play(current);
  }

  async function getAnalysis(track) {
    if (analyses.current.has(track.id)) return analyses.current.get(track.id);
    setMessage(`Analyzing ${track.title}…`);
    const ctx = new AudioContext();
    const response = await fetch(track.url);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const result = analyzeTrack(buffer);
    await ctx.close();
    analyses.current.set(track.id, result);
    return result;
  }

  async function next() {
    const nextIndex = (index + 1) % queue.length;
    const nextTrack = queue[nextIndex];

    if (!smart) {
      await player.crossfade(nextTrack, { crossfadeSeconds: 4, entryAt: 0 });
      setIndex(nextIndex);
      setMessage("4-second crossfade");
      return;
    }

    const [a, b] = await Promise.all([getAnalysis(current), getAnalysis(nextTrack)]);
    const transition = chooseTransition(a, b);
    setAnalysis({ ...transition, nextTitle: nextTrack.title });
    await player.crossfade(nextTrack, transition);
    setIndex(nextIndex);
    setMessage(`Smart: A ends ${formatTime(transition.exitAt)} → B starts ${transition.entryAt.toFixed(1)}s → ${transition.crossfadeSeconds}s blend`);
  }

  async function addFiles(event) {
    const files = [...event.target.files];
    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      const ctx = new AudioContext();
      const buffer = await decodeAudioFile(file, ctx);
      const result = analyzeTrack(buffer);
      await ctx.close();
      const id = `${file.name}-${file.lastModified}`;
      const track = { id, title: file.name.replace(/\.[^/.]+$/, ""), artist: "Local file", color: "#20242d", url: objectUrl };
      analyses.current.set(id, result);
      setQueue((items) => [...items, track]);
    }
    if (files.length) setMessage(`${files.length} track(s) analyzed and added`);
  }

  function previous() {
    const previousIndex = (index - 1 + queue.length) % queue.length;
    setIndex(previousIndex);
    setMessage("Previous track");
  }

  function addFiles(event) {
    const files = [...event.target.files];
    const additions = files.map((file, i) => ({
      id: `${file.name}-${file.lastModified}-${i}`,
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "Local file",
      color: "#20242d",
      url: URL.createObjectURL(file),
    }));
    if (additions.length) {
      setQueue((items) => [...items, ...additions]);
      setMessage(`${additions.length} track(s) added`);
    }
  }

  function seek(event) {
    const value = Number(event.target.value);
    const element = player.current?.element;
    if (element) element.currentTime = value;
    setPosition(value);
  }

  function changeVolume(event) {
    const value = Number(event.target.value);
    setVolume(value);
    if (player.current?.gain) player.current.gain.gain.value = value;
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-dot" />PULSE</div>
        <label className="upload">
          + Add music
          <input type="file" accept="audio/*" multiple onChange={addFiles} />
        </label>
      </header>

      <section className="hero">
        <div className="art" style={{ background: `linear-gradient(135deg, ${current.color}, #10131a)` }}>
          <span>♫</span>
        </div>

        <div className="details">
          <p className="eyebrow">NOW PLAYING</p>
          <h1>{current.title}</h1>
          <p className="artist">{current.artist}</p>
          <p className="status">{message}</p>

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
              <strong>Transition plan</strong>
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
        {queue.map((track, i) => (
          <button
            className={`track ${i === index ? "active" : ""}`}
            key={track.id}
            onClick={async () => {
              setIndex(i);
              await player.crossfade(track, 2500, smart ? 2 : 0);
              setMessage("Transition complete");
            }}
          >
            <span className="track-number">{i + 1}</span>
            <span className="track-info"><strong>{track.title}</strong><small>{track.artist}</small></span>
            <span>{i === index ? (playing ? "Playing" : "Paused") : "Play"}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
