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
// ДИНАМИЧЕСКИЕ КАНАЛЫ LIME
// ======================================================
const LIME_CHANNELS = {
  "tvc_plus2": { id: 129, region: 66, tz: 5 },
  "tvc_plus4": { id: 129, region: 54, tz: 7 },
  "tvc_plus6": { id: 129, region: 25, tz: 10 },
};

// ======================================================
// HEADERS & AGENTS (Имитация браузера на limehd.tv)
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

function getWebHeaders(targetUrl = "") {
  const baseHeaders = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  };

  if (targetUrl && isWinkUrl(targetUrl)) {
    return {
      ...baseHeaders,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Referer": "https://wink.ru/",
      "Origin": "https://wink.ru",
      "Accept": "*/*",
      "Connection": "keep-alive",
    };
  }

  return {
    ...baseHeaders,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "x-lhd-agent": LIME_WEB_AGENT,
    "Referer": "https://limehd.tv/",
    "Origin": "https://limehd.tv",
    "Accept": "*/*",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
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
async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 6000) {
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
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

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
      response.end("Lime Fixed Proxy is running.");
      return;
    }

    if (url.pathname.includes("__layero_probe") || url.pathname === "/favicon.ico") {
      response.writeHead(404, corsHeaders());
      response.end();
      return;
    }

    // Диагностический эндпоинт
    if (url.pathname.startsWith("/debug/")) {
      const channelKey = url.pathname.replace("/debug/", "");
      response.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });

      if (!LIME_CHANNELS[channelKey]) {
        response.end(JSON.stringify({ error: `Channel '${channelKey}' not found` }, null, 2));
        return;
      }

      const ch = LIME_CHANNELS[channelKey];
      const apiUrl = `https://pl.iptv2021.com/api/v4/channel?id=${ch.id}&tz=${ch.tz}&region=${ch.region}`;

      try {
        const apiRes = await fetchWithRetry(apiUrl, { headers: getWebHeaders(apiUrl) }, 2, 5000);
        const apiText = await apiRes.text();
        response.end(JSON.stringify({ channel: channelKey, apiUrl, status: apiRes.status, response: JSON.parse(apiText) }, null, 2));
      } catch (err) {
        response.end(JSON.stringify({ channel: channelKey, error: err.message }, null, 2));
      }
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
        const subRes = await fetchWithRetry(targetUrl, { headers: getWebHeaders(targetUrl) });
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
      const reqHeaders = getWebHeaders(targetUrl);

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
      let masterUrl = null;
      let provider = "lime";

      // 1. ДИНАМИЧЕСКИЙ ЗАПРОС К API LIME С ИЗВЛЕЧЕНИЕМ ССЫЛКИ ИЗ stream.common или url
      if (LIME_CHANNELS[path]) {
        const ch = LIME_CHANNELS[path];
        const apiUrl = `https://pl.iptv2021.com/api/v4/channel?id=${ch.id}&tz=${ch.tz}&region=${ch.region}`;
        const apiRes = await fetchWithRetry(apiUrl, { headers: getWebHeaders(apiUrl) }, 3, 5000);
        
        if (!apiRes.ok) throw new Error(`Lime API status ${apiRes.status}`);
        const apiData = await apiRes.json();

        // Точное извлечение ссылки из структуры ответа Лайма
        masterUrl = apiData.url || (apiData.stream && apiData.stream.common) || null;

        if (!masterUrl) {
          // Запасной глубокий поиск, если структура вдруг изменится
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
        }

        if (!masterUrl) throw new Error("Master URL not found in Lime API response");
        console.log(`[Lime] Получена мастер-ссылка для ${path}: ${masterUrl}`);

      } else {
        // 2. ДЛЯ ОСТАЛЬНЫХ КАНАЛОВ (Wink / Vitrina)
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

        masterUrl = channelInfo.url;
        provider = channelInfo.provider || "wink";
      }

      // Скачиваем мастер-плейлист и переписываем все дочерние пути на наш прокси
      let streamResponse;
      if (provider === "vitrina") {
        streamResponse = await fetchWithRetry(masterUrl, { headers: getVitrinaHeaders() }, 3, 5000);
        if (!streamResponse.ok) throw new Error(`Vitrina status ${streamResponse.status}`);
        const rawM3u8 = await streamResponse.text();
        processedM3u8 = rewriteVitrinaPlaylist(rawM3u8, masterUrl);
      } else {
        streamResponse = await fetchWithRetry(masterUrl, { headers: getWebHeaders(masterUrl) }, 3, 5000);
        if (!streamResponse.ok) throw new Error(`Upstream status ${streamResponse.status}`);
        const rawM3u8 = await streamResponse.text();
        processedM3u8 = resolveM3u8Urls(rawM3u8, masterUrl, devKey);
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
  console.log(`Lime Fixed Proxy listening on port ${PORT}`);
  fetchOtherConfigs().catch(() => {});
  fetchAllowedDevices().catch(() => {});
});
