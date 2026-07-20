"""Relatório de qualidade + validação de data/transacoes.json.

Revalida o schema (bloqueia se quebrar) e imprime um panorama para o revisor:
distribuição por ano/natureza/uso, cobertura de área, parciais e outliers de
R$/m². Espelha o papel de scraper/validate_data.py. Saída != 0 se o schema falhar
ou o JSON não existir — serve de gate de CI."""
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import models  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ = os.path.join(RAIZ, "data", "transacoes.json")


def _cont(rotulo, itens):
    print(f"\n{rotulo}")
    for chave, n in sorted(itens, key=lambda kv: -kv[1]):
        print(f"  {n:>4}  {chave}")


def main():
    if not os.path.exists(ARQ):
        raise SystemExit(f"{ARQ} não existe — rode `python itbi/build.py` antes")
    with open(ARQ, encoding="utf-8") as f:
        dados = json.load(f)

    linhas = dados["transacoes"]
    erros = 0
    for i, t in enumerate(linhas):
        try:
            models.Transacao(**t)
        except Exception as e:
            erros += 1
            print(f"[schema] linha {i} inválida: {e}")
    if erros:
        raise SystemExit(f"\n{erros} transações violam o schema — corrija build.py")

    n = len(linhas)
    print(f"transações: {n}  ·  período {dados['periodo']['de']} a {dados['periodo']['ate']}")
    print(f"fonte: {dados['fonte']}")

    # garantia do filtro: nenhum CEP fora da faixa 045xxxxx
    fora = [t for t in linhas if t.get("cep") and not t["cep"].startswith("045")]
    print(f"\nCEP fora de 045xxxxx (deveria ser 0): {len(fora)}")
    for t in fora[:5]:
        print(f"  ! {t['cep']}  {t['bairro']}  {t['endereco']}")

    from collections import Counter
    _cont("por ano (data de transação):", Counter(t["ano"] for t in linhas).items())
    _cont("por natureza:", Counter(t["natureza"] for t in linhas).items())
    _cont("por uso (IPTU):", Counter(t.get("descricao_uso") or "(sem uso)" for t in linhas).items())

    residenciais = [t for t in linhas if t["residencial"]]
    com_area = [t for t in linhas if t.get("area_construida_m2")]
    parciais = [t for t in linhas if t["proporcao"] < 100]
    com_m2 = [t for t in linhas if t.get("valor_m2")]
    print(f"\nresidenciais (uso 10/20/21/25): {len(residenciais)} ({len(residenciais)*100//n}%)")
    print(f"com área construída > 0: {len(com_area)} ({len(com_area)*100//n}%)")
    print(f"transferências parciais (<100%): {len(parciais)} ({len(parciais)*100//n}%)")

    if com_m2:
        m2 = sorted(t["valor_m2"] for t in com_m2)
        print(f"\nR$/m² (ajustado p/ 100%, {len(m2)} transações com área):")
        print(f"  mediana {statistics.median(m2):,.0f}  ·  min {m2[0]:,.0f}  ·  max {m2[-1]:,.0f}")
        # outliers grosseiros (fora de 3.000–120.000 /m²) — só diagnóstico
        out = [t for t in com_m2 if t["valor_m2"] < 3000 or t["valor_m2"] > 120000]
        print(f"  outliers fora de 3k–120k/m² (revisar): {len(out)}")
        for t in out[:8]:
            print(f"    {t['valor_m2']:>9,.0f}/m²  {t['area_construida_m2']:>6.0f}m²  "
                  f"prop {t['proporcao']:>5}%  {t['natureza'][:24]}  {t['endereco'][:40]}")

    print("\nOK — schema válido.")


if __name__ == "__main__":
    main()
