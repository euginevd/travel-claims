"""Turn recorded scenes into one video: each frame held until the next, marked waits played fast
or cut, scaled to 1600x900, a short fade between scenes, and a captions file in step.

Usage: python assemble.py walkthrough.mp4 01-landing 02-repo ...
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SCENES = HERE / "scenes"
FPS = 30
FADE = 0.3
# A frame held for less than this is dropped: it plays inside a wait that was cut or sped up.
SHORTEST = 0.0005
NOTE = "The walkthrough has no sound: these are the captions shown on screen, with their timings."


def ffmpeg(*args: str, cwd: Path) -> None:
    """Run ffmpeg, found on the path, with fixed arguments built here."""
    exe = shutil.which("ffmpeg")
    if exe is None:
        sys.exit("ffmpeg isn't on the path")
    subprocess.run([exe, "-y", "-loglevel", "error", *args], cwd=cwd, check=True)  # noqa: S603


def speed_at(t: float, marks: list[dict]) -> float:
    """How fast the recording plays at a moment: the first mark that covers it, else 1."""
    for m in marks:
        if m["a"] <= t < m["b"]:
            return m["speed"]
    return 1.0


def out_time(t: float, t0: float, marks: list[dict]) -> float:
    """Where a moment of the recording lands in the scene's clip."""
    inside = [x for m in marks for x in (m["a"], m["b"]) if t0 < x < t]
    edges = sorted({t0, t, *inside})
    total = 0.0
    for a, b in zip(edges, edges[1:], strict=False):
        speed = speed_at(a, marks)
        total += 0 if speed == 0 else (b - a) / speed
    return total


def build(name: str) -> tuple[Path, float, list[tuple[float, float, str]]]:
    """One scene's clip, its length and its captions' times."""
    rec = json.loads((SCENES / name / "rec.json").read_text())
    t0, end, marks = rec["t0"], rec["end"], rec["marks"]
    frames = [f for f in rec["frames"] if f["t"] >= t0 - 0.05] or rec["frames"][-1:]
    lines = ["ffconcat version 1.0"]
    length = 0.0
    times = [max(f["t"], t0) for f in frames] + [end]
    for f, a, b in zip(frames, times, times[1:], strict=False):
        held = out_time(b, t0, marks) - out_time(a, t0, marks)
        if held <= SHORTEST:
            continue
        lines += [f"file '{f['file']}'", f"duration {held:.4f}"]
        length += held
    lines.append(f"file '{frames[-1]['file']}'")
    (SCENES / name / "list.txt").write_text("\n".join(lines) + "\n")
    clip = SCENES / f"{name}.mp4"
    fade = f"fade=t=in:st=0:d={FADE},fade=t=out:st={max(0, length - FADE):.3f}:d={FADE}"
    ffmpeg(
        *("-f", "concat", "-safe", "0", "-i", "list.txt"),
        *("-vf", f"fps={FPS},scale=1600:900:flags=lanczos,{fade},format=yuv420p"),
        *("-t", f"{length:.3f}", "-c:v", "libx264", "-preset", "slow", "-crf", "20"),
        *("-r", str(FPS), str(clip)),
        cwd=SCENES / name,
    )
    caps = rec["caps"]
    cues = []
    for i, cap in enumerate(caps):
        if not cap["text"].strip():
            continue
        a = out_time(cap["t"], t0, marks)
        b = out_time(caps[i + 1]["t"], t0, marks) if i + 1 < len(caps) else length
        cues.append((a, b, cap["text"]))
    print(f"{name}: {length:.1f} s")
    return clip, length, cues


def stamp(s: float) -> str:
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    return f"{int(h):02d}:{int(m):02d}:{sec:06.3f}"


def main(order: list[str], out: Path) -> None:
    offset, all_cues, clips = 0.0, [], []
    for name in order:
        clip, length, cues = build(name)
        clips.append(clip)
        all_cues += [(offset + a, offset + b, t) for a, b, t in cues]
        offset += length
    (SCENES / "all.txt").write_text("".join(f"file '{c.name}'\n" for c in clips))
    ffmpeg(
        *("-f", "concat", "-safe", "0", "-i", "all.txt"),
        *("-c", "copy", "-movflags", "+faststart", str(out)),
        cwd=SCENES,
    )
    vtt = ["WEBVTT", "", "NOTE", NOTE, ""]
    for a, b, t in all_cues:
        vtt += [f"{stamp(a)} --> {stamp(b)}", t, ""]
    out.with_suffix(".en.vtt").write_text("\n".join(vtt), encoding="utf-8")
    print(f"total {offset:.1f} s -> {out}")


if __name__ == "__main__":
    main(sys.argv[2:], Path(sys.argv[1]).resolve())
