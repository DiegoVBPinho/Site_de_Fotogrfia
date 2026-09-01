/*
  ============================================================
  DADOS DO SITE — carregados de uma planilha Google em tempo real.
  ============================================================
  Pra trocar fotos, criar álbuns ou mudar o texto "Sobre mim", edite a
  planilha — não precisa mexer em código nem publicar de novo no Netlify.

  A planilha tem 4 abas: Albuns, Fotos, Categorias, Config.
  Modelo pronto pra importar: pasta /csv deste projeto.
  Veja o guia completo no rodapé do site ("Como atualizar o site").

  SHEET_ID vem da URL da planilha:
  https://docs.google.com/spreadsheets/d/ESTE_PEDAÇO_AQUI/edit
*/
const SHEET_ID = "COLOQUE_O_ID_DA_SUA_PLANILHA_AQUI";

// Enquanto SHEET_ID não for trocado (ou a planilha ainda não existir),
// o site usa os CSVs locais em /csv como fonte — é o que permite testar
// tudo antes de ter a planilha real no ar.
const USE_LOCAL_CSV = SHEET_ID === "COLOQUE_O_ID_DA_SUA_PLANILHA_AQUI";

const SHEET_TABS = { albuns: "Albuns", fotos: "Fotos", categorias: "Categorias", config: "Config" };

function tabURL(tab){
  if (USE_LOCAL_CSV) return `csv/${tab}.csv`;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}

// ------------------------------------------------------------
// Parser de CSV (RFC4180: aspas duplas, vírgulas e quebras de linha
// dentro de um campo) — não dá pra usar split(",") porque tags e
// descrições podem ter vírgula dentro.
// ------------------------------------------------------------
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
      // ignora — trata só \n como fim de linha
    } else if (c === "\n"){
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell !== ""));
}

function rowsToObjects(rows){
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || "").trim(); });
    return obj;
  });
}

async function fetchTab(tab){
  const res = await fetch(tabURL(tab), { cache: "no-store" });
  if (!res.ok) throw new Error(`Não consegui carregar a aba "${tab}" (HTTP ${res.status}).`);
  return rowsToObjects(parseCSV(await res.text()));
}

// Aceita: caminho relativo (images/...), URL completa de outro serviço,
// ou link/ID do Google Drive (qualquer formato de compartilhamento) —
// nesse último caso converte pro formato que o Drive serve como imagem.
function resolveImage(value){
  const v = (value || "").trim();
  if (!v) return "";
  if (v.startsWith("images/")) return v;
  if (/^https?:\/\//.test(v) && !/drive\.google\.com|docs\.google\.com/.test(v)) return v;
  const m = v.match(/[-\w]{25,}/); // IDs de arquivo do Drive têm bem mais que 25 caracteres
  return m ? `https://lh3.googleusercontent.com/d/${m[0]}=w1600` : v;
}

function toTags(value){
  return (value || "").split(",").map(t => t.trim()).filter(Boolean);
}

async function loadSiteData(){
  const [albunsRows, fotosRows, categoriasRows, configRows] = await Promise.all([
    fetchTab(SHEET_TABS.albuns),
    fetchTab(SHEET_TABS.fotos),
    fetchTab(SHEET_TABS.categorias),
    fetchTab(SHEET_TABS.config),
  ]);

  window.ALBUMS = albunsRows.map(r => ({
    id: r.album_id,
    parent: r.album_pai || null,
    categoria: r.categoria,
    titulo: r.titulo,
    subtitulo: r.subtitulo || "",
    cover: resolveImage(r.capa),
    descricao: r.descricao || "",
  }));

  window.PHOTOS = fotosRows.map(r => ({
    id: r.foto_id,
    src: resolveImage(r.imagem),
    album: r.album_id,
    data: r.data,
    titulo: r.titulo,
    local: r.local || "",
    tags: toTags(r.tags),
  }));

  window.CATEGORIAS = categoriasRows.map(r => ({ id: r.id, label: r.label }));

  const cfg = {};
  configRows.forEach(r => { cfg[r.chave] = r.valor; });

  window.SOBRE_MIM_TEXTO = cfg.sobre_mim || "";

  const wa = (cfg.whatsapp || "").trim();
  window.CONTATO = {
    instagram: cfg.instagram || "",
    whatsapp: wa ? (wa.startsWith("http") ? wa : `https://wa.me/${wa.replace(/\D/g, "")}`) : "",
    email: cfg.email || "",
  };
}

function showLoadError(err){
  console.error("Falha ao carregar dados do site:", err);
  document.body.innerHTML = `
    <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; padding:2rem; background:#0f2035; color:#eae9e8; font-family:Inter,sans-serif;">
      <div>
        <p style="font-size:1.15rem; margin-bottom:.6rem;">Não foi possível carregar o acervo agora.</p>
        <p style="opacity:.6; font-size:.85rem; max-width:420px;">Verifique se a planilha está compartilhada como "Qualquer pessoa com o link" e tente recarregar em alguns instantes.</p>
      </div>
    </div>`;
}

// Link "Abrir a planilha" no painel "Como atualizar o site" — não depende
// do fetch, então funciona mesmo se a planilha ainda não existir.
(function wireSheetLink(){
  const btn = document.getElementById("openSheetBtn");
  if (!btn) return;
  if (USE_LOCAL_CSV){
    btn.textContent = "Planilha ainda não configurada (usando CSV local)";
    btn.removeAttribute("href");
    btn.style.pointerEvents = "none";
    btn.style.opacity = ".55";
  } else {
    btn.href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  }
})();

// main.js só roda depois que os dados chegam — por isso é injetado aqui
// em vez de estar num <script> fixo no HTML.
loadSiteData()
  .then(() => {
    const s = document.createElement("script");
    s.src = "js/main.js";
    document.body.appendChild(s);
  })
  .catch(showLoadError);
