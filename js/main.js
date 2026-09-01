// ============================================================
// Helpers
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// respeita quem pediu menos movimento no sistema — desliga parallax e
// scroll-scrub (os fades/transições normais já são neutralizados via CSS)
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
function formatMonthYear(iso){
  const [y, m] = iso.split("-");
  return `${MESES_ABREV[parseInt(m, 10) - 1]}/${y}`;
}
// "MAIO 2026" — usado como título de cada grupo da linha do tempo
function formatMonthYearFull(iso){
  const [y, m] = iso.split("-");
  return `${MESES[parseInt(m, 10) - 1].toUpperCase()} ${y}`;
}
function formatDayOnly(iso){
  const [, , d] = iso.split("-");
  return parseInt(d, 10);
}

function getAlbum(id){ return ALBUMS.find(a => a.id === id); }
function children(parentId){ return ALBUMS.filter(a => a.parent === parentId); }
function albumPhotos(id){ return PHOTOS.filter(p => p.album === id); }
function albumPhotosRecursive(id){
  let list = albumPhotos(id);
  children(id).forEach(c => { list = list.concat(albumPhotosRecursive(c.id)); });
  return list;
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
// data do álbum = data da foto mais antiga que pertence DIRETAMENTE a ele
function albumOwnDate(id){
  const photos = albumPhotos(id);
  if (!photos.length) return null;
  return photos.reduce((min, p) => (p.data < min ? p.data : min), photos[0].data);
}
function catLabel(id){ return (CATEGORIAS.find(c => c.id === id) || {}).label || id; }

// Data "efetiva" de um álbum: a dele mesma, ou (se for uma pastinha sem
// foto própria) a data mais antiga entre todos os descendentes — assim dá
// pra ordenar até álbuns-pai que não têm foto direta, só sub-álbuns.
function albumEffectiveDate(id){
  const own = albumOwnDate(id);
  if (own) return own;
  const recPhotos = albumPhotosRecursive(id);
  if (!recPhotos.length) return null;
  return recPhotos.reduce((min, p) => (p.data < min ? p.data : min), recPhotos[0].data);
}
// Ordena álbuns em ordem cronológica: do mais antigo pro mais recente
// (sem data vai pro final)
function sortAlbumsByDate(albums){
  return [...albums].sort((a, b) => {
    const da = albumEffectiveDate(a.id), db = albumEffectiveDate(b.id);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(da) - new Date(db);
  });
}

// Revela cada foto suavemente ao entrar na tela, com um atraso crescente
// por card (--stagger) pra aparecerem em cascata em vez de tudo de uma
// vez — reinicia a cada "leva" de ~8 pra não deixar o final da grade
// esperando um atraso enorme.
const polaroidObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting){
      entry.target.classList.add("in-view");
      polaroidObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
function observePolaroids(container){
  $$(".polaroid", container).forEach((el, i) => {
    el.style.setProperty("--stagger", (Math.min(i % 8, 7) * 0.07).toFixed(2) + "s");
    polaroidObserver.observe(el);
  });
}

// Injects the reusable aperture SVG into any element with class "aperture" lacking one
function stampApertures(root = document){
  const tpl = $("#apertureTpl");
  $$(".aperture", root).forEach(el => {
    if (!el.querySelector("svg")) el.appendChild(tpl.content.cloneNode(true));
  });
}

// Detecta se cada foto é vertical ou horizontal e aplica a classe certa na
// moldura (polaroid), pra moldura vertical abraçar foto vertical e moldura
// horizontal abraçar foto horizontal — em vez de cortar tudo num único formato.
function applyOrientationClasses(root = document){
  $$(".polaroid img", root).forEach(img => {
    const figure = img.closest(".polaroid");
    if (!figure) return;
    const classify = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const isPortrait = img.naturalHeight > img.naturalWidth;
      figure.classList.toggle("polaroid--portrait", isPortrait);
      figure.classList.toggle("polaroid--landscape", !isPortrait);
    };
    if (img.complete) classify();
    else img.addEventListener("load", classify, { once: true });
  });
}

// Quando uma categoria só tem UM álbum principal (sem irmãos pra escolher),
// não faz sentido mostrar a "pastinha" vazia esperando um clique — entra
// direto no álbum (e continua entrando se ele também só tiver um sub-álbum).
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
// Hero mosaic — grade de fotos lado a lado, sem nenhuma sobreposta,
// só com fotos horizontais (verticais destoam da grade e ficam
// espremidas — melhor deixá-las de fora do mosaico da capa)
// ============================================================
function checkOrientation(photo){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ photo, landscape: img.naturalWidth >= img.naturalHeight });
    img.onerror = () => resolve({ photo, landscape: false });
    img.src = photo.src;
  });
}

// Calcula quantas colunas/linhas cabem no mosaico a partir do tamanho REAL
// da janela (não um breakpoint fixo) — assim a grade se adapta sozinha
// tanto trocando de celular pra monitor quanto só redimensionando a
// janela, sem ficar esticada/quadriculada errado em telas ultra-largas
// ou bem estreitas. Cada célula mira um tamanho-alvo (menor no celular,
// pra caber mais fotos pequenas; maior no desktop), e o número de
// colunas/linhas é só "quantas células desse tamanho cabem aqui".
function computeHeroGrid(){
  const w = window.innerWidth, h = window.innerHeight;
  const mobile = w < 640;
  const targetCell = mobile ? 95 : 180;
  const cols = Math.max(mobile ? 3 : 5, Math.min(mobile ? 5 : 12, Math.round(w / targetCell)));
  const rows = Math.max(mobile ? 6 : 4, Math.min(mobile ? 9 : 7, Math.round(h / targetCell)));
  return { cols, rows };
}
let lastHeroGrid = null;

async function renderHeroMosaic(){
  const el = $("#heroMosaic");
  const { cols, rows } = computeHeroGrid();
  lastHeroGrid = { cols, rows };
  const cells = cols * rows;

  el.style.setProperty("--hero-cols", cols);
  el.style.setProperty("--hero-rows", rows);

  const shuffled = [...PHOTOS].sort(() => Math.random() - 0.5);
  const landscapePool = [];
  const BATCH = Math.max(cells * 2, 30);
  let i = 0;
  while (landscapePool.length < cells && i < shuffled.length){
    const batch = shuffled.slice(i, i + BATCH);
    i += BATCH;
    const results = await Promise.all(batch.map(checkOrientation));
    results.forEach(r => { if (r.landscape) landscapePool.push(r.photo); });
  }
  if (!landscapePool.length) return;

  const pool = [];
  while (pool.length < cells) pool.push(...landscapePool);
  pool.length = cells;

  // centro da grade (em coordenadas de linha/coluna) — cada foto calcula
  // sua distância até esse centro pra entrar em onda, do meio pras bordas,
  // feito uma gota d'água caindo n'água. Início quase junto com a logo
  // (sem espera morta) e espalhamento rápido — "instantâneo" no começo,
  // suave só no jeito que cada foto se movimenta, não na demora.
  const RIPPLE_START = 0.05;
  const RIPPLE_SPREAD = 0.7;
  const centerRow = (rows - 1) / 2;
  const centerCol = (cols - 1) / 2;
  const maxDist = Math.hypot(centerRow, centerCol) || 1;

  el.innerHTML = pool.map((p, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const dist = Math.hypot(row - centerRow, col - centerCol) / maxDist; // 0 (centro) a 1 (cantos)
    const r = (Math.random() * 6 - 3).toFixed(1);
    const delay = (RIPPLE_START + dist * RIPPLE_SPREAD + Math.random() * 0.08).toFixed(2);
    const floatDur = (5 + Math.random() * 4).toFixed(1);
    // sem "lazy" aqui: essas fotos já aparecem na primeira dobra da
    // página, então "lazy" só atrasava o carregamento à toa
    return `<div class="hero__tile" style="--d:${delay}s;">
      <div class="hero__tile-inner" style="--r:${r}deg; --fd:${floatDur}s;">
        <img src="${p.src}" alt="${p.titulo}">
      </div>
    </div>`;
  }).join("");
}

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
let navStack = []; // array of album ids representing the current drill-down path

// Categoria de álbum normalmente resolve pelo campo `categoria` do álbum-pai,
// mas algumas categorias (ex.: Esporte) não têm mais um álbum-topo próprio —
// as fotos viraram sub-álbum dentro de outro assunto (Festa de Santa Rita).
// Nesses casos a categoria é só a TAG da foto mesmo, então cai pra tag.
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

function renderFilters(){
  filtersEl.innerHTML = CATEGORIAS.map(c => `
    <button class="filter-chip ${c.id === activeCategory ? "active" : ""}" data-cat="${c.id}">
      <span class="aperture"></span> ${c.label}
    </button>
  `).join("");
  stampApertures(filtersEl);
  $$(".filter-chip", filtersEl).forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      navStack = resolveSingleAlbumChain(activeCategory);
      renderFilters();
      renderMural();
    });
  });
}

function renderBreadcrumb(){
  // no celular o breadcrumb normalmente fica escondido (a navegação lá é
  // por categoria, não por pastinha) — MAS se veio um clique específico
  // (ex.: card da linha do tempo) que empilhou um álbum em navStack,
  // precisa aparecer, senão não tem como voltar pro mural geral
  if (isMobileView() && !searchQuery && !navStack.length){
    breadcrumbEl.innerHTML = "";
    return;
  }
  if (searchQuery){
    breadcrumbEl.innerHTML = `<span class="crumb">Resultados da busca "${searchQuery}"</span>`;
    return;
  }
  const chain = navStack.map(id => getAlbum(id));
  let html = `<button data-idx="-1">Mural</button>`;
  chain.forEach((a, i) => {
    html += `<span class="sep">/</span><button data-idx="${i}">${a.titulo}</button>`;
  });
  breadcrumbEl.innerHTML = html;
  $$("button", breadcrumbEl).forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      navStack = idx === -1 ? resolveSingleAlbumChain(activeCategory) : navStack.slice(0, idx + 1);
      renderMural();
    });
  });
}

function isMobileView(){ return window.innerWidth <= 780; }

function renderMural(){
  renderBreadcrumb();
  folderZone.innerHTML = "";
  photosDividerLabel.style.display = "none";

  // --- search mode: flat results across every photo ---
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
    observePolaroids(muralGrid);
    applyOrientationClasses(muralGrid);
    $$(".polaroid", muralGrid).forEach(el => {
      el.addEventListener("click", () => openLightbox(items, items.findIndex(p => p.id === el.dataset.id)));
    });
    refreshParallaxTargets();
    return;
  }
  searchClear.style.display = "none";

  // --- celular: navegar por álbum fica confuso na tela pequena — mostra as
  //     fotos da categoria agrupadas por álbum, no máximo 3 de cada vez,
  //     com um "ver mais" pra quem quiser o álbum inteiro ---
  if (isMobileView()){
    // se veio de um clique específico (card da linha do tempo, ou álbum
    // dentro de outro álbum) o navStack aponta pro álbum exato — mostra
    // só as fotos dele (recursivo, cobre sub-álbuns), não a categoria
    // inteira misturada. Sem isso, clicar "Ver álbum" caía num apanhado
    // aleatório de tudo daquela categoria em vez do álbum pedido.
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
          ${rest > 0 ? `<button class="mobile-album-block__more" data-group="${g.album ? g.album.id : ""}">Ver mais ${rest} foto${rest === 1 ? "" : "s"} <span class="aperture"></span></button>` : ""}
        </div>`;
    }).join("");
    stampApertures(muralGrid);
    observePolaroids(muralGrid);
    applyOrientationClasses(muralGrid);

    $$(".mobile-album-block", muralGrid).forEach(block => {
      const g = groups.find(x => (x.album ? x.album.id : "") === block.dataset.group);
      if (!g) return;
      $$(".polaroid", block).forEach(el => {
        el.addEventListener("click", () => openLightbox(g.photos, g.photos.findIndex(p => p.id === el.dataset.id)));
      });
      const moreBtn = $(".mobile-album-block__more", block);
      if (moreBtn) moreBtn.addEventListener("click", () => openLightbox(g.photos, Math.min(MOBILE_PREVIEW_LIMIT, g.photos.length - 1)));
    });
    refreshParallaxTargets();
    return;
  }

  // --- normal browsing mode (desktop) ---
  const currentParent = navStack.length ? navStack[navStack.length - 1] : null;
  let childAlbums = children(currentParent);
  if (currentParent === null){
    childAlbums = childAlbums.filter(a => activeCategory === "todos" || a.categoria === activeCategory);
  }
  childAlbums = sortAlbumsByDate(childAlbums);
  // Categorias sem álbum-topo próprio (ex.: Esporte, que virou sub-álbum
  // dentro de Festa de Santa Rita) caem aqui: sem pastinha pra abrir, mostra
  // direto as fotos que têm a tag da categoria.
  const ownPhotos = currentParent
    ? albumPhotos(currentParent)
    : (activeCategory !== "todos" && !childAlbums.length
        ? PHOTOS.filter(p => photoMatchesCategory(p, activeCategory))
        : []);

  // sub-álbuns ("pastinhas") no topo
  if (childAlbums.length){
    folderZone.innerHTML = `
      ${ownPhotos.length ? `<p class="mural-divider">Álbuns dentro deste álbum</p>` : ""}
      <div class="polaroid-grid polaroid-grid--albums" style="margin-bottom: ${ownPhotos.length ? "2rem" : "0"};">
        ${childAlbums.map(a => albumCardHTML(a)).join("")}
      </div>
    `;
    stampApertures(folderZone);
    // as capas de álbum usam a mesma classe .polaroid das fotos soltas —
    // por isso também precisam ser "observadas" pra ganhar a classe
    // in-view e deixar de ficar com opacity:0 pra sempre (bug corrigido:
    // antes só o muralGrid era observado, o folderZone nunca)
    observePolaroids(folderZone);
    // capas de álbum NÃO variam moldura por orientação — capa é sempre
    // horizontal (força consistência visual na grade de álbuns)
    $$(".polaroid", folderZone).forEach(el => {
      el.addEventListener("click", () => {
        navStack.push(el.dataset.id);
        renderMural();
        // rola até o quadro (breadcrumb + sub-álbuns/fotos), não até o
        // topo da seção — senão só mostra o título "Mural de Álbuns" e o
        // usuário tem que rolar mais pra ver o que realmente abriu
        $(".corkboard").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  if (ownPhotos.length){
    if (childAlbums.length) photosDividerLabel.style.display = "inline-block";
    muralGrid.innerHTML = ownPhotos.map(p => photoCardHTML(p)).join("");
    observePolaroids(muralGrid);
    applyOrientationClasses(muralGrid);
    $$(".polaroid", muralGrid).forEach(el => {
      el.addEventListener("click", () => openLightbox(ownPhotos, ownPhotos.findIndex(p => p.id === el.dataset.id)));
    });
  } else if (!childAlbums.length){
    muralGrid.innerHTML = currentParent
      ? `<p class="no-results">Este álbum ainda não tem fotos.</p>`
      : `<p class="no-results">Nenhum álbum nesta categoria ainda.</p>`;
  } else {
    muralGrid.innerHTML = "";
  }
  refreshParallaxTargets();
}

function albumCardHTML(a){
  const kids = children(a.id);
  const isFolder = kids.length > 0;
  const count = isFolder ? kids.length : albumPhotos(a.id).length;
  const countLabel = isFolder ? `${count} álbum${count === 1 ? "" : "s"}` : `${count} foto${count === 1 ? "" : "s"}`;
  return `
    <figure class="polaroid polaroid--album ${isFolder ? "polaroid--folder" : ""}" data-id="${a.id}">
      <span class="polaroid__pin"></span>
      <span class="polaroid__aperture aperture"></span>
      <span class="polaroid__count">${countLabel}</span>
      <div class="polaroid__frame"><img src="${a.cover}" alt="${a.titulo}" loading="lazy"></div>
      <figcaption class="polaroid__cap">${a.titulo}${a.subtitulo ? " — " + a.subtitulo : ""}</figcaption>
    </figure>
  `;
}

function photoCardHTML(p){
  // "legenda" é usada em fotos que vieram de um sub-álbum que foi
  // incorporado ao álbum-pai (ex.: sub-álbum só com fotos verticais,
  // que não podia ter capa) — mantém o nome do sub-álbum antigo visível
  // na legenda da foto, em vez de perder essa informação.
  const capText = p.legenda ? `${formatDateShort(p.data)} — ${p.legenda}` : formatDateShort(p.data);
  return `
    <figure class="polaroid" data-id="${p.id}">
      <span class="polaroid__pin"></span>
      <div class="polaroid__frame"><img src="${p.src}" alt="${p.titulo}" loading="lazy"></div>
      <figcaption class="polaroid__cap">${capText}</figcaption>
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
// Linha do tempo — compacta, revela mais aos poucos
// ============================================================
let timelineRevealCount = 1;
const TIMELINE_STEP = 3;

// mesmo princípio do reveal escalonado das fotos, aplicado aos cards
// da linha do tempo — cada um aparece um pouco depois do anterior
const timelineObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting){
      entry.target.classList.add("in-view");
      timelineObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

function renderTimeline(){
  const el = $("#timeline");
  // retratos ficam de fora da linha do tempo — são ensaios avulsos, não
  // fazem parte da cronologia de eventos/coberturas
  // só álbuns de primeiro nível (sem sub-álbum) — fica mais limpo.
  // usa a data "efetiva" (própria, ou a mais antiga entre os
  // descendentes) pra álbuns-pasta como "Drone" e "Festa de Santa Rita"
  // continuarem aparecendo mesmo sem foto própria direta.
  const dated = ALBUMS
    .filter(a => a.categoria !== "retratos" && a.parent === null)
    .map(a => ({ album: a, date: albumEffectiveDate(a.id) }))
    .filter(x => x.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const visible = dated.slice(0, timelineRevealCount);

  // agrupa por mês/ano (ex.: "MAIO 2026") — cada grupo vira um grid,
  // em vez de uma coluna única deixando espaço vazio do lado direito
  const groups = [];
  const byMonth = new Map();
  visible.forEach(({ album: a, date }) => {
    const key = date.slice(0, 7); // "2026-05"
    if (!byMonth.has(key)){
      byMonth.set(key, { label: formatMonthYearFull(date), items: [] });
      groups.push(byMonth.get(key));
    }
    byMonth.get(key).items.push({ album: a, date });
  });

  el.innerHTML = groups.map(g => `
    <div class="timeline-group">
      <p class="timeline-group__label">${g.label}</p>
      <div class="timeline-group__grid">
        ${g.items.map(({ album: a, date }) => {
          // recursivo: álbuns-pasta (Drone, Festa de Santa Rita) não têm
          // foto própria direta, só através dos sub-álbuns
          const kidsCount = children(a.id).length;
          const count = albumPhotosRecursive(a.id).length;
          return `
            <div class="timeline__item" data-id="${a.id}">
              <div class="timeline__card">
                <div class="timeline__thumb"><img src="${a.cover}" alt="${a.titulo}" loading="lazy"></div>
                <div class="timeline__body">
                  <p class="timeline__date">${formatDateShort(date)}</p>
                  <p class="timeline__title">${a.titulo}${a.subtitulo ? " — " + a.subtitulo : ""}</p>
                  ${kidsCount ? `<p class="timeline__meta">${kidsCount} Álbum${kidsCount === 1 ? "" : "s"} Interno${kidsCount === 1 ? "" : "s"}</p>` : ""}
                  <p class="timeline__meta">${count} foto${count === 1 ? "" : "s"}</p>
                  <button class="timeline__view-btn" data-id="${a.id}">Ver álbum <span class="aperture"></span></button>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");
  stampApertures(el);
  $$(".timeline__item", el).forEach((item, i) => {
    item.style.setProperty("--stagger", (Math.min(i, 6) * 0.09).toFixed(2) + "s");
    timelineObserver.observe(item);
  });

  const buttons = [];
  if (dated.length > visible.length){
    buttons.push(`<button class="timeline__more" id="timelineMore">Mostrar mais</button>`);
  }
  if (timelineRevealCount > 1){
    buttons.push(`<button class="timeline__more timeline__more--less" id="timelineLess">Mostrar menos</button>`);
  }
  if (buttons.length){
    el.insertAdjacentHTML("beforeend", `<div class="timeline__actions">${buttons.join("")}</div>`);
    const moreBtn = $("#timelineMore");
    const lessBtn = $("#timelineLess");
    if (moreBtn) moreBtn.addEventListener("click", () => {
      timelineRevealCount += TIMELINE_STEP;
      renderTimeline();
    });
    if (lessBtn) lessBtn.addEventListener("click", () => {
      timelineRevealCount = 1;
      renderTimeline();
      $("#tempo").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  $$(".timeline__item", el).forEach(item => {
    item.addEventListener("click", () => {
      navStack = breadcrumbFor(item.dataset.id).map(a => a.id);
      searchQuery = ""; searchInput.value = "";
      renderMural();
      // mesma correção: mostra direto o breadcrumb + sub-álbuns/fotos do
      // álbum clicado, não o topo da seção (título "Mural de Álbuns")
      $(".corkboard").scrollIntoView({ behavior: "smooth", block: "start" });
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
  // troca a foto com um pequeno cross-fade em vez de um corte seco —
  // some, troca o src, e volta a aparecer assim que a nova carregar
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
      $(".corkboard").scrollIntoView({ behavior: "smooth" });
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
      $(".corkboard").scrollIntoView({ behavior: "smooth" });
    });
  });
}

lbImgWrap.addEventListener("click", () => {
  lbImgWrap.classList.toggle("zoomed");
  // sem isso, o touch-action do palco (que reserva o arraste horizontal
  // pra passar de foto) impedia arrastar a foto ampliada na vertical
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

// swipe pra navegar (mobile)
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
// Parallax sutil nas fotos da grade — a imagem desliza um pouco mais
// devagar que o card conforme rola a página, dando uma sensação de
// profundidade sem atrapalhar a leitura. Só no desktop (no celular a
// grade é outra e o ganho visual não compensa o custo).
// ============================================================
let parallaxTargets = [];
function refreshParallaxTargets(){
  // capas de álbum ficam de fora do parallax: a foto lá dentro usa
  // "contain" (não pode ter nem um pixel cortado), então não tem a
  // margem extra necessária pra deslizar sem revelar borda vazia
  parallaxTargets = (REDUCE_MOTION || isMobileView()) ? [] : $$(".polaroid:not(.polaroid--album) .polaroid__frame img");
}
function tickGridParallax(){
  if (parallaxTargets.length){
    const vh = window.innerHeight;
    parallaxTargets.forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return; // fora da tela, não vale o custo
      const center = rect.top + rect.height / 2;
      const dist = Math.max(-1, Math.min(1, (center - vh / 2) / vh));
      img.style.transform = `translateY(${(dist * 16).toFixed(1)}px)`;
    });
  }
  requestAnimationFrame(tickGridParallax);
}
requestAnimationFrame(tickGridParallax);

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
// Gerenciador embutido — abrir/fechar
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
// Barra inferior (celular) — destaca a aba da seção visível
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
// Recalcula ao redimensionar (ex: girar o celular) — só quando
// cruza a fronteira mobile/desktop, pra não re-renderizar à toa
// ============================================================
let lastWasMobile = isMobileView();
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nowMobile = isMobileView();
    if (nowMobile !== lastWasMobile){
      lastWasMobile = nowMobile;
      renderMural();
    }
    // troca de monitor, janela redimensionada, celular girado — o
    // mosaico do hero recalcula o grid (cols/rows) e só re-renderiza
    // de fato se o formato realmente mudou, pra não replicar a animação
    // de entrada à toa em tremidas pequenas (barra de endereço sumindo etc.)
    const nextGrid = computeHeroGrid();
    if (!lastHeroGrid || nextGrid.cols !== lastHeroGrid.cols || nextGrid.rows !== lastHeroGrid.rows){
      renderHeroMosaic();
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
// Init
// ============================================================
stampApertures(document);
renderHeroMosaic();
renderFilters();
renderMural();
renderTimeline();
observeReveals();
