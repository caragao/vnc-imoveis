"""Relatório de qualidade + validação de data/transacoes.json.

Revalida o schema (bloqueia se quebrar) e imprime um panorama para o revisor:
distribuição por ano/natureza/uso, cobertura de área, parciais e outliers de
R$/m². Espelha o papel de scraper/validate_data.py. Saída != 0 se o schema falhar
ou o JSON não existir — serve de gate de CI."""
import json
import os
import statistics
import sys

try:  # evita UnicodeEncodeError no console cp1252 do Windows
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

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

    # garantia do filtro: nenhum CEP fora da faixa real de VNC (04500–04515)
    def _cep5(t):
        return int((t.get("cep") or "0").replace("-", "")[:5] or 0)
    fora = [t for t in linhas if t.get("cep") and not (4500 <= _cep5(t) <= 4515)]
    print(f"\nCEP fora de 04500–04515 (deveria ser 0): {len(fora)}")
    for t in fora[:5]:
        print(f"  ! {t['cep']}  {t['bairro']}  {t['endereco']}")

    from collections import Counter
    _cont("por ano (data de transação):", Counter(t["ano"] for t in linhas).items())
    _cont("por natureza:", Counter(t["natureza"] for t in linhas).items())
    _cont("por tipo de ativo (uso IPTU):", Counter(t.get("tipo_ativo") or "?" for t in linhas).items())
    _cont("por padrão (IPTU):", Counter(t.get("descricao_padrao") or "(sem padrão)" for t in linhas).items())

    # composição metodológica (P1.4): integral vs parcial, área, faixas de área
    integrais = [t for t in linhas if t["integral"]]
    parciais = [t for t in linhas if not t["integral"]]
    com_area = [t for t in linhas if t.get("area_construida_m2")]
    predio_inteiro = [t for t in linhas if t.get("tipo_ativo") == "Prédio residencial (inteiro)"]
    print(f"\ntransferências integrais (100%): {len(integrais)} ({len(integrais)*100//n}%)")
    print(f"transferências parciais (<100%): {len(parciais)} ({len(parciais)*100//n}%)")
    print(f"com área construída > 0: {len(com_area)} ({len(com_area)*100//n}%)")
    print(f"cadastros de prédio inteiro (uso 21, fora dos KPIs de unidade): {len(predio_inteiro)}")
    faixas = Counter()
    for t in com_area:
        a = t["area_construida_m2"]
        faixas["<=100" if a <= 100 else "100-300" if a <= 300 else "300-600" if a <= 600 else ">600"] += 1
    _cont("faixas de area construida (com area):", faixas.items())

    # população dos KPIs padrão: unidade residencial + integral (metodologia explícita)
    kpi_pop = [t for t in linhas if t["residencial"] and t["integral"] and t.get("valor_m2")]
    print(f"\npopulação dos KPIs padrão (residencial de unidade + 100% + com área): {len(kpi_pop)}")
    if kpi_pop:
        m2 = sorted(t["valor_m2"] for t in kpi_pop)
        print(f"  R$/m² equivalente — mediana {statistics.median(m2):,.0f}  ·  "
              f"min {m2[0]:,.0f}  ·  max {m2[-1]:,.0f}")
        for ano in sorted({t["ano"] for t in kpi_pop}):
            mm = sorted(t["valor_m2"] for t in kpi_pop if t["ano"] == ano)
            print(f"    {ano}: mediana {statistics.median(mm):,.0f}  (n={len(mm)})")
        out = [t for t in kpi_pop if t["valor_m2"] < 3000 or t["valor_m2"] > 120000]
        print(f"  outliers fora de 3k–120k/m² (revisar): {len(out)}")
        for t in out[:6]:
            print(f"    {t['valor_m2']:>9,.0f}/m²  {t['area_construida_m2']:>6.0f}m²  "
                  f"{t['tipo_ativo'][:18]}  {t['endereco'][:38]}")

    print("\nOK — schema válido.")


if __name__ == "__main__":
    main()
