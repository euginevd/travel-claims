"""A voiceover from the captions, by Kokoro run locally (kokoro-onnx, model files beside it in
`model/`): each caption read aloud by Kokoro, laid at its caption's start.
Where a line runs longer than its caption's time on screen, the picture holds just before the
next caption (clear of the scene fades) until the line ends. Writes the video with sound and
captions retimed to match."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
# Usage: python voice.py <video> <captions.vtt> <out.mp4> [voice] [speed]
_ARGS = sys.argv[1:6]
_ARGS += ["af_heart", "1.2"][max(0, len(_ARGS) - 3) :]
VIDEO, VTT, OUT = (Path(a) for a in _ARGS[:3])
VOICE, SPEED = _ARGS[3], float(_ARGS[4])
RATE = 24000
GAP = 0.35  # silence after a line before the next one starts
HOLD_BEFORE = 0.45  # hold this far before the next caption, clear of a scene's fade

SAY = [
    (r"\bAWS\b", "Amazon Web Services"),
    (r"CLM-1048", "claim ten forty-eight"),
    (r"\$174\.87", "a hundred and seventy-four dollars eighty-seven"),
    (r"\bOWASP's\b", "oh-wasp's"),
    (r"\bOWASP\b", "oh-wasp"),
    (r"\bR1\b", "R one"),
    (r"\bIaC\b", "infrastructure-as-code"),
    (r"\bCodeQL\b", "Code Q L"),
    (r"\bPR\b", "pull request"),
    (r"\bAgentCore\b", "Agent Core"),
    (r"\bUnderCover\b", "Under Cover"),
    (r"\bMCP\b", "M C P"),
    (r"\bCSA\b", "C S A"),
    (r"\bLLM\b", "L L M"),
    (r"\bSTRIDE\b", "stride"),
    (r"\bMAESTRO\b", "Maestro"),
    (r"(apps|infra|docs)/", r"\1"),
    (r"12 months", "twelve months"),
]


def spoken(text: str) -> str:
    for pattern, words in SAY:
        text = re.sub(pattern, words, text)
    return text


def cues(path: Path) -> list[tuple[float, float, str]]:
    found = []
    for block in path.read_text(encoding="utf-8").split("\n\n"):
        m = re.match(r"(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\n(.+)", block.strip(), re.S)
        if m:
            a = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
            b = int(m[4]) * 3600 + int(m[5]) * 60 + float(m[6])
            found.append((a, b, m[7].strip()))
    return found


def narrated(lines: list[tuple[float, float, str]]) -> list[tuple[float, float, str]]:
    """NARRATION names a script with one spoken line per caption, said at that caption's moment
    in place of its words. Without it, the captions are read as they are."""
    script = os.environ.get("NARRATION")
    if not script:
        return lines
    text = Path(script).read_text(encoding="utf-8")
    said = [x.strip() for x in text.splitlines() if x.strip() and not x.startswith("#")]
    if len(said) != len(lines):
        sys.exit(f"{script} has {len(said)} lines for {len(lines)} captions")
    return [(a, b, words) for (a, b, _), words in zip(lines, said, strict=True)]


def length(path: Path) -> float:
    out = subprocess.run(  # noqa: S603 - ffprobe with arguments built here
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout)


def stamp(s: float) -> str:
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    return f"{int(h):02d}:{int(m):02d}:{sec:06.3f}"


def main() -> None:
    kokoro = Kokoro(str(HERE / "model/kokoro-v1.0.onnx"), str(HERE / "model/voices-v1.0.bin"))
    lines = cues(VTT)
    lines = narrated(lines)
    total = length(VIDEO)
    clips = []
    for _, _, text in lines:
        audio, rate = kokoro.create(spoken(text), voice=VOICE, speed=SPEED, lang="en-us")
        if rate != RATE:
            sys.exit(f"Kokoro returned {rate} Hz, not {RATE}")
        clips.append(audio.astype(np.float32))
    # Hold points: just before each next caption, or the video's end for the last.
    holds = []  # (where in the original, how long)
    for i, (a, _, _) in enumerate(lines):
        nxt = lines[i + 1][0] if i + 1 < len(lines) else total
        need = len(clips[i]) / RATE + GAP
        extra = need - (nxt - a)
        if extra > 0:
            holds.append((max(a + 0.2, nxt - HOLD_BEFORE), extra))

    # Map an original time to the new timeline.
    def moved(t: float) -> float:
        return t + sum(h for at, h in holds if at < t)

    # Video: cut at each hold point, freeze the last frame for the hold, join.
    edges = [0.0] + [at for at, _ in holds] + [total]
    parts, graph = [], []
    for k in range(len(edges) - 1):
        hold = holds[k][1] if k < len(holds) else 0
        pad = f",tpad=stop_mode=clone:stop_duration={hold:.3f}" if hold else ""
        graph.append(
            f"[s{k}]trim=start={edges[k]:.3f}:end={edges[k + 1]:.3f},setpts=PTS-STARTPTS{pad}[v{k}]"
        )
        parts.append(f"[v{k}]")
    # One decode of the input, split for each part: trimming the same input many times crashes.
    graph.insert(0, f"[0:v]split={len(parts)}" + "".join(f"[s{k}]" for k in range(len(parts))))
    graph.append("".join(parts) + f"concat=n={len(parts)}:v=1:a=0[v]")
    new_total = moved(total) + 0.001
    # Audio: each line at its caption's new start.
    track = np.zeros(int(new_total * RATE) + RATE, dtype=np.float32)
    timed = []
    for (a, _, text), clip in zip(lines, clips, strict=True):
        start = moved(a) + 0.15
        i = int(start * RATE)
        track[i : i + len(clip)] += clip
        timed.append((moved(a), text))
    track = np.clip(track * 0.95, -1, 1)
    sf.write(HERE / "voice.wav", track, RATE)
    (HERE / "graph.txt").write_text(";".join(graph))
    subprocess.run(  # noqa: S603 - ffmpeg with arguments built here
        [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(VIDEO),
            "-i",
            str(HERE / "voice.wav"),
            "-/filter_complex",
            str(HERE / "graph.txt"),
            "-map",
            "[v]",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "25",
            "-tune",
            "stillimage",
            "-pix_fmt",
            "yuv420p",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar",
            "48000",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(OUT),
        ],
        check=True,
    )
    vtt = ["WEBVTT", "", "NOTE", "The voiceover's words, as captions, with their timings.", ""]
    for i, (a, text) in enumerate(timed):
        b = timed[i + 1][0] if i + 1 < len(timed) else moved(total)
        vtt += [f"{stamp(a)} --> {stamp(b)}", text, ""]
    OUT.with_suffix(".en.vtt").write_text("\n".join(vtt), encoding="utf-8")
    print(
        json.dumps(
            {
                "holds": len(holds),
                "added": round(sum(h for _, h in holds), 1),
                "length": round(moved(total), 1),
            }
        )
    )


if __name__ == "__main__":
    main()
