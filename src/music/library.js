// Audio files placed in src/music/audio are picked up automatically by Vite.
const modules = import.meta.glob(
  "./audio/*.{mp3,wav,ogg,m4a,aac,flac}",
  {
    eager: true,
    query: "?url",
    import: "default",
  }
);

export const localTracks = Object.entries(modules)
  .map(([path, url]) => ({
    id: path,
    title: path
      .split("/")
      .pop()
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]+/g, " "),
    artist: "Local file",
    color: "#20242d",
    url,
    source: "local",
  }))
  .sort((a, b) => a.title.localeCompare(b.title));
