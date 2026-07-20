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
import re
import sys
import unicodedata
from datetime import date, datetime

import pandas as pd

try:  # evita UnicodeEncodeError no console cp1252 do Windows
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# permite rodar tanto `python itbi/build.py` quanto `python build.py` de dentro de itbi/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import models  # noqa: E402
import util  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_RAW = os.path.join(RAIZ, "itbi", "raw")
SAIDA = os.path.join(RAIZ, "data", "transacoes.json")
FONTE = "Prefeitura de São Paulo — ITBI-IV (Transações Imobiliárias)"

# mapa chave interna -> nome esperado da coluna no cabeçalho da Prefeitura.
# O casamento é feito por _norm_header (tolerante a acentos, º/° e espaços) —
# NÃO por igualdade exata: o cabeçalho real usa "N°" (grau, U+00B0) e não "Nº"
# (ordinal, U+00BA); a comparação exata falhava e o SQL virava "?".
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

# colunas sem as quais uma transação não pode ser montada de forma confiável.
COLS_OBRIGATORIAS = ("sql", "cep", "bairro", "logradouro", "valor", "data", "proporcao", "area_construida")


def _norm_header(s: str) -> str:
    """Chave robusta p/ casar cabeçalhos: sem º/°/ª, sem acento, só [a-z0-9 ]."""
    s = str(s).replace("º", "").replace("°", "").replace("ª", "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def resolver_colunas(colunas):
    """Mapeia chave interna -> nome real da coluna, casando por header normalizado.

    Retorna (mapa_chave_para_real, faltando_obrigatorias)."""
    reais = {_norm_header(c): c for c in colunas}
    mapa, faltando = {}, []
    for chave, esperado in COL.items():
        real = reais.get(_norm_header(esperado))
        if real is not None:
            mapa[chave] = real
        elif chave in COLS_OBRIGATORIAS:
            faltando.append(chave)
    return mapa, faltando


def _parse_data(v):
    """Célula de data -> objeto date, ou None."""
    if isinstance(v, (datetime, date)):
        return v.date() if isinstance(v, datetime) else v
    ts = pd.to_datetime(v, errors="coerce", dayfirst=True)
    return None if pd.isna(ts) else ts.date()


def _proporcao_valida(v) -> bool:
    """True se v é um número finito em (0, 100] — proporção utilizável."""
    try:
        n = float(v)
    except (ValueError, TypeError):
        return False
    import math
    return math.isfinite(n) and 0 < n <= 100


def _proporcao(v):
    """Proporção transmitida em %, no intervalo (0, 100]. Ausente/inválida -> 100.

    Trata como ausente: None, string vazia/espaços, NaN, ±infinito, não-numérico,
    zero, negativo e >100 (o pandas entrega célula vazia como float('nan'), que
    escapa das comparações de faixa — NaN<=0 e NaN>100 são ambos False)."""
    return round(float(v), 4) if _proporcao_valida(v) else 100.0


def _montar_endereco(logr, num, compl):
    partes = [p for p in (logr, num, compl) if p]
    return ", ".join(partes) if partes else "(endereço não informado)"


def _id(sql, matricula, data_iso, valor):
    import hashlib
    bruto = f"{sql}|{matricula}|{data_iso}|{valor}"
    return "itbi-" + hashlib.sha1(bruto.encode("utf-8")).hexdigest()[:12]


def processar_linha(row):
    """dict de uma linha (colunas já com chaves internas) -> Transacao, ou None.

    Devolve (Transacao, motivo_default_proporcao) onde motivo é True se a
    proporção estava ausente e recebeu o default 100% (para contabilizar)."""
    valor = util.inteiro(row.get("valor"))
    if not valor or valor <= 0:
        return None, False
    d = _parse_data(row.get("data"))
    if d is None:
        return None, False
    sql = util.texto(row.get("sql")) or "?"
    matricula = util.texto(row.get("matricula")) or "?"
    data_iso = d.isoformat()
    area = util.inteiro(row.get("area_construida"))
    area = float(area) if area and area > 0 else None
    terreno = util.inteiro(row.get("area_terreno"))
    prop_bruta = row.get("proporcao")
    prop = _proporcao(prop_bruta)
    usou_default = prop == 100.0 and not _proporcao_valida(prop_bruta)
    t = models.novo(
        id=_id(sql, matricula, data_iso, valor),
        sql=sql,
        logradouro=util.texto(row.get("logradouro")),
        numero=util.texto(row.get("numero")),
        complemento=util.texto(row.get("complemento")),
        endereco=_montar_endereco(
            util.texto(row.get("logradouro")),
            util.texto(row.get("numero")),
            util.texto(row.get("complemento")),
        ),
        referencia=util.texto(row.get("referencia")),
        bairro=util.texto(row.get("bairro")) or "VILA NOVA CONCEICAO",
        cep=util.fmt_cep(row.get("cep")),
        natureza=util.texto(row.get("natureza")) or "(não informada)",
        data=data_iso,
        valor=valor,
        proporcao=prop,
        valor_venal_referencia=util.inteiro(row.get("vvr")),
        base_calculo=util.inteiro(row.get("base")),
        area_construida_m2=area,
        area_terreno_m2=float(terreno) if terreno and terreno > 0 else None,
        uso=util.inteiro(row.get("uso")),
        descricao_uso=util.texto(row.get("descricao_uso")),
        padrao=util.inteiro(row.get("padrao")),
        descricao_padrao=util.texto(row.get("descricao_padrao")),
        acc=util.inteiro(row.get("acc")),
    )
    return t, usou_default


def coletar(dir_raw):
    """Lê todos os .xlsx do diretório, filtra VNC e devolve (lista, auditoria).

    Duas passagens sobre os candidatos (CEP na faixa de VNC), porque o campo
    Bairro é inconfiável nos DOIS sentidos: mistura bairros vizinhos E deixa de
    marcar VNC de verdade. Por isso não se exige o rótulo para incluir:
      1. Semeia um allowlist de LOGRADOUROS de VNC = ruas que aparecem com rótulo
         'Nova Conceição' + CEP na faixa (alta confiança).
      2. Inclui todo candidato cujo logradouro está no allowlist (independe do
         rótulo) e não está na blocklist de ruas de bairro vizinho. Candidatos com
         rua desconhecida ficam AMBÍGUOS: excluídos e listados para revisão."""
    arquivos = sorted(glob.glob(os.path.join(dir_raw, "*.xlsx")))
    if not arquivos:
        raise SystemExit(
            f"nenhum .xlsx em {dir_raw} — baixe as planilhas de ITBI da Prefeitura "
            f"(ver docs/ITBI.md) e coloque em itbi/raw/"
        )
    from collections import Counter
    aud = {
        "linhas_brutas": 0, "aceitas_vnc": 0, "descartadas_dados": 0,
        "excluidas_cep": 0,     # rótulo diz Conceição mas CEP fora da faixa VNC
        "excluidas_rua": 0,     # logradouro é de bairro vizinho (blocklist)
        "ambiguos_revisar": 0,  # CEP na faixa mas rua não confirmada como VNC
        "proporcao_default": 0,
        "ceps": Counter(), "ruas_incluidas": Counter(),
        "ruas_excluidas": Counter(), "ambiguos": Counter(),
    }
    # ---- passagem 1: coletar candidatos (CEP na faixa) e semear o allowlist ----
    candidatos = []          # dicts de linha já com chaves internas
    allowlist = set()        # logradouros normalizados confirmados como VNC
    for arq in arquivos:
        print(f"lendo {os.path.basename(arq)} ...", flush=True)
        xls = pd.ExcelFile(arq)
        for aba in [s for s in xls.sheet_names if "-20" in s]:  # abas mensais
            df = pd.read_excel(arq, sheet_name=aba)
            mapa, faltando = resolver_colunas(df.columns)
            if faltando:
                print(f"  aviso: aba {aba} sem colunas obrigatórias {faltando} — pulada")
                continue
            df = df.rename(columns={real: chave for chave, real in mapa.items()})
            aud["linhas_brutas"] += len(df)
            for _, row in df.iterrows():
                r = row.to_dict()
                cepok = util.cep_em_vnc(r.get("cep"))
                rotulo = util.rotulo_conceicao(r.get("bairro"))
                if rotulo and not cepok:
                    aud["excluidas_cep"] += 1
                    continue
                if not cepok:
                    continue
                candidatos.append(r)
                rua = util.normalizar(r.get("logradouro"))
                if rotulo and rua and not util.rua_bloqueada(r.get("logradouro")):
                    allowlist.add(rua)
    # ---- passagem 2: classificar candidatos pelo allowlist de ruas ----
    transacoes = {}
    for r in candidatos:
        logr = r.get("logradouro")
        rua = util.normalizar(logr)
        if util.rua_bloqueada(logr):
            aud["excluidas_rua"] += 1
            aud["ruas_excluidas"][rua] += 1
            continue
        if rua not in allowlist:  # rua não confirmada como VNC -> ambíguo, não incluir
            aud["ambiguos_revisar"] += 1
            aud["ambiguos"][rua] += 1
            continue
        aud["aceitas_vnc"] += 1
        try:
            t, usou_default = processar_linha(r)
        except Exception as e:  # linha ruim não derruba a execução
            aud["descartadas_dados"] += 1
            print(f"  linha descartada: {e}")
            continue
        if t is None:
            aud["descartadas_dados"] += 1
            continue
        if usou_default:
            aud["proporcao_default"] += 1
        aud["ceps"][(t.cep or "?")[:5]] += 1
        aud["ruas_incluidas"][t.logradouro or "?"] += 1
        transacoes[t.id] = t  # dedup por id estável (sql|matrícula|data|valor)
    lista = sorted(transacoes.values(), key=lambda t: t.data)
    aud["unicas"] = len(lista)
    aud["allowlist_ruas"] = len(allowlist)
    return lista, aud


def _imprimir_auditoria(aud, delta):
    print("\n=== AUDITORIA GEOGRÁFICA ===")
    print(f"linhas brutas lidas ................. {aud['linhas_brutas']}")
    print(f"allowlist de ruas de VNC (semeado) .. {aud['allowlist_ruas']}")
    print(f"aceitas como VNC (pré-dedup) ........ {aud['aceitas_vnc']}")
    print(f"  descartadas por dados ruins ....... {aud['descartadas_dados']}")
    print(f"transações únicas (pós-dedup) ....... {aud['unicas']}")
    print(f"excluídas: rótulo VNC + CEP fora .... {aud['excluidas_cep']}")
    print(f"excluídas: rua de bairro vizinho .... {aud['excluidas_rua']} {dict(aud['ruas_excluidas'])}")
    amb = aud["ambiguos"].most_common(15)
    print(f"AMBÍGUAS (CEP VNC, rua não confirmada): {aud['ambiguos_revisar']} — NÃO incluídas, revisar:")
    for rua, n in amb:
        print(f"    {n:>4}  {rua}")
    print(f"proporção ausente -> default 100% ... {aud['proporcao_default']}")
    print("CEPs aceitos (05 dígitos):")
    for cep, n in sorted(aud["ceps"].items()):
        if n:
            print(f"    {cep}  {n}")
    if delta is not None:
        print(f"delta vs JSON anterior: {delta:+d} transações")


def main():
    dir_raw = sys.argv[1] if len(sys.argv) > 1 else DIR_RAW
    saida = sys.argv[2] if len(sys.argv) > 2 else SAIDA
    anterior = None
    if os.path.exists(saida):
        try:
            with open(saida, encoding="utf-8") as f:
                anterior = len(json.load(f).get("transacoes", []))
        except Exception:
            anterior = None
    lista, aud = coletar(dir_raw)
    if not lista:
        raise SystemExit("nenhuma transação de VNC encontrada — verifique as planilhas")
    datas = [t.data for t in lista]
    envelope = {
        "atualizado_em": datetime.now().isoformat(timespec="seconds"),
        "fonte": FONTE,
        "periodo": {"de": min(datas), "ate": max(datas)},
        "criterio_vnc": "CEP 04500-000 a 04515-999 + rótulo 'Nova Conceição' + rua não bloqueada (ADR-011)",
        "total": len(lista),
        "transacoes": [t.model_dump() for t in lista],
    }
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False, indent=2)
    _imprimir_auditoria(aud, None if anterior is None else len(lista) - anterior)
    print(f"\ngravado {saida} com {len(lista)} transações "
          f"(período {envelope['periodo']['de']} a {envelope['periodo']['ate']})")


if __name__ == "__main__":
    main()
