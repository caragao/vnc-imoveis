"""Schema de uma transação imobiliária de ITBI-IV (Prefeitura de SP).

Uma linha da planilha = uma DTI (Declaração de Transações Imobiliárias) paga.
Só transações do bairro Vila Nova Conceição chegam aqui (o filtro vive em
build.py). Valores monetários em reais inteiros; áreas em float m²."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# Classificação do ativo pelo código de USO (IPTU), da aba "Tabela de USOS".
# É a base econômica das inclusões/exclusões — não usar corte por percentil no
# lugar disto (ver docs/ITBI.md). Uso não mapeado -> "Outro"; ausente -> None.
# Mapa completo dos códigos da aba "Tabela de USOS" (0–85). Qualquer código novo
# numa atualização futura cai em "Outro" e é sinalizado pelo validate_data.py.
TIPO_POR_USO = {
    0: "Terreno",
    10: "Casa", 12: "Casa", 14: "Casa",
    13: "Habitação coletiva",
    20: "Apartamento",
    21: "Prédio residencial (inteiro)",  # área = prédio todo, NÃO é unidade
    22: "Prédio de uso misto", 32: "Prédio de uso misto",
    23: "Vaga de garagem", 24: "Vaga de garagem", 62: "Vaga de garagem", 63: "Vaga de garagem",
    25: "Flat",
    26: "Depósito",
    30: "Escritório/Consultório", 31: "Escritório/Consultório",
    40: "Loja", 41: "Loja", 42: "Loja",
    43: "Uso múltiplo", 64: "Uso múltiplo", 74: "Uso múltiplo", 84: "Uso múltiplo",
    50: "Indústria", 51: "Indústria/armazém",
    60: "Oficina", 61: "Posto de serviço",
    70: "Diversão/clube", 71: "Escola", 72: "Templo",
    80: "Hotel/hospedaria", 81: "Saúde", 82: "Mídia/emissora", 83: "Institucional",
    85: "Flat comercial",
}

# Unidades residenciais de MERCADO usadas nos KPIs/scatter padrão. Só unidades
# autônomas comparáveis por m²: apartamento (20), flat (25) e casa (10). Exclui
# de propósito o prédio de apartamento INTEIRO (21) — a área ali é a do edifício,
# não de uma unidade, e distorceria o R$/m². Demais usos (vaga, loja, escritório,
# terreno...) também ficam fora do default residencial.
USOS_RESIDENCIAIS = {10, 20, 25}


def tipo_ativo(uso: Optional[int]) -> str:
    if uso is None:
        return "Não classificado"
    # código presente na base mas fora da Tabela de USOS oficial (0–85): não
    # inventar rótulo — expor o número p/ ser identificável e sinalizado no validador.
    return TIPO_POR_USO.get(uso, f"Outro (uso {uso})")


class Transacao(BaseModel):
    id: str = Field(min_length=6, description="hash estável de sql|matrícula|data|valor")
    sql: str = Field(description="Nº do Cadastro (SQL) do imóvel")
    # localização
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    endereco: str = Field(description="logradouro + número + complemento, montado")
    referencia: Optional[str] = Field(default=None, description="nome do prédio/condomínio")
    bairro: str
    cep: Optional[str] = None
    # transação
    natureza: str
    data: str = Field(description="data de transação em ISO (AAAA-MM-DD)")
    ano: int
    mes: int = Field(ge=1, le=12)
    valor: int = Field(gt=0, description="valor de transação declarado, em reais")
    proporcao: float = Field(gt=0, le=100, description="proporção transmitida (%)")
    valor_100pct: int = Field(gt=0, description="valor equivalente a 100% (extrapolado): valor ÷ proporção")
    valor_venal_referencia: Optional[int] = Field(default=None, ge=0)
    base_calculo: Optional[int] = Field(default=None, ge=0)
    razao_valor_venal: Optional[float] = Field(
        default=None, description="valor declarado ÷ valor venal de referência (global)"
    )
    # imóvel (IPTU)
    area_construida_m2: Optional[float] = Field(default=None, gt=0)
    area_terreno_m2: Optional[float] = Field(default=None, ge=0)
    valor_m2: Optional[int] = Field(
        default=None, gt=0,
        description="R$/m² equivalente: valor_100pct ÷ área construída (None se área ausente)"
    )
    uso: Optional[int] = Field(default=None, description="código de uso (IPTU)")
    descricao_uso: Optional[str] = None
    tipo_ativo: str = Field(description="classe do ativo derivada do uso (Apartamento, Casa, Vaga...)")
    padrao: Optional[int] = Field(default=None, description="código de padrão (IPTU)")
    descricao_padrao: Optional[str] = None
    acc: Optional[int] = Field(
        default=None, description="ACC (IPTU): ano de construção corrigido"
    )
    integral: bool = Field(description="proporção transmitida == 100% (compra da unidade inteira)")
    residencial: bool = Field(description="unidade residencial de mercado (uso em USOS_RESIDENCIAIS)")

    @field_validator("data")
    @classmethod
    def _data_iso(cls, v: str) -> str:
        date.fromisoformat(v)
        return v


def novo(**kwargs) -> Transacao:
    """Cria uma Transacao derivando valor_100pct, valor_m2 e residencial.

    Espera receber já limpos: valor (int), proporcao (float), area_construida_m2
    (float ou None), uso (int ou None), data (ISO). Campos derivados são
    recalculados aqui para manter uma única fonte de verdade da regra."""
    valor = kwargs["valor"]
    prop = kwargs["proporcao"]
    kwargs["valor_100pct"] = round(valor / (prop / 100))
    area = kwargs.get("area_construida_m2")
    m2 = round(kwargs["valor_100pct"] / area) if area else None
    kwargs["valor_m2"] = m2 if m2 else None  # 0 (área gigante / valor ínfimo) vira None
    vvr = kwargs.get("valor_venal_referencia")
    kwargs["razao_valor_venal"] = round(valor / vvr, 3) if vvr else None
    d = date.fromisoformat(kwargs["data"])
    kwargs["ano"], kwargs["mes"] = d.year, d.month
    kwargs["tipo_ativo"] = tipo_ativo(kwargs.get("uso"))
    kwargs["integral"] = prop >= 100
    kwargs["residencial"] = kwargs.get("uso") in USOS_RESIDENCIAIS
    return Transacao(**kwargs)
