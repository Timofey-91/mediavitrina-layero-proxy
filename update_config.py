import json
import re
import time
import urllib.request
import urllib.error
import urllib.parse


CONFIG_FILE = "config.json"

# ============================================================
# HTTP headers
# ============================================================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Origin": "https://player.mediavitrina.ru",
    "Referer": "https://player.mediavitrina.ru/",
}


# ============================================================
# Mediavitrina balancer
# ============================================================

BALANCER_URL = (
    "https://media.mediavitrina.ru/"
    "balancer/v3/default_2026/{slug}/streams.json"
)


# ============================================================
# Player.html
#
# Отсюда каждый запуск берём актуальный
# egress_version_id.
# ============================================================

PLAYER_URLS = {

    "1tv":
        "https://player.mediavitrina.ru/"
        "1tvch/1tvch/vitrinatv_web/"
        "659fab1a9893b/player.html",

    "5tv":
        "https://player.mediavitrina.ru/"
        "5tv/vitrinatv_web/player.html",

    "channel78":
        "https://player.mediavitrina.ru/"
        "tk78/vitrinatv_web/player.html",

    "ctc":
        "https://player.mediavitrina.ru/"
        "ctc_ext/vitrinatv_web/player.html",

    "ctc-dom":
        "https://player.mediavitrina.ru/"
        "domashniy_ext/vitrinatv_web/player.html",

    "ctc-che":
        "https://player.mediavitrina.ru/"
        "che_ext/vitrinatv_web/player.html",

    "ctc-love":
        "https://player.mediavitrina.ru/"
        "ctc_love_ext/vitrinatv_web/player.html",

    "friday":
        "https://player.mediavitrina.ru/"
        "gpm_friday_v2/friday/vitrinatv_web/player.html",

    "izvestia":
        "https://player.mediavitrina.ru/"
        "iz/vitrinatv_web/player.html",

    "matchtv":
        "https://player.mediavitrina.ru/"
        "gpm_matchtv_v2/matchtv/vitrinatv_web/player.html",

    "ntv0h":
        "https://player.mediavitrina.ru/"
        "ntv_v2/ntv/vitrinatv_web/player.html",

    "otr_0":
        "https://player.mediavitrina.ru/"
        "otr_v2/otr/vitrinatv_web/"
        "66e19a6096580/player.html",

    "ren-tv":
        "https://player.mediavitrina.ru/"
        "rentv/vitrinatv_web/player.html",

    "russia24":
        "https://player.mediavitrina.ru/"
        "russia24/vitrinatv_web/player.html",

    "tnt":
        "https://player.mediavitrina.ru/"
        "gpm_tnt_v2/tnt/vitrinatv_web/player.html",

    "tv3":
        "https://player.mediavitrina.ru/"
        "tv3_v2/tv3/vitrinatv_web/player.html",

    "tvc":
        "https://player.mediavitrina.ru/"
        "tvc/tvc/vitrinatv_web/player.html",

    "zvezda":
        "https://player.mediavitrina.ru/"
        "zvezda/tvzvezda/vitrinatv_web/player.html",
}


# ============================================================
# Каналы
# ============================================================

CHANNELS = {

    "1tv": {
        "slug": "1tvch",
    },

    "5tv": {
        "slug": "5tv",
    },

    "5tv_2_sd": {
        "base": "5tv",
        "stream_id": "5tv_2_sd",
    },

    "5tv_4_sd": {
        "base": "5tv",
        "stream_id": "5tv_4_sd",
    },

    "5tv_7_sd": {
        "base": "5tv",
        "stream_id": "5tv_7_sd",
    },

    "channel78": {
        "slug": "tk78",
    },

    "ctc": {
        "slug": "ctc",
    },

    "ctc2": {
        "base": "ctc",
        "stream_id": "ctc2",
    },

    "ctc4": {
        "base": "ctc",
        "stream_id": "ctc4",
    },

    "ctc7": {
        "base": "ctc",
        "stream_id": "ctc7",
    },

    "ctc-dom": {
        "slug": "domashniy",
    },

    "ctc-dom2": {
        "base": "ctc-dom",
        "stream_id": "ctc-dom2",
    },

    "ctc-dom4": {
        "base": "ctc-dom",
        "stream_id": "ctc-dom4",
    },

    "ctc-dom7": {
        "base": "ctc-dom",
        "stream_id": "ctc-dom7",
    },

    "ctc-che": {
        "slug": "che",
    },

    "ctc-love": {
        "slug": "ctclove",
    },

    "friday": {
        "slug": "gpm_friday",
    },

    "friday2h": {
        "base": "friday",
        "stream_id": "friday2h",
    },

    "friday4h": {
        "base": "friday",
        "stream_id": "friday4h",
    },

    "friday7h": {
        "base": "friday",
        "stream_id": "friday7h",
    },

    "izvestia": {
        "slug": "iz",
    },

    "matchtv": {
        "slug": "gpm_matchtv",
    },

    "ntv0h": {
        "slug": "ntv_msk",
    },

    "ntv1h": {
        "base": "ntv0h",
        "stream_id": "ntv1h",
    },

    "ntv2h": {
        "base": "ntv0h",
        "stream_id": "ntv2h",
    },

    "ntv4h": {
        "base": "ntv0h",
        "stream_id": "ntv4h",
    },

    "otr_0": {
        "slug": "otr",
    },

    "ren-tv": {
        "slug": "rentv",
    },

    "ren_2_sd": {
        "base": "ren-tv",
        "stream_id": "ren_2_sd",
    },

    "ren_4_sd": {
        "base": "ren-tv",
        "stream_id": "ren_4_sd",
    },

    "ren_7_sd": {
        "base": "ren-tv",
        "stream_id": "ren_7_sd",
    },

    "russia24": {
        "slug": "russia24",
    },

    "tnt": {
        "slug": "gpm_tnt",
    },

    "tnt2h": {
        "base": "tnt",
        "stream_id": "tnt2h",
    },

    "tnt4h": {
        "base": "tnt",
        "stream_id": "tnt4h",
    },

    "tnt7h": {
        "base": "tnt",
        "stream_id": "tnt7h",
    },

    "tv3": {
        "slug": "gpm_tv3",
    },

    "tv3h2": {
        "base": "tv3",
        "stream_id": "tv3h2",
    },

    "tv3h4": {
        "base": "tv3",
        "stream_id": "tv3h4",
    },

    "tv3h7": {
        "base": "tv3",
        "stream_id": "tv3h7",
    },

    "tvc": {
        "slug": "tvc",
    },

    "zvezda": {
        "slug": "zvezda",
    },

    "zvezda2": {
        "base": "zvezda",
        "stream_id": "zvezda2",
    },

    "zvezda4": {
        "base": "zvezda",
        "stream_id": "zvezda4",
    },

    "zvezda7": {
        "base": "zvezda",
        "stream_id": "zvezda7",
    },
}


# ============================================================
# Вспомогательная функция для HTTP запросов с Retry
# ============================================================

def http_get(url, params=None, timeout=20, retries=3):
    """
    Универсальный аналог requests.get с поддержкой query-параметров, 
    ймаутов, повторных попыток (retry) и возвратом статуса и текста ответа.
    """
    if params:
        parsed_url = urllib.parse.urlparse(url)
        query_dict = dict(urllib.parse.parse_qsl(parsed_url.query))
        query_dict.update(params)
        encoded_query = urllib.parse.urlencode(query_dict)
        parsed_url = parsed_url._replace(query=encoded_query)
        url = urllib.parse.urlunparse(parsed_url)

    req = urllib.request.Request(url, headers=HEADERS)
    
    last_error = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status_code = response.getcode()
                body = response.read().decode("utf-8", errors="ignore")
                return status_code, body
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore") if e.fp else ""
            if e.code in [400, 404, 403]:
                return e.code, body
            last_error = f"HTTP error {e.code}"
        except Exception as e:
            last_error = str(e)
        
        if attempt < retries - 1:
            time.sleep(1.5)

    raise RuntimeError(f"Network error after {retries} retries: {last_error}")


# ============================================================
# Нормализация URL
# ============================================================

def normalize_url(value):
    if isinstance(value, str):
        value = value.strip()
        return value if value else None
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                item = item.strip()
                if item:
                    return item
    return None


# ============================================================
# Получение актуального egress_version_id
# ============================================================

def get_egress(channel_name):
    player_url = PLAYER_URLS.get(channel_name)

    if not player_url:
        print(f"[ERROR] {channel_name}: player URL не задан")
        return None

    print()
    print(f"[PLAYER] {channel_name}")
    print(f"[PLAYER URL] {player_url}")

    try:
        status_code, text = http_get(player_url, timeout=15)
        print(f"[PLAYER HTTP {status_code}] {channel_name}")

        if status_code != 200:
            print(f"[ERROR] {channel_name}: player.html вернул HTTP {status_code}")
            return None

        match = re.search(
            r"streams_api_v2_url:"
            r"\s*['\"][^'\"]*"
            r"egress_version_id=(\d+)",
            text,
        )

        if not match:
            match = re.search(
                r"egress_version_id=(\d+)",
                text,
            )

        if not match:
            print(f"[ERROR] {channel_name}: egress_version_id не найден")
            return None

        egress = match.group(1)
        print(f"[EGRESS] {channel_name} -> {egress}")
        return egress

    except Exception as e:
        print(f"[ERROR] {channel_name}: {e}")
        return None


# ============================================================
# Получение HLS от Mediavitrina
# ============================================================

def fetch_hls(slug, egress):
    url = BALANCER_URL.format(slug=slug)

    params = {
        "application_id": "",
        "player_referer_hostname": "vitrina.tv",
        "config_checksum_sha256": "undefined",
        "egress_version_id": egress,
    }

    try:
        status_code, text = http_get(url, params=params, timeout=15)
        print(f"[HTTP {status_code}] {slug} | egress={egress}")

        if status_code != 200:
            print(f"[ERROR] {slug}: {text[:500]}")
            return None

        data = json.loads(text)
        hls_url = normalize_url(data.get("hls"))

        if not hls_url:
            print(f"[ERROR] {slug}: поле hls отсутствует")
            return None

        print(f"[OK] {slug} -> {hls_url}")
        return hls_url

    except Exception as e:
        print(f"[ERROR] {slug}: {e}")
        return None


# ============================================================
# Проверка HLS
# ============================================================

def check_hls(url):
    try:
        status_code, text = http_get(url, timeout=8, retries=2)
        if status_code != 200:
            return False

        text = text.lstrip()
        if "#EXTM3U" not in text:
            return False

        return True
    except Exception:
        return False


# ============================================================
# Построение регионального URL
# ============================================================

def build_regional_url(
    base_url,
    stream_id,
    hls_number,
):
    match = re.match(
        r"^(https?://[^/]+)/"
        r"(hls-livef\d+)/"
        r"([^/]+)/"
        r"(index\.m3u8)"
        r"(\?.*)?$",
        base_url,
    )

    if not match:
        print(f"[ERROR] Не удалось разобрать основной URL:\n{base_url}")
        return None

    host = match.group(1)
    query = match.group(5) or ""

    return (
        f"{host}/"
        f"hls-livef{hls_number}/"
        f"{stream_id}/"
        f"index.m3u8"
        f"{query}"
    )


# ============================================================
# Поиск регионального потока
# ============================================================

def find_regional_stream(
    base_url,
    stream_id,
):
    print()
    print(f"[SEARCH] Ищем {stream_id}")

    match = re.search(
        r"/hls-livef(\d+)/",
        base_url,
    )

    numbers = list(range(1, 10))

    if match:
        original_number = int(match.group(1))
        if original_number in numbers:
            numbers.remove(original_number)
            numbers.insert(0, original_number)

    for number in numbers:
        candidate = build_regional_url(
            base_url,
            stream_id,
            number,
        )

        if not candidate:
            return None

        print(f"[TRY] {stream_id} -> hls-livef{number}")

        if check_hls(candidate):
            print(f"[FOUND] {stream_id} -> {candidate}")
            return candidate

        print(f"[NOT FOUND] {stream_id} hls-livef{number}")
        time.sleep(0.2)

    print(f"[ERROR] {stream_id}: рабочий hls-livef не найден")
    return None


# ============================================================
# MAIN
# ============================================================

def main():
    config = {}

    print("=" * 70)
    print("Mediavitrina HLS updater (urllib version)")
    print("Основные + региональные потоки (с анти-бот паузами)")
    print("Динамический egress_version_id")
    print("=" * 70)

    base_streams = {}

    for channel_name, channel_data in CHANNELS.items():
        if "base" in channel_data:
            continue

        slug = channel_data["slug"]

        print()
        print(f"--- {channel_name} ---")
        print(f"slug : {slug}")

        egress = get_egress(channel_name)

        if not egress:
            print(f"[-] {channel_name}: не удалось получить egress_version_id")
            time.sleep(0.9)
            continue

        stream_url = fetch_hls(slug, egress)

        if stream_url:
            config[channel_name] = stream_url
            base_streams[channel_name] = stream_url
        else:
            print(f"[-] {channel_name}: основной поток не получен")

        time.sleep(0.9)

    for channel_name, channel_data in CHANNELS.items():
        if "base" not in channel_data:
            continue

        base_channel = channel_data["base"]
        stream_id = channel_data["stream_id"]

        print()
        print("=" * 70)
        print(f"--- {channel_name} ---")
        print(f"base       : {base_channel}")
        print(f"stream_id : {stream_id}")
        print("=" * 70)

        base_url = base_streams.get(base_channel)

        if not base_url:
            print(f"[-] {channel_name}: не удалось получить основной поток {base_channel}")
            continue

        regional_url = find_regional_stream(base_url, stream_id)

        if regional_url:
            config[channel_name] = regional_url
        else:
            print(f"[-] {channel_name}: поток не найден")

        time.sleep(0.9)

    if not config:
        raise RuntimeError("Не удалось получить ни одного HLS потока.")

    with open(
        CONFIG_FILE,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            config,
            f,
            ensure_ascii=False,
            indent=4,
        )

    print()
    print("=" * 70)
    print(f"[FINISH] Получено: {len(config)} / {len(CHANNELS)}")
    print(f"[FINISH] Файл: {CONFIG_FILE}")
    print("=" * 70)


if __name__ == "__main__":
    main()
