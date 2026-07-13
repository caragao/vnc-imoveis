"""Orquestrador: coleta as 3 fontes, valida e grava data/imoveis.json.

Uso:  python run.py            (na pasta scraper/)
Falha em uma fonte não aborta as demais — o resumo final indica o que rodou.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sites import angloamericana, ph15, vnc

SAIDA = Path(__file__).resolve().parent.parent / "data" / "imoveis.json"
FONTES = [("vnc", vnc), ("ph15", ph15), ("angloamericana", angloamericana)]


def main() -> int:
    todos = []
    falhas = []
    for nome, modulo in FONTES:
        try:
            todos.extend(modulo.coletar())
        except Exception as e:
            falhas.append(nome)
            print(f"[{nome}] ERRO: {e}", file=sys.stderr)

    if not todos:
        print("Nenhum imóvel coletado — mantendo o JSON anterior.", file=sys.stderr)
        return 1

    # ids únicos (proteção contra bug de paginação duplicando itens)
    por_id = {im.id: im for im in todos}
    envelope = {
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fontes_com_falha": falhas,
        "imoveis": [im.model_dump() for im in sorted(por_id.values(), key=lambda i: i.preco_m2)],
    }
    SAIDA.write_text(json.dumps(envelope, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nOK: {len(por_id)} imóveis gravados em {SAIDA}")
    if falhas:
        print(f"ATENÇÃO: fontes com falha: {', '.join(falhas)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
