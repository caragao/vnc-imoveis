"""Testes do filtro VNC e da normalização (rodar de itbi/: python -m unittest discover tests)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models import novo, USOS_RESIDENCIAIS  # noqa: E402
from util import fmt_cep, is_vnc, normalizar, texto, inteiro, rua_bloqueada, bairro_outro  # noqa: E402
from build import _proporcao  # noqa: E402


class TestIsVnc(unittest.TestCase):
    def test_variantes_reais_de_vnc(self):
        # rótulos + CEPs reais de VNC (04505–04515) que aparecem nas planilhas
        for bairro, cep in [
            ("VILA NOVA CONCEICAO", 4505001),
            ("VL NOVA CONCEICAO", 4507010),
            ("V NOVA CONCEICAO", 4509021),
            ("V. NOVA CONCEICAO", 4513901),
            ("VNCONCEICAO", 4515011),
        ]:
            self.assertTrue(is_vnc(bairro, cep), f"deveria aceitar {bairro} {cep}")

    def test_homonimos_sao_rejeitados(self):
        # bairros DIFERENTES que contêm 'Conceição' — CEP fora da faixa 045
        self.assertFalse(is_vnc("VL N S CONCEICAO", 5181220))    # Nossa Senhora
        self.assertFalse(is_vnc("VL N SRA CONCEICAO", 5181000))  # Nossa Senhora
        self.assertFalse(is_vnc("SITIO CONCEICAO", 8473030))     # Sítio
        self.assertFalse(is_vnc("CJ HAB SITIO CONCEICAO", 8473090))

    def test_vazamento_itaim_vila_olimpia_rejeitado(self):
        # rótulo diz "Nova Conceição" mas o CEP (04522+) é Itaim/Vila Olímpia —
        # endereços reais que vazavam com a faixa larga 045xxxxx
        self.assertFalse(is_vnc("VL NOVA CONCEICAO", 4543000))  # Av. JK / Souza Aranha
        self.assertFalse(is_vnc("VILA NOVA CONCEICAO", 4545000))  # Fadlo Haidar
        self.assertFalse(is_vnc("V NOVA CONCEICAO", 4535000))   # João Cachoeira
        self.assertFalse(is_vnc("VL NOVA CONCEICAO", 4532000))  # Guilherme Bannitz

    def test_cep_fora_da_faixa_rejeita_mesmo_com_rotulo_certo(self):
        # rótulo diz VNC mas CEP é de outro bairro -> rejeita (defesa dupla)
        self.assertFalse(is_vnc("VILA NOVA CONCEICAO", 5181220))

    def test_cep_ausente_rejeita(self):
        self.assertFalse(is_vnc("VILA NOVA CONCEICAO", None))


class TestNormalizacao(unittest.TestCase):
    def test_normalizar_tira_acento_e_maiuscula(self):
        self.assertEqual(normalizar("Vila Nova Conceição"), "VILA NOVA CONCEICAO")

    def test_fmt_cep(self):
        self.assertEqual(fmt_cep(4505001), "04505-001")
        self.assertIsNone(fmt_cep(None))

    def test_texto_limpa_floats_inteiros_e_nan(self):
        self.assertEqual(texto(71.0), "71")
        self.assertEqual(texto(" R DIOGO "), "R DIOGO")
        self.assertIsNone(texto("nan"))
        self.assertIsNone(texto(None))

    def test_inteiro(self):
        self.assertEqual(inteiro("605994.39"), 605994)
        self.assertEqual(inteiro(100), 100)
        self.assertIsNone(inteiro(None))


class TestProporcao(unittest.TestCase):
    def test_valores_validos(self):
        self.assertEqual(_proporcao(100), 100.0)
        self.assertEqual(_proporcao(50), 50.0)
        self.assertEqual(_proporcao(4.07), 4.07)

    def test_ausente_ou_invalido_vira_100(self):
        self.assertEqual(_proporcao(None), 100.0)
        self.assertEqual(_proporcao(0), 100.0)
        self.assertEqual(_proporcao(150), 100.0)
        self.assertEqual(_proporcao("nao numero"), 100.0)

    def test_nan_e_infinito_do_pandas_viram_100(self):
        # célula Excel vazia chega como float('nan'); ±inf também não pode passar
        self.assertEqual(_proporcao(float("nan")), 100.0)
        self.assertEqual(_proporcao(float("inf")), 100.0)
        self.assertEqual(_proporcao(float("-inf")), 100.0)
        self.assertEqual(_proporcao("   "), 100.0)
        self.assertEqual(_proporcao(-10), 100.0)


class TestNovaTransacao(unittest.TestCase):
    BASE = dict(
        id="itbi-abc123def456", sql="123", endereco="R X, 1", bairro="VILA NOVA CONCEICAO",
        natureza="1.Compra e venda", data="2025-08-29", valor=1_000_000, proporcao=100.0,
    )

    def test_valor_m2_ajustado_para_100pct(self):
        # transferência de 50% por 5M num apto de 100m² -> unidade inteira vale 10M -> 100k/m²
        t = novo(**{**self.BASE, "valor": 5_000_000, "proporcao": 50.0,
                    "area_construida_m2": 100.0, "uso": 20})
        self.assertEqual(t.valor_100pct, 10_000_000)
        self.assertEqual(t.valor_m2, 100_000)

    def test_area_zero_deixa_valor_m2_nulo(self):
        t = novo(**{**self.BASE, "area_construida_m2": None, "uso": 0})
        self.assertIsNone(t.valor_m2)

    def test_ano_e_mes_derivados_da_data(self):
        t = novo(**self.BASE)
        self.assertEqual((t.ano, t.mes), (2025, 8))

    def test_flag_residencial_exclui_predio_inteiro(self):
        self.assertTrue(novo(**{**self.BASE, "uso": 20}).residencial)   # apartamento
        self.assertTrue(novo(**{**self.BASE, "uso": 25}).residencial)   # flat
        self.assertTrue(novo(**{**self.BASE, "uso": 10}).residencial)   # casa
        self.assertFalse(novo(**{**self.BASE, "uso": 21}).residencial)  # prédio INTEIRO — fora
        self.assertFalse(novo(**{**self.BASE, "uso": 40}).residencial)  # loja
        self.assertEqual(USOS_RESIDENCIAIS, {10, 20, 25})

    def test_tipo_ativo(self):
        self.assertEqual(novo(**{**self.BASE, "uso": 20}).tipo_ativo, "Apartamento")
        self.assertEqual(novo(**{**self.BASE, "uso": 25}).tipo_ativo, "Flat")
        self.assertEqual(novo(**{**self.BASE, "uso": 10}).tipo_ativo, "Casa")
        self.assertEqual(novo(**{**self.BASE, "uso": 24}).tipo_ativo, "Vaga de garagem")
        self.assertEqual(novo(**{**self.BASE, "uso": 23}).tipo_ativo, "Vaga de garagem")  # comercial
        self.assertEqual(novo(**{**self.BASE, "uso": 80}).tipo_ativo, "Hotel/hospedaria")
        self.assertEqual(novo(**{**self.BASE, "uso": 85}).tipo_ativo, "Flat comercial")
        self.assertEqual(novo(**{**self.BASE, "uso": 0}).tipo_ativo, "Terreno")
        self.assertEqual(novo(**{**self.BASE, "uso": None}).tipo_ativo, "Não classificado")
        # hotel e flat comercial NÃO são unidade residencial de mercado
        self.assertFalse(novo(**{**self.BASE, "uso": 80}).residencial)
        self.assertFalse(novo(**{**self.BASE, "uso": 85}).residencial)

    def test_flag_integral(self):
        self.assertTrue(novo(**{**self.BASE, "proporcao": 100.0}).integral)
        self.assertFalse(novo(**{**self.BASE, "proporcao": 50.0}).integral)

    def test_razao_valor_venal(self):
        t = novo(**{**self.BASE, "valor": 800_000, "valor_venal_referencia": 400_000})
        self.assertEqual(t.razao_valor_venal, 2.0)


class TestRuaBloqueada(unittest.TestCase):
    def test_ruas_de_itaim_vila_olimpia_bloqueadas(self):
        for rua in ["R JOAO CACHOEIRA", "R CLODOMIRO AMAZONAS",
                    "R DR EDUARDO DE SOUZA ARANHA", "R DR FADLO HAIDAR",
                    "AV PRES JUSCELINO KUBITSCHEK", "AV STO AMARO"]:  # arterial de divisa
            self.assertTrue(rua_bloqueada(rua), f"deveria bloquear {rua}")

    def test_ruas_de_vnc_nao_bloqueadas(self):
        for rua in ["R AFONSO BRAZ", "R JACQUES FELIX", "R DOMINGOS FERNANDES", None]:
            self.assertFalse(rua_bloqueada(rua), f"não deveria bloquear {rua}")

    def test_is_vnc_bloqueia_rua_mesmo_com_cep_e_rotulo(self):
        # defesa extra: rótulo VNC + CEP na faixa, mas rua de Itaim -> rejeita
        self.assertFalse(is_vnc("VILA NOVA CONCEICAO", 4510000, "R JOAO CACHOEIRA"))
        self.assertTrue(is_vnc("VILA NOVA CONCEICAO", 4510000, "R AFONSO BRAZ"))


class TestBairroOutro(unittest.TestCase):
    def test_rotulos_de_outro_bairro(self):
        for b in ["INDIANOPOLIS", "ITAIM BIBI", "VILA OLIMPIA", "MOEMA", "JARDIM PAULISTA"]:
            self.assertTrue(bairro_outro(b), f"deveria marcar {b} como outro bairro")

    def test_rotulo_conceicao_prevalece(self):
        self.assertFalse(bairro_outro("VILA NOVA CONCEICAO"))
        self.assertFalse(bairro_outro(None))  # sem rótulo não é "outro"


if __name__ == "__main__":
    unittest.main()
