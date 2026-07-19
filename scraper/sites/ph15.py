"""PH15 (ph15.com) — API JSON pública do site.

Endpoint: https://api.ph15.com/v1/site/listings (apiKey extraída da home).
Bairro 5 = Vila Nova Conceição, cidade 3 = São Paulo. Detalhes em docs/SCRAPERS.md.
"""
import re
import urllib.parse

from models import Imovel, novo_imovel
from util import http_get, http_get_json, parse_area_m2, parse_int, parse_preco_brl

SITE = "https://ph15.com"
API = "https://api.ph15.com"
ID_CIDADE_SP = "3"
ID_BAIRRO_VNC = "5"

def _credenciais() -> dict:
    """A home embute PARAMETROS = { apiUrl, apiKey, chaveIndicacao } em <script>.

    Sem fallback hardcoded: se a extração falhar, a fonte falha explicitamente
    (run.py registra em fontes_com_falha e segue com as demais). Uma credencial
    antiga mascarando o problema seria pior que a falha visível.
    """
    html = http_get(SITE + "/", accept="text/html")
    api_key = re.search(r'"apiKey"\s*:\s*"([^"]+)"', html)
    chave = re.search(r'"chaveIndicacao"\s*:\s*"([^"]+)"', html)
    if not api_key or not chave:
        raise RuntimeError(
            "ph15: não encontrei apiKey/chaveIndicacao no bloco PARAMETROS da home — "
            "o site mudou; ver docs/SCRAPERS.md (seção ph15.com)"
        )
    return {"apiKey": api_key.group(1), "chaveIndicacao": chave.group(1)}


def coletar() -> list[Imovel]:
    creds = _credenciais()
    imoveis: list[Imovel] = []
    descartados = 0
    page = 1
    while True:
        params = [
            ("apiKey", creds["apiKey"]),
            ("chaveIndicacao", creds["chaveIndicacao"]),
            ("filtro-tagList[]", "residencial"),
            ("filtro-tagList[]", "vende"),
            ("filtro-idDgCidade", ID_CIDADE_SP),
            ("filtro-idDgBairro", ID_BAIRRO_VNC),
            ("page", str(page)),
        ]
        data = http_get_json(f"{API}/v1/site/listings?" + urllib.parse.urlencode(params))
        d = data.get("data", {})
        rows = d.get("rows", [])
        if not rows:
            break
        for row in rows:
            if not row.get("vende"):
                continue
            preco = parse_preco_brl(row.get("valorVenda") or "")
            area = parse_area_m2(row.get("area") or "")
            if not preco or not area or area <= 10:
                descartados += 1
                continue
            ref = str(row.get("referencia") or row.get("idComercializacao") or "").replace(".", "")
            url_anuncio = row.get("urlAnuncio") or ""
            imoveis.append(novo_imovel(
                id=f"ph15-{ref}",
                fonte="ph15",
                url=SITE + url_anuncio if url_anuncio.startswith("/") else url_anuncio,
                titulo=(row.get("tituloAnuncio") or "").strip() or f"Imóvel {ref}",
                tipo=row.get("subSubTipo") or "Imóvel",
                preco=preco,
                area_util_m2=area,
                dormitorios=parse_int(row.get("dormitorios")),
                suites=parse_int(row.get("suites")),
                vagas=parse_int(row.get("vagas")),
                condominio=parse_preco_brl(row.get("valorCondominio") or ""),
                iptu=parse_preco_brl(row.get("valorIptu") or ""),
                endereco=row.get("logradouro"),
            ))
        total_paginas = d.get("total") or 1  # "total" = número de páginas nesta API
        if page >= total_paginas:
            break
        page += 1
    print(f"[ph15] {len(imoveis)} imóveis ({descartados} descartados sem preço/área)")
    return imoveis
