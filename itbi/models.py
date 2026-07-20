"""Schema de uma transação imobiliária de ITBI-IV (Prefeitura de SP).

Uma linha da planilha = uma DTI (Declaração de Transações Imobiliárias) paga.
Só transações do bairro Vila Nova Conceição chegam aqui (o filtro vive em
build.py). Valores monetários em reais inteiros; áreas em float m²."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# grupos de uso (IPTU) que representam imóvel residencial de mercado.
# 10=residência, 20=apartamento em condomínio, 21=prédio de apartamento
# residencial, 25=flat residencial. Demais (garagem, loja, escritório,
# terreno, indústria...) não entram no default residencial do dashboard.
USOS_RESIDENCIAIS = {10, 20, 21, 25}


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
    valor_100pct: int = Field(gt=0, description="valor extrapolado para 100% do imóvel")
    valor_venal_referencia: Optional[int] = Field(default=None, ge=0)
    base_calculo: Optional[int] = Field(default=None, ge=0)
    razao_valor_venal: Optional[float] = Field(
        default=None, description="valor declarado ÷ valor venal de referência (global)"
    )
    # imóvel (IPTU)
    area_construida_m2: Optional[float] = Field(default=None, gt=0)
    area_terreno_m2: Optional[float] = Field(default=None, ge=0)
    valor_m2: Optional[int] = Field(
        default=None, gt=0, description="valor_100pct ÷ área construída (None se área ausente)"
    )
    uso: Optional[int] = Field(default=None, description="código de uso (IPTU)")
    descricao_uso: Optional[str] = None
    padrao: Optional[int] = Field(default=None, description="código de padrão (IPTU)")
    descricao_padrao: Optional[str] = None
    acc: Optional[int] = Field(
        default=None, description="ACC (IPTU): ano de construção corrigido"
    )
    residencial: bool = Field(description="uso pertence a USOS_RESIDENCIAIS")

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
    kwargs["residencial"] = kwargs.get("uso") in USOS_RESIDENCIAIS
    return Transacao(**kwargs)
