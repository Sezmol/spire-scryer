/**
 * Spire Scryer — EBS (Extension Backend Service)
 * Cloudflare Worker
 *
 * Routes:
 *   POST /register       — broadcaster Config view generates per-channel mod secret
 *   POST /state          — mod sends game state → broadcast to Twitch PubSub
 *   GET  /state/:channel — extension polls state (fallback if PubSub fails)
 *   GET  /health         — alive check
 *
 * Env vars:
 *   TWITCH_CLIENT_ID          (public, from Twitch dashboard)
 *   TWITCH_EXTENSION_SECRET   (secret, base64, from Twitch dashboard)
 */

const PUBSUB_URL = "https://api.twitch.tv/helix/extensions/pubsub";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Mod-Secret",
    };
    try {
      return await handleRequest(request, env, corsHeaders);
    } catch (e) {
      console.error("UNCAUGHT", e && e.stack || e);
      return json({ error: "internal", message: String(e && e.message || e) }, corsHeaders, 500);
    }
  },
};

async function handleRequest(request, env, corsHeaders) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── GET /health ──────────────────────────────────────────────
    if (url.pathname === "/health") {
      return json({ ok: true }, corsHeaders);
    }

    // ── POST /register ───────────────────────────────────────────
    // Config view calls this with broadcaster's Twitch JWT to generate
    // (or regenerate) a per-channel mod secret.
    if (request.method === "POST" && url.pathname === "/register") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";

      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return json({ error: "missing_token" }, corsHeaders, 401);

      let payload;
      try {
        payload = await verifyTwitchJwt(env, token);
      } catch (e) {
        return json({ error: "invalid_token", message: e.message }, corsHeaders, 401);
      }

      if (payload.role !== "broadcaster") {
        return json({ error: "not_broadcaster" }, corsHeaders, 403);
      }
      if (!payload.channel_id) {
        return json({ error: "no_channel_id" }, corsHeaders, 400);
      }

      // Rate limit: per IP and per channel, 5 registers / hour
      if (!checkRateLimit(`ip:${ip}`, 5, 3600_000)) {
        return json({ error: "rate_limited", message: "too many requests from this IP" }, corsHeaders, 429);
      }
      if (!checkRateLimit(`ch:${payload.channel_id}`, 5, 3600_000)) {
        return json({ error: "rate_limited", message: "too many regenerations for this channel" }, corsHeaders, 429);
      }

      if (!env.SPIRE_KV) return json({ error: "kv_not_configured" }, corsHeaders, 500);

      const secret = randomSecret();
      await env.SPIRE_KV.put(`secret:${payload.channel_id}`, secret);
      // Invalidate cached secret so new secret takes effect immediately
      secretCache.delete(payload.channel_id);

      return json({ secret, channelId: payload.channel_id }, corsHeaders);
    }

    // ── POST /state ──────────────────────────────────────────────
    // Mod sends: { channelId, state: {...} }
    // Header: X-Mod-Secret: <per-channel secret from /register>
    if (request.method === "POST" && url.pathname === "/state") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, corsHeaders, 400);
      }

      const { channelId, state } = body;
      if (!channelId || !state) {
        return json({ error: "missing channelId or state" }, corsHeaders, 400);
      }

      // Rate limit per channel: 120/min (mod normally pushes 60/min)
      if (!checkRateLimit(`state:${channelId}`, 120, 60_000)) {
        return json({ error: "rate_limited" }, corsHeaders, 429);
      }

      // Verify per-channel mod secret
      const modSecret = request.headers.get("X-Mod-Secret");
      if (!modSecret) return json({ error: "unauthorized" }, corsHeaders, 401);
      if (!env.SPIRE_KV) return json({ error: "kv_not_configured" }, corsHeaders, 500);

      const expectedSecret = await getChannelSecret(env, channelId);
      if (!expectedSecret) {
        return json({ error: "channel_not_registered" }, corsHeaders, 403);
      }
      if (!timingSafeEqual(modSecret, expectedSecret)) {
        return json({ error: "unauthorized" }, corsHeaders, 401);
      }

      // Twitch PubSub hard cap 5KB. Cascade degrade until under limit.
      const CAP = 4500;
      const tries = [
        {},
        { dropExhaust: true },
        { dropExhaust: true, dropDiscard: true },
        { dropExhaust: true, dropDiscard: true, dropDraw: true },
        { noDesc: true },
        { noDesc: true, dropExhaust: true },
        { noDesc: true, dropExhaust: true, dropDiscard: true, dropDraw: true },
        { deckOnly: true, noDesc: true },
        { metaOnly: true },
      ];
      let pubsubPayload = null;
      let chosenOpts = null;
      for (const opts of tries) {
        const p = JSON.stringify(ultraCompact(state, opts));
        if (p.length <= CAP) { pubsubPayload = p; chosenOpts = opts; break; }
        if (!pubsubPayload || p.length < pubsubPayload.length) { pubsubPayload = p; chosenOpts = opts; }
      }
      console.log("chose", chosenOpts, "size", pubsubPayload.length, "full", JSON.stringify(state).length);
      await pubsubSend(env, channelId, pubsubPayload);

      return json({ ok: true }, corsHeaders);
    }

    // ── GET /state/:channelId ────────────────────────────────────
    // Extension polls this as fallback
    if (request.method === "GET" && url.pathname.startsWith("/state/")) {
      const channelId = url.pathname.slice("/state/".length);
      if (!channelId) return json({ error: "missing channelId" }, corsHeaders, 400);

      if (!env.SPIRE_KV) return json({ error: "kv_not_configured" }, corsHeaders, 500);

      const raw = await env.SPIRE_KV.get(`state:${channelId}`);
      if (!raw) return json({ inRun: false }, corsHeaders);

      return new Response(raw, {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return json({ error: "not_found" }, corsHeaders, 404);
}

// ── Twitch PubSub broadcast ──────────────────────────────────────

async function pubsubSend(env, channelId, message) {
  const jwt = await makeJwt(env, channelId);

  const res = await fetch(PUBSUB_URL, {
    method: "POST",
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target: ["broadcast"],
      broadcaster_id: channelId,
      is_global_broadcast: false,
      message,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("PubSub error:", res.status, text);
  }
}

// ── JWT for Twitch Extension API ─────────────────────────────────

async function makeJwt(env, channelId) {
  const secret = base64ToBytes(env.TWITCH_EXTENSION_SECRET);

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 60,
    user_id: channelId,
    channel_id: channelId,
    role: "external",
    pubsub_perms: { send: ["broadcast"] },
  }));

  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw", secret,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64url(sig)}`;
}

// ── Compact state (strip descriptions to fit 5KB PubSub limit) ───

function compactState(state) {
  if (!state.players) return state;
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      deck: p.deck?.map(c => ({ id: c.id, title: c.title, cost: c.cost, rarity: c.rarity, type: c.type, isUpgraded: c.isUpgraded })),
      relics: p.relics?.map(r => ({ id: r.id, title: r.title, rarity: r.rarity, stackCount: r.stackCount })),
      potionSlots: p.potionSlots?.map(po => po ? { id: po.id, title: po.title, rarity: po.rarity } : null),
    })),
  };
}

// Ultra-compact: whitelist only what overlay renders. Short keys, id-indexed dict.
// t=title, c=cost, r=rarity, y=type, u=isUpgraded, s=stackCount, h=character(1-char)
function charCode(name) {
  if (!name) return "";
  const k = String(name).toUpperCase();
  if (k.startsWith("IRON")) return "I";
  if (k.startsWith("SIL")) return "S";
  if (k.startsWith("REG")) return "R";
  if (k.startsWith("NEC")) return "N";
  if (k.startsWith("DEF")) return "D";
  if (k.startsWith("COL")) return "C";
  return "";
}

function ultraCompact(state, opts = {}) {
  if (!state.players) return { inRun: state.inRun };
  return {
    inRun: state.inRun,
    players: state.players.map(p => {
      const playerChar = charCode(p.character);
      const cardDict = {};
      const addCard = c => {
        if (c && c.id && !cardDict[c.id]) {
          cardDict[c.id] = { t: c.title, c: c.cost, r: c.rarity, y: c.type, u: c.isUpgraded };
          if (!opts.noDesc && c.description) cardDict[c.id].d = c.description;
          const ch = charCode(c.character);
          if (ch && ch !== playerChar) cardDict[c.id].h = ch;
        }
      };
      const cb = p.combat || {};
      const deck = (p.deck || []).map(c => { addCard(c); return c.id; });
      const hand = opts.deckOnly ? [] : (cb.hand || []).map(c => { addCard(c); return c.id; });
      const drawPile = (opts.deckOnly || opts.dropDraw) ? [] : (cb.drawPile || []).map(c => { addCard(c); return c.id; });
      const discardPile = (opts.deckOnly || opts.dropDiscard) ? [] : (cb.discardPile || []).map(c => { addCard(c); return c.id; });
      const exhaustPile = (opts.deckOnly || opts.dropExhaust) ? [] : (cb.exhaustPile || []).map(c => { addCard(c); return c.id; });

      const result = {
        cardDict,
        deck,
        hand,
        drawPile,
        discardPile,
        exhaustPile,
        character: p.character,
        relics: (p.relics || []).map(r => {
          const o = { id: r.id, t: r.title, r: r.rarity, s: r.stackCount };
          if (!opts.noDesc && r.description) o.d = r.description;
          return o;
        }),
        potionSlots: (p.potionSlots || []).map(po => {
          if (!po) return null;
          const o = { id: po.id, t: po.title, r: po.rarity };
          if (!opts.noDesc && po.description) o.d = po.description;
          return o;
        }),
      };
      if (p.combat) {
        result.combat = {
          energy: p.combat.energy,
          maxEnergy: p.combat.maxEnergy,
          block: p.combat.block,
          powers: p.combat.powers,
        };
      }

      if (opts.metaOnly) {
        return {
          cardDict: {},
          deck: [], hand: [], drawPile: [], discardPile: [], exhaustPile: [],
          relics: result.relics.slice(0, 10),
          potionSlots: result.potionSlots,
          deckCount: deck.length,
        };
      }

      return result;
    }),
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function base64url(input) {
  let str;
  if (typeof input === "string") {
    str = btoa(unescape(encodeURIComponent(input)));
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(input)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64);
}

function base64urlDecodeToString(str) {
  const bytes = base64urlDecode(str);
  return new TextDecoder().decode(bytes);
}

// Verify Twitch extension JWT (HS256 signed with TWITCH_EXTENSION_SECRET).
// Throws on any failure. Returns payload on success.
async function verifyTwitchJwt(env, token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64urlDecodeToString(headerB64));
  if (header.alg !== "HS256") throw new Error("unsupported_alg");

  const secret = base64ToBytes(env.TWITCH_EXTENSION_SECRET);
  const key = await crypto.subtle.importKey(
    "raw", secret,
    { name: "HMAC", hash: "SHA-256" },
    false, ["verify"]
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = base64urlDecode(sigB64);
  const ok = await crypto.subtle.verify("HMAC", key, sig, data);
  if (!ok) throw new Error("bad_signature");

  const payload = JSON.parse(base64urlDecodeToString(payloadB64));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("expired");
  }
  return payload;
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Per-isolate in-memory cache to avoid KV reads on every /state POST.
// Cloudflare Workers isolates are long-lived under load.
const secretCache = new Map();
const SECRET_CACHE_TTL_MS = 60_000;

async function getChannelSecret(env, channelId) {
  const now = Date.now();
  const cached = secretCache.get(channelId);
  if (cached && cached.exp > now) return cached.value;

  const val = await env.SPIRE_KV.get(`secret:${channelId}`);
  secretCache.set(channelId, { value: val, exp: now + SECRET_CACHE_TTL_MS });
  return val;
}

// In-memory rate limiter per isolate. Sliding window.
// Not globally consistent across isolates, but good enough to stop simple abuse.
const rateBuckets = new Map();

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = rateBuckets.get(key) || [];
  const recent = hits.filter(t => t > cutoff);
  if (recent.length >= maxRequests) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);

  // Occasional GC to prevent unbounded memory growth
  if (rateBuckets.size > 10_000) {
    for (const [k, v] of rateBuckets) {
      if (v[v.length - 1] < cutoff) rateBuckets.delete(k);
    }
  }
  return true;
}
