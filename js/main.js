// ============================================================
// Helpers
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HAS_FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

function formatDateShort(iso){
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function formatDateLong(iso){
  const [y, m, d] = iso.split("-");
  return `${parseInt(d,10)} de ${MESES[parseInt(m,10)-1]} de ${y}`;
}
const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function formatMonthYearFull(iso){
  const [y, m] = iso.split("-");
  return `${MESES[parseInt(m, 10) - 1].toUpperCase()} ${y}`;
}

// ============================================================
// Dados — navegação da árvore de álbuns (puro, sem DOM)
// ============================================================
function getAlbum(id){ return ALBUMS.find(a => a.id === id); }
// só entra na navegação quem tem foto de verdade (direta ou nos sub-álbuns) —
// álbum/categoria vazio nunca aparece pro visitante
function children(parentId){ return ALBUMS.filter(a => a.parent === parentId && albumHasContent(a.id)); }
function albumPhotos(id){ return PHOTOS.filter(p => p.album === id); }
function albumPhotosRecursive(id){
  let list = albumPhotos(id);
  ALBUMS.filter(a => a.parent === id).forEach(c => { list = list.concat(albumPhotosRecursive(c.id)); });
  return list;
}
function albumHasContent(id){ return albumPhotosRecursive(id).length > 0; }
// nomes bonitos pra cada categoria (coluna "categoria" do Albuns.csv) —
// usado só pra agrupar a vitrine principal por tipo de trabalho
const CATEGORY_LABELS = {
  retratos: "Retratos",
  "festa-particular": "Festas & Eventos",
  "santa-rita": "Festa de Santa Rita",
  drone: "Drone",
  carnaval: "Carnaval",
  natureza: "Natureza",
  hacktown: "Hacktown",
  "feirao-folclorico": "Feirão Folclórico",
  profissoes: "Profissões",
};
function categoryLabel(slug){
  if (!slug) return "Outros";
  return CATEGORY_LABELS[slug] || (slug.charAt(0).toUpperCase() + slug.slice(1));
}
// "2026" sozinho só faz sentido dentro da vitrine agrupada por categoria
// (que já mostra "FESTA DE SANTA RITA" do lado) — em qualquer outro lugar
// (busca, spotlight, rótulo de pai) carimba o nome do evento junto
function albumDisplayName(a){
  return /^\d{4}$/.test(a.titulo) ? `${categoryLabel(a.categoria)} ${a.titulo}` : a.titulo;
}
function breadcrumbFor(albumId){
  const chain = [];
  let current = getAlbum(albumId);
  while (current){
    chain.unshift(current);
    current = current.parent ? getAlbum(current.parent) : null;
  }
  return chain;
}
function albumOwnDate(id){
  const photos = albumPhotos(id);
  if (!photos.length) return null;
  return photos.reduce((min, p) => (p.data < min ? p.data : min), photos[0].data);
}
// mais nova das fotos PRÓPRIAS do álbum (sem descer pros filhos) — usada
// pra achar o "álbum mais recente": um álbum tipo "Aleatórios" que vive
// ganhando foto nova de vez em quando precisa contar pela foto mais
// nova, não pela mais velha
function albumOwnLatestDate(id){
  const photos = albumPhotos(id);
  if (!photos.length) return null;
  return photos.reduce((max, p) => (p.data > max ? p.data : max), photos[0].data);
}
function catLabel(id){ return (CATEGORIAS.find(c => c.id === id) || {}).label || id; }
// data mais recente entre todas as fotos do álbum, incluindo sub-álbuns —
// é o que decide a ordem "mais atual primeiro" na vitrine
function albumEffectiveDate(id){
  const photos = albumPhotosRecursive(id);
  if (!photos.length) return null;
  return photos.reduce((max, p) => (p.data > max ? p.data : max), photos[0].data);
}
// mais recente primeiro — quem visita o site quer ver o trabalho atual,
// não cavar até achar
function sortAlbumsByDate(albums){
  return [...albums].sort((a, b) => {
    const da = albumEffectiveDate(a.id), db = albumEffectiveDate(b.id);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(db) - new Date(da);
  });
}
function sortPhotosByDate(photos){
  return [...photos].sort((a, b) => new Date(b.data) - new Date(a.data));
}
function resolveSingleAlbumChain(categoryId){
  if (categoryId === "todos") return [];
  const topAlbums = children(null).filter(a => a.categoria === categoryId);
  if (topAlbums.length !== 1) return [];
  const chain = [topAlbums[0].id];
  let current = topAlbums[0];
  while (true){
    const kids = children(current.id);
    if (kids.length === 1 && !albumPhotos(current.id).length){
      chain.push(kids[0].id);
      current = kids[0];
    } else break;
  }
  return chain;
}

function stampApertures(root = document){
  const tpl = $("#apertureTpl");
  $$(".aperture", root).forEach(el => {
    if (!el.querySelector("svg")) el.appendChild(tpl.content.cloneNode(true));
  });
}

// revela cards ao entrar na tela, em cascata
const cardObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting){
      entry.target.classList.add("in-view");
      cardObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
function observeCards(container){
  $$(".card", container).forEach((el, i) => {
    el.style.transitionDelay = (Math.min(i % 10, 9) * 0.09).toFixed(2) + "s";
    cardObserver.observe(el);
  });
}

// masonry de verdade via JS — CSS columns sozinho "balanceia" pra menos
// colunas do que cabe quando tem poucas fotos (ex: álbum com 6 fotos usa
// só 3 colunas mesmo cabendo 5), deixando buraco enorme do lado. Aqui a
// gente decide quantas colunas cabem e distribui uma a uma, sempre na
// coluna mais curta até agora — garante que usa a largura toda.
const MASONRY_COL_WIDTH = 300, MASONRY_GAP = 22;
function layoutMasonry(container){
  const items = $$(".card", container);
  if (!items.length) return;
  const width = container.clientWidth || container.parentElement.clientWidth;
  const cols = Math.max(1, Math.min(items.length, Math.round((width + MASONRY_GAP) / (MASONRY_COL_WIDTH + MASONRY_GAP))));

  const track = document.createElement("div");
  track.className = "masonry-track";
  const colEls = Array.from({ length: cols }, () => {
    const col = document.createElement("div");
    col.className = "masonry-col";
    track.appendChild(col);
    return col;
  });

  // altura estimada pela proporção declarada no card (ratio real, quando
  // já classificado por applyOrientationClasses; senão assume quadrado)
  const colHeights = new Array(cols).fill(0);
  items.forEach(item => {
    const ratio = item.classList.contains("card--portrait") ? 0.75
      : item.classList.contains("card--landscape") ? 1.333 : 1;
    const estH = MASONRY_COL_WIDTH / ratio;
    let shortest = 0;
    for (let i = 1; i < cols; i++){ if (colHeights[i] < colHeights[shortest]) shortest = i; }
    colEls[shortest].appendChild(item);
    colHeights[shortest] += estH + MASONRY_GAP;
  });

  container.appendChild(track);
}

// fotos verticais ganham moldura vertical, horizontais ganham horizontal
function applyOrientationClasses(root = document){
  $$(".card--photo img", root).forEach(img => {
    const card = img.closest(".card");
    if (!card) return;
    const classify = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const isPortrait = img.naturalHeight > img.naturalWidth;
      card.classList.toggle("card--portrait", isPortrait);
      card.classList.toggle("card--landscape", !isPortrait);
    };
    if (img.complete) classify();
    else img.addEventListener("load", classify, { once: true });
  });
}

// ============================================================
// Cursor autoral
// ============================================================
function initCursor(){
  if (!HAS_FINE_POINTER) return;
  const cursor = $("#cursor");
  let x = window.innerWidth / 2, y = window.innerHeight / 2;
  let cx = x, cy = y;
  window.addEventListener("mousemove", e => {
    x = e.clientX; y = e.clientY;
    cursor.classList.remove("hidden");
  });
  document.addEventListener("mouseleave", () => cursor.classList.add("hidden"));
  const HOVER_SELECTOR = 'a, button, .card, .filter-chip, [data-hover], input, .lightbox__tags span';
  document.addEventListener("mouseover", e => {
    if (e.target.closest(HOVER_SELECTOR)) cursor.classList.add("hovering");
  });
  document.addEventListener("mouseout", e => {
    if (e.target.closest(HOVER_SELECTOR) && !e.relatedTarget?.closest?.(HOVER_SELECTOR)) cursor.classList.remove("hovering");
  });
  let cursorTicking = false;
  function tick(){
    cx += (x - cx) * 0.22; cy += (y - cy) * 0.22;
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    if (Math.abs(x - cx) > 0.1 || Math.abs(y - cy) > 0.1){
      requestAnimationFrame(tick);
    } else {
      cursorTicking = false;
    }
  }
  window.addEventListener("mousemove", () => {
    if (!cursorTicking){ cursorTicking = true; requestAnimationFrame(tick); }
  });
}

// ============================================================
// Botões magnéticos
// ============================================================
function initMagnetic(){
  if (!HAS_FINE_POINTER) return;
  $$("[data-magnetic]").forEach(el => {
    el.addEventListener("mousemove", e => {
      const r = el.getBoundingClientRect();
      const relX = e.clientX - (r.left + r.width / 2);
      const relY = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${relX * 0.35}px, ${relY * 0.45}px)`;
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  });
}

// ============================================================
// Hero — mosaico uniforme (tipo "gota d'água" do site original),
// peças do mesmo tamanho encaixadas lado a lado até completar o
// hero inteiro, sem parar: flutua e troca foto sozinho depois.
// ============================================================
function computeHeroColWidth(){
  return window.innerWidth < 640 ? 130 : 190;
}
// tamanhos variados (retrato/paisagem/quadrada) igual à grade de fotos do
// álbum — masonry de verdade via CSS columns, sem gap, cobrindo o hero
// inteiro de ponta a ponta ("peça encaixa na outra até completar tudo")
const HERO_RATIOS = [3/4, 4/3, 1, 2/3, 3/2, 4/5];

// corrige a peça do mosaico pra proporção REAL da foto assim que ela
// carrega — sem isso, object-fit:cover corta a imagem pra caber numa
// caixa com proporção aleatória (o que não pode: foto sempre inteira)
function matchTileToPhoto(fig){
  const img = fig.querySelector("img");
  if (!img) return;
  const apply = () => {
    if (img.naturalWidth && img.naturalHeight){
      fig.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
  };
  if (img.complete) apply(); else img.addEventListener("load", apply, { once: true });
}

function initHeroMosaic(){
  const el = $("#heroMosaic");
  const pool = PHOTOS.filter(Boolean);
  if (!pool.length) return;
  const colWidth = computeHeroColWidth();
  el.style.setProperty("--hero-colw", colWidth + "px");

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const cols = Math.max(3, Math.round(window.innerWidth / colWidth));
  // preenche até dar mais que a altura da tela (com folga) — melhor sobrar
  // embaixo do que faltar tile e abrir buraco no fim do mosaico
  const targetHeight = window.innerHeight * cols * 1.35;
  el.innerHTML = "";
  const tiles = [];
  // nunca repete foto no mosaico — anda pelo array embaralhado sem
  // módulo, e para de encher se o acervo acabar (não dá voltinha)
  let i = 0, accHeight = 0;
  while (accHeight < targetHeight && i < 500 && i < shuffled.length){
    const p = shuffled[i];
    const estRatio = HERO_RATIOS[Math.floor(Math.random() * HERO_RATIOS.length)];
    const fig = document.createElement("figure");
    fig.className = "hero__tile";
    fig.dataset.photoId = p.id;
    fig.style.aspectRatio = estRatio; // chute inicial só pra estimar quantos tiles cabem
    fig.innerHTML = `<div class="hero__tile-inner" style="--fd:${(5 + Math.random() * 4).toFixed(1)}s; --fdd:${(Math.random() * 3).toFixed(1)}s; --fx:${(Math.random() * 14 - 7).toFixed(0)}px; --fy:${(Math.random() * 14 - 7).toFixed(0)}px;"><img src="${p.src}" alt=""></div>`;
    // assim que a foto carrega, a peça assume a proporção REAL dela —
    // corta zero, foto deitada fica deitada, em pé fica em pé
    matchTileToPhoto(fig);
    el.appendChild(fig);
    tiles.push(fig);
    accHeight += colWidth / estRatio;
    i++;
  }

  // mede a posição real de cada peça DEPOIS do masonry montar (columns não
  // é uma grade limpa como antes) pra calcular a distância até o centro —
  // é isso que faz o efeito "gota d'água" de verdade, vindo do meio
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const maxDist = Math.hypot(cx, cy) || 1;
    const RIPPLE_START = 0.05, RIPPLE_SPREAD = 0.85;
    tiles.forEach(t => {
      const r = t.getBoundingClientRect();
      const tx = (r.left - rect.left) + r.width / 2, ty = (r.top - rect.top) + r.height / 2;
      const dist = Math.hypot(tx - cx, ty - cy) / maxDist;
      t.style.transitionDelay = REDUCE_MOTION ? "0s" : (RIPPLE_START + dist * RIPPLE_SPREAD + Math.random() * 0.1).toFixed(2) + "s";
    });
    requestAnimationFrame(() => tiles.forEach(t => t.classList.add("in-view")));
  });

  const logoDelayMs = 1400;
  setTimeout(() => {
    $("#heroContent").classList.add("is-visible");
    playLogoReveal();
  }, REDUCE_MOTION ? 0 : logoDelayMs);

  if (REDUCE_MOTION) return;
  const heroEl = $("#inicio");
  // troca fotos aos poucos em tiles aleatórios — mantém o mosaico vivo sem
  // nunca ficar igual E sem nunca repetir foto entre dois tiles ao mesmo
  // tempo (só entram fotos que não estão em nenhum outro tile agora)
  setInterval(() => {
    if (!heroEl || heroEl.getBoundingClientRect().bottom < 0) return; // fora da tela, poupa trabalho
    const n = Math.max(1, Math.round(tiles.length * 0.06));
    const tileOrder = [...tiles.keys()].sort(() => Math.random() - 0.5).slice(0, n);
    const displayedIds = new Set(tiles.map(t => t.dataset.photoId));
    const available = shuffled.filter(p => !displayedIds.has(p.id)).sort(() => Math.random() - 0.5);
    let ai = 0;
    tileOrder.forEach(idx => {
      if (ai >= available.length) return; // acabaram as fotos livres pra essa rodada
      const tile = tiles[idx];
      const img = tile.querySelector("img");
      if (!img) return;
      const next = available[ai++];
      tile.dataset.photoId = next.id;
      img.classList.add("is-fading");
      setTimeout(() => {
        img.src = next.src;
        img.classList.remove("is-fading");
        matchTileToPhoto(tile);
      }, 500);
    });
  }, 1400);
}

// ------------------------------------------------------------
// Logo — recorte quadro a quadro: fatia a logo em tiras e cada uma
// "bate" no lugar em sequência, tipo frame de filme, nada de fade.
// ------------------------------------------------------------
const LOGO_STRIPS = 7;
function buildLogoStrips(){
  const stage = $("#heroLogoStage");
  const original = stage.querySelector("img.hero__logo");
  if (!original) return;
  const src = original.getAttribute("src"), alt = original.getAttribute("alt");
  const setup = () => {
    const ratio = original.naturalWidth && original.naturalHeight ? original.naturalWidth / original.naturalHeight : 3.4;
    stage.style.aspectRatio = ratio.toFixed(3);
    stage.innerHTML = "";
    for (let i = 0; i < LOGO_STRIPS; i++){
      const img = document.createElement("img");
      img.src = src; img.alt = i === 0 ? alt : "";
      img.className = "hero__logo hero__logo-strip";
      const top = (i / LOGO_STRIPS) * 100, bottom = 100 - ((i + 1) / LOGO_STRIPS) * 100;
      img.style.clipPath = `inset(${top.toFixed(2)}% 0 ${bottom.toFixed(2)}% 0)`;
      img.style.setProperty("--sd", (i * 0.11).toFixed(2) + "s");
      stage.appendChild(img);
    }
  };
  if (original.complete && original.naturalWidth) setup();
  else original.addEventListener("load", setup, { once: true });
}
function playLogoReveal(){
  const wrap = $("#heroLogoWrap");
  if (wrap) wrap.classList.add("play");
}

function initHero(){
  buildLogoStrips();
  initHeroMosaic();
}

// ============================================================
// Nav
// ============================================================
const nav = $("#nav");
const navToggle = $("#navToggle");
const navLinks = $("#navLinks");

window.addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", window.scrollY > 40);
}, { passive: true });

navToggle.addEventListener("click", () => {
  navToggle.classList.toggle("open");
  navLinks.classList.toggle("open");
});
$$("#navLinks a").forEach(a => a.addEventListener("click", () => {
  navToggle.classList.remove("open");
  navLinks.classList.remove("open");
}));

// ============================================================
// Mural (álbuns aninhados)
// ============================================================
const muralGrid = $("#muralGrid");
const folderZone = $("#folderZone");
const photosDividerLabel = $("#photosDividerLabel");
const breadcrumbEl = $("#navAlbum");
const searchInput = $("#searchInput");
const searchClear = $("#searchClear");

let activeCategory = "todos";
let searchQuery = "";
let navStack = [];

// ============================================================
// Navegação por URL — cada álbum tem seu próprio endereço
// (#/album-id), então o botão voltar do navegador funciona, dá pra
// atualizar a página sem se perder, e dá pra mandar o link direto de
// um álbum. Sem isso tudo acontecia só "por dentro" da mesma página.
// ============================================================
function albumIdFromHash(){
  const m = location.hash.match(/^#\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function applyRoute(albumId, { scroll = true } = {}){
  navStack = albumId && getAlbum(albumId) ? breadcrumbFor(albumId).map(a => a.id) : [];
  searchQuery = "";
  if (searchInput) searchInput.value = "";
  renderMural();
  renderLatestAlbum();
  if (scroll) $(".board").scrollIntoView({ behavior: "smooth", block: "start" });
}

// usado por qualquer clique que leva pra dentro de um álbum — troca o
// endereço (o que já cria uma parada no histórico do navegador sozinho)
function goToAlbum(albumId){
  const target = albumId ? `#/${albumId}` : "";
  if ((location.hash || "") === target){ applyRoute(albumId); return; }
  location.hash = target;
}

window.addEventListener("hashchange", () => applyRoute(albumIdFromHash()));

function photoMatchesCategory(p, categoryId){
  if (categoryId === "todos") return true;
  const album = getAlbum(p.album);
  if (album && album.categoria === categoryId) return true;
  return (p.tags || []).includes(categoryId);
}

// tira acento pra "julia" achar "Júlia" — gente digita sem acento o tempo todo
function normalizeSearch(s){
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesSearch(p, query){
  if (!query) return true;
  const q = normalizeSearch(query.trim());
  const album = getAlbum(p.album);
  const haystack = normalizeSearch([
    p.titulo, p.local, ...(p.tags || []),
    album ? album.titulo : "", album ? album.subtitulo : "",
  ].join(" "));
  return haystack.includes(q);
}

// header simples: "← Voltar" + título do álbum atual — nada de trilha de
// migalhas (a maioria dos álbuns só tem 1 nível de profundidade mesmo)
function renderBreadcrumb(){
  if (searchQuery){
    breadcrumbEl.innerHTML = `<h3 class="nav__album__title">Resultados da busca "${searchQuery}"</h3>`;
    return;
  }
  if (!navStack.length){
    breadcrumbEl.innerHTML = "";
    return;
  }
  const current = getAlbum(navStack[navStack.length - 1]);
  breadcrumbEl.innerHTML = `
    <button class="nav__album__back" id="navAlbumBack" data-hover>← Voltar</button>
    <h3 class="nav__album__title">${albumDisplayName(current)}${current.subtitulo ? " — " + current.subtitulo : ""}</h3>
  `;
  $("#navAlbumBack").addEventListener("click", () => {
    const target = navStack.length > 1 ? navStack[navStack.length - 2] : null;
    goToAlbum(target);
  });
}

function isMobileView(){ return window.innerWidth <= 780; }

function renderMural(){
  renderBreadcrumb();
  folderZone.innerHTML = "";
  photosDividerLabel.style.display = "none";
  muralGrid.className = "card-grid";

  const openAlbumId = navStack.length ? navStack[navStack.length - 1] : null;
  if (openAlbumId !== muralBgAlbumId){
    muralBgAlbumId = openAlbumId;
    setMuralBackground(openAlbumId);
  }

  if (searchQuery){
    // busca filtra ÁLBUNS (igual a listagem normal), não uma parede de
    // fotos soltas — digitar "bru" já mostra o álbum "Bruna Viola"
    searchClear.style.display = "inline";
    muralGrid.className = "card-grid";
    muralGrid.innerHTML = "";
    const matches = ALBUMS
      .filter(a => albumPhotos(a.id).length > 0)
      .filter(a => {
        const titleHay = `${a.titulo} ${a.subtitulo || ""}`.toLowerCase();
        if (titleHay.includes(searchQuery.trim().toLowerCase())) return true;
        return albumPhotos(a.id).some(p => matchesSearch(p, searchQuery));
      });
    const matchesOrdenados = sortAlbumsByDate(matches);

    if (!matches.length){
      folderZone.innerHTML = `<p class="no-results">Nenhum álbum encontrado para "${searchQuery}".</p>`;
      return;
    }
    folderZone.innerHTML = `
      <div class="card-grid card-grid--albums card-grid--top">
        ${matchesOrdenados.map(a => albumCardHTML(a)).join("")}
      </div>
    `;
    stampApertures(folderZone);
    observeCards(folderZone);
    wireAdminAlbumDelete(folderZone);
    wireAdminAlbumCategory(folderZone);
    $$(".card", folderZone).forEach(el => {
      el.addEventListener("click", () => goToAlbum(el.dataset.id));
    });
    return;
  }
  searchClear.style.display = "none";

  if (isMobileView()){
    const currentParent = navStack.length ? navStack[navStack.length - 1] : null;
    const items = currentParent
      ? albumPhotosRecursive(currentParent)
      : PHOTOS.filter(p => photoMatchesCategory(p, activeCategory));
    if (!items.length){
      muralGrid.innerHTML = `<p class="no-results">Nenhuma foto nesta categoria ainda.</p>`;
      return;
    }
    const MOBILE_PREVIEW_LIMIT = 3;
    const groups = [];
    const byAlbum = new Map();
    items.forEach(p => {
      if (!byAlbum.has(p.album)) { byAlbum.set(p.album, { album: getAlbum(p.album), photos: [] }); groups.push(byAlbum.get(p.album)); }
      byAlbum.get(p.album).photos.push(p);
    });
    // mais recente primeiro, tanto o álbum quanto as fotos dentro dele
    groups.forEach(g => { g.photos = sortPhotosByDate(g.photos); });
    groups.sort((a, b) => new Date(b.photos[0].data) - new Date(a.photos[0].data));
    const showTitles = groups.length > 1;

    muralGrid.innerHTML = groups.map(g => {
      const shown = g.photos.slice(0, MOBILE_PREVIEW_LIMIT);
      const rest = g.photos.length - shown.length;
      return `
        <div class="mobile-album-block" data-group="${g.album ? g.album.id : ""}">
          ${showTitles && g.album ? (() => {
            const parent = g.album.parent ? getAlbum(g.album.parent) : null;
            const parentLabel = parent ? albumDisplayName(parent) : "";
            const ownTitle = parent ? g.album.titulo : albumDisplayName(g.album);
            return `<p class="mobile-album-block__title">${parentLabel ? `<span class="mobile-album-block__parent">${parentLabel}</span>` : ""}${ownTitle}${g.album.subtitulo ? " — " + g.album.subtitulo : ""}</p>`;
          })() : ""}
          <div class="mobile-album-block__frames">${shown.map(p => photoCardHTML(p)).join("")}</div>
          ${rest > 0 ? `<button class="mobile-album-block__more" data-group="${g.album ? g.album.id : ""}" data-hover>Ver mais ${rest} foto${rest === 1 ? "" : "s"} <span class="aperture"></span></button>` : ""}
        </div>`;
    }).join("");
    stampApertures(muralGrid);
    observeCards(muralGrid);
    applyOrientationClasses(muralGrid);

    $$(".mobile-album-block", muralGrid).forEach(block => {
      const g = groups.find(x => (x.album ? x.album.id : "") === block.dataset.group);
      if (!g) return;
      $$(".card", block).forEach(el => {
        el.addEventListener("click", () => openLightbox(g.photos, g.photos.findIndex(p => p.id === el.dataset.id)));
      });
      const moreBtn = $(".mobile-album-block__more", block);
      if (moreBtn) moreBtn.addEventListener("click", () => openLightbox(g.photos, Math.min(MOBILE_PREVIEW_LIMIT, g.photos.length - 1)));
    });
    return;
  }

  const currentParent = navStack.length ? navStack[navStack.length - 1] : null;
  // raiz: só álbuns de topo (sem album_pai) — eventos com vários sub-álbuns
  // (Drone, Festa de Santa Rita, Feirão Folclórico) viram 1 card-pasta em
  // vez de espalhar cada sub-álbum solto na vitrine. Álbuns de pessoa não
  // têm pai, então continuam aparecendo soltos igual antes. A busca não
  // usa esse filtro — continua achando qualquer álbum, de qualquer nível.
  let childAlbums = currentParent === null
    ? sortAlbumsByDate(ALBUMS.filter(a => a.parent === null && albumHasContent(a.id)))
    : sortAlbumsByDate(children(currentParent));
  const ownPhotos = currentParent ? sortPhotosByDate(albumPhotos(currentParent)) : [];

  if (childAlbums.length){
    // na raiz agrupa por categoria (tipo de trabalho) em vez de uma vitrine
    // só — assim dá pra folhear "Retratos" à parte de "Festas", por ex.,
    // e faz sentido um álbum de 1 foto ao lado de um de 30 dentro do mesmo grupo
    const albumsHTML = currentParent === null
      ? (() => {
          const groups = new Map();
          childAlbums.forEach(a => {
            const key = a.categoria || "";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(a);
          });
          const sortedKeys = [...groups.keys()].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR"));
          return sortedKeys.map(key => `
            <p class="mural-divider mural-divider--category">${categoryLabel(key)}</p>
            <div class="card-grid card-grid--albums card-grid--top" style="margin-bottom: 2.4rem;">
              ${groups.get(key).map(a => albumCardHTML(a)).join("")}
            </div>
          `).join("")
        })()
      : `
        <div class="card-grid card-grid--albums" style="margin-bottom: ${ownPhotos.length ? "2rem" : "0"};">
          ${childAlbums.map(a => albumCardHTML(a)).join("")}
        </div>
      `;
    folderZone.innerHTML = `
      ${ownPhotos.length ? `<p class="mural-divider">Álbuns dentro deste álbum</p>` : ""}
      ${albumsHTML}
    `;
    stampApertures(folderZone);
    observeCards(folderZone);
    wireAdminAlbumDelete(folderZone);
    wireAdminAlbumCategory(folderZone);
    $$(".card", folderZone).forEach(el => {
      el.addEventListener("click", () => goToAlbum(el.dataset.id));
    });
  }

  if (ownPhotos.length){
    if (childAlbums.length) photosDividerLabel.style.display = "inline-block";
    muralGrid.className = "card-grid card-grid--photos";
    muralGrid.innerHTML = ownPhotos.map(p => photoCardHTML(p)).join("");
    applyOrientationClasses(muralGrid);
    layoutMasonry(muralGrid);
    observeCards(muralGrid);
    $$(".card", muralGrid).forEach(el => {
      el.addEventListener("click", () => openLightbox(ownPhotos, ownPhotos.findIndex(p => p.id === el.dataset.id)));
    });
  } else if (!childAlbums.length){
    muralGrid.innerHTML = currentParent
      ? `<p class="no-results">Este álbum ainda não tem fotos.</p>`
      : `<p class="no-results">Nenhum álbum ainda.</p>`;
  } else {
    muralGrid.innerHTML = "";
  }

  // botão de subir foto — só faz sentido com um álbum de destino claro,
  // então só aparece quando o admin está dentro de um álbum específico
  let uploadZone = $("#adminUploadZone");
  if (!uploadZone){
    uploadZone = document.createElement("div");
    uploadZone.id = "adminUploadZone";
    uploadZone.className = "admin-only admin-upload";
    $(".board").appendChild(uploadZone);
  }
  if (currentParent){
    const album = getAlbum(currentParent);
    uploadZone.innerHTML = `
      <label class="admin-btn admin-upload__btn" data-hover>
        + Subir foto pra "${album.titulo}"
        <input type="file" accept="image/*" id="adminUploadInput" hidden>
      </label>
      <span class="admin-upload__status" id="adminUploadStatus"></span>
    `;
    wireAdminUpload(currentParent);
  } else {
    uploadZone.innerHTML = "";
  }
}

// ============================================================
// Álbum mais recente (destaque antes da grade) — o de data mais
// atual, não o "atualizado por último"
// ============================================================
function renderLatestAlbum(){
  const el = $("#latestAlbum");
  if (!el) return;
  const candidates = ALBUMS
    .filter(a => albumPhotos(a.id).length > 0)
    .map(a => ({ album: a, date: albumOwnLatestDate(a.id) }))
    .filter(x => x.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!candidates.length){ el.innerHTML = ""; return; }

  // resolve cada candidato pro álbum-pai (o evento inteiro, não o
  // pedacinho — "Banda" sozinho não diz nada, "Feirão Folclórico 2026"
  // diz) e pega os 2 mais recentes sem repetir o mesmo pai
  const seen = new Set();
  const featured = [];
  for (const { album: leaf, date } of candidates){
    const a = leaf.parent ? getAlbum(leaf.parent) : leaf;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    featured.push({ a, date });
    if (featured.length === 2) break;
  }

  // mais recente sempre na esquerda
  el.innerHTML = `<div class="latest-album__row">${featured.map(({ a, date }, i) => {
    const parent = a.parent ? getAlbum(a.parent) : null;
    const parentLabel = parent ? albumDisplayName(parent) : "";
    const count = albumPhotosRecursive(a.id).length;
    const displayTitle = albumDisplayName(a);
    return `
      <figure class="card latest-album__card" data-id="${a.id}" data-hover>
        <div class="card__media"><img src="${a.cover}" alt="${a.titulo}" loading="lazy"></div>
        <div class="card__overlay latest-album__overlay">
          <p class="latest-album__eyebrow">${i === 0 ? "Álbum mais recente" : "Também novo"}</p>
          ${parentLabel ? `<p class="card__parent">${parentLabel}</p>` : ""}
          <h3 class="latest-album__title">${displayTitle}${a.subtitulo ? " — " + a.subtitulo : ""}</h3>
          <p class="latest-album__date">${formatDateLong(date)} · ${count} foto${count === 1 ? "" : "s"}</p>
        </div>
      </figure>
    `;
  }).join("")}</div>`;

  stampApertures(el);
  observeCards(el);
  $$(".card", el).forEach(card => {
    card.addEventListener("click", () => goToAlbum(card.dataset.id));
  });
}

function albumCardHTML(a){
  const kids = children(a.id);
  const isFolder = kids.length > 0;
  const count = isFolder ? kids.length : albumPhotos(a.id).length;
  const countLabel = isFolder ? `${count} álbum${count === 1 ? "" : "s"}` : `${count} foto${count === 1 ? "" : "s"}`;
  // sem a árvore de navegação, o card precisa dizer sozinho de onde é —
  // "Júlia" sem contexto não diz nada; "Júlia" + "Maquiagem" diz
  const parent = a.parent ? getAlbum(a.parent) : null;
  const parentLabel = parent ? albumDisplayName(parent) : "";
  // pastas-evento (Festa de Santa Rita 2025 vs 2026, por ex.) têm o mesmo
  // título e só se diferenciam pelo subtitulo — sem isso viravam 2 cards
  // idênticos na vitrine
  let titleText = isFolder && a.subtitulo ? `${a.titulo} — ${a.subtitulo}` : a.titulo;
  // "2026" sozinho nunca é suficiente, nem dentro da vitrine agrupada —
  // sempre carimba o nome do evento junto ("Festa de Santa Rita 2026")
  if (/^\d{4}$/.test(a.titulo)) titleText = albumDisplayName(a);
  // só álbum de topo tem seletor de categoria — é o que decide o grupo
  // dele na vitrine principal; sub-álbum vive dentro da pasta do pai
  const categorySelect = !a.parent ? (() => {
    const known = new Set(Object.keys(CATEGORY_LABELS));
    if (a.categoria) known.add(a.categoria);
    const opts = [...known].sort((x, y) => categoryLabel(x).localeCompare(categoryLabel(y), "pt-BR"))
      .map(k => `<option value="${k}" ${a.categoria === k ? "selected" : ""}>${categoryLabel(k)}</option>`).join("");
    return `
      <select class="admin-only card__admin-category" data-album-category="${a.id}" data-hover title="Mudar categoria">
        ${opts}
        <option value="__nova__">+ Nova categoria…</option>
      </select>
    `;
  })() : "";
  return `
    <figure class="card" data-id="${a.id}" data-hover>
      <button class="admin-only card__admin-delete" data-album-delete="${a.id}" title="Apagar álbum" data-hover>🗑</button>
      ${categorySelect}
      <div class="card__media"><img src="${a.cover}" alt="${a.titulo}" loading="lazy"></div>
      <div class="card__overlay">
        ${parentLabel ? `<p class="card__parent">${parentLabel}</p>` : ""}
        <div class="card__row">
          <h3 class="card__title">${titleText}</h3>
          <span class="card__count">${countLabel}</span>
        </div>
      </div>
    </figure>
  `;
}

// liga o seletor de categoria (só em álbum de topo, só aparece em modo admin)
function wireAdminAlbumCategory(container){
  $$("[data-album-category]", container).forEach(sel => {
    sel.addEventListener("click", e => e.stopPropagation());
    sel.addEventListener("change", async () => {
      const albumId = sel.dataset.albumCategory;
      let categoria = sel.value;
      if (categoria === "__nova__"){
        const nome = prompt("Nome da categoria nova:");
        if (!nome || !nome.trim()){ renderMural(); return; }
        categoria = nome.trim().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
        if (!CATEGORY_LABELS[categoria]) CATEGORY_LABELS[categoria] = nome.trim();
      }
      try {
        await adminCall("set-category", { albumId, categoria });
        const album = getAlbum(albumId);
        if (album) album.categoria = categoria;
        renderMural();
      } catch (err){
        alert("Não deu: " + err.message);
        renderMural();
      }
    });
  });
}

// liga o botão de apagar álbum (fica escondido até entrar no modo admin)
function wireAdminAlbumDelete(container){
  $$("[data-album-delete]", container).forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      adminDeleteAlbum(btn.dataset.albumDelete, () => renderMural());
    });
  });
}

function photoCardHTML(p){
  const dateText = p.legenda ? `${formatDateShort(p.data)} — ${p.legenda}` : formatDateShort(p.data);
  return `
    <figure class="card card--photo" data-id="${p.id}" data-hover>
      <div class="card__media"><img src="${p.src}" alt="${p.titulo}" loading="lazy"></div>
      <div class="card__overlay"><span class="card__date">${dateText}</span></div>
    </figure>
  `;
}

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  renderMural();
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && searchQuery.trim()){
    e.preventDefault();
    searchInput.blur();
    $(".board").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  renderMural();
});

// ============================================================
// Linha do tempo
// ============================================================
// faixa horizontal e infinita, do álbum mais antigo pro mais recente —
// substitui os cards parados por algo que rola sozinho, tipo Apple
function renderTimeline(){
  const track = $("#filmstripTrack");
  // todo álbum que tem foto própria vira uma entrada — não só os de topo.
  // álbum-pasta (ex: "Drone", que só existe pra organizar sub-álbuns e não
  // tem foto direta) fica de fora sozinho, mas cada filho dele entra com a
  // própria data — assim nada fica escondido dentro do pai
  const dated = ALBUMS
    .filter(a => albumPhotos(a.id).length > 0)
    .map(a => ({ album: a, date: albumOwnDate(a.id) }))
    .filter(x => x.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // do começo até a data mais atual

  if (!dated.length){ track.innerHTML = ""; return; }

  let lastYear = null;
  const reels = [];
  dated.forEach(({ album: a, date }) => {
    const year = date.slice(0, 4);
    if (year !== lastYear){
      reels.push(`<div class="filmreel filmreel--marker"><span class="filmreel__year">${year}</span></div>`);
      lastYear = year;
    }
    const count = albumPhotos(a.id).length;
    reels.push(`
      <figure class="filmreel" data-id="${a.id}" data-hover>
        <img src="${a.cover}" alt="${a.titulo}" loading="lazy">
        <figcaption class="filmreel__cap">
          <p class="filmreel__title">${albumDisplayName(a)} (${count} foto${count === 1 ? "" : "s"})</p>
          <p class="filmreel__date">${formatDateShort(date)}</p>
        </figcaption>
      </figure>
    `);
  });

  // duplica a sequência pra loop sem costura (a animação anda 50% e volta pro início igualzinho)
  track.innerHTML = reels.join("") + reels.join("");

  filmstripSingleWidth = track.scrollWidth / 2;
  filmstripOffset = 0;
  track.style.transform = "translateX(0px)";

  $$(".filmreel[data-id]", track).forEach(reel => {
    reel.addEventListener("click", () => goToAlbum(reel.dataset.id));
  });
}

// posição da trilha (px, sempre <= 0) controlada em rAF — dá pra pausar no
// hover e pular com as setas sem brigar com uma animação CSS por baixo
let filmstripSingleWidth = 0;
let filmstripOffset = 0;
let filmstripHover = false;
let filmstripFreezeUntil = 0;
const FILMSTRIP_SPEED = 40; // px/s

function initFilmstripNav(){
  const wrap = $(".filmstrip-wrap");
  const track = $("#filmstripTrack");
  const prevBtn = $("#filmstripPrev");
  const nextBtn = $("#filmstripNext");
  if (!wrap || !track || !prevBtn || !nextBtn) return;

  wrap.addEventListener("mouseenter", () => { filmstripHover = true; });
  wrap.addEventListener("mouseleave", () => { filmstripHover = false; });

  function jump(dir){
    if (!filmstripSingleWidth) return;
    const step = 3 * (340 + 14); // ~3 álbuns por clique
    if (dir === "next"){
      filmstripOffset -= step;
      if (filmstripOffset <= -filmstripSingleWidth) filmstripOffset += filmstripSingleWidth;
    } else {
      filmstripOffset += step;
      if (filmstripOffset > 0) filmstripOffset -= filmstripSingleWidth;
    }
    track.style.transition = "transform .5s var(--ease-soft)";
    track.style.transform = `translateX(${filmstripOffset}px)`;
    filmstripFreezeUntil = performance.now() + 2600;
    setTimeout(() => { track.style.transition = ""; }, 520);
  }
  prevBtn.addEventListener("click", () => jump("prev"));
  nextBtn.addEventListener("click", () => jump("next"));

  let lastTs = null;
  function tick(ts){
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (filmstripSingleWidth > 0 && !REDUCE_MOTION && !filmstripHover && ts > filmstripFreezeUntil){
      filmstripOffset -= FILMSTRIP_SPEED * dt;
      if (filmstripOffset <= -filmstripSingleWidth) filmstripOffset += filmstripSingleWidth;
      track.style.transform = `translateX(${filmstripOffset}px)`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
// Lightbox
// ============================================================
const lightbox = $("#lightbox");
const lbStage = $("#lbStage");
const lbImgWrap = $("#lbImgWrap");
const lbImg = $("#lbImg");
const lbCounter = $("#lbCounter");
const lbAlbumTitle = $("#lbAlbumTitle");
const lbDate = $("#lbDate");
const lbLocal = $("#lbLocal");
const lbTreeList = $("#lbTreeList");
const lbTags = $("#lbTags");
const lbDownload = $("#lbDownload");
let lbItems = [];
let lbIndex = 0;

// baixar sempre passa pela foto já com marca d'água — é a única imagem
// que existe no site, não tem versão "limpa" pública em lugar nenhum
lbDownload.addEventListener("click", () => {
  const p = lbItems[lbIndex];
  if (!p) return;
  const a = document.createElement("a");
  a.href = p.src;
  a.download = p.src.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
});
$("#lbSetCover").addEventListener("click", () => {
  const p = lbItems[lbIndex];
  if (p) adminSetCover(p.album, p.id);
});
$("#lbDeletePhoto").addEventListener("click", () => {
  const p = lbItems[lbIndex];
  if (!p) return;
  adminDeletePhoto(p.id, () => { closeLightbox(); renderMural(); renderLatestAlbum(); });
});

function openLightbox(items, index){
  lbItems = items;
  lbIndex = index;
  updateLightbox();
  lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
}

function updateLightbox(){
  const p = lbItems[lbIndex];
  lbImgWrap.classList.remove("zoomed");
  lbStage.classList.remove("zoomed");
  lbImg.style.opacity = "0";
  const swapSrc = () => {
    lbImg.src = p.src;
    lbImg.alt = p.titulo;
  };
  if (lbImg.complete) requestAnimationFrame(swapSrc); else swapSrc();
  lbImg.onload = () => { lbImg.style.opacity = "1"; };
  lbCounter.textContent = `${lbIndex + 1} / ${lbItems.length}`;
  lbDate.textContent = formatDateLong(p.data);
  lbLocal.textContent = p.local || "";

  const chain = breadcrumbFor(p.album);
  lbAlbumTitle.textContent = albumDisplayName(chain[chain.length - 1]);

  lbTreeList.innerHTML = chain.map((a, i) => `
    <div class="lightbox__tree-item ${i === chain.length - 1 ? "is-current" : ""}" style="--depth:${i};">
      <button data-id="${a.id}">${albumDisplayName(a)}</button>
    </div>
  `).join("");
  $$("button", lbTreeList).forEach(btn => {
    btn.addEventListener("click", () => {
      closeLightbox();
      goToAlbum(btn.dataset.id);
    });
  });

  lbTags.innerHTML = (p.tags || []).map(t => `<span data-tag="${t}">#${t}</span>`).join("");
  $$("span", lbTags).forEach(chip => {
    chip.addEventListener("click", () => {
      closeLightbox();
      navStack = [];
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      activeCategory = "todos";
      searchInput.value = chip.dataset.tag;
      searchQuery = chip.dataset.tag;
      renderMural();
      $(".board").scrollIntoView({ behavior: "smooth" });
    });
  });
}

lbImgWrap.addEventListener("click", () => {
  lbImgWrap.classList.toggle("zoomed");
  lbStage.classList.toggle("zoomed", lbImgWrap.classList.contains("zoomed"));
});

function closeLightbox(){
  lightbox.classList.remove("open");
  lbImgWrap.classList.remove("zoomed");
  document.body.style.overflow = "";
}

$("#lbClose").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLightbox(); });
$("#lbPrev").addEventListener("click", () => { lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length; updateLightbox(); });
$("#lbNext").addEventListener("click", () => { lbIndex = (lbIndex + 1) % lbItems.length; updateLightbox(); });

document.addEventListener("keydown", e => {
  if (!lightbox.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") $("#lbPrev").click();
  if (e.key === "ArrowRight") $("#lbNext").click();
});

let touchStartX = null, touchStartY = null;
lbStage.addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
lbStage.addEventListener("touchend", e => {
  if (touchStartX === null || lbImgWrap.classList.contains("zoomed")) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5){
    dx < 0 ? $("#lbNext").click() : $("#lbPrev").click();
  }
  touchStartX = null; touchStartY = null;
}, { passive: true });

// ============================================================
// Sobre mim
// ============================================================
$("#sobreTexto").textContent = SOBRE_MIM_TEXTO;

// ============================================================
// Redes sociais — vem da aba "Config" da planilha. Enquanto o campo
// estiver vazio, mantém o link inerte (sem pular pro topo da página).
// ============================================================
const socialLinks = {
  "#socialInstagram": CONTATO && CONTATO.instagram,
  "#socialWhatsapp": CONTATO && CONTATO.whatsapp,
  "#socialEmail": CONTATO && CONTATO.email ? `mailto:${CONTATO.email}` : "",
};
Object.entries(socialLinks).forEach(([sel, href]) => {
  const el = $(sel);
  if (!el) return;
  if (href){
    el.href = href;
    el.target = "_blank";
    el.rel = "noopener";
  } else {
    el.addEventListener("click", e => e.preventDefault());
  }
});

// ============================================================
// Barra inferior (celular)
// ============================================================
const tabbarItems = $$(".mobile-tabbar__item");
if (tabbarItems.length){
  const tabSections = ["inicio", "mural", "tempo", "sobre"]
    .map(id => document.getElementById(id))
    .filter(Boolean);

  const tabObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting){
        const id = entry.target.id;
        tabbarItems.forEach(item => item.classList.toggle("active", item.dataset.tab === id));
      }
    });
  }, { threshold: 0.4 });

  tabSections.forEach(sec => tabObserver.observe(sec));
}

// ============================================================
// Recalcula ao redimensionar
// ============================================================
let lastWasMobile = isMobileView();
let resizeTimer = null;
let lastHeroColWidth = computeHeroColWidth();
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nowMobile = isMobileView();
    if (nowMobile !== lastWasMobile){
      lastWasMobile = nowMobile;
      renderMural();
    }
    const nextColWidth = computeHeroColWidth();
    if (nextColWidth !== lastHeroColWidth){
      lastHeroColWidth = nextColWidth;
      initHeroMosaic();
    }
  }, 200);
});

// ============================================================
// Scroll reveal
// ============================================================
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting){
      entry.target.classList.add("is-visible");
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

function observeReveals(){ $$(".reveal").forEach(el => io.observe(el)); }

// ============================================================
// Fotos de fundo com parallax — todas as seções, não só o hero
// ============================================================
function initSectionBackgrounds(){
  const targets = [
    { id: "tempoBg", from: PHOTOS.slice().sort(() => Math.random() - 0.5) },
    { id: "sobreBg", from: PHOTOS.slice().sort(() => Math.random() - 0.5) },
    { id: "contatoBg", from: PHOTOS.slice().sort(() => Math.random() - 0.5) },
  ];
  targets.forEach(({ id, from }) => {
    const el = document.getElementById(id);
    const photo = from[0];
    if (!el || !photo) return;
    const img = document.createElement("img");
    img.src = photo.src; img.alt = ""; img.loading = "lazy";
    el.appendChild(img);
  });
  setMuralBackground(null);
}

// ------------------------------------------------------------
// Fundo do mural é sempre do álbum que tá aberto — troca pra outra foto
// do mesmo álbum conforme a pessoa rola a página (não fica parado)
// ------------------------------------------------------------
let muralBgPool = [];
let muralBgIndex = 0;
let muralBgLastSwapY = null;
let muralBgAlbumId = undefined;

function setMuralBackground(albumId){
  const pool = albumId ? albumPhotosRecursive(albumId) : PHOTOS;
  muralBgPool = [...(pool.length ? pool : PHOTOS)].sort(() => Math.random() - 0.5).slice(0, 8);
  muralBgIndex = 0;
  muralBgLastSwapY = null;
  const el = document.getElementById("muralBg");
  if (!el || !muralBgPool.length) return;
  let img = el.querySelector("img");
  if (!img){ img = document.createElement("img"); img.loading = "lazy"; el.appendChild(img); el.dataset.ready = "1"; }
  img.style.opacity = 1;
  img.src = muralBgPool[0].src;
}

function initParallax(){
  const layers = $$(".section__bg img");
  if (!layers.length || REDUCE_MOTION) return;
  const muralSection = document.getElementById("mural");
  function tick(){
    const vh = window.innerHeight;
    layers.forEach(img => {
      const rect = img.parentElement.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      const center = rect.top + rect.height / 2;
      const dist = (center - vh / 2) / vh;
      img.style.transform = `translateY(${(dist * 70).toFixed(1)}px)`;
    });

    if (muralSection && muralBgPool.length > 1){
      const r = muralSection.getBoundingClientRect();
      const scrolled = -r.top;
      if (r.top < vh && r.bottom > 0){
        if (muralBgLastSwapY === null) muralBgLastSwapY = scrolled;
        else if (Math.abs(scrolled - muralBgLastSwapY) > 650){
          muralBgLastSwapY = scrolled;
          muralBgIndex = (muralBgIndex + 1) % muralBgPool.length;
          const img = document.querySelector("#muralBg img");
          const next = muralBgPool[muralBgIndex];
          if (img && next){
            img.style.opacity = 0;
            setTimeout(() => { img.src = next.src; img.style.opacity = 1; }, 260);
          }
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// hover na logo do hero: some ela e o degradê, revelando o mosaico puro
// atrás — só pra quem tem mouse de verdade (em touch não existe hover)
function initHeroPeek(){
  const hero = $("#inicio");
  const logoWrap = $("#heroLogoWrap");
  if (!hero || !logoWrap || !HAS_FINE_POINTER) return;
  logoWrap.addEventListener("mouseenter", () => hero.classList.add("hero--peek"));
  logoWrap.addEventListener("mouseleave", () => hero.classList.remove("hero--peek"));
}

// bloqueia clique-direito ("salvar imagem como...") e arrastar em
// qualquer foto do site — a única forma de baixar é pelo botão "Baixar
// foto" do lightbox, que já entrega a versão com marca d'água
document.addEventListener("contextmenu", e => {
  if (e.target.tagName === "IMG") e.preventDefault();
});
document.addEventListener("dragstart", e => {
  if (e.target.tagName === "IMG") e.preventDefault();
});

// ============================================================
// Painel de admin — login por senha, apagar foto/álbum e trocar capa
// direto do site. A função que confere a senha e mexe nos arquivos de
// verdade roda escondida no Netlify — só funciona no site publicado;
// no teste local (localhost) dá erro de rede, e é esperado.
// ============================================================
const ADMIN_ENDPOINT = "/.netlify/functions/admin";
let adminPassword = sessionStorage.getItem("adminPassword") || null;

async function adminCall(action, params){
  const res = await fetch(ADMIN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword, action, ...params }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* resposta vazia */ }
  if (!res.ok) throw new Error(data.error || `Não deu — o site publicado precisa estar no ar (HTTP ${res.status}).`);
  return data;
}

function setAdminMode(on){
  document.body.classList.toggle("admin-mode", on);
  $("#adminBar").style.display = on ? "flex" : "none";
  renderMural();
  renderLatestAlbum();
}

function openAdminModal(){
  $("#adminModal").classList.add("open");
  $("#adminModalError").style.display = "none";
  $("#adminPasswordInput").value = "";
  $("#adminPasswordInput").focus();
}
function closeAdminModal(){ $("#adminModal").classList.remove("open"); }

$("#adminTrigger").addEventListener("click", openAdminModal);
$("#adminModalClose").addEventListener("click", closeAdminModal);
$("#adminModal").addEventListener("click", (e) => { if (e.target.id === "adminModal") closeAdminModal(); });
$("#adminPasswordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#adminLoginBtn").click(); });

$("#adminLoginBtn").addEventListener("click", async () => {
  const pass = $("#adminPasswordInput").value;
  if (!pass) return;
  const btn = $("#adminLoginBtn");
  btn.disabled = true; btn.textContent = "Entrando...";
  const before = adminPassword;
  adminPassword = pass;
  try {
    await adminCall("verify", {});
    sessionStorage.setItem("adminPassword", pass);
    closeAdminModal();
    setAdminMode(true);
  } catch (err){
    adminPassword = before;
    $("#adminModalError").textContent = err.message.includes("HTTP") ? err.message : "Senha incorreta.";
    $("#adminModalError").style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

$("#adminLogout").addEventListener("click", () => {
  adminPassword = null;
  sessionStorage.removeItem("adminPassword");
  setAdminMode(false);
});

async function adminDeletePhoto(fotoId, onDone){
  if (!confirm("Apagar essa foto? Não dá pra desfazer.")) return;
  try {
    await adminCall("delete-photo", { fotoId });
    alert("Apagada! Pode levar 1-2 minutos pra sumir do site publicado.");
    onDone && onDone();
  } catch (err){ alert("Não deu: " + err.message); }
}

async function adminDeleteAlbum(albumId, onDone){
  if (!confirm("Apagar esse álbum inteiro e todas as fotos dele? Não dá pra desfazer.")) return;
  try {
    await adminCall("delete-album", { albumId });
    alert("Apagado! Pode levar 1-2 minutos pra sumir do site publicado.");
    onDone && onDone();
  } catch (err){ alert("Não deu: " + err.message); }
}

async function adminSetCover(albumId, fotoId){
  try {
    await adminCall("set-cover", { albumId, fotoId });
    alert("Capa trocada! Pode levar 1-2 minutos pra atualizar no site publicado.");
  } catch (err){ alert("Não deu: " + err.message); }
}

// ============================================================
// Criar álbum (admin) — escreve linha nova no Albuns.csv
// ============================================================
function slugifyCategoria(nome){
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

function populateCreateAlbumCategorias(){
  const sel = $("#createAlbumCategoria");
  const cats = [...new Set([...Object.keys(CATEGORY_LABELS), ...ALBUMS.map(a => a.categoria).filter(Boolean)])]
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR"));
  sel.innerHTML = cats.map(c => `<option value="${c}">${categoryLabel(c)}</option>`).join("")
    + `<option value="__nova__">+ Nova categoria…</option>`;
}

function openCreateAlbumModal(){
  populateCreateAlbumCategorias();
  $("#createAlbumTitulo").value = "";
  $("#createAlbumSubtitulo").value = "";
  $("#createAlbumNovaCategoria").value = "";
  $("#createAlbumNovaCategoria").style.display = "none";
  $("#createAlbumError").style.display = "none";
  $("#createAlbumModal").classList.add("open");
  $("#createAlbumTitulo").focus();
}
function closeCreateAlbumModal(){ $("#createAlbumModal").classList.remove("open"); }

$("#createAlbumBtn").addEventListener("click", openCreateAlbumModal);
$("#createAlbumClose").addEventListener("click", closeCreateAlbumModal);
$("#createAlbumModal").addEventListener("click", (e) => { if (e.target.id === "createAlbumModal") closeCreateAlbumModal(); });
$("#createAlbumCategoria").addEventListener("change", () => {
  $("#createAlbumNovaCategoria").style.display = $("#createAlbumCategoria").value === "__nova__" ? "block" : "none";
});

$("#createAlbumSubmit").addEventListener("click", async () => {
  const titulo = $("#createAlbumTitulo").value.trim();
  const subtitulo = $("#createAlbumSubtitulo").value.trim();
  let categoria = $("#createAlbumCategoria").value;
  const errEl = $("#createAlbumError");
  if (categoria === "__nova__"){
    const nome = $("#createAlbumNovaCategoria").value.trim();
    if (!nome){ errEl.textContent = "Digite o nome da categoria nova."; errEl.style.display = "block"; return; }
    categoria = slugifyCategoria(nome);
    CATEGORY_LABELS[categoria] = nome;
  }
  if (!titulo){ errEl.textContent = "Digite um título."; errEl.style.display = "block"; return; }

  const btn = $("#createAlbumSubmit");
  btn.disabled = true; btn.textContent = "Criando...";
  try {
    const res = await adminCall("create-album", { titulo, subtitulo, categoria });
    ALBUMS.push({ id: res.albumId, parent: null, categoria, titulo, subtitulo, cover: "", descricao: "" });
    closeCreateAlbumModal();
    alert(`Álbum "${titulo}" criado! Ele só aparece na vitrine depois de ter pelo menos 1 foto — entre nele e use "Subir foto".`);
    goToAlbum(res.albumId);
  } catch (err){
    errEl.textContent = err.message;
    errEl.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Criar";
  }
});

// ============================================================
// Subir foto (admin) — redimensiona e carimba a logo no navegador
// antes de mandar pro GitHub, pra nunca subir arquivo gigante de câmera
// nem foto sem marca d'água
// ============================================================
// mesmos números do script que gera as fotos que já estão no site
// (scripts auxiliares fora do repo) — pra toda foto nova sair igual
const ADMIN_UPLOAD_MAX_DIM = 1440;
const ADMIN_UPLOAD_QUALITY = 0.88;
const ADMIN_WATERMARK_SRC = "images/brand/assinatura-white-transparent.png";

function loadImageFromSrc(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("não consegui carregar a imagem"));
    img.src = src;
  });
}

async function processImageForUpload(file){
  const objectUrl = URL.createObjectURL(file);
  let img;
  try { img = await loadImageFromSrc(objectUrl); }
  finally { URL.revokeObjectURL(objectUrl); }

  let { width, height } = img;
  if (width > ADMIN_UPLOAD_MAX_DIM || height > ADMIN_UPLOAD_MAX_DIM){
    const scale = ADMIN_UPLOAD_MAX_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  try {
    const logo = await loadImageFromSrc(ADMIN_WATERMARK_SRC);
    const logoW = width * 0.16;
    const logoH = logoW * (logo.height / logo.width);
    const margin = width * 0.025;
    ctx.globalAlpha = 0.88;
    ctx.drawImage(logo, width - logoW - margin, height - logoH - margin, logoW, logoH);
    ctx.globalAlpha = 1;
  } catch { /* sem logo disponível, sobe sem marca d'água mesmo */ }

  const dataUrl = canvas.toDataURL("image/jpeg", ADMIN_UPLOAD_QUALITY);
  return dataUrl.split(",")[1];
}

function wireAdminUpload(albumId){
  const input = $("#adminUploadInput");
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const status = $("#adminUploadStatus");
    status.textContent = "Preparando imagem...";
    try {
      const base64 = await processImageForUpload(file);
      status.textContent = "Enviando...";
      await adminCall("upload-photo", { albumId, filename: "foto.jpg", dataBase64: base64 });
      status.textContent = "Enviada! Pode levar 1-2 minutos pra aparecer no site publicado.";
      input.value = "";
    } catch (err){
      status.textContent = "Não deu: " + err.message;
    }
  });
}

if (adminPassword) setAdminMode(true);

// ============================================================
// Init
// ============================================================
stampApertures(document);
initCursor();
initMagnetic();
initHero();
initSectionBackgrounds();
initParallax();
initHeroPeek();
applyRoute(albumIdFromHash(), { scroll: false });
renderTimeline();
initFilmstripNav();
observeReveals();
