"""VNC Private Homes (vnc.com.br) — API JSON pública do site Next.js.

Endpoint: https://api-site.vnc.com.br/lopes/units
Filtros: slug do bairro + listingType=SALE. Detalhes em docs/SCRAPERS.md.
"""
import re
import unicodedata

from models import Imovel, novo_imovel
from util import http_get_json, parse_area_m2, parse_int

API = "https://api-site.vnc.com.br"
SLUG_BAIRRO = "vila-nova-conceicao-sao-paulo-sp-brasil"
PAGE_SIZE = 50

# tipos residenciais aceitos (escopo: moradia; exclui Salas/Lajes/etc.)
TIPOS_RESIDENCIAIS = {
    "apartamento", "cobertura", "casa", "casa de vila", "casa de condominio",
    "casa em condominio", "duplex", "triplex", "garden", "flat", "studio", "kitnet",
}


def _sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def _slugify(s: str) -> str:
    return re.sub(r"\s+", "-", _sem_acento(s).lower().strip())


def _url_anuncio(item: dict) -> str:
    """Replica a construção de URL do front da VNC (chunk 8320)."""
    ref = str(item.get("reference") or "")
    ref = ref if ref.startswith("REO") else f"REO{ref}"
    tipo = (item.get("subType") or {}).get("name") or (item.get("type") or {}).get("name") or "tipo"
    dorms = item.get("bedrooms") or 0
    bairro = (item.get("address") or {}).get("neighborhood") or "bairro"
    slug = f"{_slugify(tipo)}-{dorms}-dormitorios-{_slugify(bairro)}"
    return f"https://www.vnc.com.br/imovel/{ref}/{slug}?finalidade=venda"


def coletar() -> list[Imovel]:
    imoveis: list[Imovel] = []
    descartados = 0
    page = 1
    while True:
        data = http_get_json(
            f"{API}/lopes/units?slug={SLUG_BAIRRO}&listingType=SALE"
            f"&page={page}&pageSize={PAGE_SIZE}"
        )
        for item in data.get("items", []):
            tipo = ((item.get("subType") or {}).get("name")
                    or (item.get("type") or {}).get("name") or "")
            if _sem_acento(tipo).lower() not in TIPOS_RESIDENCIAIS:
                continue  # fora do escopo residencial
            try:
                preco = float(item.get("sellingPrice") or 0)  # API manda "8600000.00"
            except ValueError:
                preco = 0
            area = parse_area_m2(item.get("usableArea"))
            if not preco or not area or area <= 10:
                descartados += 1
                continue
            endereco = (item.get("address") or {}).get("street")
            titulo = (item.get("name") or "").strip() or f"{tipo} {item.get('reference')}"
            imoveis.append(novo_imovel(
                id=f"vnc-{item.get('reference')}",
                fonte="vnc",
                url=_url_anuncio(item),
                titulo=titulo,
                tipo=tipo,
                preco=int(preco),
                area_util_m2=area,
                dormitorios=parse_int(item.get("bedrooms")),
                suites=parse_int(item.get("suites")),
                vagas=parse_int(item.get("parkingSpaces")),
                endereco=endereco,
            ))
        if not data.get("hasMorePages"):
            break
        page += 1
    print(f"[vnc] {len(imoveis)} imóveis ({descartados} descartados sem preço/área)")
    return imoveis
