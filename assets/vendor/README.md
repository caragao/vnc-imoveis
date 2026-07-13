# Dependências vendorizadas

Bibliotecas de terceiros commitadas no repo (ADR-003/ADR-007: sem CDN — o dashboard
funciona offline e sem dependência externa em runtime).

## xlsx.min.js — SheetJS Community Edition (build "mini")

| Campo | Valor |
|---|---|
| Biblioteca | SheetJS CE (xlsx), build `xlsx.mini.min.js` |
| Versão | **0.20.3** (conferível em runtime: `XLSX.version`) |
| Origem oficial | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js |
| SHA-256 | `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939` |
| Licença | Apache License 2.0 — https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE (© SheetJS LLC) |
| Uso no projeto | `assets/excel.js` (`json_to_sheet` + `writeFile` para o botão "Baixar Excel") |

O build **mini** cobre XLSX/CSV básicos e é suficiente para o export deste projeto
(≈280 KB vs ≈1 MB do build completo).

### Como atualizar

1. Escolher a versão em https://cdn.sheetjs.com/ (SheetJS não publica versões novas no npm público).
2. Baixar `https://cdn.sheetjs.com/xlsx-<versão>/package/dist/xlsx.mini.min.js` para este diretório como `xlsx.min.js`.
3. Recalcular o hash (`sha256sum assets/vendor/xlsx.min.js`) e atualizar esta tabela (versão, URL, SHA-256).
4. Testar o export: abrir o dashboard, filtrar, "Baixar Excel", conferir acentos e colunas.
5. Registrar a atualização no PR (checklist de docs).

### Verificar integridade do arquivo atual

```bash
sha256sum assets/vendor/xlsx.min.js   # deve bater com a tabela acima
```
