let apiPromise;

export async function searchYouTube(query) {
  const key = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!key) throw new Error("Missing VITE_YOUTUBE_API_KEY");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "12",
    key,
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error("YouTube search failed (" + response.status + ")");
  const data = await response.json();
  return data.items.map((item) => ({
    id: item.id.videoId,
    source: "youtube",
    title: item.snippet.title,
    artist: item.snippet.channelTitle,
    artwork: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
  }));
}

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Could not load YouTube IFrame API"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export async function createYouTubePlayer(elementId, onStateChange) {
  await loadYouTubeApi();
  return new Promise((resolve) => {
    new window.YT.Player(elementId, {
      width: "100%",
      height: "100%",
      videoId: "",
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: (event) => resolve(event.target),
        onStateChange,
      },
    });
  });
}
