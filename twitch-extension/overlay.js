const EBS_URL = "https://spire-scryer-ebs.spire-scryer.workers.dev";

let currentState = null;
let activeDeckTab = "deck"; // deck | hand | draw | discard | exhaust

const RELIC_SLOT = {
  x0: 0.6,
  y: 8,
  w: 3.5,
  h: 6.0,
  gap: 0,
  perRow: 20,
};
const POTION_SLOT = { x0: 26.3, y: 0.8, w: 3, h: 5.5, gap: 0.15 };

function buildRelicHotspots(relics) {
  const container = document.getElementById("relic-hotspots");
  container.innerHTML = "";

  if (!relics) return;

  relics.forEach((relic, i) => {
    const x = RELIC_SLOT.x0 + i * (RELIC_SLOT.w + RELIC_SLOT.gap);
    const div = document.createElement("div");

    div.className = "hotspot hotspot-relic";
    div.style.left = x + "%";
    div.style.top = RELIC_SLOT.y + "%";
    div.style.width = RELIC_SLOT.w + "%";
    div.style.height = RELIC_SLOT.h + "%";
    div.dataset.idx = i;
    div.dataset.type = "relic";
    container.appendChild(div);
  });
}

function buildPotionHotspots(potionSlots) {
  const container = document.getElementById("potion-hotspots");
  container.innerHTML = "";

  if (!potionSlots) return;

  potionSlots.forEach((potion, i) => {
    if (!potion) return;

    const x = POTION_SLOT.x0 + i * (POTION_SLOT.w + POTION_SLOT.gap);
    const div = document.createElement("div");

    div.className = "hotspot hotspot-potion";
    div.style.left = x + "%";
    div.style.top = POTION_SLOT.y + "%";
    div.style.width = POTION_SLOT.w + "%";
    div.style.height = POTION_SLOT.h + "%";
    div.dataset.idx = i;
    div.dataset.type = "potion";
    container.appendChild(div);
  });
}

let channelId = null;

if (!window.Twitch || !window.Twitch.ext) {
  console.error("Twitch ext helper not loaded");
}

let lastBroadcastAt = 0;

window.Twitch.ext.onAuthorized((auth) => {
  channelId = auth.channelId;

  window.Twitch.ext.listen("broadcast", (target, contentType, message) => {
    lastBroadcastAt = Date.now();

    try {
      onState(JSON.parse(message));
    } catch (e) {
      console.error("parse err", e);
    }
  });

  pollFallback();
  setInterval(pollFallback, 15000);
});

async function pollFallback() {
  // Secondary path that only fires when PubSub has been silent for 10s.
  // Covers two cases: viewer joined mid-stream (missed the last broadcast) and payloads
  // too large for PubSub's 5KB cap (worker stores those in KV instead of broadcasting).
  if (!channelId) return;

  if (Date.now() - lastBroadcastAt < 10000) return;

  try {
    const res = await fetch(`${EBS_URL}/state/${channelId}`, {
      cache: "no-store",
    });

    if (res.ok) onState(await res.json());
  } catch {
    /* ignore */
  }
}

function onState(data) {
  if (data.error) {
    setStatus("error", data.message || "ERROR");

    currentState = null;

    buildRelicHotspots([]);
    buildPotionHotspots([]);
    return;
  }

  if (data.players) {
    // Decode the compact payload format produced by the worker:
    //   - cardDict maps each unique card id to its fields using 1-char keys (t/c/r/y/u/d/h)
    //     so we avoid repeating full card objects across deck + every pile.
    //   - h is a 1-char class code ("I"/"S"/"R"/"N"/"D"/"C"), only present when the card's
    //     class differs from the player's class (e.g. Colorless cards in an Ironclad deck).
    //   - Each pile (deck, hand, drawPile, etc.) is an array of card ids; we expand them here.
    data.players = data.players.map((p) => {
      if (!p.cardDict) return p;

      const charFromCode = (code) => {
        if (!code) return "";

        const map = {
          I: "IRONCLAD",
          S: "SILENT",
          R: "REGENT",
          N: "NECROBINDER",
          D: "DEFECT",
          C: "COLORLESS",
        };

        return map[code] || "";
      };

      const expandCard = (x) => {
        // A pile entry may already be an object (legacy / uncompressed path) — pass through.
        if (typeof x !== "string") return x;

        const m = p.cardDict[x] || {};

        return {
          id: x,
          title: m.t,
          cost: m.c,
          rarity: m.r,
          type: m.y,
          isUpgraded: m.u,
          description: m.d,
          character: charFromCode(m.h),
        };
      };

      const resolve = (arr) => (arr || []).map(expandCard);

      const relics = (p.relics || []).map((r) => ({
        id: r.id,
        title: r.t ?? r.title,
        rarity: r.r ?? r.rarity,
        stackCount: r.s ?? r.stackCount,
        description: r.d ?? r.description,
      }));

      const potionSlots = (p.potionSlots || []).map((po) =>
        po
          ? {
              id: po.id,
              title: po.t ?? po.title,
              rarity: po.r ?? po.rarity,
              description: po.d ?? po.description,
            }
          : null,
      );

      // Worker sometimes drops the top-level combat object to fit under Twitch's 5KB PubSub cap
      // but keeps the piles at the player level. Detect that case so we still show combat UI.
      const hasCombatPiles =
        p.hand?.length ||
        p.drawPile?.length ||
        p.discardPile?.length ||
        p.exhaustPile?.length;

      return {
        ...p,
        deck: resolve(p.deck),
        combat: p.combat
          ? {
              ...p.combat,
              hand: resolve(p.hand),
              drawPile: resolve(p.drawPile),
              discardPile: resolve(p.discardPile),
              exhaustPile: resolve(p.exhaustPile),
            }
          : hasCombatPiles
            ? {
                hand: resolve(p.hand),
                drawPile: resolve(p.drawPile),
                discardPile: resolve(p.discardPile),
                exhaustPile: resolve(p.exhaustPile),
              }
            : undefined,
        relics,
        potionSlots,
      };
    });
  }

  currentState = data;

  if (!data.inRun) {
    setStatus("ok", "NOT IN RUN");
    buildRelicHotspots([]);
    buildPotionHotspots([]);
    closePanels();
    return;
  }

  setStatus("ok", "CONNECTED");

  const me = data.players[0];

  buildRelicHotspots(me.relics);
  buildPotionHotspots(me.potionSlots);

  if (el("panel-deck").classList.contains("open")) renderDeckTab(me);

  if (el("panel-combat").classList.contains("open")) {
    // Combat panel already open — re-render with fresh data for whichever pile it's showing.
    // We read the title text rather than track pile state separately.
    const title = el("pc-title").textContent;
    let which = "discard";
    if (title === "Draw Pile") which = "draw";
    else if (title === "Exhaust Pile") which = "exhaust";
    openCombatPanel(which);
  }
}

function bbcodeToHtml(raw) {
  if (!raw) return "";

  let s = raw;

  s = s.replace(/\[img\][\s\S]*?\[\/img\]/gi, "");
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(
    /\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi,
    (_, color, text) => {
      const cls = colorToClass(color);
      return `<span class="${cls}">${text}</span>`;
    },
  );
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  s = s.replace(/\[\/?[^\]]+\]/g, "");
  s = s.replace(/\n/g, "<br>");

  return s;
}

function colorToClass(color) {
  const c = color.trim().toLowerCase();
  const named = {
    red: "r",
    green: "g",
    blue: "b",
    yellow: "y",
    gold: "y",
    orange: "y",
    cyan: "b",
    teal: "b",
    lime: "g",
  };

  if (named[c]) return named[c];

  if (c.startsWith("#")) {
    const rgb = parseHex(c);

    if (rgb) return rgbToClass(rgb);
  }

  return "num";
}

function parseHex(hex) {
  hex = hex.replace("#", "");

  if (hex.length === 3)
    hex = hex
      .split("")
      .map((h) => h + h)
      .join("");

  if (hex.length !== 6) return null;

  const n = parseInt(hex, 16);

  if (isNaN(n)) return null;

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToClass([r, g, b]) {
  // StS2 uses arbitrary hex colors inside BBCode. Bucket them into 4 semantic classes
  // (r/g/b/y) so CSS can style them consistently regardless of the exact shade.
  // Thresholds picked empirically — "dominant by 30" catches most saturated colors,
  // and the last check covers muted golds that don't dominate any single channel.
  if (r > g + 30 && r > b + 30) return "r";
  if (g > r + 30 && g > b + 30) return "g";
  if (b > r + 30 && b > g + 30) return "b";
  if (r > 180 && g > 140 && b < 100) return "y";

  return "num";
}

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  if (s == null) return "";

  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortId(modelId) {
  if (!modelId) return "—";

  const parts = modelId.split(".");
  const entry = parts[parts.length - 1] || modelId;

  return entry
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function prettyCharacter(id) {
  if (!id) return "";

  const parts = id.split(".");
  const name = parts[parts.length - 1] || id;

  return name.charAt(0) + name.slice(1).toLowerCase();
}

function setStatus(state, text) {
  el("status").dataset.state = state;
  el("status-text").textContent = text;
}

const tooltip = el("tooltip");
let tooltipHideTimer = null;

function showTooltip(anchorEl, data) {
  clearTimeout(tooltipHideTimer);

  el("tt-title").textContent = data.title || shortId(data.id) || "—";
  el("tt-dot").dataset.rarity = data.rarity || "";
  el("tt-meta").textContent = [data.rarity, data.type]
    .filter(Boolean)
    .join(" · ");
  el("tt-desc").innerHTML = bbcodeToHtml(data.description) || "";

  // Position the tooltip to the right of the anchor by default, then flip / clamp
  // to keep it inside the viewport. Must add `.visible` before measuring offsetWidth
  // because a display:none element reports zero dimensions.
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  tooltip.classList.add("visible");

  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;

  let left = rect.right + 10;
  let top = rect.top;

  if (left + tw > vw - 10) left = rect.left - tw - 10;
  if (top + th > vh - 10) top = vh - th - 10;
  if (top < 10) top = 10;
  if (left < 10) left = 10;

  tooltip.style.left = left + "px";
  tooltip.style.top = top + "px";
}

function hideTooltip(immediate) {
  // Short delay on mouseout lets the cursor travel between adjacent hotspots
  // without the tooltip flickering in the gap between them.
  if (immediate) {
    tooltip.classList.remove("visible");
  } else {
    tooltipHideTimer = setTimeout(
      () => tooltip.classList.remove("visible"),
      80,
    );
  }
}

function openDeckPanel(tab) {
  if (!currentState?.inRun) return;

  const me = currentState.players[0];

  activeDeckTab = tab || "deck";

  const combat = me.combat;
  const tabs = [{ id: "deck", label: `Deck (${me.deck?.length ?? 0})` }];

  if (combat) {
    tabs.push({
      id: "hand",
      label: `Hand (${combat.hand?.length ?? 0})`,
    });

    tabs.push({
      id: "draw",
      label: `Draw (${combat.drawPile?.length ?? 0})`,
    });

    tabs.push({
      id: "discard",
      label: `Discard (${combat.discardPile?.length ?? 0})`,
    });

    if (combat.exhaustPile?.length)
      tabs.push({
        id: "exhaust",
        label: `Exhaust (${combat.exhaustPile?.length ?? 0})`,
      });
  }

  const tabsEl = el("pd-tabs");
  tabsEl.innerHTML = tabs
    .map(
      (t) =>
        `<button class="panel-tab${activeDeckTab === t.id ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`,
    )
    .join("");

  tabsEl.querySelectorAll(".panel-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeDeckTab = btn.dataset.tab;
      renderDeckTab(me);
      tabsEl
        .querySelectorAll(".panel-tab")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.tab === activeDeckTab),
        );
    });
  });

  renderDeckTab(me);
  el("panel-deck").classList.add("open");
}

function renderDeckTab(me) {
  const combat = me.combat;
  let cards = [];

  if (activeDeckTab === "deck") cards = me.deck ?? [];
  else if (combat) {
    if (activeDeckTab === "hand") cards = combat.hand ?? [];
    else if (activeDeckTab === "draw") cards = combat.drawPile ?? [];
    else if (activeDeckTab === "discard") cards = combat.discardPile ?? [];
    else if (activeDeckTab === "exhaust") cards = combat.exhaustPile ?? [];
  }

  el("pd-title").textContent =
    activeDeckTab.charAt(0).toUpperCase() + activeDeckTab.slice(1);
  el("pd-meta").textContent =
    `${cards.length} card${cards.length !== 1 ? "s" : ""}`;

  el("pd-body").innerHTML = cards.length
    ? `<div class="grid grid--cards">${cards.map(cardHtml).join("")}</div>`
    : `<div class="empty">No cards here.</div>`;
}

function openCombatPanel(which) {
  if (!currentState?.inRun) return;

  const me = currentState.players[0];
  const combat = me.combat;

  if (!combat) return;

  let cards = [];
  let title = "";

  if (which === "draw") {
    cards = combat.drawPile ?? [];
    title = "Draw Pile";
  } else if (which === "discard") {
    cards = combat.discardPile ?? [];
    title = "Discard Pile";
  } else if (which === "exhaust") {
    cards = combat.exhaustPile ?? [];
    title = "Exhaust Pile";
  }

  el("pc-title").textContent = title;
  el("pc-meta").textContent = `${cards.length} cards`;
  el("pc-body").innerHTML = cards.length
    ? `<div class="grid grid--cards">${cards.map(cardHtml).join("")}</div>`
    : `<div class="empty">No cards here.</div>`;

  el("panel-combat").classList.add("open");
}

function cardHtml(card) {
  const title = card.title || shortId(card.id);

  // Upgrade marker: "+" for a normal upgrade, "+N" for cards that can be upgraded multiple times.
  let upgradeMark = "";
  if (card.isUpgraded) {
    const label = card.upgradeLevel > 1 ? `+${card.upgradeLevel}` : "+";
    upgradeMark = `<span class="upgrade">${label}</span>`;
  }

  // Cost display: "X" for variable-cost cards, a number for normal cards, "—" for curses/statuses with no cost.
  let cost = "—";
  if (card.costX) cost = "X";
  else if (card.cost >= 0) cost = String(card.cost);

  const costClass = card.costX ? "card-cost x" : "card-cost";
  const desc = bbcodeToHtml(card.description);
  const type = (card.type || "").toUpperCase();
  const character = cardCharacter(card);

  return `
          <div class="item item--card" data-character="${escapeHtml(character)}" data-type="${escapeHtml(type)}" data-rarity="${escapeHtml(card.rarity || "")}">
            <div class="${costClass}">${cost}</div>
            <div class="card-banner">${escapeHtml(title)}${upgradeMark}</div>
            <div class="card-type">${escapeHtml(card.type || "Unknown")}</div>
            ${desc ? `<div class="card-desc">${desc}</div>` : `<div class="card-desc"></div>`}
            ${card.rarity ? `<div class="card-rarity">${escapeHtml(card.rarity)}</div>` : ""}
          </div>`;
}

function cardCharacter(card) {
  if (card.character) return String(card.character).toUpperCase();

  const me = currentState?.players?.[0];

  if (!me?.character) return "";

  const parts = String(me.character).split(".");

  return parts[parts.length - 1].toUpperCase();
}

function relicHtml(relic) {
  const name = relic.title || shortId(relic.id);
  const stack =
    relic.stackCount > 1
      ? `<span class="item-stack">×${relic.stackCount}</span>`
      : "";
  const desc = bbcodeToHtml(relic.description);

  return `
          <div class="item item--relic">
            <div class="item-header">
              <div class="item-title">${escapeHtml(name)}</div>${stack}
            </div>
            <div class="item-meta">
              <span class="item-rarity" data-rarity="${escapeHtml(relic.rarity || "")}">${escapeHtml(relic.rarity || "")}</span>
            </div>
            ${desc ? `<div class="item-desc">${desc}</div>` : ""}
          </div>`;
}

document.getElementById("relic-hotspots").addEventListener("mouseover", (e) => {
  const hs = e.target.closest(".hotspot");
  if (!hs || !currentState?.inRun) return;
  const relic = currentState.players[0]?.relics?.[parseInt(hs.dataset.idx)];
  if (relic) showTooltip(hs, relic);
});

document.getElementById("relic-hotspots").addEventListener("mouseout", (e) => {
  if (!e.target.closest(".hotspot")) return;
  hideTooltip();
});

document
  .getElementById("potion-hotspots")
  .addEventListener("mouseover", (e) => {
    const hs = e.target.closest(".hotspot");
    if (!hs || !currentState?.inRun) return;
    const potion =
      currentState.players[0]?.potionSlots?.[parseInt(hs.dataset.idx)];
    if (potion) showTooltip(hs, potion);
  });

document.getElementById("potion-hotspots").addEventListener("mouseout", (e) => {
  if (!e.target.closest(".hotspot")) return;
  hideTooltip();
});

el("hs-deck").addEventListener("click", () => {
  if (el("panel-deck").classList.contains("open")) closePanels();
  else openDeckPanel("deck");
});

el("hs-draw").addEventListener("click", () => {
  if (
    el("panel-combat").classList.contains("open") &&
    el("pc-title").textContent === "Draw Pile"
  )
    closePanels();
  else openCombatPanel("draw");
});

el("hs-discard").addEventListener("click", () => {
  if (
    el("panel-combat").classList.contains("open") &&
    el("pc-title").textContent === "Discard Pile"
  )
    closePanels();
  else openCombatPanel("discard");
});

el("hs-exhaust").addEventListener("click", () => {
  if (
    el("panel-combat").classList.contains("open") &&
    el("pc-title").textContent === "Exhaust Pile"
  )
    closePanels();
  else openCombatPanel("exhaust");
});

el("pd-close").addEventListener("click", () =>
  el("panel-deck").classList.remove("open"),
);
el("pc-close").addEventListener("click", () =>
  el("panel-combat").classList.remove("open"),
);

function closePanels() {
  el("panel-deck").classList.remove("open");
  el("panel-combat").classList.remove("open");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePanels();
    return;
  }

  if (e.target.tagName === "INPUT") return;

  const key = e.key.toLowerCase();

  if (key === "d") {
    if (el("panel-deck").classList.contains("open")) closePanels();
    else openDeckPanel("deck");
  }
});

document.addEventListener("mousedown", (e) => {
  ["panel-deck", "panel-combat"].forEach((id) => {
    if (
      el(id).classList.contains("open") &&
      !el(id).contains(e.target) &&
      !["hs-deck", "hs-draw", "hs-discard"].includes(e.target.id)
    )
      el(id).classList.remove("open");
  });
});
