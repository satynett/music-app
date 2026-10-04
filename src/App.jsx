import { useEffect, useMemo, useRef, useState } from "react";
import { SmartPlayer } from "./audio/SmartPlayer";
import { analyzeTrack, decodeAudioFile, chooseTransition } from "./audio/analyzer";
import {
  createSpotifyPlayer,
  finishSpotifyLogin,
  getSpotifyToken,
  spotifyLogin,
  spotifyPlay,
  spotifySearch,
} from "./providers/spotify";
import { createYouTubePlayer, searchYouTube } from "./providers/youtube";

const demoTracks = [
  { id: "demo-1", title: "Midnight Drive", artist: "Demo Artist", color: "#6d5dfc", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", source: "local" },
  { id: "demo-2", title: "Neon Rain", artist: "Demo Artist", color: "#00a896", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", source: "local" },
];

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

export default function App() {
  const [mode, setMode] = useState("local");
  const [queue, setQueue] = useState(demoTracks);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [smart, setSmart] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("Ready.");
  const [analysis, setAnalysis] = useState(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState(null);

  const localPlayer = useMemo(() => new SmartPlayer({
    onStateChange: (state) => {
      if (mode !== "local") return;
      setPosition(state.currentTime);
      setDuration(state.duration);
      if (state.playing !== undefined) setPlaying(state.playing);
      if (state.ended) setPlaying(false);
    },
  }), [mode]);

  const spotifyPlayerRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const analyses = useRef(new Map());

  const current = queue[index];

  useEffect(() => () => localPlayer.destroy(), [localPlayer]);

  useEffect(() => {
    (async () => {
      try {
        const token = await finishSpotifyLogin() || await getSpotifyToken();
        if (!token) return;
        const player = await createSpotifyPlayer({
          onReady: (deviceId) => {
            setSpotifyDeviceId(deviceId);
            setSpotifyConnected(true);
            setMessage("Spotify connected.");
          },
          onState: (state) => {
            if (!state || mode !== "spotify") return;
            setPlaying(!state.paused);
            setPosition(state.position / 1000);
            setDuration(state.duration / 1000);
          },
        });
        spotifyPlayerRef.current = player;
        setSpotifyConnected(true);
      } catch (error) {
        setMessage(error.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "youtube" || youtubePlayerRef.current) return;
    createYouTubePlayer("youtube-player", (event) => {
      const states = window.YT.PlayerState;
      if (event.data === states.PLAYING) setPlaying(true);
      if (event.data === states.PAUSED) setPlaying(false);
      if (event.data === states.ENDED) setPlaying(false);
    }).then((player) => { youtubePlayerRef.current = player; });
  }, [mode]);

  useEffect(() => () => {
    spotifyPlayerRef.current?.disconnect();
    youtubePlayerRef.current?.destroy?.();
  }, []);

  async function search() {
    if (!query.trim()) return;
    try {
      setMessage(`Searching ${mode === "spotify" ? "Spotify" : mode === "youtube" ? "YouTube" : "local music"}…`);
      if (mode === "spotify") {
        if (!spotifyConnected) throw new Error("Connect Spotify first.");
        setResults(await spotifySearch(query));
      } else if (mode === "youtube") {
        setResults(await searchYouTube(query));
      } else {
        setResults(queue.filter((track) =>
          `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase())
        ));
      }
      setMessage("Search complete.");
    } catch (error) {
      setMessage(error.message);
    }
  }

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
    const nextIndex = trackIndex ?? queue.findIndex((item) => item.id === track.id);
    if (nextIndex >= 0) setIndex(nextIndex);
    setMode("local");
    setMessage("Playing local audio.");
    await localPlayer.play(track);
  }

  async function playSpotify(track) {
    if (!spotifyDeviceId) throw new Error("Spotify player is not ready yet.");
    setMode("spotify");
    setQueue((items) => {
      const existing = items.findIndex((item) => item.id === track.id);
      if (existing >= 0) { setIndex(existing); return items; }
      const next = [...items, track];
      setIndex(next.length - 1);
      return next;
    });
    await spotifyPlay(track.uri, spotifyDeviceId);
    setMessage("Spotify playback started.");
  }

  async function playYouTube(track) {
    if (!youtubePlayerRef.current) {
      setMode("youtube");
      throw new Error("YouTube player is still loading. Try again.");
    }
    setMode("youtube");
    const existing = queue.findIndex((item) => item.id === track.id);
    if (existing < 0) {
      setQueue((items) => [...items, track]);
      setIndex(queue.length);
    } else {
      setIndex(existing);
    }
    youtubePlayerRef.current.loadVideoById(track.id);
    setPlaying(true);
    setMessage("YouTube playback started.");
  }

  async function selectResult(track) {
    try {
      if (track.source === "spotify") await playSpotify(track);
      else if (track.source === "youtube") await playYouTube(track);
      else await playLocal(track);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function togglePlay() {
    try {
      if (mode === "spotify") {
        if (!spotifyPlayerRef.current) return;
        if (playing) await spotifyPlayerRef.current.pause();
        else await spotifyPlayerRef.current.resume();
        return;
      }
      if (mode === "youtube") {
        if (playing) youtubePlayerRef.current?.pauseVideo();
        else youtubePlayerRef.current?.playVideo();
        return;
      }
      if (playing) {
        setMessage("Fading out…");
        await localPlayer.fadePause(2000);
      } else {
        await localPlayer.play(current);
        setMessage("Playing");
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function next() {
    if (mode !== "local") {
      if (mode === "spotify") await spotifyPlayerRef.current?.nextTrack();
      else if (mode === "youtube") {
        const nextIndex = (index + 1) % queue.length;
        const nextTrack = queue[nextIndex];
        if (nextTrack?.source === "youtube") {
          setIndex(nextIndex);
          youtubePlayerRef.current?.loadVideoById(nextTrack.id);
        }
      }
      return;
    }
    const nextIndex = (index + 1) % queue.length;
    const nextTrack = queue[nextIndex];
    if (!nextTrack) return;
    try {
      const [a, b] = await Promise.all([getAnalysis(current), getAnalysis(nextTrack)]);
      const transition = smart ? chooseTransition(a, b) : {
        exitAt: Math.max(0, a.duration - 4),
        entryAt: 0,
        crossfadeSeconds: 4,
        bpmA: a.bpm,
        bpmB: b.bpm,
      };
      setAnalysis({ ...transition, nextTitle: nextTrack.title });
      if (smart) {
        localPlayer.scheduleTransition(nextTrack, transition);
        setMessage(`Scheduled: ${formatTime(transition.exitAt)} → ${transition.entryAt.toFixed(1)}s`);
      } else {
        await localPlayer.crossfade(nextTrack, transition);
        setIndex(nextIndex);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function previous() {
    if (mode === "spotify") {
      await spotifyPlayerRef.current?.previousTrack();
      return;
    }
    if (mode === "youtube") {
      const previousIndex = (index - 1 + queue.length) % queue.length;
      const track = queue[previousIndex];
      if (track?.source === "youtube") {
        setIndex(previousIndex);
        youtubePlayerRef.current?.loadVideoById(track.id);
      }
      return;
    }
    const previousIndex = (index - 1 + queue.length) % queue.length;
    const track = queue[previousIndex];
    setIndex(previousIndex);
    await localPlayer.play(track);
  }

  function seek(event) {
    const value = Number(event.target.value);
    if (mode === "spotify") spotifyPlayerRef.current?.seek(value * 1000);
    else if (mode === "youtube") youtubePlayerRef.current?.seekTo(value, true);
    else if (localPlayer.current?.element) localPlayer.current.element.currentTime = value;
    setPosition(value);
  }

  function changeVolume(event) {
    const value = Number(event.target.value);
    setVolume(value);
    if (mode === "spotify") spotifyPlayerRef.current?.setVolume(value * 100);
    else if (mode === "youtube") youtubePlayerRef.current?.setVolume(value * 100);
    else localPlayer.setVolume(value);
  }

  async function addFiles(event) {
    const files = [...event.target.files];
    const additions = [];
    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      const ctx = new AudioContext();
      const buffer = await decodeAudioFile(file, ctx);
      const result = analyzeTrack(buffer);
      await ctx.close();
      const id = `${file.name}-${file.lastModified}`;
      const track = { id, title: file.name.replace(/\.[^/.]+$/, ""), artist: "Local file", color: "#20242d", url: objectUrl, source: "local" };
      analyses.current.set(id, result);
      additions.push(track);
    }
    if (additions.length) {
      setQueue((items) => [...items, ...additions]);
      setMessage(`${additions.length} local track(s) analyzed and added`);
    }
  }

  const isYouTube = mode === "youtube";

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-dot" />PULSE</div>
        <div className="top-actions">
          <button className={mode === "local" ? "pill active" : "pill"} onClick={() => setMode("local")}>Local</button>
          <button className={mode === "spotify" ? "pill active" : "pill"} onClick={() => setMode("spotify")}>Spotify</button>
          <button className={mode === "youtube" ? "pill active" : "pill"} onClick={() => setMode("youtube")}>YouTube</button>
          <label className="upload">+ Add music<input type="file" accept="audio/*" multiple onChange={addFiles} /></label>
        </div>
      </header>

      <section className="search-panel">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={mode === "local" ? "Search your music…" : `Search ${mode === "spotify" ? "Spotify" : "YouTube"}…`}
        />
        <button onClick={search}>Search</button>
        {mode === "spotify" && !spotifyConnected && (
          <button className="connect" onClick={() => spotifyLogin().catch((e) => setMessage(e.message))}>Connect Spotify</button>
        )}
      </section>

      {results.length > 0 && (
        <section className="results">
          <div className="queue-head"><h2>Search results</h2><span>{results.length}</span></div>
          {results.map((track) => (
            <button className="track result" key={track.id} onClick={() => selectResult(track)}>
              <img src={track.artwork || ""} alt="" />
              <span className="track-info"><strong>{track.title}</strong><small>{track.artist}{track.album ? ` · ${track.album}` : ""}</small></span>
              <span>Play</span>
            </button>
          ))}
        </section>
      )}

      {isYouTube && <div className="youtube-shell"><div id="youtube-player" /></div>}

      <section className="hero">
        <div className="art" style={{ background: `linear-gradient(135deg, ${current?.color || "#4c5cff"}, #10131a)` }}>
          <span>♫</span>
        </div>
        <div className="details">
          <p className="eyebrow">{mode.toUpperCase()} · NOW PLAYING</p>
          <h1>{current?.title || "Choose a track"}</h1>
          <p className="artist">{current?.artist || "Nothing playing"}</p>
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
            <label>Smart transition <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} disabled={mode !== "local"} /></label>
            <label className="volume">Vol <input type="range" min="0" max="1" step="0.01" value={volume} onChange={changeVolume} /></label>
          </div>

          {mode === "local" && analysis && (
            <div className="analysis-card">
              <strong>Smart transition plan</strong>
              <span>Exit A: {formatTime(analysis.exitAt)}</span>
              <span>Entry B: {analysis.entryAt.toFixed(1)}s</span>
              <span>Blend: {analysis.crossfadeSeconds}s</span>
              <span>BPM: {analysis.bpmA ?? "?"} → {analysis.bpmB ?? "?"}</span>
            </div>
          )}
          {mode !== "local" && (
            <div className="provider-note">
              {mode === "spotify"
                ? "Spotify playback stays inside Spotify's official Web Playback SDK. Our Smart Transition processing is disabled for Spotify content."
                : "YouTube playback uses the official YouTube IFrame player. YouTube controls, branding and playback behavior remain under YouTube's player."}
            </div>
          )}
        </div>
      </section>

      <section className="queue">
        <div className="queue-head"><h2>Queue</h2><span>{queue.length} tracks</span></div>
        {queue.map((track, i) => (
          <button className={`track ${i === index ? "active" : ""}`} key={track.id} onClick={() => selectResult(track)}>
            <span className="track-number">{i + 1}</span>
            <span className="track-info"><strong>{track.title}</strong><small>{track.artist} · {track.source}</small></span>
            <span>{i === index && playing ? "Playing" : "Play"}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
