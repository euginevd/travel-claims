// The landing page: the apps' links and the walkthrough. No customer data is read here.

// THE WALKTHROUGH VIDEO. null shows the still and "coming soon". Once the end-to-end recording
// exists, set this to its path, for example "media/walkthrough.mp4", and the frame becomes a
// player with the browser's own controls. (Then recompute app.js's integrity hash in index.html.)
const WALKTHROUGH = null;

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
  // The address beside each link: the page's own text locally, the deployed host on AWS.
  if (!links) return;
  document.querySelectorAll("[data-host-port]").forEach((host) => {
    host.textContent = new URL(appUrl(host.dataset.hostPort)).host;
  });
}

function setUpWalkthrough() {
  if (!WALKTHROUGH) return;
  const video = document.getElementById("walkthrough");
  video.src = WALKTHROUGH;
  video.controls = true;
  video.hidden = false;
  document.getElementById("walkthrough-still").hidden = true;
  document.getElementById("walkthrough-soon").hidden = true;
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
