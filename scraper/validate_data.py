"""Valida data/imoveis.json e imprime um relatório de qualidade.

Uso:  python scraper/validate_data.py   (da raiz)  ou  python validate_data.py  (de scraper/)

Exit code != 0 SOMENTE para violações objetivas de schema/integridade:
  - JSON inválido ou fora do schema Pydantic
  - IDs duplicados
  - URLs duplicadas ou que não começam com https://
  - preco_m2 divergindo materialmente de preco/area_util_m2 (> R$ 1)
  - suites > dormitorios (ambos preenchidos)
Outliers (área/preço fora de faixa, possíveis duplicados entre fontes) são
reportados como diagnóstico e NÃO bloqueiam.
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from models import Imovel  # noqa: E402

ARQUIVO = Path(__file__).resolve().parent.parent / "data" / "imoveis.json"


def main() -> int:
    dados = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    brutos = dados["imoveis"]
    erros: list[str] = []

    # schema
    imoveis: list[Imovel] = []
    for i, item in enumerate(brutos):
        try:
            imoveis.append(Imovel(**item))
        except Exception as e:
            erros.append(f"schema: item {i} ({item.get('id', '?')}): {e}")

    # integridade
    ids = Counter(im.id for im in imoveis)
    for id_, n in ids.items():
        if n > 1:
            erros.append(f"id duplicado: {id_} ({n}x)")
    urls = Counter(im.url for im in imoveis)
    for url, n in urls.items():
        if n > 1:
            erros.append(f"url duplicada: {url} ({n}x)")
    for im in imoveis:
        if abs(im.preco_m2 - im.preco / im.area_util_m2) > 1:
            erros.append(f"preco_m2 divergente: {im.id} ({im.preco_m2} vs {im.preco / im.area_util_m2:.0f})")
        if im.suites is not None and im.dormitorios is not None and im.suites > im.dormitorios:
            erros.append(f"suites > dormitorios: {im.id} ({im.suites} > {im.dormitorios})")

    # ---------- relatório ----------
    print(f"Total de imóveis: {len(imoveis)}  (atualizado_em: {dados.get('atualizado_em')})")
    print("Por fonte:", dict(Counter(im.fonte for im in imoveis)))
    if dados.get("fontes_com_falha"):
        print("⚠ fontes com falha na última coleta:", dados["fontes_com_falha"])

    ordenados = sorted(imoveis, key=lambda i: i.preco_m2)
    print("\nBottom 10 por R$/m²:")
    for im in ordenados[:10]:
        print(f"  {im.preco_m2:>7} R$/m²  {im.area_util_m2:>7.0f} m²  {im.id:<18} {im.tipo}")
    print("Top 10 por R$/m²:")
    for im in ordenados[-10:]:
        print(f"  {im.preco_m2:>7} R$/m²  {im.area_util_m2:>7.0f} m²  {im.id:<18} {im.tipo}")

    outliers_area = [im for im in imoveis if im.area_util_m2 < 30 or im.area_util_m2 > 1000]
    outliers_preco = [im for im in imoveis if im.preco < 1_000_000 or im.preco > 50_000_000]
    print(f"\nOutliers de área (<30 ou >1000 m²): {len(outliers_area)}")
    for im in outliers_area[:15]:
        print(f"  {im.id:<18} {im.area_util_m2:>8.1f} m²  {im.tipo}")
    print(f"Outliers de preço (<R$ 1 mi ou >R$ 50 mi): {len(outliers_preco)}")
    for im in outliers_preco[:15]:
        print(f"  {im.id:<18} R$ {im.preco:>12,}  {im.tipo}")

    # diagnóstico de possíveis duplicados entre fontes (sem deduplicar):
    # mesma área arredondada + preço igual em fontes diferentes
    chaves = Counter()
    for im in imoveis:
        chaves[(round(im.area_util_m2), im.preco)] += 1
    possiveis = {k: n for k, n in chaves.items() if n > 1}
    print(f"\nPossíveis duplicados entre fontes (mesma área arredondada + mesmo preço): "
          f"{sum(possiveis.values()) - len(possiveis)} pares em {len(possiveis)} grupos (diagnóstico, não bloqueia)")

    if erros:
        print(f"\n{len(erros)} VIOLAÇÕES DE INTEGRIDADE:", file=sys.stderr)
        for e in erros:
            print("  " + e, file=sys.stderr)
        return 1
    print("\nOK: schema e integridade válidos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
