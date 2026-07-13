"""Helpers compartilhados pelos scrapers."""
import re
import time
import urllib.request
import gzip
import json

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 vnc-imoveis-dashboard"
)

DELAY_S = 1.0  # pausa mínima entre requisições por site
_last_request = {}


def http_get(url: str, accept: str = "application/json") -> str:
    """GET educado: user-agent identificável + delay de 1s por host."""
    host = url.split("/")[2]
    elapsed = time.monotonic() - _last_request.get(host, 0)
    if elapsed < DELAY_S:
        time.sleep(DELAY_S - elapsed)
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
    _last_request[host] = time.monotonic()
    return data.decode("utf-8", "replace")


def http_get_json(url: str) -> dict:
    return json.loads(http_get(url))


def parse_preco_brl(texto: str) -> int | None:
    """'R$ 8.600.000' / 'R$ 8.600.000,00' -> 8600000 (int, reais)."""
    if not texto:
        return None
    m = re.search(r"R\$\s*([\d\.]+)(?:,\d+)?", texto.replace("\xa0", " "))
    if not m:
        return None
    return int(m.group(1).replace(".", ""))


def parse_area_m2(texto: str) -> float | None:
    """'259,88 m²' / '182 m²' / '288.00' -> float m²."""
    if not texto:
        return None
    m = re.search(r"([\d\.]+(?:,\d+)?)", str(texto).replace("\xa0", " "))
    if not m:
        return None
    valor = m.group(1)
    if "," in valor:
        valor = valor.replace(".", "").replace(",", ".")
    return float(valor)


def parse_int(valor) -> int | None:
    """'4' / 4 / '79.432' -> int; None se vazio/inválido."""
    if valor is None or valor == "":
        return None
    try:
        return int(str(valor).replace(".", "").strip())
    except ValueError:
        return None
