const EBS_URL = "https://spire-scryer-ebs.spire-scryer.workers.dev";

let authToken = null;
let channelId = null;

window.Twitch.ext.onAuthorized((auth) => {
  authToken = auth.token;
  channelId = auth.channelId;
});

function copyText(text) {
  const ta = document.createElement("textarea");

  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.setAttribute("readonly", "");

  document.body.appendChild(ta);

  ta.select();

  let ok = false;

  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(ta);

  return ok;
}

document.getElementById("copy-btn").addEventListener("click", () => {
  const cfg = document.getElementById("cfg-out").textContent;
  const btn = document.getElementById("copy-btn");
  const ok = copyText(cfg);

  btn.textContent = ok ? "Copied!" : "Failed";

  if (ok) btn.classList.add("ok");

  setTimeout(() => {
    btn.textContent = "Copy";
    btn.classList.remove("ok");
  }, 2000);
});

document.getElementById("gen-btn").addEventListener("click", async () => {
  const btn = document.getElementById("gen-btn");
  const statusEl = document.getElementById("status");

  btn.disabled = true;

  statusEl.textContent = "Requesting secret...";
  statusEl.className = "status";

  if (!authToken) {
    statusEl.textContent = "Not authorized yet. Reload.";
    statusEl.className = "status err";

    btn.disabled = false;

    return;
  }

  try {
    const res = await fetch(`${EBS_URL}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const txt = await res.text();

      statusEl.textContent = `Failed: ${res.status} ${txt}`;
      statusEl.className = "status err";

      btn.disabled = false;

      return;
    }

    const data = await res.json();
    const secret = data.secret;

    document.getElementById("secret-out").textContent = secret;
    document.getElementById("secret-wrap").style.display = "block";

    const cfg = `EBS_URL=${EBS_URL}\nMOD_SECRET=${secret}\nCHANNEL_ID=${channelId}\n`;

    document.getElementById("cfg-out").textContent = cfg;

    statusEl.textContent =
      "Secret generated. New secret replaces any previous one.";
    statusEl.className = "status ok";
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.className = "status err";
  } finally {
    btn.disabled = false;
  }
});
