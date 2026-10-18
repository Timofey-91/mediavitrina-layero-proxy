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

// Единственный Device ID, полученный при прохождении капчи
const DEVICE_ID = "448182.66555409547-1790167864304";

const LIME_WEB_AGENT = JSON.stringify({
  platform: "web",
  app: "limehd.tv",
  device_id: DEVICE_ID,
});

// Куки авторизации с валидным токеном прохождения защиты
const LIME_COOKIE = `spid=1789471753211_d24206d2c501aed0b81a419ebedde60a_ksiknrov2hn12wqe; ff-session-id=1789471760557353620299; _ym_uid=1789471766597734341; _ym_d=1789471766; _ymab_param=bDdwj7T-XI7UGbsLUVRzfn3WFleSnNVvToQ6yzYQrxvMqNZqUmlWDsz0B-CZ63tVFUV70VQcRG9zVvjFfqoAJSmdg5Y; cookieIsAgree=true; userRegionCode=65; showDemoModal=1; isPincodeDisabled=false; profileMode=parent; deviceId=${DEVICE_ID}; lastChannel=tvc; yandex_extid_last_sync=2026-10-12T10%3A28%3A02.703Z; sessionId=17921728724711389342711; appGuid=746ac552-8fb9-45e9-a58b-10554f7aed85; __ai_fp_uuid=1cb3ecaece957bb7%3A1; ma_id=4916097261792172895740; __upin=vEJkXWpCw1zNlCOzW/jsuA; ma_id_api=tmSLo/unyy1ItqiFXRmu1OjJuoBJbc5dT5ifm+Gr93wfXt+TBhH4fBlOi18x/D9hl5Tif/8+hgOt9GAtk+Rsyuyr1d1DN209x0mzUpITAWCOz36RKh7h9w0xDIxixUzhoVY/oXxmcSYrWIFKCOxzNTzYxhXCveFIF1CYzI0cI50Nd8qEiYZcKhRNTXB3R0b5htQ+SzVMdFD1MmYdpa9/0zgJbD2AbOlpUMhKvyvz3vDCduCnkGWXLvFf8RMJJIEWSthr8RnzwVcgTbJRv63x23qdvdwfYYum9tktxjlrUWU2Hik9Y4jZu+91RM1m/segJlEW0fB2IzyARrGNbusUEg==; _buzz_aidata=JTdCJTIydWZwJTIyJTNBJTIydkVKa1hXcEN3MXpObENPelclMkZqc3VBJTIyJTJDJTIyYnJvd3NlclZlcnNpb24lMjIlM0ElMjIxNTUuMCUyMiUyQyUyMnRzQ3JlYXRlZCUyMiUzQTE3OTIxNzI4OTc0MjQlN0Q=; _buzz_mtsa=JTdCJTIydWZwJTIyJTNBJTIyMTY4NTQxZmExMmRhZGEyNTMxNTc2ZDkyN2NkMjg2YTglMjIlMkMlMjJicm93c2VyVmVyc2lvbiUyMiUzQSUyMjE1NS4wJTIyJTJDJTIydHNDcmVhdGVkJTIyJTNBMTc5MjE3Ijg5ODAzMyU3RA==; _ym_isad=2; limeSocDem=%7B%22mh_user_id%22%3A%22746ac552-8fb9-45e9-a58b-10554f7aed85%22%2C%22status%22%3A%22success%22%2C%22socio_demographics%22%3A%5B%7B%221%22%3A%226%22%2C%222%22%3A%2215%22%2C%2218%22%3A%22105%22%2C%22member_id%22%3A1%2C%22priority%22%3A1%7D%5D%2C%22recheck_on_channel_change%22%3Atrue%2C%22expiry_date%22%3A%222026-10-18T10%3A09%3A14Z%22%7D; spjs=1792318998688_37126423_0f8e933c_9773db7ec7685d431f2ecf098b593cf9_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; spsc=1792318998688_640068b6c5cd059d2f162492f294d9f0_jYr2DyHU6Xh-KTnBMQZv3uMP7RF9GfcmSkAhYP2knwsZ; spcaphp=eyJpdiI6ImpRbVZpb3J4SnR2WEZmQ0Z4VzV0TFE9PSIsInZhbHVlIjoiZXJwWnd1dFBrSFFuTFVsUnAzbnVcL3Bvekl2Q0ptTE5jTFoxWkpZTnp6alBXa2tLUFM4SlN4eStERk02bkVIRkV6alwvXC9nUUFPRm04TWNrVjM0NDBQTUM3WmdzK1RaWlphR01ibm53MTdyNUE9IiwibWFjIjoiM2JmYjIyZTJlOGNlNDc2NWEzNWIwYWMyMDE0Y2VkNzc1MDY1MTVmNGMwZmQzODIzZDgzMmJkNjk2N2U5YWFjNSJ9; spca=1792318998688_d3b484b457f0cab86a0fe62a82408925_jYr2DyHU6Xh-KTnBMQZv3uMP7RF9GfcmSkAhYP2knwsZ_Wod2UvXMCW4a5ujGn6YaXg; nuxt-color-mode=system; nuxt-session=Fe26.2**f02124a10a5847ef06c36b8bd2928147f651ec48b18fcaff2ca7edd08c656ed8*Hhx36BSc3N4cGinmL-mqNg*fnRUjX_lfVhxkpVY9P65MWCMKo_m76jji6Zdp5loh7rt7pHXRyPjStnFoPu3oHQgNT3GvSzRpe-B8ah70XkjwREiDKlIg8Y_vhjJPG-41UEXfwgjk-lQ79Tf3PGHPnKQ**4f5d6593a63fcc1661ff17b805dc4bb97620f5ad0bf706b007fddeea3a768695*lphdcTLH04IfNnMiVIRoNtLtNl6GzhhLvw31JvbgVv0`;

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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "x-device-id": DEVICE_ID,
    "x-lhd-agent": LIME_WEB_AGENT,
    "Referer": "https://limehd.tv/",
    "Origin": "https://limehd.tv",
    "Cookie": LIME_COOKIE,
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
// HTTPS REQUEST WRAPPER
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
