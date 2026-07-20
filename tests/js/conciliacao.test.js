/* Testes da conciliação por prédio e da camada de área útil (Node puro, sem
   framework). Rodar:  node tests/js/conciliacao.test.js   (da raiz do repo) */
"use strict";
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const C = require(path.join(__dirname, "..", "..", "assets", "conciliacao.js"));

let ok = 0;
async function t(nome, fn) { await fn(); ok++; console.log("  ok -", nome); }

const FONTE_AU = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "area-util.js"), "utf-8");
function carregarAreaUtil(inicial = {}) {
  const dados = { "vnc-imoveis:areautil": JSON.stringify(inicial) };
  const ls = { getItem: (k) => dados[k] ?? null, setItem: (k, v) => { dados[k] = v; } };
  const sandbox = { localStorage: ls, console: { warn: () => {} }, Date, JSON, Number, Math, String, Object, Promise, Array };
  return vm.runInNewContext(FONTE_AU + "\nAreaUtil;", sandbox);
}
const arquivoFake = (obj) => ({ text: () => Promise.resolve(JSON.stringify(obj)) });

(async () => {
  console.log("conciliacao.js");

  // 1. normalização de logradouro: acento, caixa e prefixo de tipo somem, miolo fica
  await t("normaliza logradouro (acento/caixa/prefixo)", () => {
    assert.strictEqual(C.normalizarLogradouro("R JACQUES FELIX"), "JACQUES FELIX");
    assert.strictEqual(C.normalizarLogradouro("Rua Jacques Félix"), "JACQUES FELIX");
    assert.strictEqual(C.normalizarLogradouro("Jacques Felix"), "JACQUES FELIX");
    assert.strictEqual(C.normalizarLogradouro("Avenida Santo Amaro"), "SANTO AMARO");
    assert.strictEqual(C.normalizarLogradouro("AV. SANTO AMARO"), "SANTO AMARO");
    assert.strictEqual(C.normalizarLogradouro(null), "");
  });

  // 2. só o PRIMEIRO token de tipo é removido (não come o miolo do nome)
  await t("não remove prefixo no meio do nome", () => {
    assert.strictEqual(C.normalizarLogradouro("Rua da Paz"), "DA PAZ");
    assert.strictEqual(C.normalizarLogradouro("Alameda Rua Nova"), "RUA NOVA");
  });

  // 3. chaveEndereco combina core + dígitos, e falha quando falta um dos dois
  await t("chaveEndereco = CORE#DIGITOS ou null", () => {
    assert.strictEqual(C.chaveEndereco("R JACQUES FELIX", "626"), "JACQUES FELIX#626");
    assert.strictEqual(C.chaveEndereco("Rua Jacques Félix", 626), "JACQUES FELIX#626");
    assert.strictEqual(C.chaveEndereco("R JACQUES FELIX", "s/n"), null, "sem número -> null");
    assert.strictEqual(C.chaveEndereco("", "626"), null, "sem logradouro -> null");
  });

  // 4. parse de endereço livre (com/sem vírgula, com complemento)
  await t("parseEnderecoLivre extrai rua e número", () => {
    assert.deepStrictEqual(C.parseEnderecoLivre("Rua Afonso Braz, 692, apto 51"),
      { rua: "Rua Afonso Braz", numero: "692" });
    assert.deepStrictEqual(C.parseEnderecoLivre("Avenida Santo Amaro 835"),
      { rua: "Avenida Santo Amaro", numero: "835" });
    assert.deepStrictEqual(C.parseEnderecoLivre(""), { rua: "", numero: "" });
  });

  // 5. chaveImovel: usa endereco do anúncio, com fallback para endereco_completo
  await t("chaveImovel usa endereço, com fallback de anotação", () => {
    assert.strictEqual(C.chaveImovel({ endereco: "Rua Afonso Braz, 692" }, null), "AFONSO BRAZ#692");
    assert.strictEqual(C.chaveImovel({ endereco: null }, { endereco_completo: "Rua Marcos Lopes, 272" }),
      "MARCOS LOPES#272");
    assert.strictEqual(C.chaveImovel({ endereco: null }, null), null);
  });

  // 6. conciliação ponta a ponta: transação e anúncio do MESMO prédio geram a mesma chave
  await t("transação e anúncio do mesmo prédio conciliam", () => {
    const kt = C.chaveTransacao({ logradouro: "R MARCOS LOPES", numero: "272" });
    const ki = C.chaveImovel({ endereco: "Rua Marcos Lopes, 272" }, null);
    assert.strictEqual(kt, ki);
    assert.strictEqual(kt, "MARCOS LOPES#272");
  });

  // 7. indexarPorPredio agrupa por chave e ignora itens sem chave
  await t("indexarPorPredio agrupa e descarta sem chave", () => {
    const trans = [
      { logradouro: "R MARCOS LOPES", numero: "272" },
      { logradouro: "Rua Marcos Lopes", numero: "272" },
      { logradouro: "R AFONSO BRAZ", numero: "805" },
      { logradouro: null, numero: null },
    ];
    const idx = C.indexarPorPredio(trans, C.chaveTransacao);
    assert.strictEqual(idx.size, 2);
    assert.strictEqual(idx.get("MARCOS LOPES#272").length, 2);
    assert.strictEqual(idx.get("AFONSO BRAZ#805").length, 1);
  });

  console.log("area-util.js");

  // 8. sanitização: só número finito > 0 vale; resto descarta o registro
  await t("AreaUtil sanitiza área <= 0 / não numérica", async () => {
    const A = carregarAreaUtil();
    await A.carregar();
    await A.importar(arquivoFake({
      a: { area_util: 80, atualizado_em: "2026-01-01T00:00:00Z" },
      b: { area_util: 0, atualizado_em: "2026-01-01T00:00:00Z" },
      c: { area_util: -5, atualizado_em: "2026-01-01T00:00:00Z" },
      d: { area_util: "x", atualizado_em: "2026-01-01T00:00:00Z" },
      e: { area_util: "92.5", atualizado_em: "2026-01-01T00:00:00Z" },
    }));
    assert.strictEqual(A.valor("a"), 80);
    assert.strictEqual(A.valor("b"), null, "0 descartado");
    assert.strictEqual(A.valor("c"), null, "negativo descartado");
    assert.strictEqual(A.valor("d"), null, "não numérico descartado");
    assert.strictEqual(A.valor("e"), 92.5, "número em string aceito");
  });

  // 9. salvar vazio/<=0 remove o registro (volta a usar a sugestão)
  await t("AreaUtil.salvar vazio remove o override", () => {
    const A = carregarAreaUtil();
    A.salvar("x", 100);
    assert.strictEqual(A.valor("x"), 100);
    A.salvar("x", "");
    assert.strictEqual(A.valor("x"), null, "string vazia remove");
    A.salvar("x", 50);
    A.salvar("x", 0);
    assert.strictEqual(A.valor("x"), null, "zero remove");
  });

  // 10. merge por timestamp: mais recente vence
  await t("AreaUtil merge mantém o mais recente", async () => {
    const A = carregarAreaUtil({ a: { area_util: 70, atualizado_em: "2026-01-01T00:00:00.000Z" } });
    await A.carregar();
    await A.importar(arquivoFake({ a: { area_util: 90, atualizado_em: "2026-06-01T00:00:00.000Z" } }));
    assert.strictEqual(A.valor("a"), 90, "import mais recente vence");
  });

  console.log(`\n${ok} casos OK`);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
