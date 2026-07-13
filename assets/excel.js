/* Export .xlsx das linhas filtradas, incluindo anotações (ADR-007).
   Usa SheetJS vendorizado em assets/vendor/xlsx.min.js (sem CDN). */
"use strict";

function baixarExcel(imoveis, anotacoes) {
  const linhas = imoveis.map((im) => {
    const a = anotacoes[im.id] || {};
    return {
      "Fonte": im.fonte,
      "Tipo": im.tipo,
      "Título": im.titulo,
      "Área útil (m²)": im.area_util_m2,
      "Preço (R$)": im.preco,
      "R$/m²": im.preco_m2,
      "Dormitórios": im.dormitorios,
      "Suítes": im.suites,
      "Vagas": im.vagas,
      "Endereço (site)": im.endereco || "",
      "Endereço completo (meu)": a.endereco_completo || "",
      "Comentário": a.comentario || "",
      "Score (1-5)": a.score || "",
      "Visitado": a.visitado ? "sim" : "",
      "Link": im.url,
      "Capturado em": im.capturado_em,
    };
  });
  const ws = XLSX.utils.json_to_sheet(linhas);
  // larguras amigáveis (título/comentário/link mais largos)
  ws["!cols"] = [
    { wch: 8 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
    { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 28 }, { wch: 28 }, { wch: 40 },
    { wch: 6 }, { wch: 8 }, { wch: 50 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Imóveis VNC");
  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `imoveis-vila-nova-conceicao-${hoje}.xlsx`);
}
