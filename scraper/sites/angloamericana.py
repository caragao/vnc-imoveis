"""Anglo Americana (angloamericana.com.br) — Playwright obrigatório (403 anti-bot).

Busca: /busca/venda/sao-paulo/vila-nova-conceicao (cards server-rendered).
Suítes só existem na página de detalhe -> visitamos cada anúncio.
Detalhes em docs/SCRAPERS.md.
"""
import re

from playwright.sync_api import sync_playwright

from models import Imovel, novo_imovel
from util import parse_area_m2, parse_preco_brl

SITE = "https://angloamericana.com.br"
URL_BUSCA = f"{SITE}/busca/venda/sao-paulo/vila-nova-conceicao"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
DELAY_MS = 1200


def _parse_card(texto: str) -> dict:
    """Texto do card: 'Venda\nApartamento\nVila Nova Conceição\n182m²\n3 quartos\n2 vagas\nR$ 5.500.000'."""
    d = {}
    if m := re.search(r"([\d\.,]+)\s*m²", texto):
        d["area"] = parse_area_m2(m.group(1))
    if m := re.search(r"(\d+)\s*quartos?", texto):
        d["dormitorios"] = int(m.group(1))
    if m := re.search(r"(\d+)\s*vagas?", texto):
        d["vagas"] = int(m.group(1))
    d["preco"] = parse_preco_brl(texto)
    return d


def coletar() -> list[Imovel]:
    imoveis: list[Imovel] = []
    descartados = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, locale="pt-BR")
        page = ctx.new_page()
        page.goto(URL_BUSCA, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        # rolar até estabilizar (resultados podem carregar por lazy-load)
        estavel = 0
        total_anterior = 0
        while estavel < 3:
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(DELAY_MS)
            total = page.eval_on_selector_all('a[href*="/imovel/"]', "els => els.length")
            estavel = estavel + 1 if total == total_anterior else 0
            total_anterior = total

        cards = page.eval_on_selector_all(
            'a[href*="/imovel/venda/"]',
            'els => [...new Map(els.map(e => [e.getAttribute("href"), e.innerText])).entries()]'
            ".map(([href, text]) => ({href, text}))",
        )
        # apenas resultados do bairro (a home embute destaques de outros bairros)
        cards = [c for c in cards if "/vila-nova-conceicao/" in c["href"]]
        print(f"[anglo] {len(cards)} cards na busca")

        for card in cards:
            href = card["href"]
            codigo = href.rstrip("/").split("/")[-1]
            tipo_slug = href.rstrip("/").split("/")[-2]
            info = _parse_card(card["text"])
            if not info.get("preco") or not info.get("area") or info["area"] <= 10:
                descartados += 1
                continue

            # detalhe: suítes + condomínio/IPTU (best-effort; só existem aqui)
            suites = None
            condominio = None
            iptu = None
            try:
                page.goto(SITE + href, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(DELAY_MS + 1500)
                corpo = page.inner_text("body")
                if m := re.search(r"\((\d+)\s*su[ií]tes?\)", corpo, re.I):
                    suites = int(m.group(1))
                elif m := re.search(r"(\d+)\s*su[ií]tes?", corpo, re.I):
                    suites = int(m.group(1))
                if m := re.search(r"Condom[ií]nio[^R]*R\$\s*[\d\.]+(?:,\d+)?", corpo, re.I):
                    condominio = parse_preco_brl(m.group(0))
                if m := re.search(r"IPTU[^R]*R\$\s*[\d\.]+(?:,\d+)?", corpo, re.I):
                    iptu = parse_preco_brl(m.group(0))
            except Exception as e:
                print(f"[anglo] aviso: detalhe {codigo} falhou ({e})")

            imoveis.append(novo_imovel(
                id=f"anglo-{codigo}",
                fonte="angloamericana",
                url=SITE + href,
                titulo=f"{tipo_slug.replace('-', ' ').title()} em Vila Nova Conceição ({codigo})",
                tipo=tipo_slug.replace("-", " ").title(),
                preco=info["preco"],
                area_util_m2=info["area"],
                dormitorios=info.get("dormitorios"),
                suites=suites,
                vagas=info.get("vagas"),
                condominio=condominio,
                iptu=iptu,
                endereco=None,
            ))
        browser.close()
    print(f"[anglo] {len(imoveis)} imóveis ({descartados} descartados sem preço/área)")
    return imoveis
