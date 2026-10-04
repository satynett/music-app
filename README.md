# Music App

A web music player focused on smooth, intelligent transitions between songs.

## MVP

- Local audio file playback
- Play / pause / previous / next
- Queue
- Volume control
- Smooth 2-second fade-out on pause/stop
- Crossfade between tracks
- Intro analysis for a smarter entry point
- Energy/onset visualization
- No external music hosting

## Run

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Architecture

React UI -> SmartPlayer -> Web Audio API -> Analyzer

The transition engine is intentionally independent from the music source, so a compliant remote music provider can be integrated later.
