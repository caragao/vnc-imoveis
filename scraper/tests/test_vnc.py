"""Testes da composição de título e do parse de IPTU da VNC.

Rodar de scraper/: python -m unittest discover tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sites.vnc import _iptu_vnc, titulo_vnc  # noqa: E402


class TestTituloVnc(unittest.TestCase):
    def test_com_endereco_e_numero(self):
        self.assertEqual(
            titulo_vnc("Apartamento", 71.0, "Rua Afonso Braz, 692"),
            "Apartamento · 71 m² · Rua Afonso Braz",
        )

    def test_area_com_decimal(self):
        self.assertEqual(
            titulo_vnc("Cobertura", 84.62, "Rua Gararu, 140"),
            "Cobertura · 84.62 m² · Rua Gararu",
        )

    def test_sem_endereco(self):
        self.assertEqual(titulo_vnc("Apartamento", 90.0, None), "Apartamento · 90 m²")

    def test_endereco_sem_numero(self):
        self.assertEqual(
            titulo_vnc("Casa", 200.0, "Rua Sem Numero"),
            "Casa · 200 m² · Rua Sem Numero",
        )

    def test_tipo_vazio_vira_imovel(self):
        self.assertEqual(titulo_vnc("", 50.0, None), "Imóvel · 50 m²")


class TestIptuVnc(unittest.TestCase):
    def test_formato_decimal(self):
        self.assertEqual(_iptu_vnc({"iptu": "2000.00"}), 2000)
        self.assertEqual(_iptu_vnc({"iptu": "50.00"}), 50)

    def test_fallback_monthly_property_tax(self):
        self.assertEqual(_iptu_vnc({"monthlyPropertyTax": "2400.00"}), 2400)

    def test_ausente_ou_invalido(self):
        self.assertIsNone(_iptu_vnc({}))
        self.assertIsNone(_iptu_vnc({"iptu": None}))
        self.assertIsNone(_iptu_vnc({"iptu": ""}))


if __name__ == "__main__":
    unittest.main()
