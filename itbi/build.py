"""Gera data/transacoes.json a partir das planilhas de ITBI-IV da Prefeitura.

Lê os .xlsx brutos de itbi/raw/ (não versionados — ver ADR-011), mantém só as
transações de Vila Nova Conceição, normaliza os campos, deduplica e grava o
JSON derivado que o dashboard consome.

Uso:  python itbi/build.py [dir_raw] [saida_json]
      (defaults: itbi/raw/  e  data/transacoes.json, relativos à raiz do repo)
"""
import glob
import json
import os
import sys
from datetime import date, datetime

import pandas as pd

# permite rodar tanto `python itbi/build.py` quanto `python build.py` de dentro de itbi/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import models  # noqa: E402
import util  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_RAW = os.path.join(RAIZ, "itbi", "raw")
SAIDA = os.path.join(RAIZ, "data", "transacoes.json")
FONTE = "Prefeitura de São Paulo — ITBI-IV (Transações Imobiliárias)"

# mapa coluna-da-planilha -> uso interno. Nomes exatos do cabeçalho da Prefeitura.
COL = {
    "sql": "Nº do Cadastro (SQL)",
    "logradouro": "Nome do Logradouro",
    "numero": "Número",
    "complemento": "Complemento",
    "bairro": "Bairro",
    "referencia": "Referência",
    "cep": "CEP",
    "natureza": "Natureza de Transação",
    "valor": "Valor de Transação (declarado pelo contribuinte)",
    "data": "Data de Transação",
    "vvr": "Valor Venal de Referência",
    "proporcao": "Proporção Transmitida (%)",
    "base": "Base de Cálculo adotada",
    "area_terreno": "Área do Terreno (m2)",
    "area_construida": "Área Construída (m2)",
    "uso": "Uso (IPTU)",
    "descricao_uso": "Descrição do uso (IPTU)",
    "padrao": "Padrão (IPTU)",
    "descricao_padrao": "Descrição do padrão (IPTU)",
    "acc": "ACC (IPTU)",
    "matricula": "Matrícula do Imóvel",
}


def _parse_data(v):
    """Célula de data -> objeto date, ou None."""
    if isinstance(v, (datetime, date)):
        return v.date() if isinstance(v, datetime) else v
    ts = pd.to_datetime(v, errors="coerce", dayfirst=True)
    return None if pd.isna(ts) else ts.date()


def _proporcao(v):
    """Proporção transmitida em %, no intervalo (0, 100]. Ausente/0 -> 100."""
    n = None
    try:
        n = float(v)
    except (ValueError, TypeError):
        n = None
    if n is None or n <= 0 or n > 100:
        return 100.0
    return round(n, 4)


def _montar_endereco(logr, num, compl):
    partes = [p for p in (logr, num, compl) if p]
    return ", ".join(partes) if partes else "(endereço não informado)"


def _id(sql, matricula, data_iso, valor):
    import hashlib
    bruto = f"{sql}|{matricula}|{data_iso}|{valor}"
    return "itbi-" + hashlib.sha1(bruto.encode("utf-8")).hexdigest()[:12]


def processar_linha(row):
    """dict de uma linha da planilha -> Transacao, ou None se inválida/incompleta."""
    valor = util.inteiro(row.get(COL["valor"]))
    if not valor or valor <= 0:
        return None
    d = _parse_data(row.get(COL["data"]))
    if d is None:
        return None
    sql = util.texto(row.get(COL["sql"])) or "?"
    matricula = util.texto(row.get(COL["matricula"])) or "?"
    data_iso = d.isoformat()
    area = util.inteiro(row.get(COL["area_construida"]))
    area = float(area) if area and area > 0 else None
    terreno = util.inteiro(row.get(COL["area_terreno"]))
    return models.novo(
        id=_id(sql, matricula, data_iso, valor),
        sql=sql,
        logradouro=util.texto(row.get(COL["logradouro"])),
        numero=util.texto(row.get(COL["numero"])),
        complemento=util.texto(row.get(COL["complemento"])),
        endereco=_montar_endereco(
            util.texto(row.get(COL["logradouro"])),
            util.texto(row.get(COL["numero"])),
            util.texto(row.get(COL["complemento"])),
        ),
        referencia=util.texto(row.get(COL["referencia"])),
        bairro=util.texto(row.get(COL["bairro"])) or "VILA NOVA CONCEICAO",
        cep=util.fmt_cep(row.get(COL["cep"])),
        natureza=util.texto(row.get(COL["natureza"])) or "(não informada)",
        data=data_iso,
        valor=valor,
        proporcao=_proporcao(row.get(COL["proporcao"])),
        valor_venal_referencia=util.inteiro(row.get(COL["vvr"])),
        base_calculo=util.inteiro(row.get(COL["base"])),
        area_construida_m2=area,
        area_terreno_m2=float(terreno) if terreno and terreno > 0 else None,
        uso=util.inteiro(row.get(COL["uso"])),
        descricao_uso=util.texto(row.get(COL["descricao_uso"])),
        padrao=util.inteiro(row.get(COL["padrao"])),
        descricao_padrao=util.texto(row.get(COL["descricao_padrao"])),
        acc=util.inteiro(row.get(COL["acc"])),
    )


def coletar(dir_raw):
    """Lê todos os .xlsx do diretório, filtra VNC e devolve lista de Transacao."""
    arquivos = sorted(glob.glob(os.path.join(dir_raw, "*.xlsx")))
    if not arquivos:
        raise SystemExit(
            f"nenhum .xlsx em {dir_raw} — baixe as planilhas de ITBI da Prefeitura "
            f"(ver docs/ITBI.md) e coloque em itbi/raw/"
        )
    transacoes = {}
    total_lidas = total_vnc = descartadas = 0
    for arq in arquivos:
        print(f"lendo {os.path.basename(arq)} ...", flush=True)
        xls = pd.ExcelFile(arq)
        abas = [s for s in xls.sheet_names if "-20" in s]  # abas mensais (JAN-2025 ...)
        for aba in abas:
            df = pd.read_excel(arq, sheet_name=aba)
            if COL["bairro"] not in df.columns:
                print(f"  aviso: aba {aba} sem coluna Bairro — pulada")
                continue
            total_lidas += len(df)
            vnc = df[df.apply(lambda r: util.is_vnc(r.get(COL["bairro"]), r.get(COL["cep"])), axis=1)]
            total_vnc += len(vnc)
            for _, row in vnc.iterrows():
                try:
                    t = processar_linha(row.to_dict())
                except Exception as e:  # linha ruim não derruba a execução
                    descartadas += 1
                    print(f"  linha descartada em {aba}: {e}")
                    continue
                if t is None:
                    descartadas += 1
                    continue
                transacoes[t.id] = t  # dedup por id estável (sql|matrícula|data|valor)
    lista = sorted(transacoes.values(), key=lambda t: t.data)
    print(f"\nlinhas lidas: {total_lidas} · candidatas VNC: {total_vnc} · "
          f"descartadas: {descartadas} · únicas: {len(lista)}")
    return lista


def main():
    dir_raw = sys.argv[1] if len(sys.argv) > 1 else DIR_RAW
    saida = sys.argv[2] if len(sys.argv) > 2 else SAIDA
    lista = coletar(dir_raw)
    if not lista:
        raise SystemExit("nenhuma transação de VNC encontrada — verifique as planilhas")
    datas = [t.data for t in lista]
    envelope = {
        "atualizado_em": datetime.now().isoformat(timespec="seconds"),
        "fonte": FONTE,
        "periodo": {"de": min(datas), "ate": max(datas)},
        "total": len(lista),
        "transacoes": [t.model_dump() for t in lista],
    }
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False, indent=2)
    print(f"gravado {saida} com {len(lista)} transações "
          f"(período {envelope['periodo']['de']} a {envelope['periodo']['ate']})")


if __name__ == "__main__":
    main()
