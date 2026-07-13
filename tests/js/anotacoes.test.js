/* Testes da camada de anotações (Node puro, sem framework).
   Rodar:  node tests/js/anotacoes.test.js   (da raiz do repo) */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FONTE = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "anotacoes.js"), "utf-8");

/** Carrega uma instância isolada do módulo com um mock de localStorage. */
function carregarModulo(localStorageMock) {
  const sandbox = {
    localStorage: localStorageMock,
    console: { warn: () => {} },
    Date, JSON, Number, Math, String, Object, Promise, Array,
  };
  return vm.runInNewContext(FONTE + "\nAnotacoes;", sandbox);
}

function lsFuncional(inicial = {}) {
  const dados = { "vnc-imoveis:anotacoes": JSON.stringify(inicial) };
  return {
    getItem: (k) => dados[k] ?? null,
    setItem: (k, v) => { dados[k] = v; },
    _dados: dados,
  };
}

const arquivoFake = (obj) => ({ text: () => Promise.resolve(typeof obj === "string" ? obj : JSON.stringify(obj)) });

(async () => {
  // 1. sanitização de score: string maliciosa, fora de faixa, numérica em string
  {
    const A = carregarModulo(lsFuncional());
    await A.carregar();
    await A.importar(arquivoFake({
      a: { score: '3" onmouseover="alert(1)', atualizado_em: "2026-01-01T00:00:00Z" },
      b: { score: 7, atualizado_em: "2026-01-01T00:00:00Z" },
      c: { score: "4", atualizado_em: "2026-01-01T00:00:00Z" },
      d: { score: -2, atualizado_em: "2026-01-01T00:00:00Z" },
    }));
    assert.strictEqual(A.todas().a.score, 0, "score malicioso vira 0");
    assert.strictEqual(A.todas().b.score, 5, "score > 5 clampa em 5");
    assert.strictEqual(A.todas().c.score, 4, "score numérico em string é aceito");
    assert.strictEqual(A.todas().d.score, 0, "score negativo clampa em 0");
  }

  // 2. sanitização de visitado: só boolean true vale
  {
    const A = carregarModulo(lsFuncional());
    await A.carregar();
    await A.importar(arquivoFake({
      a: { visitado: "sim", atualizado_em: "2026-01-01T00:00:00Z" },
      b: { visitado: true, atualizado_em: "2026-01-01T00:00:00Z" },
      c: { visitado: 1, atualizado_em: "2026-01-01T00:00:00Z" },
    }));
    assert.strictEqual(A.todas().a.visitado, false, "'sim' vira false");
    assert.strictEqual(A.todas().b.visitado, true, "true permanece");
    assert.strictEqual(A.todas().c.visitado, false, "1 vira false");
  }

  // 3. merge por timestamp: mais recente vence; inválido perde; formato válido
  //    não normalizado é normalizado com Date.parse (nunca comparação lexical crua)
  {
    const A = carregarModulo(lsFuncional({
      a: { comentario: "antigo", atualizado_em: "2026-01-01T00:00:00.000Z" },
      b: { comentario: "atual", atualizado_em: "2026-06-01T00:00:00.000Z" },
      c: { comentario: "valido", atualizado_em: "2026-06-01T00:00:00.000Z" },
    }));
    await A.carregar();
    await A.importar(arquivoFake({
      a: { comentario: "novo", atualizado_em: "Jun 30 2026 12:00:00 GMT+0000" }, // válido, não normalizado
      b: { comentario: "velho", atualizado_em: "2025-01-01T00:00:00.000Z" },     // mais antigo, perde
      c: { comentario: "corrompido", atualizado_em: "não é data" },              // inválido, perde
    }));
    assert.strictEqual(A.todas().a.comentario, "novo", "timestamp válido não normalizado vence o antigo");
    assert.strictEqual(A.todas().a.atualizado_em, "2026-06-30T12:00:00.000Z", "timestamp é normalizado para ISO");
    assert.strictEqual(A.todas().b.comentario, "atual", "timestamp mais antigo perde");
    assert.strictEqual(A.todas().c.comentario, "valido", "timestamp inválido perde do válido");
  }

  // 4. import de JSON inválido rejeita sem corromper o cache
  {
    const A = carregarModulo(lsFuncional({ a: { comentario: "ok", atualizado_em: "2026-01-01T00:00:00Z" } }));
    await A.carregar();
    await assert.rejects(() => A.importar(arquivoFake("{ json quebrado")), /JSON/i, "JSON quebrado rejeita");
    await assert.rejects(() => A.importar(arquivoFake([1, 2])), /formato inválido/, "array rejeita");
    assert.strictEqual(A.todas().a.comentario, "ok", "cache intacto após import falho");
  }

  // 5. localStorage bloqueado: carregar não lança, salvar funciona em memória
  {
    const A = carregarModulo({
      getItem: () => { throw new Error("storage disabled"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    });
    const cache = await A.carregar(); // não pode lançar
    assert.strictEqual(Object.keys(cache).length, 0, "carrega vazio com storage bloqueado");
    const salvo = A.salvar("x", { score: 3 });
    assert.strictEqual(salvo.score, 3, "salvar funciona em memória");
    assert.strictEqual(A.persistiu(), false, "persistiu() reporta falha de escrita");
  }

  console.log("anotacoes.test.js: 5 grupos de teste OK");
})().catch((e) => { console.error(e); process.exit(1); });
