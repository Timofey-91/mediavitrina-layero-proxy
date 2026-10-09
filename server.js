const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 8.0.1;)";
const REFERER = "https://player.mediavitrina.ru/";

const CONFIG_URL =
  "https://gitverse.ru/api/repos/Timofey91/mediavitrina-proxy/raw/branch/master/config.json";

// Переменные окружения в Layero (подхватывает DEVICES_CONFIG_URL)
const GIST_KEYS_URL = process.env.DEVICES_CONFIG_URL || "";

// Раздельное время жизни кэша:
const CONFIG_TTL = 12 * 60 * 60 * 1000; // 12 часов (2 раза в сутки для GitVerse)
const KEYS_TTL = 5 * 60 * 1000;         // 5 минут (для авто-проверки устройств)

let configCache = null;
let configExpiresAt = 0;

let keysCache = null;
let keysExpiresAt = 0;

// ======================================================
// CORS & HEADERS
// ======================================================

function vitrinaHeaders() {
  return {
    "User-Agent": USER_AGENT,
    "Referer": REFERER,
    "Accept": "*/*",
  };
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// ======================================================
// KEYS LOADER (Кэш 5 минут)
// ======================================================

async function loadAllowedKeys() {
  const now = Date.now();
  if (keysCache && now < keysExpiresAt) return keysCache;
  if (!GIST_KEYS_URL) return [];

  try {
    const response = await fetch(GIST_KEYS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000), // Таймаут 3 секунды
    });

    if (response.ok) {
      const data = await response.json();
      keysCache = Array.isArray(data) ? data : data.keys || [];
      keysExpiresAt = now + KEYS_TTL;
      return keysCache;
    }
  } catch (err) {
    console.error("[Keys] Ошибка загрузки ключей из Gist:", err);
  }

  return keysCache || [];
}

async function isKeyValid(devKey) {
  if (!devKey) return false;
  const allowed = await loadAllowedKeys();
  if (allowed.length === 0) return true; // Если Gist временно недоступен — пропускаем
  return allowed.includes(devKey);
}

// ======================================================
// CONFIG LOADER (Кэш 12 часов)
// ======================================================

async function loadConfig() {
  const now = Date.now();
  if (configCache && now < configExpiresAt) return configCache;

  const response = await fetch(CONFIG_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(3000), // Таймаут 3 секунды
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });

  if (!response.ok) throw new Error(`Config HTTP ${response.status}`);

  const config = await response.json();
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid config format");
  }

  configCache = config;
  configExpiresAt = now + CONFIG_TTL; // Сохраняем на 12 часов
  return configCache;
}

// ======================================================
// REWRITE M3U8
// ======================================================

function rewritePlaylist(text, targetUrl) {
  let baseUrl;
  try {
    baseUrl = new URL(targetUrl);
  } catch {
    return text;
  }

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          try {
            return `URI="${new URL(uri, baseUrl).toString()}"`;
          } catch {
            return match;
          }
        });
      }

      if (!trimmed.startsWith("#")) {
        try {
          return new URL(trimmed, baseUrl).toString();
        } catch {
          return line;
        }
      }

      return line;
    })
    .join("\n");
}

// ======================================================
// MAIN ROUTE
// ======================================================

app.get("*", async (req, res) => {
  try {
    // 1. Проверка ключа ?dev=
    const devKey = req.query.dev;
    const valid = await isKeyValid(devKey);

    if (!valid) {
      return res
        .status(403)
        .send("Forbidden: Invalid or missing device key (?dev=)");
    }

    // 2. Определение канала
    const channel = req.path.replace(/^\/+/, "").replace(/\.m3u8$/i, "");

    if (!channel) {
      return res.send("Layero Mediavitrina proxy is working.\n");
    }

    // 3. Загрузка конфига (из памяти за 1 мс или из GitVerse раз в 12 часов)
    let config;
    try {
      config = await loadConfig();
    } catch (err) {
      return res.status(502).send("Config error: " + err.message);
    }

    if (!(channel in config)) {
      return res.status(404).send("Channel not found: " + channel);
    }

    const targetUrl = config[channel];
    if (!targetUrl) return res.status(502).send("Invalid channel URL");

    // 4. Обработка HEAD запроса
    if (req.method === "HEAD") {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.status(200).end();
    }

    // 5. Запросить плейлист из Витрины
    const response = await fetch(targetUrl, {
      headers: vitrinaHeaders(),
      signal: AbortSignal.timeout(5000), // Таймаут 5 секунд
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return res
        .status(502)
        .send(`Mediavitrina error: ${response.status}\n\n${body.substring(0, 1000)}`);
    }

    const text = await response.text();
    const rewritten = rewritePlaylist(text, targetUrl);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.send(rewritten);
  } catch (err) {
    res.status(502).send("Proxy error: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Layero proxy running on port ${PORT}`);
});
