// ============================================================
// Painel de administração — apaga foto/álbum e troca capa direto do
// site. Roda escondido (nunca no navegador do visitante); confere a
// senha aqui dentro antes de mexer em qualquer arquivo.
//
// Precisa de 3 variáveis de ambiente configuradas no Netlify (nunca
// no código): ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_REPO ("dono/repo").
// Opcional: GITHUB_BRANCH (padrão "main").
// ============================================================

const GITHUB_API = "https://api.github.com";

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

function rowsToObjects(rows){
  if (!rows.length) return { headers: [], objects: [] };
  const headers = rows[0].map(h => h.trim());
  const objects = rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    return obj;
  });
  return { headers, objects };
}

function csvField(value){
  const v = value == null ? "" : String(value);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function objectsToCSV(headers, objects){
  const lines = [headers.join(",")];
  for (const obj of objects){
    lines.push(headers.map(h => csvField(obj[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function ghHeaders(){
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "diegovictor-admin-function",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoInfo(){
  const repo = process.env.GITHUB_REPO; // "dono/repositorio"
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!repo) throw new Error("GITHUB_REPO não configurado no Netlify.");
  return { repo, branch };
}

async function getFile(path){
  const { repo, branch } = repoInfo();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`Não consegui ler ${path} no GitHub (HTTP ${res.status}).`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { content, sha: json.sha };
}

async function putFile(path, content, sha, message){
  const { repo, branch } = repoInfo();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch,
    }),
  });
  if (!res.ok){
    const errText = await res.text().catch(() => "");
    throw new Error(`Não consegui salvar ${path} no GitHub (HTTP ${res.status}). ${errText}`);
  }
  return res.json();
}

// pra imagem — o conteúdo já chega em base64 do navegador, não pode
// passar pelo Buffer.from(..., "utf-8") do putFile (corrompe binário)
async function putBinaryFile(path, base64Content, message){
  const { repo, branch } = repoInfo();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: base64Content, branch }),
  });
  if (!res.ok){
    const errText = await res.text().catch(() => "");
    throw new Error(`Não consegui subir ${path} no GitHub (HTTP ${res.status}). ${errText}`);
  }
  return res.json();
}

function slugify(s){
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

async function deleteFile(path, message){
  const { repo, branch } = repoInfo();
  // precisa do sha atual do arquivo pra poder apagar
  const getRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers: ghHeaders() });
  if (!getRes.ok) return; // já não existe — nada a fazer
  const { sha } = await getRes.json();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok){
    const errText = await res.text().catch(() => "");
    throw new Error(`Não consegui apagar ${path} no GitHub (HTTP ${res.status}). ${errText}`);
  }
}

async function loadCSV(path){
  const { content, sha } = await getFile(path);
  const { headers, objects } = rowsToObjects(parseCSV(content));
  return { headers, objects, sha };
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST"){
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Método não permitido." }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON inválido." }) }; }

  const { password, action } = body;
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD){
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Senha incorreta." }) };
  }

  try {
    if (action === "verify"){
      // senha já foi conferida acima — só confirma que deu certo, sem
      // mexer em nada. É o que o login do site usa pra saber se entra.
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (action === "delete-photo"){
      const { fotoId } = body;
      if (!fotoId) throw new Error("fotoId obrigatório.");

      const fotos = await loadCSV("csv/Fotos.csv");
      const idx = fotos.objects.findIndex(r => r.foto_id === fotoId);
      if (idx === -1) throw new Error("Foto não encontrada.");
      const [removed] = fotos.objects.splice(idx, 1);

      // se a foto apagada era capa de algum álbum, troca pra outra foto
      // que sobrou no mesmo álbum (ou deixa em branco se não sobrou nenhuma)
      const albuns = await loadCSV("csv/Albuns.csv");
      const irmãs = fotos.objects.filter(r => r.album_id === removed.album_id);
      let albunsChanged = false;
      albuns.objects.forEach(a => {
        if (a.capa === removed.imagem){
          a.capa = irmãs.length ? irmãs[0].imagem : "";
          albunsChanged = true;
        }
      });

      await putFile("csv/Fotos.csv", objectsToCSV(fotos.headers, fotos.objects), fotos.sha,
        `Admin: apaga foto ${fotoId}`);
      if (albunsChanged){
        const albunsFresh = await loadCSV("csv/Albuns.csv"); // sha pode ter mudado, recarrega
        const merged = albunsFresh.objects.map(a => {
          const patched = albuns.objects.find(x => x.album_id === a.album_id);
          return patched ? patched : a;
        });
        await putFile("csv/Albuns.csv", objectsToCSV(albunsFresh.headers, merged), albunsFresh.sha,
          `Admin: atualiza capa após apagar foto ${fotoId}`);
      }
      if (removed.imagem){
        await deleteFile(removed.imagem, `Admin: apaga arquivo da foto ${fotoId}`);
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (action === "delete-album"){
      const { albumId } = body;
      if (!albumId) throw new Error("albumId obrigatório.");

      const albuns = await loadCSV("csv/Albuns.csv");
      const temFilho = albuns.objects.some(a => a.album_pai === albumId);
      if (temFilho) throw new Error("Esse álbum tem sub-álbuns dentro — apague os de dentro primeiro.");

      const idx = albuns.objects.findIndex(a => a.album_id === albumId);
      if (idx === -1) throw new Error("Álbum não encontrado.");
      albuns.objects.splice(idx, 1);

      const fotos = await loadCSV("csv/Fotos.csv");
      const daAlbum = fotos.objects.filter(r => r.album_id === albumId);
      const resto = fotos.objects.filter(r => r.album_id !== albumId);

      await putFile("csv/Albuns.csv", objectsToCSV(albuns.headers, albuns.objects), albuns.sha,
        `Admin: apaga álbum ${albumId}`);
      await putFile("csv/Fotos.csv", objectsToCSV(fotos.headers, resto), fotos.sha,
        `Admin: apaga fotos do álbum ${albumId}`);
      for (const foto of daAlbum){
        if (foto.imagem) await deleteFile(foto.imagem, `Admin: apaga arquivo do álbum ${albumId}`);
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (action === "set-cover"){
      const { albumId, fotoId } = body;
      if (!albumId || !fotoId) throw new Error("albumId e fotoId obrigatórios.");

      const fotos = await loadCSV("csv/Fotos.csv");
      const foto = fotos.objects.find(r => r.foto_id === fotoId);
      if (!foto) throw new Error("Foto não encontrada.");

      const albuns = await loadCSV("csv/Albuns.csv");
      const album = albuns.objects.find(a => a.album_id === albumId);
      if (!album) throw new Error("Álbum não encontrado.");
      album.capa = foto.imagem;

      await putFile("csv/Albuns.csv", objectsToCSV(albuns.headers, albuns.objects), albuns.sha,
        `Admin: troca capa do álbum ${albumId}`);

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (action === "set-category"){
      const { albumId, categoria } = body;
      if (!albumId || !categoria) throw new Error("albumId e categoria obrigatórios.");

      const albuns = await loadCSV("csv/Albuns.csv");
      const album = albuns.objects.find(a => a.album_id === albumId);
      if (!album) throw new Error("Álbum não encontrado.");
      album.categoria = categoria;

      await putFile("csv/Albuns.csv", objectsToCSV(albuns.headers, albuns.objects), albuns.sha,
        `Admin: muda categoria do álbum ${albumId} para ${categoria}`);

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (action === "create-album"){
      const { titulo, subtitulo, categoria, albumPai } = body;
      if (!titulo || !categoria) throw new Error("Título e categoria são obrigatórios.");

      const albuns = await loadCSV("csv/Albuns.csv");
      if (albumPai && !albuns.objects.some(a => a.album_id === albumPai)){
        throw new Error("Álbum-pai não existe.");
      }

      const existing = new Set(albuns.objects.map(a => a.album_id));
      const base = slugify(titulo) || "album";
      let id = base, n = 2;
      while (existing.has(id)) id = `${base}-${n++}`;

      albuns.objects.push({
        album_id: id,
        album_pai: albumPai || "",
        categoria,
        titulo,
        subtitulo: subtitulo || "",
        capa: "",
        descricao: "",
      });

      await putFile("csv/Albuns.csv", objectsToCSV(albuns.headers, albuns.objects), albuns.sha,
        `Admin: cria álbum ${id}`);

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, albumId: id }) };
    }

    if (action === "upload-photo"){
      const { albumId, filename, dataBase64, titulo, local, tags } = body;
      if (!albumId || !dataBase64) throw new Error("albumId e imagem são obrigatórios.");

      const albuns = await loadCSV("csv/Albuns.csv");
      const album = albuns.objects.find(a => a.album_id === albumId);
      if (!album) throw new Error("Álbum não encontrado.");

      const fotos = await loadCSV("csv/Fotos.csv");
      const usedImagens = new Set(fotos.objects.map(r => r.imagem));
      const usedIds = new Set(fotos.objects.map(r => r.foto_id));
      const ext = /\.([a-z0-9]{2,5})$/i.test(filename || "") ? filename.split(".").pop().toLowerCase() : "jpg";

      let n = fotos.objects.filter(r => r.album_id === albumId).length + 1;
      let imagePath, fotoId;
      do {
        const numStr = String(n).padStart(2, "0");
        imagePath = `images/${albumId}/${albumId}-${numStr}.${ext}`;
        fotoId = `${albumId}-${numStr}`;
        n++;
      } while (usedImagens.has(imagePath) || usedIds.has(fotoId));

      await putBinaryFile(imagePath, dataBase64, `Admin: adiciona foto ${fotoId}`);

      const today = new Date().toISOString().slice(0, 10);
      fotos.objects.push({
        foto_id: fotoId,
        album_id: albumId,
        imagem: imagePath,
        data: today,
        titulo: titulo || album.titulo,
        local: local || "",
        tags: tags || "",
      });
      await putFile("csv/Fotos.csv", objectsToCSV(fotos.headers, fotos.objects), fotos.sha,
        `Admin: adiciona foto ${fotoId} ao álbum ${albumId}`);

      if (!album.capa){
        const albunsFresh = await loadCSV("csv/Albuns.csv");
        const merged = albunsFresh.objects.map(a => a.album_id === albumId ? { ...a, capa: imagePath } : a);
        await putFile("csv/Albuns.csv", objectsToCSV(albunsFresh.headers, merged), albunsFresh.sha,
          `Admin: define capa do álbum ${albumId}`);
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, fotoId, imagem: imagePath }) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Ação desconhecida." }) };
  } catch (err){
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message || "Erro desconhecido." }) };
  }
};
