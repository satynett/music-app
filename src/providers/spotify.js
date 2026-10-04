const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = window.location.origin + "/callback";
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function challenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  return base64Url(await crypto.subtle.digest("SHA-256", data));
}

export async function spotifyLogin() {
  if (!CLIENT_ID) throw new Error("Missing VITE_SPOTIFY_CLIENT_ID");
  const verifier = randomString();
  const state = randomString(24);
  localStorage.setItem("spotify_code_verifier", verifier);
  localStorage.setItem("spotify_state", state);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    state,
  });
  window.location.href = url.toString();
}

export async function finishSpotifyLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;
  const state = params.get("state");
  if (state !== localStorage.getItem("spotify_state")) throw new Error("Spotify OAuth state mismatch");
  const verifier = localStorage.getItem("spotify_code_verifier");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error("Spotify token exchange failed");
  const token = await response.json();
  localStorage.setItem("spotify_token", JSON.stringify({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  }));
  history.replaceState({}, "", "/");
  return token.access_token;
}

export async function getSpotifyToken() {
  const saved = JSON.parse(localStorage.getItem("spotify_token") || "null");
  if (!saved) return null;
  if (Date.now() < saved.expiresAt - 60000) return saved.accessToken;
  if (!saved.refreshToken) return null;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: saved.refreshToken,
    }),
  });
  if (!response.ok) return null;
  const token = await response.json();
  const next = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || saved.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  localStorage.setItem("spotify_token", JSON.stringify(next));
  return next.accessToken;
}

export async function spotifyFetch(path, options = {}) {
  const token = await getSpotifyToken();
  if (!token) throw new Error("Connect Spotify first");
  const response = await fetch("https://api.spotify.com/v1" + path, {
    ...options,
    headers: { Authorization: "Bearer " + token, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error("Spotify request failed (" + response.status + ")");
  return response.json();
}

export async function spotifySearch(query) {
  const data = await spotifyFetch("/search?" + new URLSearchParams({
    q: query, type: "track", limit: "12",
  }));
  return data.tracks.items.map((track) => ({
    id: track.id,
    uri: track.uri,
    source: "spotify",
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.album.name,
    artwork: track.album.images?.[0]?.url,
  }));
}

export async function loadSpotifySdk() {
  if (window.Spotify) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Spotify Web Playback SDK"));
    document.head.appendChild(script);
  });
}

export async function createSpotifyPlayer({ onState, onReady }) {
  await loadSpotifySdk();
  const player = new window.Spotify.Player({
    name: "Pulse Web Player",
    volume: 0.9,
    getOAuthToken: async (cb) => cb(await getSpotifyToken()),
  });
  player.addListener("player_state_changed", onState);
  player.addListener("ready", ({ device_id }) => onReady(device_id));
  player.addListener("initialization_error", ({ message }) => console.error(message));
  player.addListener("authentication_error", ({ message }) => console.error(message));
  await player.connect();
  return player;
}

export async function spotifyPlay(uri, deviceId) {
  await spotifyFetch("/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
    headers: { "Content-Type": "application/json" },
  });
  const token = await getSpotifyToken();
  const response = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + encodeURIComponent(deviceId), {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!response.ok) throw new Error("Spotify could not start playback (" + response.status + ")");
}
