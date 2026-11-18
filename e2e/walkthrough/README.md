# The walkthrough, recorded by script

Records `apps/home/media/walkthrough.mp4` from the local stack (decision 73). Each scene is a
Playwright script: Chrome's screencast keeps every frame, the page carries the caption, a section
tag and a cursor, and waits on the model are marked to play faster. `assemble.py` joins the scenes
with `ffmpeg`.

Needs the local stack up (`docker compose up -d`), `ffmpeg` on the path, and the red team, an exam
and an improvement round run on the console first, so its pages have something to show.

```bash
cd e2e/walkthrough
node s-intro.cjs                 # project page, repo, architecture, threat model
node reset-claims.cjs            # claims only, so Oliver's claim is new
node s-customer.cjs              # Oliver claims; writes claim.txt
# wait for the agent to decide the claim, then:
node s-handler.cjs               # Dana asks the Copilot and approves
node s-console.cjs               # the control plane, then the end card
python trim.py                   # speeds up typing and tab switching
python assemble.py walkthrough.mp4 01-landing 02-repo 03-customer 04-handler 05-overview 06-trace 07-evaluate 08-secure 09-govern 10-end
```

## The narrated version

The project page's "With voiceover" plays a narrated cut. Its script is [narration.txt](narration.txt): one spoken line for each caption, said as that caption's screen appears. The scenes are recorded again without the caption box (`NO_CAPTIONS=1`), into `scenes-voice/` (`SCENES=voice`), and `voice.py` reads the script with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), run locally, so no text leaves the machine. Where a line runs past its screen, the picture holds just before the next one. It writes `walkthrough-voice.mp4` and the script as its captions.

```bash
export SCENES=voice NO_CAPTIONS=1        # then record every scene as above
python trim.py
python assemble.py clean.mp4 01-landing 02-repo 03-customer 04-handler 05-overview 06-trace 07-evaluate 08-secure 09-govern 10-end
uv venv --python 3.12 .venv && uv pip install --python .venv kokoro-onnx soundfile
mkdir model   # kokoro-v1.0.onnx and voices-v1.0.bin from kokoro-onnx's model-files-v1.0 release
NARRATION=narration.txt .venv/Scripts/python voice.py clean.mp4 clean.en.vtt walkthrough-voice.mp4 af_heart 1.0
```

`node poster.cjs` draws the thumbnail (`poster.png`) from `slide.html`; save it as `apps/home/img/walkthrough-poster.jpg`.

`assemble.py` also writes `walkthrough.en.vtt` beside the video. Re-encode with
`ffmpeg -i walkthrough.mp4 -c:v libx264 -preset slow -crf 25 -tune stillimage -movflags +faststart -an final.mp4`
before copying it to `apps/home/media/`.
