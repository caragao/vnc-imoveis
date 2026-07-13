"""Testes dos parsers compartilhados (rodar de scraper/: python -m unittest discover tests)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models import novo_imovel  # noqa: E402
from util import parse_area_m2, parse_int, parse_preco_brl  # noqa: E402


class TestParsePrecoBrl(unittest.TestCase):
    def test_formatos_reais_dos_sites(self):
        self.assertEqual(parse_preco_brl("R$ 8.600.000"), 8_600_000)          # ph15
        self.assertEqual(parse_preco_brl("R$ 11.900.000,00"), 11_900_000)     # vnc (exibição)
        self.assertEqual(parse_preco_brl("R$\xa05.500.000"), 5_500_000)       # anglo (nbsp)
        self.assertEqual(parse_preco_brl("Venda R$ 3.250.000 texto"), 3_250_000)

    def test_invalidos(self):
        self.assertIsNone(parse_preco_brl(""))
        self.assertIsNone(parse_preco_brl(None))
        self.assertIsNone(parse_preco_brl("sob consulta"))


class TestParseAreaM2(unittest.TestCase):
    def test_formatos_reais_dos_sites(self):
        self.assertEqual(parse_area_m2("259,88 m²"), 259.88)   # ph15 (decimal vírgula)
        self.assertEqual(parse_area_m2("182 m²"), 182.0)       # anglo
        self.assertEqual(parse_area_m2("225.00"), 225.0)       # vnc (decimal ponto)
        self.assertEqual(parse_area_m2("1.234,5 m²"), 1234.5)  # milhar + decimal

    def test_invalidos(self):
        self.assertIsNone(parse_area_m2(""))
        self.assertIsNone(parse_area_m2(None))


class TestParseInt(unittest.TestCase):
    def test_valores(self):
        self.assertEqual(parse_int("4"), 4)
        self.assertEqual(parse_int(4), 4)
        self.assertEqual(parse_int("79.432"), 79432)  # referência ph15 com ponto
        self.assertEqual(parse_int(" 3 "), 3)

    def test_invalidos(self):
        self.assertIsNone(parse_int(None))
        self.assertIsNone(parse_int(""))
        self.assertIsNone(parse_int("abc"))


class TestNovoImovel(unittest.TestCase):
    BASE = dict(
        id="vnc-1", fonte="vnc", url="https://x.com/1", titulo="T", tipo="Apartamento",
        preco=1_000_000, area_util_m2=100.0,
    )

    def test_preco_m2_calculado(self):
        im = novo_imovel(**self.BASE)
        self.assertEqual(im.preco_m2, 10_000)

    def test_zero_dormitorios_com_suite_vira_desconhecido(self):
        im = novo_imovel(**self.BASE, dormitorios=0, suites=1)
        self.assertIsNone(im.dormitorios)
        self.assertEqual(im.suites, 1)

    def test_zero_dormitorios_sem_suite_permanece(self):
        im = novo_imovel(**self.BASE, dormitorios=0, suites=0)  # studio
        self.assertEqual(im.dormitorios, 0)


if __name__ == "__main__":
    unittest.main()
