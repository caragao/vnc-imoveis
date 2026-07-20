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


# faixa de CEP da Vila Nova Conceição de verdade: 04500-000 a 04515-999.
# NÃO usar a faixa larga 045xxxxx: 04522+ já é Itaim Bibi/Vila Olímpia (Av. JK,
# Dr. Eduardo de Souza Aranha, Fadlo Haidar, João Cachoeira...), que aparecem
# rotulados como "Nova Conceição" na declaração e vazariam para os totais. O
# corte em 04515 bate com a extensão real do bairro nos dados (ver docs/ITBI.md).
CEP_VNC_MIN, CEP_VNC_MAX = 4500000, 4515999

# Ruas de bairros VIZINHOS que aparecem dentro da faixa de CEP ou rotuladas como
# "Nova Conceição". Servem de blocklist (defesa em profundidade) para que nunca
# entrem — nem por rótulo errado, nem por contaminar o allowlist de ruas de VNC.
# Substrings normalizadas (sem prefixo R/AV). Ver docs/ITBI.md.
#  - Itaim Bibi / Vila Olímpia: CEP 04522+ (já fora da faixa, aqui por garantia).
#  - Moema / Indianópolis: ruas de nome de ave em 04514/04515, que dividem a faixa
#    de CEP com VNC (ex.: Av. Lavandisca é VNC e Av. Sabiá é Moema, ambas 04515).
_RUAS_NAO_VNC = (
    # Itaim Bibi / Vila Olímpia
    "JOAO CACHOEIRA", "CLODOMIRO AMAZONAS", "EDUARDO DE SOUZA ARANHA", "FADLO HAIDAR",
    "GUILHERME BANNITZ", "ATILIO INNOCENTI", "JUSCELINO KUBITSCHEK", "MIGUEL CALFAT",
    "ALCEU DE CAMPOS RODRIGUES", "JOAQUIM FERREIRA LOBO", "FERNANDES DE ABREU",
    # Moema / Indianópolis (nomes de ave e adjacências) — dividem CEP com VNC
    "SABIA", "PINTASSILGO", "TUIM", "JACUTINGA", "GRAUNA", "PERIQUITO", "ARAGUARI",
    "REPUBLICA DO LIBANO",
)


def cep_em_vnc(cep) -> bool:
    """CEP dentro da faixa real da Vila Nova Conceição (04500–04515)."""
    c = cep_int(cep)
    return c is not None and CEP_VNC_MIN <= c <= CEP_VNC_MAX


def rotulo_conceicao(bairro) -> bool:
    """Rótulo de bairro sugere Vila Nova Conceição, sem cair nos homônimos."""
    b = normalizar(bairro)
    tem = "NOVA CONCEICAO" in b or "VNCONCEICAO" in b
    return tem and not any(t in b for t in _ARMADILHAS)


def rua_bloqueada(logradouro) -> bool:
    """Logradouro está na lista de ruas confirmadas de outro bairro."""
    r = normalizar(logradouro)
    return any(rua in r for rua in _RUAS_NAO_VNC)


def is_vnc(bairro, cep, logradouro=None) -> bool:
    """True só para Vila Nova Conceição de verdade.

    Três sinais: rótulo contém 'NOVA CONCEICAO' E CEP na faixa real do bairro
    (04500–04515) E o logradouro não está na lista de ruas de outro bairro. O CEP
    exclui homônimos (Nossa Senhora 0518x, Sítio 0847x) e o vazamento de
    Itaim/Vila Olímpia (04522+); a lista de ruas é defesa extra (ver docs/ITBI.md)."""
    return rotulo_conceicao(bairro) and cep_em_vnc(cep) and not rua_bloqueada(logradouro)


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
