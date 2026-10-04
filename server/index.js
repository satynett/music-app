import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json());

// Helper to run yt-dlp
async function runYtDlp(args) {
  try {
    const { stdout } = await execFileAsync("yt-dlp", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw new Error(err.stderr || err.message);
  }
}

/**
 * Search YouTube
 */
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const limit = Math.min(Number(req.query.limit) || 10, 20);

  if (!q) {
    return res.status(400).json({ error: "Missing search query" });
  }

  try {
    const raw = await runYtDlp([
      `ytsearch${limit}:${q}`,
      "--dump-json",
      "--no-playlist",
      "--flat-playlist",
      "--skip-download",
    ]);

    const lines = raw.trim().split("\n").filter(Boolean);
    const results = lines
      .map((line) => {
        try {
          const data = JSON.parse(line);
          return {
            id: data.id,
            title: data.title || "Unknown title",
            artist: data.uploader || data.channel || "Unknown artist",
            duration: data.duration || 0,
            thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || null,
            url: `https://www.youtube.com/watch?v=${data.id}`,
            source: "youtube",
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json({ results });
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

/**
 * Get audio stream info
 */
app.get("/api/stream", async (req, res) => {
  const videoId = req.query.id;
  const videoUrl = req.query.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

  if (!videoUrl) {
    return res.status(400).json({ error: "Missing id or url" });
  }

  try {
    const raw = await runYtDlp([
      videoUrl,
      "--dump-json",
      "--no-playlist",
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "--skip-download",
    ]);

    const data = JSON.parse(raw);
    const formats = data.formats || [];
    const audioFormats = formats
      .filter((f) => f.acodec !== "none" && f.vcodec === "none")
      .sort((a, b) => (b.abr || 0) - (a.abr || 0));

    const best = audioFormats[0] || formats.find((f) => f.acodec !== "none");

    if (!best?.url) {
      return res.status(404).json({ error: "No audio stream found" });
    }

    res.json({
      id: data.id,
      title: data.title,
      artist: data.uploader || data.channel || "Unknown",
      duration: data.duration,
      thumbnail: data.thumbnail,
      streamUrl: best.url,
      mimeType: best.mime_type || "audio/mp4",
      ext: best.ext || "m4a",
    });
  } catch (err) {
    console.error("Stream error:", err.message);
    res.status(500).json({ error: "Failed to get stream", details: err.message });
  }
});

/**
 * Proxy audio (fixed for CORS + Web Audio API)
 */
app.get("/api/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");

  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };

    // Only forward Range if it exists and is simple
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const response = await fetch(target, { headers });

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");

    res.status(response.status);

    // Copy important headers
    const copyHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    copyHeaders.forEach((h) => {
      const value = response.headers.get(h);
      if (value) res.setHeader(h, value);
    });

    // Stream the response
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("Proxy error:", err.message);
    if (!res.headersSent) {
      res.status(500).send("Proxy failed");
    }
  }
});

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`PULSE backend running on http://localhost:${PORT}`);
});