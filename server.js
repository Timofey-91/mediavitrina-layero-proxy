import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Readable } from "node:stream";

const PORT = process.env.PORT || 3000;
const DEVICES_CONFIG_URL = process.env.DEVICES_CONFIG_URL;

// ======================================================
// CONFIG URLS
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

function getLimeHeaders(targetUrl = "") {
  if (targetUrl && isWinkUrl(targetUrl)) {
    return {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Referer": "https://wink.ru/",
      "Origin": "https://wink.ru",
      "Accept": "*/*",
      "Connection": "keep-alive",
    };
  }

  return {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
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
// HTTPS REQUEST WRAPPER (Обход TLS/fetch ограничений CDN)
// ======================================================
function robustFetch(urlStr, headers = {}, method = "GET", timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers,
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      resolve(res);
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timeout"));
    });

    req.end();
  });
}

async function fetchTextWithRetry(urlStr, headers = {}, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await robustFetch(urlStr, headers, "GET", 8000);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let data = "";
        for await (const chunk of res) {
          data += chunk;
        }
        return { ok: true, status: res.statusCode, text: data, headers: res.headers };
      }
      lastError = new Error(`HTTP status ${res.statusCode}`);
    } catch (e) {
      lastError = e;
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastError || new Error(`Failed to fetch text from ${urlStr}`);
}

async function fetchAllowedDevices() {
  if (!DEVICES_CONFIG_URL) return;
  try {
    const res = await fetchTextWithRetry(DEVICES_CONFIG_URL, { "Cache-Control": "no-cache" }, 2);
    if (res.ok) {
      const devicesArray = JSON.parse(res.text);
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
    fetchTextWithRetry(WINK_CONFIG_URL, { "Cache-Control": "no-cache" }, 3),
    fetchTextWithRetry(VITRINA_CONFIG_URL, { "User-Agent": VITRINA_USER_AGENT }, 3),
  ]);

  let winkData = {};
  let vitrinaData = {};

  if (winkRes.status === "fulfilled" && winkRes.value.ok) {
    try { winkData = JSON.parse(winkRes.value.text); } catch (e) {}
  }
  if (vitrinaRes.status === "fulfilled" && vitrinaRes.value.ok) {
    try { vitrinaData = JSON.parse(vitrinaRes.value.text); } catch (e) {}
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
  try { baseUrl = new URL(targetUrl); } catch { return m3u8Text; }

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
      response.end("Robust Lime Proxy is running.");
      return;
    }

    if (url.pathname.includes("__layero_probe") || url.pathname === "/favicon.ico") {
      response.writeHead(404, corsHeaders());
      response.end();
      return;
    }

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
        const apiRes = await fetchTextWithRetry(apiUrl, getLimeHeaders(apiUrl), 2);
        response.end(JSON.stringify({ channel: channelKey, apiUrl, status: apiRes.status, response: JSON.parse(apiRes.text) }, null, 2));
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

    // Проксирование .m3u8 плейлистов
    if (url.pathname === "/proxy-m3u8") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        response.writeHead(400, corsHeaders());
        response.end();
        return;
      }

      try {
        const subRes = await fetchTextWithRetry(targetUrl, getLimeHeaders(targetUrl));
        const processedM3u8 = resolveM3u8Urls(subRes.text, targetUrl, devKey);

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

    // Проксирование сегментов с поддержкой стриминга
    if (url.pathname === "/proxy-segment") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        response.writeHead(400, corsHeaders());
        response.end();
        return;
      }

      const reqHeaders = getLimeHeaders(targetUrl);
      if (request.headers["range"]) {
        reqHeaders["Range"] = request.headers["range"];
      }

      try {
        const upstreamRes = await robustFetch(targetUrl, reqHeaders, "GET", 12000);
        
        const resHeaders = {
          ...corsHeaders(),
          "Content-Type": upstreamRes.headers["content-type"] || "video/mp2t",
        };
        if (upstreamRes.headers["content-length"]) resHeaders["Content-Length"] = upstreamRes.headers["content-length"];
        if (upstreamRes.headers["content-range"]) resHeaders["Content-Range"] = upstreamRes.headers["content-range"];

        response.writeHead(upstreamRes.statusCode || 200, resHeaders);
        upstreamRes.pipe(response);
      } catch (e) {
        console.error("Error proxying segment:", e.message);
        response.writeHead(503, corsHeaders());
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

      if (LIME_CHANNELS[path]) {
        const ch = LIME_CHANNELS[path];
        const apiUrl = `https://pl.iptv2021.com/api/v4/channel?id=${ch.id}&tz=${ch.tz}&region=${ch.region}`;
        const apiRes = await fetchTextWithRetry(apiUrl, getLimeHeaders(apiUrl), 3);
        const apiData = JSON.parse(apiRes.text);

        masterUrl = apiData.url || (apiData.stream && apiData.stream.common) || null;

        if (!masterUrl) {
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
        console.log(`[Lime] Мастер-ссылка для ${path}: ${masterUrl}`);

      } else {
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

      let streamText = "";
      if (provider === "vitrina") {
        const streamRes = await fetchTextWithRetry(masterUrl, getVitrinaHeaders(), 3);
        processedM3u8 = rewriteVitrinaPlaylist(streamRes.text, masterUrl);
      } else {
        const streamRes = await fetchTextWithRetry(masterUrl, getLimeHeaders(masterUrl), 3);
        processedM3u8 = resolveM3u8Urls(streamRes.text, masterUrl, devKey);
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
  console.log(`Robust Lime Proxy listening on port ${PORT}`);
  fetchOtherConfigs().catch(() => {});
  fetchAllowedDevices().catch(() => {});
});
