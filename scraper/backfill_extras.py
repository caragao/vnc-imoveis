"""Backfill pontual: preenche condomínio/IPTU e conserta títulos da VNC.

NÃO altera preço, área nem `atualizado_em` — só adiciona os campos novos e
reescreve o título das linhas da VNC (composto dos campos já presentes). É a
exceção documentada à regra "o scraper sobrescreve o JSON por completo": aqui
mexemos apenas nos campos novos, mantendo a base de preços atual.

Uso:  python backfill_extras.py   (da pasta scraper/)

Estratégia: reaproveita `coletar()` de cada fonte para obter os custos por `id`
(lê só condomínio/IPTU do resultado, ignora os preços re-coletados). Anglo é
best-effort (Playwright); se falhar, as 11 linhas ficam sem custo.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import Imovel  # noqa: E402
from sites import ph15, vnc  # noqa: E402
from sites.vnc import titulo_vnc  # noqa: E402

ARQUIVO = Path(__file__).resolve().parent.parent / "data" / "imoveis.json"


def _mapa_custos(modulo, rotulo: str) -> dict[str, tuple[int | None, int | None]]:
    """{id: (condominio, iptu)} a partir de coletar(); tolera falha da fonte."""
    try:
        return {im.id: (im.condominio, im.iptu) for im in modulo.coletar()}
    except Exception as e:  # noqa: BLE001 — falha de fonte não aborta o backfill
        print(f"[{rotulo}] custos indisponíveis, seguindo sem eles: {e}", file=sys.stderr)
        return {}


def main() -> int:
    dados = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    imoveis = dados["imoveis"]

    custos_vnc = _mapa_custos(vnc, "vnc")
    custos_ph15 = _mapa_custos(ph15, "ph15")
    custos_anglo: dict[str, tuple[int | None, int | None]] = {}
    try:
        from sites import angloamericana
        custos_anglo = _mapa_custos(angloamericana, "anglo")
    except Exception as e:  # noqa: BLE001 — Playwright pode não estar disponível
        print(f"[anglo] backfill best-effort ignorado: {e}", file=sys.stderr)

    n_titulo = n_cond = n_iptu = 0
    for im in imoveis:
        fonte = im["fonte"]
        if fonte == "vnc":
            novo = titulo_vnc(im.get("tipo", ""), im["area_util_m2"], im.get("endereco"))
            if novo != im.get("titulo"):
                im["titulo"] = novo
                n_titulo += 1
            _, iptu = custos_vnc.get(im["id"], (None, None))
            if iptu is not None:
                im["iptu"] = iptu
                n_iptu += 1
            im.setdefault("condominio", None)
        else:
            mapa = custos_ph15 if fonte == "ph15" else custos_anglo
            cond, iptu = mapa.get(im["id"], (None, None))
            if cond is not None:
                im["condominio"] = cond
                n_cond += 1
            if iptu is not None:
                im["iptu"] = iptu
                n_iptu += 1
        # garante que os campos novos existam mesmo quando a fonte não os expõe
        im.setdefault("condominio", None)
        im.setdefault("iptu", None)

    # revalida com o schema e normaliza a ordem das chaves (condominio/iptu
    # antes de endereco, como no model_dump de run.py)
    dados["imoveis"] = [Imovel(**item).model_dump() for item in imoveis]

    ARQUIVO.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(imoveis)} imóveis; títulos VNC reescritos: {n_titulo}; "
          f"condomínio preenchido: {n_cond}; IPTU preenchido: {n_iptu}")
    print(f"atualizado_em preservado: {dados.get('atualizado_em')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
