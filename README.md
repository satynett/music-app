# PULSE Music App

A local-first music player built with React + Vite. The current MVP is focused entirely on local audio so the Smart Transition engine can control the actual audio signal.

## Current MVP

- Local music playback
- Add multiple audio files
- Search local queue
- Play / pause / next / previous
- 2-second stop fade: 100% → 75% → 50% → 25% → 0%
- Crossfade: outgoing track fades down while the next track fades up
- Smart transition analysis: intro energy, silence, onset and approximate BPM
- Recommended entry point for the next track
- Crossfade duration based on analyzed tracks
- Scheduled transition at the calculated exit point
- `music/` folder reserved for local music files and ignored by Git

## Music folder

The repository contains a blank `music/` folder placeholder.

Put your local music files inside:

    music/
      song-1.mp3
      song-2.mp3
      song-3.wav

Music files are ignored by Git so your personal audio is not accidentally committed to the repository.

For the current browser MVP, use **+ Add music** to load those files into the player. Later we can add automatic library discovery and persistent metadata.

## Run

    npm install
    npm run dev

## Architecture

    React UI
       ↓
    Local Music Queue
       ↓
    SmartPlayer
       ├── Fade Controller
       ├── Crossfade Controller
       └── Web Audio routing
              ↓
       Audio Analyzer
       ├── Energy
       ├── Silence
       ├── Onset
       ├── Approx. BPM
       └── Recommended entry point

The browser Web Audio API provides the audio graph and gain control used for fades and crossfades.