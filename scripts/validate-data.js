// Confere a integridade dos dados do site (csv/Albuns.csv e csv/Fotos.csv)
// antes de publicar. Roda no GitHub Actions a cada push, mas também dá
// pra rodar na mão: `node scripts/validate-data.js`
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function parseCSV(text){
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i], next = text[i + 1];
    if (inQuotes){
      if (c === '"' && next === '"'){ field += '"'; i++; }
      else if (c === '"'){ inQuotes = false; }
      else field += c;
    } else if (c === '"'){
      inQuotes = true;
    } else if (c === ","){
      row.push(field); field = "";
    } else if (c === "\r"){
      // ignora
    } else if (c === "\n"){
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell !== ""));
}

function readCSV(relPath){
  const text = fs.readFileSync(path.join(ROOT, relPath), "utf-8");
  const rows = parseCSV(text);
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || "").trim(); });
    return obj;
  });
}

function fileExists(relPath){
  if (!relPath) return true; // capa vazia é permitido
  return fs.existsSync(path.join(ROOT, relPath));
}

const errors = [];
const warnings = [];

const albuns = readCSV("csv/Albuns.csv");
const fotos = readCSV("csv/Fotos.csv");

const albumIds = new Set(albuns.map(a => a.album_id));
const fotoIds = new Set();

// --- Albuns.csv ---
const seenAlbumIds = new Set();
albuns.forEach((a, i) => {
  const line = i + 2; // +1 header, +1 índice-base-1
  if (!a.album_id) errors.push(`Albuns.csv linha ${line}: album_id vazio.`);
  if (seenAlbumIds.has(a.album_id)) errors.push(`Albuns.csv linha ${line}: album_id "${a.album_id}" duplicado.`);
  seenAlbumIds.add(a.album_id);

  if (a.album_pai && !albumIds.has(a.album_pai)){
    errors.push(`Albuns.csv linha ${line}: album_pai "${a.album_pai}" (do álbum "${a.album_id}") não existe.`);
  }
  if (a.capa && !fileExists(a.capa)){
    errors.push(`Albuns.csv linha ${line}: capa "${a.capa}" (álbum "${a.album_id}") não existe no repositório.`);
  }
});

// --- Fotos.csv ---
const seenFotoIds = new Set();
fotos.forEach((f, i) => {
  const line = i + 2;
  if (!f.foto_id) errors.push(`Fotos.csv linha ${line}: foto_id vazio.`);
  if (seenFotoIds.has(f.foto_id)) errors.push(`Fotos.csv linha ${line}: foto_id "${f.foto_id}" duplicado.`);
  seenFotoIds.add(f.foto_id);
  fotoIds.add(f.foto_id);

  if (!f.album_id || !albumIds.has(f.album_id)){
    errors.push(`Fotos.csv linha ${line}: album_id "${f.album_id}" (foto "${f.foto_id}") não existe em Albuns.csv.`);
  }
  if (!f.imagem || !fileExists(f.imagem)){
    errors.push(`Fotos.csv linha ${line}: imagem "${f.imagem}" (foto "${f.foto_id}") não existe no repositório.`);
  }
  if (!f.data || !/^\d{4}-\d{2}-\d{2}$/.test(f.data)){
    warnings.push(`Fotos.csv linha ${line}: data "${f.data}" (foto "${f.foto_id}") não parece estar no formato AAAA-MM-DD.`);
  }
});

// --- álbuns sem nenhuma foto em lugar nenhum (nem própria, nem herdada) ---
const parentIds = new Set(albuns.filter(a => a.album_pai).map(a => a.album_pai));
albuns.forEach(a => {
  const temFotoPropria = fotos.some(f => f.album_id === a.album_id);
  const temFilho = parentIds.has(a.album_id);
  if (!temFotoPropria && !temFilho){
    warnings.push(`Albuns.csv: álbum "${a.album_id}" não tem foto própria nem sub-álbum — nunca vai aparecer no site.`);
  }
});

console.log(`Conferidos: ${albuns.length} álbuns, ${fotos.length} fotos.`);
if (warnings.length){
  console.log(`\n⚠ ${warnings.length} aviso(s):`);
  warnings.forEach(w => console.log(`  - ${w}`));
}
if (errors.length){
  console.log(`\n✗ ${errors.length} erro(s):`);
  errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
}
console.log("\n✓ Tudo certo.");
