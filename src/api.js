const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Search YouTube / YouTube Music
 */
export async function searchYoutube(query, limit = 12) {
  const res = await fetch(
    `${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Search failed");
  }
  const data = await res.json();
  return data.results || [];
}

/**
 * Get a playable stream URL for a YouTube video ID
 */
export async function getStreamInfo(videoId) {
  const res = await fetch(
    `${API_BASE}/api/stream?id=${encodeURIComponent(videoId)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to get stream");
  }
  return res.json();
}

/**
 * Build a track object that SmartPlayer can use.
 * Uses the proxy endpoint to avoid CORS issues with YouTube CDNs.
 */
export function createYoutubeTrack(streamInfo) {
  const proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(streamInfo.streamUrl)}`;

  return {
    id: `yt-${streamInfo.id}`,
    title: streamInfo.title || "Unknown title",
    artist: streamInfo.artist || "Unknown artist",
    duration: streamInfo.duration || 0,
    thumbnail: streamInfo.thumbnail || null,
    url: proxyUrl,           // Play through our proxy → no CORS problems
    directUrl: streamInfo.streamUrl,
    source: "youtube",
    color: "#ff0033",
  };
}
