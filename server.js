import http from "node:http";
import { URL } from "node:url";
import { Readable } from "node:stream";

const PORT = process.env.PORT || 3000;
const DEVICES_CONFIG_URL = process.env.DEVICES_CONFIG_URL;

// ======================================================
// CONFIG URLS (Для других провайдеров, например Wink)
// ======================================================
const WINK_CONFIG_URL =
  "https://gitverse.ru/api/repos/Timofey91/mediavitrina-proxy/raw/branch/master/wink.json";

const VITRINA_CONFIG_URL =
  "https://gitverse.ru/api/repos/Timofey91/mediavitrina-proxy/raw/branch/master/config.json";

// ======================================================
// ДИНАМИЧЕСКИЕ КАНАЛЫ LIME (Через v4/channel с IP Layero)
// ======================================================
const LIME_CHANNELS = {
  "tvc_plus2": { id: 129, region: 66, tz: 5 },
  "tvc_plus4": { id: 129, region: 54, tz: 7 },
  "tvc_plus6": { id: 129, region: 25, tz: 10 },
};

// ======================================================
// HEADERS & AGENTS (Из Lua-скрипта Nexterr/NEKTO666)
// ======================================================
const LIME_WEB_AGENT = JSON.stringify({
  platform: "web",
  app: "limehd.tv",
  device_id: "194973.63324970874-1785414641196",
});

const VITRINA_USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 8.0.1;)";
const VITRINA_REFERER = "https://player.mediavitrina.ru/";

let ALLOWED_DEVICES = new Set();
let otherConfigCache = { data: null, fetchedAt: 0 };
const m3u8Cache = new Map();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
  };
}

function isWinkUrl(targetUrl) {
  const u = targetUrl.toLowerCase();
  return (
    u.includes("wink") ||
    u.includes("rt.ru") ||
    u.includes("ngenix") ||
    u.includes("cdntv") ||
    u.includes("zabava")
  );
}

function getHeaders(targetUrl) {
  const baseHeaders = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  };

  if (isWinkUrl(targetUrl)) {
    return {
      ...baseHeaders,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://wink.ru/",
      "Origin": "https://wink.ru",
      "Accept": "*/*",
      "Connection": "keep-alive",
    };
  }

  return {
    ...baseHeaders,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
    "x-lhd-agent": LIME_WEB_AGENT,
    "Referer": "https://limehd.tv/",
    "Origin": "https://limehd.tv",
    "Accept": "*/*",
    "Connection": "keep-alive",
  };
}

function getVitrinaHeaders() {
  return {
    "User-Agent": VITRINA_USER_AGENT,
    "Referer": VITRINA_REFERER,
    "Accept": "*/*",
  };
}

// ======================================================
// FETCH WITH RETRY
// ======================================================
async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 5000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok || res.status === 206 || res.status === 404) return res;
      lastError = new Error(`HTTP status ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

// ======================================================
// DEVICE KEYS
// ======================================================
async function fetchAllowedDevices() {
  if (!DEVICES_CONFIG_URL) return;

  try {
    const res = await fetchWithRetry(
      DEVICES_CONFIG_URL,
      { headers: { "Cache-Control": "no-cache, no-store" } },
      2,
      3000
    );

    if (res.ok) {
      const devicesArray = await res.json();
      if (Array.isArray(devicesArray)) {
        ALLOWED_DEVICES = new Set(devicesArray.map((d) => String(d).trim()));
      }
    }
  } catch (e) {
    console.error("[Devices] Ошибка загрузки ключей:", e.message);
  }
}

// Загрузчик прочих конфигов (Wink / Vitrina)
async function fetchOtherConfigs() {
  const now = Date.now();
  if (otherConfigCache.data && (now - otherConfigCache.fetchedAt < 30 * 60 * 1000)) {
    return otherConfigCache.data;
  }

  const [winkRes, vitrinaRes] = await Promise.allSettled([
    fetchWithRetry(WINK_CONFIG_URL, { headers: { "Cache-Control": "no-cache" } }, 3, 5000),
    fetchWithRetry(VITRINA_CONFIG_URL, { headers: { "Cache-Control": "no-cache", "User-Agent": VITRINA_USER_AGENT } }, 3, 5000),
  ]);

  let winkData = {};
  let vitrinaData = {};

  if (winkRes.status === "fulfilled" && winkRes.value.ok) {
    try { winkData = await winkRes.value.json(); } catch (e) {}
  }
  if (vitrinaRes.status === "fulfilled" && vitrinaRes.value.ok) {
    try { vitrinaData = await vitrinaRes.value.json(); } catch (e) {}
  }

  const combined = {};
  for (const [ch, url] of Object.entries(winkData)) combined[ch] = { url, provider: "wink" };
  for (const [ch, url] of Object.entries(vitrinaData)) combined[ch] = { url, provider: "vitrina" };

  otherConfigCache = { data: combined, fetchedAt: now };
  return combined;
}

setInterval(() => fetchAllowedDevices().catch(() => {}), 10 * 60 * 1000);
setInterval(() => { m3u8Cache.clear(); }, 60 * 60 * 1000);

function isM3u8Url(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname.endsWith(".m3u8") || parsed.pathname.includes(".m3u8") || parsed.search.includes(".m3u8");
  } catch {
    return urlStr.includes(".m3u8");
  }
}

// ======================================================
// REWRITERS
// ======================================================
function resolveM3u8Urls(m3u8Text, baseUrlStr, devKey = "") {
  const baseUrl = new URL(baseUrlStr);
  const lines = m3u8Text.split("\n");
  const devParam = devKey ? `&dev=${encodeURIComponent(devKey)}` : "";

  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      return line.replace(/URI=["']([^"']+)["']/g, (match, relativeUri) => {
        try {
          const absoluteUri = new URL(relativeUri, baseUrl).toString();
          const endpoint = isM3u8Url(absoluteUri) ? "/proxy-m3u8" : "/proxy-segment";
          return `URI="${endpoint}?url=${encodeURIComponent(absoluteUri)}${devParam}"`;
        } catch {
          return match;
        }
      });
    }

    try {
      const absoluteUri = new URL(trimmed, baseUrl).toString();
      const endpoint = isM3u8Url(absoluteUri) ? "/proxy-m3u8" : "/proxy-segment";
      return `${endpoint}?url=${encodeURIComponent(absoluteUri)}${devParam}`;
    } catch {
      return line;
    }
  }).join("\n");
}

function rewriteVitrinaPlaylist(m3u8Text, targetUrl) {
  let baseUrl;
  try {
    baseUrl = new URL(targetUrl);
  } catch {
    return m3u8Text;
  }

  return m3u8Text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        try { return `URI="${new URL(uri, baseUrl).toString()}"`; } catch { return match; }
      });
    }

    if (!trimmed.startsWith("#")) {
      try { return new URL(trimmed, baseUrl).toString(); } catch { return line; }
    }

    return line;
  }).join("\n");
}

// ======================================================
// SERVER
// ======================================================
const server = http.createServer(async (request, response) => {
  try {
    const hostHeader = request.headers.host || "localhost";
    const url = new URL(request.url, `http://${hostHeader}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    if (url.pathname === "/robots.txt") {
      response.writeHead(200, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
      response.end("User-agent: *\nDisallow: /");
      return;
    }

    if (url.pathname === "/" || url.pathname === "") {
      response.writeHead(200, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
      response.end("Lime API v4 + All-in-One TV Proxy is running.");
      return;
    }

    if (url.pathname.includes("__layero_probe") || url.pathname === "/favicon.ico") {
      response.writeHead(404, corsHeaders());
      response.end();
      return;
    }

    const devKey = url.searchParams.get("dev");
    if (DEVICES_CONFIG_URL && ALLOWED_DEVICES.size > 0) {
      if (!devKey || !ALLOWED_DEVICES.has(devKey)) {
        response.writeHead(403, corsHeaders());
        response.end("Access Denied: Invalid device key");
        return;
      }
    }

    if (url.pathname === "/proxy-m3u8") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        response.writeHead(400, corsHeaders());
        response.end();
        return;
      }

      try {
        const subRes = await fetchWithRetry(targetUrl, { headers: getHeaders(targetUrl) });
        if (!subRes.ok) {
          response.writeHead(subRes.status, corsHeaders());
          response.end();
          return;
        }

        const rawM3u8 = await subRes.text();
        const processedM3u8 = resolveM3u8Urls(rawM3u8, targetUrl, devKey);

        response.writeHead(200, {
          ...corsHeaders(),
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        });
        response.end(processedM3u8);
      } catch (e) {
        console.error("Error proxying m3u8:", e.message);
        response.writeHead(503, corsHeaders());
        response.end();
      }
      return;
    }

    if (url.pathname === "/proxy-segment") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        response.writeHead(400, corsHeaders());
        response.end();
        return;
      }

      const isWink = isWinkUrl(targetUrl);
      const reqHeaders = getHeaders(targetUrl);

      if (isWink && request.headers["range"]) {
        reqHeaders["Range"] = request.headers["range"];
      }

      let segmentRes;
      try {
        segmentRes = await fetchWithRetry(targetUrl, { headers: reqHeaders });
      } catch (e) {
        console.error("Error proxying segment:", e.message);
        response.writeHead(503, corsHeaders());
        response.end();
        return;
      }

      const isOk = segmentRes.ok || (isWink && segmentRes.status === 206);
      if (!isOk) {
        response.writeHead(segmentRes.status || 503, corsHeaders());
        response.end();
        return;
      }

      const resHeaders = {
        ...corsHeaders(),
        "Content-Type": segmentRes.headers.get("content-type") || "video/mp2t",
      };

      const contentLength = segmentRes.headers.get("content-length");
      if (contentLength) resHeaders["Content-Length"] = contentLength;

      if (isWink && segmentRes.headers.get("content-range")) {
        resHeaders["Content-Range"] = segmentRes.headers.get("content-range");
      }

      response.writeHead(segmentRes.status, resHeaders);

      if (segmentRes.body) {
        const stream = Readable.fromWeb(segmentRes.body);
        stream.on("error", () => {});
        response.on("close", () => stream.destroy());
        stream.pipe(response);
      } else {
        response.end();
      }
      return;
    }

    const path = url.pathname.replace(/^\/+/, "").replace(/\.m3u8$/i, "");
    const now = Date.now();
    const cachedKey = `${path}_${devKey}`;
    const cached = m3u8Cache.get(cachedKey);

    if (cached && now < cached.expiresAt) {
      response.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      response.end(cached.content);
      return;
    }

    let processedM3u8 = "";

    try {
      let streamUrl = null;
      let provider = "lime";

      // 1. ДИНАМИЧЕСКИЙ ЗАПРОС ЧЕРЕЗ API v4 ДЛЯ ТАЙМШИФТ КАНАЛОВ (tvc_plus2 и т.д.)
      if (LIME_CHANNELS[path]) {
        const ch = LIME_CHANNELS[path];
        const apiUrl = `https://pl.iptv2021.com/api/v4/channel?id=${ch.id}&tz=${ch.tz}&region=${ch.region}`;
        const apiRes = await fetchWithRetry(apiUrl, { headers: getHeaders(apiUrl) }, 3, 5000);
        
        if (!apiRes.ok) throw new Error(`Lime API status ${apiRes.status}`);
        const apiData = await apiRes.json();

        // Рекурсивный поиск master.m3u8 в ответе API
        let masterUrl = null;
        const findMaster = (obj) => {
          if (masterUrl) return;
          if (typeof obj === 'string' && obj.startsWith('http') && obj.includes('index.m3u8')) {
            masterUrl = obj;
            return;
          }
          if (typeof obj === 'object' && obj !== null) {
            for (let val of Object.values(obj)) findMaster(val);
          }
        };
        findMaster(apiData);

        if (!masterUrl) throw new Error("Master URL not found in Lime API");

        const masterRes = await fetchWithRetry(masterUrl, { headers: getHeaders(masterUrl) }, 3, 5000);
        const masterText = await masterRes.text();

        // Парсинг потоков и выбор стабильного битрейта (480p / 3-й вариант, как в Python)
        const lines = masterText.split(/\r?\n/);
        let streams = [];
        let currentInf = null;
        for (let line of lines) {
          line = line.trim();
          if (line.startsWith("#EXT-X-STREAM-INF:")) {
            currentInf = line;
            continue;
          }
          if (currentInf && line && !line.startsWith("#")) {
            const bwMatch = currentInf.match(/BANDWIDTH=(\d+)/);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            streams.push({ bandwidth: bw, url: new URL(line, masterUrl).toString() });
            currentInf = null;
          }
        }

        streams.sort((a, b) => b.bandwidth - a.bandwidth);
        if (streams.length >= 3) {
          streamUrl = streams[2].url;
        } else if (streams.length > 0) {
          streamUrl = streams[streams.length - 1].url;
        } else {
          streamUrl = masterUrl;
        }

      } else {
        // 2. ДЛЯ ОСТАЛЬНЫХ КАНАЛОВ ИЩЕМ ВО ВНЕШНИХ КОНФИГАХ (Wink / Vitrina)
        const otherMap = await fetchOtherConfigs();
        const channelInfo = otherMap[path];

        if (!channelInfo || !channelInfo.url) {
          if (cached && cached.content) {
            response.writeHead(200, {
              ...corsHeaders(),
              "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
            });
            response.end(cached.content);
            return;
          }
          response.writeHead(404, corsHeaders());
          response.end("Channel not found");
          return;
        }

        streamUrl = channelInfo.url;
        provider = channelInfo.provider || "wink";
      }

      // Запрос потока и обработка плейлиста
      let streamResponse;
      if (provider === "vitrina") {
        streamResponse = await fetchWithRetry(streamUrl, { headers: getVitrinaHeaders() }, 3, 5000);
        if (!streamResponse.ok) throw new Error(`Vitrina status ${streamResponse.status}`);
        const rawM3u8 = await streamResponse.text();
        processedM3u8 = rewriteVitrinaPlaylist(rawM3u8, streamUrl);
      } else {
        streamResponse = await fetchWithRetry(streamUrl, { headers: getHeaders(streamUrl) }, 3, 5000);
        if (!streamResponse.ok) throw new Error(`Upstream status ${streamResponse.status}`);
        const rawM3u8 = await streamResponse.text();
        processedM3u8 = resolveM3u8Urls(rawM3u8, streamUrl, devKey);
      }

      m3u8Cache.set(cachedKey, {
        content: processedM3u8,
        expiresAt: now + 20000,
      });

      response.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      response.end(processedM3u8);

    } catch (error) {
      console.error(`Error fetching M3U8 for ${path}:`, error.message);
      
      if (cached && cached.content) {
        response.writeHead(200, {
          ...corsHeaders(),
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        });
        response.end(cached.content);
        return;
      }

      response.writeHead(503, corsHeaders());
      response.end();
    }
  } catch (error) {
    console.error("Unhandled Server Error:", error);
    response.writeHead(500, corsHeaders());
    response.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on port ${PORT}`);
  fetchOtherConfigs().catch(() => {});
  fetchAllowedDevices().catch(() => {});
});
