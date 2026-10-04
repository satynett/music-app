import { useEffect, useRef } from "react";

export function AudioVisualizer({ player, playing, blending, currentTitle, nextTitle }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = player?.getAnalyser?.();
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    const frequency = new Uint8Array(analyser.frequencyBinCount);
    const waveform = new Uint8Array(analyser.fftSize);
    let frame;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    function draw() {
      frame = requestAnimationFrame(draw);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(waveform);

      ctx.clearRect(0, 0, width, height);

      const bars = Math.min(72, frequency.length);
      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);

      for (let i = 0; i < bars; i++) {
        const sourceIndex = Math.floor((i / bars) * frequency.length);
        const value = frequency[sourceIndex] / 255;
        const barHeight = Math.max(3, value * height * 0.72);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        const gradient = ctx.createLinearGradient(0, y, 0, height);
        gradient.addColorStop(0, blending ? "#ffffff" : "#9b8cff");
        gradient.addColorStop(1, blending ? "#7c6cff" : "#40386d");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      ctx.beginPath();
      for (let i = 0; i < waveform.length; i += 8) {
        const x = (i / waveform.length) * width;
        const y = height * 0.5 + ((waveform[i] - 128) / 128) * height * 0.22;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = blending ? "rgba(255,255,255,.55)" : "rgba(184,175,255,.45)";
      ctx.stroke();
    }

    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [player, playing, blending]);

  return (
    <div className={`visualizer ${playing ? "is-playing" : ""} ${blending ? "is-blending" : ""}`}>
      <canvas ref={canvasRef} />
      <div className="visualizer-overlay">
        <span>{blending ? "BLENDING" : "LIVE AUDIO"}</span>
        {blending && (
          <strong>
            {currentTitle} <b>→</b> {nextTitle}
          </strong>
        )}
      </div>
    </div>
  );
}
