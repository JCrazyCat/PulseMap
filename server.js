// ─────────────────────────────────────────────
// PulseMap API — Secure Backend Proxy
// Node.js + Express
// Deploy on Railway: railway.app
// ─────────────────────────────────────────────

require("dotenv").config(); // local dev only — Railway uses env vars directly

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Environment Variables (set in Railway dashboard)
// THIRD_PARTY_API_KEY   — your private API key
// THIRD_PARTY_BASE_URL  — base URL of the third-party API
// ─────────────────────────────────────────────

const API_KEY = process.env.THIRD_PARTY_API_KEY;
const API_BASE = process.env.THIRD_PARTY_BASE_URL;

if (!API_KEY || !API_BASE) {
  console.error("Missing required environment variables: THIRD_PARTY_API_KEY, THIRD_PARTY_BASE_URL");
  process.exit(1);
}

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────

app.use(cors({ origin: "*" })); // tighten to your domain in production
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per IP per window
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api/", limiter);

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "pulsemap-api" });
});

// ─────────────────────────────────────────────
// GET /api/v1/places/nearby
// Query params: lat, lng, radius (metres)
// ─────────────────────────────────────────────

app.get("/api/v1/places/nearby", async (req, res) => {
  const { lat, lng, radius = 500 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng are required." });
  }

  try {
    const url = `${API_BASE}/nearby?lat=${lat}&lng=${lng}&radius=${radius}&key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Third-party API error." });
    }

    const data = await response.json();
    res.json(data.results.map(transformPlace));
  } catch (err) {
    console.error("nearby error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/places/search
// Query params: q, lat, lng, radius (metres)
// ─────────────────────────────────────────────

app.get("/api/v1/places/search", async (req, res) => {
  const { q, lat, lng, radius = 5000 } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Query parameter q is required." });
  }

  try {
    const url = `${API_BASE}/search?q=${encodeURIComponent(q)}&lat=${lat}&lng=${lng}&radius=${radius}&key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Third-party API error." });
    }

    const data = await response.json();
    res.json(data.results.map(transformPlace));
  } catch (err) {
    console.error("search error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/places/:id
// ─────────────────────────────────────────────

app.get("/api/v1/places/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const url = `${API_BASE}/details/${id}?key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Third-party API error." });
    }

    const data = await response.json();
    res.json(transformPlace(data.result));
  } catch (err) {
    console.error("place detail error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/places/:id/busyness
// ─────────────────────────────────────────────

app.get("/api/v1/places/:id/busyness", async (req, res) => {
  const { id } = req.params;

  try {
    const url = `${API_BASE}/busyness/${id}?key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Third-party API error." });
    }

    const data = await response.json();
    res.json(transformBusyness(data));
  } catch (err) {
    console.error("busyness error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/places/:id/history
// ─────────────────────────────────────────────

app.get("/api/v1/places/:id/history", async (req, res) => {
  const { id } = req.params;

  try {
    const url = `${API_BASE}/history/${id}?key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Third-party API error." });
    }

    const data = await response.json();
    res.json(transformHistory(id, data));
  } catch (err) {
    console.error("history error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
// Transformers
// Adapt these functions to match your chosen third-party API response shape
// ─────────────────────────────────────────────

function transformPlace(raw) {
  return {
    id: raw.place_id || raw.id,
    name: raw.name,
    category: mapCategory(raw.types || raw.categories || []),
    latitude: raw.geometry?.location?.lat ?? raw.lat,
    longitude: raw.geometry?.location?.lng ?? raw.lng,
    address: raw.vicinity || raw.address || null,
    busyness_level: null,
  };
}

function transformBusyness(raw) {
  return {
    score: raw.score ?? raw.popularity ?? 0,
    label: scoreToLabel(raw.score ?? raw.popularity ?? 0),
    updated_at: raw.updated_at ?? new Date().toISOString(),
    is_stale: false,
  };
}

function transformHistory(placeID, raw) {
  return {
    id: placeID,
    place_id: placeID,
    generated_at: new Date().toISOString(),
    points: (raw.points || []).map((p) => ({
      id: p.id || `${placeID}-${p.timestamp}`,
      timestamp: p.timestamp,
      score: p.score ?? p.popularity ?? 0,
    })),
  };
}

function mapCategory(types) {
  if (types.includes("cafe") || types.includes("coffee_shop")) return "cafe";
  if (types.includes("gym") || types.includes("fitness_centre")) return "gym";
  if (types.includes("restaurant") || types.includes("food")) return "restaurant";
  if (types.includes("bar") || types.includes("night_club")) return "bar";
  if (types.includes("shopping_mall") || types.includes("store")) return "shopping";
  return "other";
}

function scoreToLabel(score) {
  if (score < 30) return "quiet";
  if (score < 60) return "moderate";
  if (score < 80) return "busy";
  return "very_busy";
}

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`PulseMap API running on port ${PORT}`);
});
