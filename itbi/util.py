"""Helpers do pipeline de ITBI: normalização de texto e filtro de bairro.

O filtro de Vila Nova Conceição vive aqui (e não em build.py) para ser
testável isoladamente — o campo Bairro da Prefeitura é inconfiável e mistura
bairros homônimos (ver docs/ITBI.md)."""
import re
import unicodedata


def normalizar(s) -> str:
    """Maiúsculas, sem acento, só [A-Z0-9 ] — para comparar rótulos de bairro."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9 ]", " ", s.upper()).strip()


# termos que aparecem em "...CONCEIÇÃO" mas são OUTROS bairros:
# Vila Nossa Senhora da Conceição (CEP 0518x) e Sítio Conceição (CEP 0847x).
_ARMADILHAS = ("N S CONCEICAO", "N SRA CONCEICAO", "SITIO", "CAMPANH")


def cep_int(cep) -> int | None:
    """CEP como int de 8 dígitos (ex.: 4505001) ou None."""
    if cep is None or cep == "":
        return None
    try:
        return int(float(cep))
    except (ValueError, TypeError):
        return None


def is_vnc(bairro, cep) -> bool:
    """True só para Vila Nova Conceição de verdade.

    Dois sinais combinados: rótulo contém 'NOVA CONCEICAO' (ou 'VNCONCEICAO')
    E o CEP cai na faixa 045xxxxx do bairro — o que exclui os homônimos, que
    ficam em 0518x/0847x. Rejeita ainda os termos-armadilha por segurança."""
    b = normalizar(bairro)
    c = cep_int(cep)
    cep_ok = c is not None and 4500000 <= c <= 4549999
    tem_conceicao = "NOVA CONCEICAO" in b or "VNCONCEICAO" in b
    armadilha = any(t in b for t in _ARMADILHAS)
    return tem_conceicao and cep_ok and not armadilha


def fmt_cep(cep) -> str | None:
    """4505001 -> '04505-001'."""
    c = cep_int(cep)
    if c is None:
        return None
    s = f"{c:08d}"
    return f"{s[:5]}-{s[5:]}"


def texto(v) -> str | None:
    """Valor de célula -> str limpa, ou None se vazio/NaN."""
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() == "nan":
        return None
    # números inteiros vindos como float ('71.0' -> '71')
    if re.fullmatch(r"-?\d+\.0", s):
        s = s[:-2]
    return s or None


def inteiro(v) -> int | None:
    """Valor de célula numérica -> int, ou None se vazio/NaN/inválido."""
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (ValueError, TypeError):
        return None
    if n != n:  # NaN (células vazias viram float('nan') no pandas)
        return None
    return int(round(n))
