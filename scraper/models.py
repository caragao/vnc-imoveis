"""Schema único dos imóveis, compartilhado pelas 3 fontes."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Fonte = Literal["vnc", "ph15", "angloamericana"]


class Imovel(BaseModel):
    id: str = Field(min_length=4, description="{fonte}-{código do anúncio}, estável entre execuções")
    fonte: Fonte
    url: str = Field(pattern=r"^https://")
    titulo: str
    tipo: str
    preco: int = Field(gt=0, description="preço de venda em reais")
    area_util_m2: float = Field(gt=10)
    preco_m2: int = Field(gt=0)
    dormitorios: Optional[int] = Field(default=None, ge=0)
    suites: Optional[int] = Field(default=None, ge=0)
    vagas: Optional[int] = Field(default=None, ge=0)
    endereco: Optional[str] = None
    capturado_em: str

    @field_validator("capturado_em")
    @classmethod
    def _data_iso(cls, v: str) -> str:
        date.fromisoformat(v)
        return v


def novo_imovel(**kwargs) -> Imovel:
    """Cria um Imovel calculando preco_m2 e carimbando a data de captura."""
    kwargs.setdefault("capturado_em", date.today().isoformat())
    if "preco_m2" not in kwargs:
        kwargs["preco_m2"] = round(kwargs["preco"] / kwargs["area_util_m2"])
    return Imovel(**kwargs)
