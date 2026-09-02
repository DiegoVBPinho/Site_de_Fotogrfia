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
function catLabel(id){ return (CATEGORIAS.find(c => c.id === id) || {}).label || id; }
function albumEffectiveDate(id){
  const own = albumOwnDate(id);
  if (own) return own;
  const recPhotos = albumPhotosRecursive(id);
  if (!recPhotos.length) return null;
  return recPhotos.reduce((min, p) => (p.data < min ? p.data : min), recPhotos[0].data);
}
function sortAlbumsByDate(albums){
  return [...albums].sort((a, b) => {
    const da = albumEffectiveDate(a.id), db = albumEffectiveDate(b.id);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(da) - new Date(db);
  });
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
    el.style.transitionDelay = (Math.min(i % 10, 9) * 0.06).toFixed(2) + "s";
    cardObserver.observe(el);
  });
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
// Hero — fundo em crossfade + "viewfinder" que segue o cursor
// ============================================================
let heroPool = [];

function checkLandscape(photo){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= img.naturalHeight * 1.05 ? photo : null);
    img.onerror = () => resolve(null);
    img.src = photo.src;
  });
}

async function buildHeroPool(){
  const shuffled = [...PHOTOS].sort(() => Math.random() - 0.5);
  const results = await Promise.all(shuffled.slice(0, 60).map(checkLandscape));
  heroPool = results.filter(Boolean).slice(0, 22);
  if (!heroPool.length) heroPool = shuffled.slice(0, 10);
}

// ------------------------------------------------------------
// Mosaico do hero — grade que nunca para: entra em "gota d'água"
// (atraso cresce do centro pras bordas), flutua sozinha depois de
// assentar, e troca fotos aos poucos em tiles aleatórios pra ficar viva.
// ------------------------------------------------------------
function computeHeroGrid(){
  const w = window.innerWidth, h = window.innerHeight;
  const mobile = w < 640;
  const targetCell = mobile ? 46 : 74;
  const cols = Math.max(mobile ? 8 : 14, Math.min(mobile ? 12 : 26, Math.round(w / targetCell)));
  const rows = Math.max(mobile ? 14 : 10, Math.min(mobile ? 20 : 16, Math.round(h / targetCell)));
  return { cols, rows };
}

// formas mistas (deitada/em pé/quadrada/grande) — encaixadas com grid
// "dense" pra parecer um mosaico feito de peças diferentes, tipo quebra-
// cabeça, e não uma grade uniforme de quadradinhos iguais
const HERO_SHAPES = [
  { cls: "w2h1", cw: 2, ch: 1, weight: 5 },  // deitada
  { cls: "w1h2", cw: 1, ch: 2, weight: 5 },  // em pé
  { cls: "w1h1", cw: 1, ch: 1, weight: 6 },  // quadrada
  { cls: "w2h2", cw: 2, ch: 2, weight: 2 },  // grande, de vez em quando
];
function pickShape(){
  const total = HERO_SHAPES.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of HERO_SHAPES){ if ((r -= s.weight) <= 0) return s; }
  return HERO_SHAPES[0];
}

function initHeroMosaic(){
  const el = $("#heroMosaic");
  const pool = (PHOTOS.length ? PHOTOS : heroPool).filter(Boolean);
  if (!pool.length) return;
  const { cols, rows } = computeHeroGrid();
  el.style.setProperty("--hero-cols", cols);
  el.style.setProperty("--hero-rows", rows);

  // preenche uma grade fina (cols x rows) com peças de tamanhos variados,
  // sem sobrepor — varre livre-a-livre e encaixa a maior forma que couber
  const occupied = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const placements = [];
  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      if (occupied[r][c]) continue;
      let shape = pickShape();
      while ((r + shape.ch > rows || c + shape.cw > cols || !fits(r, c, shape)) && (shape.cw > 1 || shape.ch > 1)){
        shape = { cls: "w1h1", cw: 1, ch: 1 };
      }
      for (let rr = r; rr < r + shape.ch; rr++) for (let cc = c; cc < c + shape.cw; cc++) occupied[rr][cc] = true;
      placements.push({ row: r, col: c, ...shape });
    }
  }
  function fits(r, c, shape){
    for (let rr = r; rr < r + shape.ch; rr++) for (let cc = c; cc < c + shape.cw; cc++){
      if (rr >= rows || cc >= cols || occupied[rr][cc]) return false;
    }
    return true;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const RIPPLE_START = 0.05, RIPPLE_SPREAD = 0.85;
  const centerRow = (rows - 1) / 2, centerCol = (cols - 1) / 2;
  const maxDist = Math.hypot(centerRow, centerCol) || 1;

  el.innerHTML = "";
  const tiles = placements.map((pl, idx) => {
    const p = shuffled[idx % shuffled.length];
    const dist = Math.hypot((pl.row + pl.ch / 2) - centerRow, (pl.col + pl.cw / 2) - centerCol) / maxDist;
    const delay = REDUCE_MOTION ? 0 : (RIPPLE_START + dist * RIPPLE_SPREAD + Math.random() * 0.1);
    const fig = document.createElement("figure");
    fig.className = "hero__tile";
    fig.style.gridColumn = `${pl.col + 1} / span ${pl.cw}`;
    fig.style.gridRow = `${pl.row + 1} / span ${pl.ch}`;
    fig.style.transitionDelay = delay.toFixed(2) + "s";
    fig.innerHTML = `<div class="hero__tile-inner" style="--fd:${(5 + Math.random() * 4).toFixed(1)}s; --fdd:${(Math.random() * 3).toFixed(1)}s; --fx:${(Math.random() * 14 - 7).toFixed(0)}px; --fy:${(Math.random() * 14 - 7).toFixed(0)}px;"><img src="${p.src}" alt=""></div>`;
    el.appendChild(fig);
    return fig;
  });

  requestAnimationFrame(() => requestAnimationFrame(() => {
    tiles.forEach(t => t.classList.add("in-view"));
  }));

  // logo entra em recorte "quadro a quadro" (steps) por cima do mosaico
  const logoWrap = $("#heroLogoWrap");
  const logoDelayMs = (RIPPLE_START + RIPPLE_SPREAD + 0.5) * 1000;
  setTimeout(() => {
    $("#heroContent").classList.add("is-visible");
    if (logoWrap) logoWrap.classList.add("play");
  }, REDUCE_MOTION ? 0 : logoDelayMs);

  if (REDUCE_MOTION) return;
  const heroEl = $("#inicio");
  // troca fotos aos poucos em alguns tiles aleatórios — mantém o mosaico vivo sem nunca ficar igual
  setInterval(() => {
    if (!heroEl || heroEl.getBoundingClientRect().bottom < 0) return; // fora da tela, poupa trabalho
    const n = Math.max(1, Math.round(tiles.length * 0.06));
    for (let i = 0; i < n; i++){
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      const img = tile.querySelector("img");
      if (!img) continue;
      const next = shuffled[Math.floor(Math.random() * shuffled.length)];
      img.classList.add("is-fading");
      setTimeout(() => { img.src = next.src; img.classList.remove("is-fading"); }, 500);
    }
  }, 1400);
}

function initViewfinder(){
  if (!HAS_FINE_POINTER || REDUCE_MOTION || !heroPool.length) return;
  const hero = $("#inicio");
  const vf = $("#viewfinder");
  const vfImg = $("#viewfinderImg");
  const vfLabel = $("#viewfinderLabel");

  let tx = 0, ty = 0, cx = 0, cy = 0, active = false;
  let lastAdvanceX = 0, lastAdvanceY = 0, idx = 0;
  const STEP = 130; // px percorridos até trocar de frame

  function showFrame(i){
    const p = heroPool[i % heroPool.length];
    vfImg.style.opacity = 0;
    const img = new Image();
    img.onload = () => { vfImg.src = p.src; vfImg.alt = p.titulo || ""; vfImg.style.opacity = 1; };
    img.src = p.src;
    const album = getAlbum(p.album);
    vfLabel.textContent = album ? album.titulo : (p.titulo || "");
  }
  showFrame(0);

  let ticking = false;
  function tick(){
    cx += (tx - cx) * 0.14; cy += (ty - cy) * 0.14;
    vf.style.transform = `translate3d(${cx + 26}px, ${cy - 90}px, 0)`;
    if (active || Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1){
      requestAnimationFrame(tick);
    } else {
      ticking = false;
    }
  }
  function ensureTicking(){
    if (!ticking){ ticking = true; requestAnimationFrame(tick); }
  }

  hero.addEventListener("mousemove", e => {
    tx = e.clientX; ty = e.clientY;
    if (!active){ active = true; cx = tx; cy = ty; vf.classList.add("is-active"); }
    const dx = tx - lastAdvanceX, dy = ty - lastAdvanceY;
    if (Math.hypot(dx, dy) > STEP){
      idx++; showFrame(idx);
      lastAdvanceX = tx; lastAdvanceY = ty;
    }
    ensureTicking();
  });
  hero.addEventListener("mouseleave", () => { active = false; vf.classList.remove("is-active"); ensureTicking(); });
  hero.addEventListener("mouseenter", e => { lastAdvanceX = e.clientX; lastAdvanceY = e.clientY; });
}

async function initHero(){
  initHeroMosaic();
  await buildHeroPool();
  initViewfinder();
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
const filtersEl = $("#filters");
const muralGrid = $("#muralGrid");
const folderZone = $("#folderZone");
const photosDividerLabel = $("#photosDividerLabel");
const breadcrumbEl = $("#breadcrumb");
const searchInput = $("#searchInput");
const searchClear = $("#searchClear");

let activeCategory = "todos";
let searchQuery = "";
let navStack = [];

function photoMatchesCategory(p, categoryId){
  if (categoryId === "todos") return true;
  const album = getAlbum(p.album);
  if (album && album.categoria === categoryId) return true;
  return (p.tags || []).includes(categoryId);
}

function matchesSearch(p, query){
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const album = getAlbum(p.album);
  const haystack = [
    p.titulo, p.local, ...(p.tags || []),
    album ? album.titulo : "", album ? album.subtitulo : "",
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

// cada categoria mostra a própria foto (a mais antiga que ela tem) em vez
// de um botão genérico com texto — vira um trilho de miniaturas
function coverForCategory(catId){
  if (catId === "todos") return PHOTOS[0];
  const matches = PHOTOS.filter(p => photoMatchesCategory(p, catId));
  return matches.reduce((min, p) => (!min || p.data < min.data ? p : min), null);
}

function renderFilters(){
  const categoriasComConteudo = CATEGORIAS.filter(c => c.id === "todos" || PHOTOS.some(p => photoMatchesCategory(p, c.id)));
  filtersEl.innerHTML = categoriasComConteudo.map(c => {
    const cover = coverForCategory(c.id);
    return `
      <button class="cat-tile ${c.id === activeCategory ? "active" : ""}" data-cat="${c.id}" data-hover>
        <img src="${cover ? cover.src : ""}" alt="" loading="lazy">
        <span class="cat-tile__label">${c.label}</span>
      </button>
    `;
  }).join("");
  $$(".cat-tile", filtersEl).forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      navStack = resolveSingleAlbumChain(activeCategory);
      renderFilters();
      renderMural();
    });
  });
}

// header simples: "← Voltar" + título do álbum atual — nada de trilha de
// migalhas (a maioria dos álbuns só tem 1 nível de profundidade mesmo)
function renderBreadcrumb(){
  if (searchQuery){
    breadcrumbEl.innerHTML = `<h3 class="board-nav__title">Resultados da busca "${searchQuery}"</h3>`;
    return;
  }
  if (!navStack.length){
    breadcrumbEl.innerHTML = "";
    return;
  }
  const current = getAlbum(navStack[navStack.length - 1]);
  breadcrumbEl.innerHTML = `
    <button class="board-nav__back" id="boardBack" data-hover>← Voltar</button>
    <h3 class="board-nav__title">${current.titulo}${current.subtitulo ? " — " + current.subtitulo : ""}</h3>
  `;
  $("#boardBack").addEventListener("click", () => {
    navStack = navStack.length > 1 ? navStack.slice(0, -1) : resolveSingleAlbumChain(activeCategory);
    renderMural();
  });
}

function isMobileView(){ return window.innerWidth <= 780; }

function renderMural(){
  renderBreadcrumb();
  folderZone.innerHTML = "";
  photosDividerLabel.style.display = "none";

  if (searchQuery){
    searchClear.style.display = "inline";
    const items = PHOTOS.filter(p =>
      photoMatchesCategory(p, activeCategory) &&
      matchesSearch(p, searchQuery)
    );
    if (!items.length){
      muralGrid.innerHTML = `<p class="no-results">Nenhuma foto encontrada para "${searchQuery}".</p>`;
      return;
    }
    muralGrid.innerHTML = items.map(p => photoCardHTML(p)).join("");
    observeCards(muralGrid);
    applyOrientationClasses(muralGrid);
    $$(".card", muralGrid).forEach(el => {
      el.addEventListener("click", () => openLightbox(items, items.findIndex(p => p.id === el.dataset.id)));
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
    groups.sort((a, b) => {
      const da = a.photos.reduce((min, p) => (p.data < min ? p.data : min), a.photos[0].data);
      const db = b.photos.reduce((min, p) => (p.data < min ? p.data : min), b.photos[0].data);
      return new Date(da) - new Date(db);
    });
    const showTitles = groups.length > 1;

    muralGrid.innerHTML = groups.map(g => {
      const shown = g.photos.slice(0, MOBILE_PREVIEW_LIMIT);
      const rest = g.photos.length - shown.length;
      return `
        <div class="mobile-album-block" data-group="${g.album ? g.album.id : ""}">
          ${showTitles && g.album ? `<p class="mobile-album-block__title">${g.album.titulo}${g.album.subtitulo ? " — " + g.album.subtitulo : ""}</p>` : ""}
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
  let childAlbums = children(currentParent);
  if (currentParent === null){
    childAlbums = childAlbums.filter(a => activeCategory === "todos" || a.categoria === activeCategory);
  }
  childAlbums = sortAlbumsByDate(childAlbums);
  const ownPhotos = currentParent
    ? albumPhotos(currentParent)
    : (activeCategory !== "todos" && !childAlbums.length
        ? PHOTOS.filter(p => photoMatchesCategory(p, activeCategory))
        : []);

  if (childAlbums.length){
    folderZone.innerHTML = `
      ${ownPhotos.length ? `<p class="mural-divider">Álbuns dentro deste álbum</p>` : ""}
      <div class="card-grid card-grid--albums ${currentParent === null ? "card-grid--top" : ""}" style="margin-bottom: ${ownPhotos.length ? "2rem" : "0"};">
        ${childAlbums.map(a => albumCardHTML(a)).join("")}
      </div>
    `;
    stampApertures(folderZone);
    observeCards(folderZone);
    $$(".card", folderZone).forEach(el => {
      el.addEventListener("click", () => {
        navStack.push(el.dataset.id);
        renderMural();
        $(".board").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  if (ownPhotos.length){
    if (childAlbums.length) photosDividerLabel.style.display = "inline-block";
    muralGrid.innerHTML = ownPhotos.map(p => photoCardHTML(p)).join("");
    observeCards(muralGrid);
    applyOrientationClasses(muralGrid);
    $$(".card", muralGrid).forEach(el => {
      el.addEventListener("click", () => openLightbox(ownPhotos, ownPhotos.findIndex(p => p.id === el.dataset.id)));
    });
  } else if (!childAlbums.length){
    muralGrid.innerHTML = currentParent
      ? `<p class="no-results">Este álbum ainda não tem fotos.</p>`
      : `<p class="no-results">Nenhum álbum nesta categoria ainda.</p>`;
  } else {
    muralGrid.innerHTML = "";
  }
}

function albumCardHTML(a){
  const kids = children(a.id);
  const isFolder = kids.length > 0;
  const count = isFolder ? kids.length : albumPhotos(a.id).length;
  const countLabel = isFolder ? `${count} álbum${count === 1 ? "" : "s"}` : `${count} foto${count === 1 ? "" : "s"}`;
  return `
    <figure class="card" data-id="${a.id}" data-hover>
      <div class="card__media"><img src="${a.cover}" alt="${a.titulo}" loading="lazy"></div>
      <div class="card__overlay">
        <span class="card__count">${countLabel}</span>
        <h3 class="card__title">${a.titulo}${a.subtitulo ? " — " + a.subtitulo : ""}</h3>
      </div>
    </figure>
  `;
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
    reels.push(`
      <figure class="filmreel" data-id="${a.id}" data-hover>
        <img src="${a.cover}" alt="${a.titulo}" loading="lazy">
        <figcaption class="filmreel__cap">
          <p class="filmreel__date">${formatDateShort(date)}</p>
          <p class="filmreel__title">${a.titulo}${a.subtitulo ? " — " + a.subtitulo : ""}</p>
        </figcaption>
      </figure>
    `);
  });

  // duplica a sequência pra loop sem costura (a animação anda 50% e volta pro início igualzinho)
  track.innerHTML = reels.join("") + reels.join("");
  $$(".filmreel[data-id]", track).forEach(reel => {
    reel.addEventListener("click", () => {
      navStack = breadcrumbFor(reel.dataset.id).map(a => a.id);
      searchQuery = ""; searchInput.value = "";
      renderMural();
      $(".board").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
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
let lbItems = [];
let lbIndex = 0;

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
  lbAlbumTitle.textContent = chain[chain.length - 1].titulo;

  lbTreeList.innerHTML = chain.map((a, i) => `
    <div class="lightbox__tree-item ${i === chain.length - 1 ? "is-current" : ""}" style="--depth:${i};">
      <button data-id="${a.id}">${a.titulo}</button>
    </div>
  `).join("");
  $$("button", lbTreeList).forEach(btn => {
    btn.addEventListener("click", () => {
      closeLightbox();
      const targetChain = breadcrumbFor(btn.dataset.id);
      navStack = targetChain.map(a => a.id);
      searchQuery = "";
      searchInput.value = "";
      renderMural();
      $(".board").scrollIntoView({ behavior: "smooth" });
    });
  });

  lbTags.innerHTML = (p.tags || []).map(t => `<span data-tag="${t}">#${t}</span>`).join("");
  $$("span", lbTags).forEach(chip => {
    chip.addEventListener("click", () => {
      closeLightbox();
      navStack = [];
      activeCategory = "todos";
      searchInput.value = chip.dataset.tag;
      searchQuery = chip.dataset.tag;
      renderFilters();
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
// Guia "Como atualizar o site" — abrir/fechar
// ============================================================
const adminOverlay = $("#adminOverlay");
$("#openAdminBtn").addEventListener("click", () => {
  adminOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
});
$("#closeAdminBtn").addEventListener("click", () => {
  adminOverlay.classList.remove("open");
  document.body.style.overflow = "";
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
let lastHeroGrid = computeHeroGrid();
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nowMobile = isMobileView();
    if (nowMobile !== lastWasMobile){
      lastWasMobile = nowMobile;
      renderMural();
    }
    const nextGrid = computeHeroGrid();
    if (nextGrid.cols !== lastHeroGrid.cols || nextGrid.rows !== lastHeroGrid.rows){
      lastHeroGrid = nextGrid;
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
    { id: "muralBg", from: PHOTOS.slice().sort(() => Math.random() - 0.5) },
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
}

function initParallax(){
  const layers = $$(".section__bg img");
  if (!layers.length || REDUCE_MOTION) return;
  function tick(){
    const vh = window.innerHeight;
    layers.forEach(img => {
      const rect = img.parentElement.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      const center = rect.top + rect.height / 2;
      const dist = (center - vh / 2) / vh;
      img.style.transform = `translateY(${(dist * 70).toFixed(1)}px)`;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
// Init
// ============================================================
stampApertures(document);
initCursor();
initMagnetic();
initHero();
initSectionBackgrounds();
initParallax();
renderFilters();
renderMural();
renderTimeline();
observeReveals();
