# PULSE Music App

Provider-aware music player built with React + Vite.

## Playback modes

- **Local:** upload audio, Web Audio playback, stepped fade-out, analysis, scheduled smart crossfade.
- **Spotify:** official Spotify Web Playback SDK + Web API, OAuth PKCE, search and browser playback.
- **YouTube:** YouTube Data API search + official YouTube IFrame Player API playback.

Spotify Web Playback requires Premium. Spotify content is not processed through our Smart Transition engine. YouTube playback stays inside the official YouTube player.

## Setup

Copy `.env.example` to `.env` and set:

```
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
VITE_YOUTUBE_API_KEY=your_youtube_api_key
```

### Spotify

Create an app in the Spotify Developer Dashboard and add the exact redirect URI:
- Local: `http://127.0.0.1:5173/callback`
- Production: `https://YOUR_DOMAIN/callback`

Use PKCE; do not put a Spotify Client Secret in this browser app.

### YouTube

Enable **YouTube Data API v3** in Google Cloud, create an API key, and restrict it by HTTP referrer/domain before production.

## Run

```bash
npm install
npm run dev
```

## Architecture

```
React UI
  ├── Local -> SmartPlayer -> Web Audio API
  ├── Spotify -> Spotify Web Playback SDK
  └── YouTube -> YouTube IFrame Player API
```
