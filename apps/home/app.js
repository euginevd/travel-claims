// The landing page: the apps' links and the walkthrough. No customer data is read here.

// THE WALKTHROUGH VIDEO. null shows the still and "coming soon". Once the end-to-end recording
// exists, set this to its path, for example "media/walkthrough.mp4", and the frame becomes a
// poster with one play button under it, and a light control bar there once it plays. (Then recompute
// app.js's integrity hash in index.html.)
const WALKTHROUGH = "media/walkthrough.mp4";

// Each app's address: on AWS from links.json, which the deploy writes; locally this host and its port.
const PORT_APP = { 5173: "portal", 5174: "dashboard", 5175: "console" };
let links = null;

function appUrl(port) {
  if (links && links[PORT_APP[port]]) return links[PORT_APP[port]];
  const url = new URL(window.location.href);
  url.port = port;
  url.pathname = "/";
  url.hash = "";
  url.search = "";
  return url.toString();
}

function setUpLinks() {
  document.querySelectorAll("a[data-port]").forEach((link) => {
    link.href = appUrl(link.dataset.port);
  });
}

function setUpWalkthrough() {
  if (!WALKTHROUGH) return;
  const video = document.getElementById("walkthrough");
  const play = document.getElementById("walkthrough-play");
  video.src = WALKTHROUGH;
  video.hidden = false;
  play.hidden = false;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    play.hidden = true;
    setUpPlayer(video);
    video.play().catch(() => {
      // The browser blocked playing: the bar's play button starts it.
    });
  };
  play.addEventListener("click", start);
  video.addEventListener("click", start); // the poster starts it too
  document.getElementById("walkthrough-still").hidden = true;
  document.getElementById("walkthrough-soon").hidden = true;
}

// A light control bar under the video, in place of the browser's own, whose dark gradient sits
// over the picture. Full screen still uses the browser's controls.
function setUpPlayer(video) {
  const bar = document.getElementById("walkthrough-bar");
  const toggle = document.getElementById("pl-toggle");
  const time = document.getElementById("pl-time");
  const seek = document.getElementById("pl-seek");
  const mute = document.getElementById("pl-mute");
  const full = document.getElementById("pl-full");
  bar.hidden = false;

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const label = (button, icon, words) => {
    button.querySelector("use").setAttribute("href", icon);
    button.querySelector(".sr-only").textContent = words;
  };
  const showTime = () => {
    if (Number.isFinite(video.duration)) seek.max = String(video.duration);
    seek.value = String(video.currentTime);
    time.textContent = `${clock(video.currentTime)} / ${clock(video.duration || 0)}`;
  };
  const showPlaying = () => label(toggle, video.paused ? "#i-play" : "#i-pause", video.paused ? "Play" : "Pause");
  const flip = () => (video.paused ? video.play().catch(() => {}) : video.pause());

  toggle.addEventListener("click", flip);
  video.addEventListener("click", flip);
  video.addEventListener("play", showPlaying);
  video.addEventListener("pause", showPlaying);
  video.addEventListener("timeupdate", showTime);
  video.addEventListener("loadedmetadata", showTime);
  seek.addEventListener("input", () => {
    video.currentTime = Number(seek.value);
  });
  mute.addEventListener("click", () => {
    video.muted = !video.muted;
    label(mute, video.muted ? "#i-mute" : "#i-volume", video.muted ? "Unmute" : "Mute");
  });
  full.addEventListener("click", () => {
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    video.controls = document.fullscreenElement === video;
  });
  showTime();
  showPlaying();
}

function loadLinks() {
  return fetch("links.json", { headers: { Accept: "application/json" }, cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((found) => {
      links = found && typeof found.portal === "string" ? found : null;
    })
    .catch(() => {
      // Locally there's no links.json, so the apps are on this host's ports.
    });
}

setUpWalkthrough();
loadLinks().then(setUpLinks);
