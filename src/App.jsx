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
  const [playlists, setPlaylists] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pulse-playlists") || "[]");
    } catch {
      return [];
    }
  });

  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  const analyses = useRef(new Map());
  const autoTransitionKey = useRef(null);
  const swipeRef = useRef(null);
  const suppressQueueClick = useRef(false);
  const [draggedQueueId, setDraggedQueueId] = useState(null);
  const [swipedQueueId, setSwipedQueueId] = useState(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const player = useMemo(() => new SmartPlayer({
    onStateChange: (state) => {
      setPosition(state.currentTime);
      setDuration(state.duration);
      if (state.playing !== undefined) setPlaying(state.playing);
      if (state.ended) {
        setPlaying(false);
        const q = queueRef.current;
        const i = indexRef.current;
        if (q.length > 1) {
          const nextIndex = (i + 1) % q.length;
          const nextTrack = q[nextIndex];
          autoTransitionKey.current = null;
          player.cancelTransition();
          setIndex(nextIndex);
          player.play(nextTrack).then(() => {
            setMessage("Playing next song.");
          }).catch((error) => {
            setMessage("Next track failed: " + error.message);
          });
        }
      }

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
  if (analyses.current.has(track.id)) {
    return analyses.current.get(track.id);
  }

  // For YouTube tracks we use a lighter fallback for now
  // Full analysis is still unstable with proxied streams
  if (track.source === "youtube") {
    const fallback = {
      duration: track.duration || 180,
      bpm: null,
      recommendedStart: 0.8 + Math.random() * 2.5, // random nice entry between 0.8s - 3.3s
      reason: "YouTube fallback analysis",
    };
    analyses.current.set(track.id, fallback);
    return fallback;
  }

  // Local files - full analysis
  const ctx = new AudioContext();
  try {
    const response = await fetch(track.url);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const result = analyzeTrack(buffer);
    analyses.current.set(track.id, result);
    return result;
  } catch (err) {
    console.warn("Analysis failed:", err);
    const fallback = {
      duration: track.duration || 180,
      bpm: null,
      recommendedStart: 0,
    };
    analyses.current.set(track.id, fallback);
    return fallback;
  } finally {
    await ctx.close();
  }
}

  async function buildTransition(currentTrack, nextTrack) {
    const [currentAnalysis, nextAnalysis] = await Promise.all([
      getAnalysis(currentTrack),
      getAnalysis(nextTrack),
    ]);

    if (!smart) {
      return {
        exitAt: Math.max(0, (currentAnalysis.duration || currentTrack.duration || 180) - 4),
        entryAt: 0,
        crossfadeSeconds: 4,
        bpmA: currentAnalysis.bpm,
        bpmB: nextAnalysis.bpm,
      };
    }

    const base = chooseTransition(currentAnalysis, nextAnalysis);
    const crossfadeSeconds = Math.max(3, Math.min(base.crossfadeSeconds || 6, 6));

    return {
      exitAt: Math.max(
        0,
        (currentAnalysis.duration || currentTrack.duration || 180) - crossfadeSeconds
      ),
      entryAt: nextAnalysis.recommendedStart ?? 0,
      crossfadeSeconds,
      bpmA: currentAnalysis.bpm,
      bpmB: nextAnalysis.bpm,
    };
  }

  // Prepare the next track before the current track finishes.
  // Automatic playback uses the same transition engine as manual Next.
  useEffect(() => {
    if (!current || queue.length < 2) return;

    const nextTrack = queue[(index + 1) % queue.length];
    if (!nextTrack || nextTrack.id === current.id) return;

    const key = `${current.id}->${nextTrack.id}->${smart}`;
    if (autoTransitionKey.current === key) return;
    autoTransitionKey.current = key;

    let cancelled = false;

    (async () => {
      try {
        const transition = await buildTransition(current, nextTrack);
        if (cancelled) return;

        setAnalysis({ ...transition, nextTitle: nextTrack.title });

        player.scheduleTransition(nextTrack, transition, () => {
          const nextIndex = queueRef.current.findIndex((t) => t.id === nextTrack.id);
          if (nextIndex >= 0) setIndex(nextIndex);
          setMessage(
            smart
              ? `Smart blend → next song starts at ${transition.entryAt.toFixed(1)}s`
              : "Crossfade done"
          );
        });
      } catch (error) {
        if (!cancelled) console.error("Auto-transition preparation failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      if (
        autoTransitionKey.current === key &&
        !player.crossfading &&
        player.transition?.nextTrack?.id === nextTrack.id
      ) {
        player.cancelTransition();
      }
    };
  }, [current?.id, queue, index, smart, player]);

  async function playTrack(track, trackIndex = null) {
    if (!track) return;
    const nextIndex = trackIndex ?? queue.findIndex((item) => item.id === track.id);
    if (nextIndex >= 0) setIndex(nextIndex);
    autoTransitionKey.current = null;
    player.cancelTransition();
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

    // Manual Next is a direct user action. Start the next media element
    // before awaiting async analysis so the browser keeps the user gesture.
    try {
      autoTransitionKey.current = null;
      player.cancelTransition();

      const currentDuration = Number(current.duration) || Number(player.current?.element?.duration) || 180;
      const quickCrossfade = Math.max(3, Math.min(smart ? 5 : 4, 6));
      const quickTransition = {
        exitAt: Math.max(0, currentDuration - quickCrossfade),
        entryAt: 0,
        crossfadeSeconds: quickCrossfade,
        bpmA: null,
        bpmB: null,
      };

      // Keep React's current-track index unchanged until SmartPlayer
      // finishes the handoff. Changing it here would re-run the automatic
      // transition effect and cancel the crossfade we just started.
      setAnalysis({ ...quickTransition, nextTitle: nextTrack.title });
      setMessage(smart ? "Starting smart transition…" : "Crossfading…");

      // This call happens directly from the button handler, preserving
      // browser media-play permission.
      await player.crossfade(nextTrack, quickTransition);

      setMessage(
        smart
          ? "Smart blend complete"
          : "Crossfade complete"
      );

      // Refine the transition metadata in the background for the next
      // automatic transition; never block manual playback on analysis.
      buildTransition(current, nextTrack)
        .then((transition) => {
          setAnalysis({ ...transition, nextTitle: nextTrack.title });
        })
        .catch((error) => console.warn("Background transition analysis failed:", error));
    } catch (error) {
      console.error("Next track failed:", error);
      setMessage("Next track failed: " + error.message);
      setIndex(nextIndex);
      try {
        await player.play(nextTrack);
      } catch (playError) {
        setMessage("Playback failed: " + playError.message);
      }
    }
  }


  function reorderQueue(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const currentId = queueRef.current[indexRef.current]?.id;
    setQueue((prev) => {
      const from = prev.findIndex((track) => track.id === sourceId);
      const to = prev.findIndex((track) => track.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const nextCurrentIndex = next.findIndex((track) => track.id === currentId);
      if (nextCurrentIndex >= 0) setIndex(nextCurrentIndex);
      return next;
    });
  }

  function handleQueueDragStart(event, track) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", track.id);
    setDraggedQueueId(track.id);
  }

  function handleQueueDragEnd() {
    setDraggedQueueId(null);
  }

  function handleQueueDrop(event, targetTrack) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain");
    reorderQueue(sourceId, targetTrack.id);
    setDraggedQueueId(null);
  }

  function handleQueuePointerDown(event, track) {
    if (event.pointerType === "mouse") return;
    swipeRef.current = {
      id: track.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleQueuePointerMove(event, track) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.id !== track.id) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) return;
    if (dx < -10) {
      swipe.moved = true;
      setSwipedQueueId(track.id);
    }
  }

  async function removeFromQueue(track) {
    const q = queueRef.current;
    const currentTrack = q[indexRef.current];
    if (!q.some((item) => item.id === track.id)) return;

    if (currentTrack?.id === track.id) {
      if (q.length === 1) {
        autoTransitionKey.current = null;
        player.cancelTransition();
        await player.fadePause(1200).catch(() => {});
        setQueue([]);
        setIndex(0);
        setAnalysis(null);
        setMessage("Queue cleared.");
        return;
      }

      const nextTrack = q[(indexRef.current + 1) % q.length];
      const currentDuration = Number(currentTrack.duration) || Number(player.current?.element?.duration) || 180;
      const crossfadeSeconds = Math.max(3, Math.min(smart ? 5 : 4, 6));
      const transition = {
        exitAt: Math.max(0, currentDuration - crossfadeSeconds),
        entryAt: 0,
        crossfadeSeconds,
        bpmA: null,
        bpmB: null,
      };

      try {
        autoTransitionKey.current = null;
        player.cancelTransition();
        setMessage("Removing current track and blending to next…");
        await player.crossfade(nextTrack, transition);
      } catch (error) {
        setMessage("Playback failed: " + error.message);
        return;
      }

      const nextQueue = q.filter((item) => item.id !== track.id);
      const nextIndex = nextQueue.findIndex((item) => item.id === nextTrack.id);
      setQueue(nextQueue);
      setIndex(Math.max(0, nextIndex));
      setMessage("Current track removed.");
      return;
    }

    const currentId = currentTrack?.id;
    const nextQueue = q.filter((item) => item.id !== track.id);
    const nextIndex = nextQueue.findIndex((item) => item.id === currentId);
    setQueue(nextQueue);
    setIndex(Math.max(0, nextIndex));
    setSwipedQueueId(null);
  }

  function handleQueuePointerUp(event, track) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.id !== track.id) return;
    const dx = event.clientX - swipe.startX;
    const shouldDelete = dx < -80 && swipe.moved;
    swipeRef.current = null;

    if (shouldDelete) {
      suppressQueueClick.current = true;
      setSwipedQueueId(track.id);
      removeFromQueue(track).finally(() => {
        window.setTimeout(() => {
          suppressQueueClick.current = false;
          setSwipedQueueId(null);
        }, 0);
      });
    } else {
      setSwipedQueueId(null);
    }
  }

  function handleQueuePointerCancel() {
    swipeRef.current = null;
    setSwipedQueueId(null);
  }

  async function previous() {
    if (!queue.length) return;
    const prevIndex = (index - 1 + queue.length) % queue.length;
    autoTransitionKey.current = null;
    player.cancelTransition();
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

  useEffect(() => {
    localStorage.setItem("pulse-playlists", JSON.stringify(playlists));
  }, [playlists]);

  function createPlaylist() {
    const name = window.prompt("Playlist name");
    const trimmed = name?.trim();
    if (!trimmed) return null;

    const existing = playlists.find(
      (playlist) => playlist.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setMessage(`Playlist “${existing.name}” already exists.`);
      return existing.name;
    }

    setPlaylists((prev) => [...prev, { name: trimmed, tracks: [] }]);
    setMessage(`Created playlist “${trimmed}”.`);
    return trimmed;
  }

  function addToPlaylist(result, playlistName) {
    if (!playlistName) return;

    setPlaylists((prev) =>
      prev.map((playlist) => {
        if (playlist.name !== playlistName) return playlist;
        if (playlist.tracks.some((track) => track.id === result.id)) return playlist;

        return {
          ...playlist,
          tracks: [...playlist.tracks, result],
        };
      })
    );

    setMessage(`Added “${result.title}” to “${playlistName}”.`);
  }

  async function addYoutubeToQueue(result) {
    if (queue.some((track) => track.id === `yt-${result.id}`)) {
      setMessage(`“${result.title}” is already in the queue.`);
      return;
    }

    setLoadingTrackId(result.id);
    setMessage(`Adding “${result.title}” to queue…`);

    try {
      const streamInfo = await getStreamInfo(result.id);
      const track = createYoutubeTrack(streamInfo);

      setQueue((prev) =>
        prev.some((item) => item.id === track.id) ? prev : [...prev, track]
      );
      setMessage(`Added “${track.title}” to queue.`);
    } catch (err) {
      setMessage(err.message || "Failed to add track to queue");
    } finally {
      setLoadingTrackId(null);
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
      autoTransitionKey.current = null;
      player.cancelTransition();
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
            <div key={item.id} className="track yt-result-row">
              <span className="track-number">▶</span>
              <span className="track-info">
                <strong>{item.title}</strong>
                <small>{item.artist} · {formatTime(item.duration)} · YouTube</small>
              </span>
              <div className="yt-result-actions">
                <button
                  className="result-action play-result"
                  disabled={loadingTrackId === item.id}
                  onClick={() => playYoutubeResult(item)}
                >
                  {loadingTrackId === item.id ? "Loading…" : "Play"}
                </button>
                <button
                  className="result-action"
                  disabled={loadingTrackId === item.id}
                  onClick={() => addYoutubeToQueue(item)}
                >
                  + Add to Queue
                </button>
                <button
                  className="result-action"
                  onClick={() => createPlaylist()}
                >
                  + Create Playlist
                </button>
                <select
                  className="playlist-select"
                  value=""
                  onChange={(e) => addToPlaylist(item, e.target.value)}
                  disabled={!playlists.length}
                  aria-label={`Add ${item.title} to playlist`}
                >
                  <option value="">
                    {playlists.length ? "Add to Playlist" : "Create a playlist first"}
                  </option>
                  {playlists.map((playlist) => (
                    <option key={playlist.name} value={playlist.name}>
                      {playlist.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
            <div
              className={"queue-track-wrap " + (i === index ? "active " : "") + (draggedQueueId === track.id ? "dragging " : "") + (swipedQueueId === track.id ? "swiped" : "")}
              key={track.id}
              draggable
              onDragStart={(event) => handleQueueDragStart(event, track)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleQueueDrop(event, track)}
              onDragEnd={handleQueueDragEnd}
              onPointerDown={(event) => handleQueuePointerDown(event, track)}
              onPointerMove={(event) => handleQueuePointerMove(event, track)}
              onPointerUp={(event) => handleQueuePointerUp(event, track)}
              onPointerCancel={handleQueuePointerCancel}
              title="Drag to reorder · swipe left to remove"
            >
              <button
                className={"track " + (i === index ? "active" : "")}
                onClick={() => {
                  if (suppressQueueClick.current) return;
                  playTrack(track, i);
                }}
              >
                <span className="queue-drag-handle" aria-hidden="true">⋮⋮</span>
                <span className="track-number">{i + 1}</span>
                <span className="track-info">
                  <strong>{track.title}</strong>
                  <small>{track.artist} · YouTube</small>
                </span>
                <span>{i === index && playing ? "Playing" : "Play"}</span>
              </button>
              <button
                className="queue-delete"
                aria-label={"Remove " + track.title + " from queue"}
                onClick={(event) => {
                  event.stopPropagation();
                  removeFromQueue(track);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </section>
    </main>
  );
}