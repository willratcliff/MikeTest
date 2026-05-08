// wiki-link.js
//
// Augments each plant card on mikesplants.com with a "Read about this clone"
// link that points to the corresponding entry on wiki.mikesplants.com.
//
// Match resolution order:
//   1) wiki-overrides.json (in this repo) — Mike's manual map plant-id → path
//      (or `false` to suppress an auto-match)
//   2) algorithmic match against wiki-lookup.json (published by the wiki)
//
// Renders only HIGH/MEDIUM-confidence algorithmic matches. LOW-confidence
// fallbacks (just-the-species index page) are too noisy and dropped.

(function () {
  "use strict";

  const WIKI_LOOKUP_URL = "https://wiki.mikesplants.com/wiki-lookup.json";
  const OVERRIDES_URL = "wiki-overrides.json"; // same-origin
  const WIKI_BASE = "https://wiki.mikesplants.com";

  let wikiData = null;       // { lookup: [...], overrides: {} } — populated by load()
  let loadPromise = null;    // Single-flight loader.

  // ---- public API ---------------------------------------------------------

  // Resolve a wiki URL for a single plant (synchronous if data is loaded;
  // returns null otherwise). Use after `await wikiLink.load()` to be safe.
  function getWikiUrl(plant) {
    if (!wikiData) return null;
    return resolveWikiUrl(plant, wikiData);
  }

  // Load wiki lookup + overrides (single-flight). Resolves to true on
  // success, false on failure (links simply won't render).
  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const [lookupRes, overridesRes] = await Promise.allSettled([
          fetch(WIKI_LOOKUP_URL, { cache: "force-cache" }),
          fetch(OVERRIDES_URL, { cache: "no-cache" }),
        ]);
        if (lookupRes.status !== "fulfilled" || !lookupRes.value.ok) {
          console.warn("wiki-link: failed to load wiki-lookup.json");
          return false;
        }
        const lookup = await lookupRes.value.json();
        let overrides = {};
        if (overridesRes.status === "fulfilled" && overridesRes.value.ok) {
          try {
            overrides = await overridesRes.value.json();
          } catch (e) {
            console.warn("wiki-link: wiki-overrides.json malformed, ignoring");
          }
        }
        wikiData = { lookup, overrides };
        return true;
      } catch (e) {
        console.warn("wiki-link: load failed", e);
        return false;
      }
    })();
    return loadPromise;
  }

  // Sweep the DOM for plant cards and append wiki links. Idempotent —
  // skips cards that already have a `.wiki-link` element. Useful both
  // for cards rendered before the data was loaded AND for cards added
  // by category re-renders.
  function decorateAllCards() {
    if (!wikiData) return;
    const cards = document.querySelectorAll(".plant-card");
    cards.forEach((card) => {
      if (card.querySelector(".wiki-link")) return;
      const plantId = card.querySelector(".plant-id")?.textContent?.trim();
      const plantName = card.querySelector(".plant-name")?.textContent?.trim();
      const plantLocation = card.querySelector(".plant-location")?.textContent?.trim();
      if (!plantId || !plantName) return;
      const href = resolveWikiUrl(
        { id: plantId, name: plantName, location: plantLocation || "" },
        wikiData
      );
      if (href) appendWikiLink(card, href);
    });
  }

  // Wait for plant cards to appear (renderPlantGrid is async-ish), then
  // decorate. We watch for both the initial render and category switches.
  function watchForRenders() {
    const observer = new MutationObserver(() => decorateAllCards());
    observer.observe(document.body, { childList: true, subtree: true });
    // Also try immediately in case cards already exist.
    decorateAllCards();
  }

  // ---- DOM injection ------------------------------------------------------

  function appendWikiLink(card, href) {
    const info = card.querySelector(".plant-info");
    if (!info) return;
    const a = document.createElement("a");
    a.className = "wiki-link";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML =
      '<span class="wiki-icon" aria-hidden="true">📖</span>' +
      '<span class="wiki-text">Read about this clone</span>' +
      '<span class="wiki-arrow" aria-hidden="true">↗</span>';
    // Stop card-click handler from firing.
    a.addEventListener("click", (e) => e.stopPropagation());
    info.appendChild(a);
  }

  // Inject the link's CSS once.
  function injectStyles() {
    if (document.getElementById("wiki-link-styles")) return;
    const style = document.createElement("style");
    style.id = "wiki-link-styles";
    style.textContent = `
      .plant-card .wiki-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding: 6px 12px;
        font-size: 0.875rem;
        font-weight: 500;
        color: #2c3e2d;
        background: #eaf3eb;
        border: 1px solid #c8dcc9;
        border-radius: 6px;
        text-decoration: none;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }
      .plant-card .wiki-link:hover {
        background: #2c3e2d;
        border-color: #2c3e2d;
        color: #fff;
      }
      .plant-card .wiki-icon { font-size: 0.95rem; }
      .plant-card .wiki-arrow { font-size: 0.85rem; opacity: 0.7; }
    `;
    document.head.appendChild(style);
  }

  // ---- match resolution ---------------------------------------------------

  function resolveWikiUrl(plant, data) {
    // Only manual overrides produce links. Algorithmic matching is
    // disabled because it produced too many false positives across
    // similar-sounding cultivars (e.g. 'Hidden Beauty' → leuco Sumter,
    // 'tall, vigorous' → leuco RED Breeder Clone Franklin).
    // For listings absent from wiki-overrides.json, no link is shown.
    if (plant.id && Object.prototype.hasOwnProperty.call(data.overrides, plant.id)) {
      const v = data.overrides[plant.id];
      if (v === false || v == null || v === "") return null;
      return WIKI_BASE + "/" + String(v).replace(/^\/+/, "").replace(/\/+$/, "") + "/";
    }
    return null;
  }

  // ---- matcher (mirrors scripts/match_inventory.py) -----------------------

  const GENUS_ABBREVS = {
    S: "Sarracenia", D: "Dionaea", C: "Cephalotus",
    U: "Utricularia", Dr: "Drosera", P: "Pinguicula",
  };
  const TRUE_SARRACENIA = new Set([
    "alabamensis", "alata", "flava", "jonesii", "leucophylla", "minor",
    "oreophila", "psittacina", "purpurea", "rosea", "rubra", "montana",
  ]);
  const TRUE_SPECIES = {
    Sarracenia: TRUE_SARRACENIA,
    Dionaea: new Set(["muscipula"]),
    Cephalotus: new Set(["follicularis"]),
    Drosera: new Set(["binata", "capensis", "filiformis", "intermedia", "rotundifolia"]),
  };
  const LOCATION_RE = /([A-Za-z\.\s]+?)\s*(?:Co\.?|County)\s*,?\s*([A-Z]{2})\b/i;

  function norm(s) { return (s || "").toString().toLowerCase().trim(); }

  function parseName(name) {
    const text = (name || "").trim();
    const isVarious = text.toLowerCase().includes("various clone");
    let textClean = text.replace(/\(various clones?\)/ig, "").trim();

    let genus = null, genusAbbrev = null;
    let m = textClean.match(/^([A-Z][a-z]+)\s+/);
    if (m && TRUE_SPECIES[m[1]]) {
      genus = m[1];
      textClean = textClean.slice(m[0].length).trim();
    } else {
      m = textClean.match(/^([A-Za-z]+)\.\s+/);
      if (m) {
        genusAbbrev = m[1];
        genus = GENUS_ABBREVS[genusAbbrev] || null;
        textClean = textClean.slice(m[0].length).trim();
      }
    }
    if (!genus) return { genus: null, raw: text };

    let isHybrid = false;
    if (/^[x×]\s+/i.test(textClean)) {
      isHybrid = true;
      textClean = textClean.replace(/^[x×]\s+/i, "").trim();
    }

    let cultivar = null;
    const cultM = textClean.match(/'([^']+)'/);
    if (cultM) {
      cultivar = cultM[1];
      textClean = (textClean.slice(0, cultM.index) + textClean.slice(cultM.index + cultM[0].length)).trim();
    }

    let parts = textClean.length ? textClean.split(/\s+/) : [];
    let species = null;
    const realSpecies = TRUE_SPECIES[genus] || new Set();
    if (parts.length && realSpecies.has(parts[0].toLowerCase())) {
      species = parts[0].toLowerCase();
      parts = parts.slice(1);
    } else {
      isHybrid = true;
    }

    let infraRank = null, infraName = null;
    if (parts.length && /^(var|ssp|subsp|f)\.?$/i.test(parts[0])) {
      infraRank = parts[0].replace(/\.$/, "").toLowerCase();
      infraName = parts.length > 1 ? parts[1].toLowerCase() : null;
      parts = parts.slice(2);
    }

    let cloneLetter = null;
    if (parts.length >= 2 && parts[0].toLowerCase() === "clone" && parts[1].length <= 3) {
      cloneLetter = parts[1].replace(/,$/, "").toUpperCase();
      parts = parts.slice(2);
    }

    const leftover = parts.join(" ").trim();
    if (leftover && !cultivar) cultivar = leftover;

    return { genus, genusAbbrev, species, isHybrid, infraspecificRank: infraRank,
             infraspecificName: infraName, cultivar, cloneLetter, isVarious, raw: text };
  }

  function parseLocation(loc) {
    if (!loc) return [null, null];
    const m = LOCATION_RE.exec(loc);
    if (m) return [m[2].toUpperCase(), m[1].trim()];
    const stateOnly = /,\s*([A-Z]{2})\s*$/.exec(loc);
    if (stateOnly) return [stateOnly[1].toUpperCase(), null];
    return [null, null];
  }

  function findMatch(parsed, location, wiki) {
    if (!parsed.genus) return { match: null, confidence: "none" };
    const genus = norm(parsed.genus);
    const [state, county] = parseLocation(location);

    // No-species path: hybrids and naked-cultivar listings.
    if (parsed.isHybrid && parsed.cultivar) {
      const cult = norm(parsed.cultivar);
      const inGenus = wiki.filter((w) => norm(w.genus) === genus);
      const hybrids = inGenus.filter((w) => w.hybrid);
      for (const pool of [hybrids, inGenus]) {
        const hits = pool.filter((w) => norm(w.cultivar) === cult);
        if (hits.length) return { match: hits[0], confidence: "high" };
        const shortHits = pool.filter((w) => cult === norm(w.short_name));
        if (shortHits.length) return { match: shortHits[0], confidence: "high" };
      }
      for (const pool of [hybrids, inGenus]) {
        const subs = pool.filter((w) => cult && (norm(w.full_name).includes(cult) || norm(w.short_name).includes(cult)));
        if (subs.length) return { match: subs[0], confidence: "medium" };
      }
      return { match: null, confidence: "none" };
    }

    if (!parsed.species) return { match: null, confidence: "none" };
    const species = norm(parsed.species);
    const base = wiki.filter((w) => norm(w.genus) === genus && norm(w.species) === species);
    if (!base.length) return { match: null, confidence: "none" };

    const varL = norm(parsed.infraspecificName);

    // Tier 1 (high): cultivar match within the same variety.
    if (parsed.cultivar && !parsed.isVarious) {
      const cult = norm(parsed.cultivar);
      const sameVar = varL ? base.filter((w) => norm(w.infraspecific_name) === varL) : base;
      const exact = sameVar.filter((w) => norm(w.cultivar) === cult);
      if (exact.length) return { match: exact[0], confidence: "high" };
      const sub = sameVar.filter((w) => norm(w.full_name).includes(cult) || norm(w.short_name).includes(cult));
      if (sub.length) return { match: sub[0], confidence: "high" };
    }

    // "clone X" letter match.
    if (parsed.cloneLetter && varL) {
      const letter = parsed.cloneLetter.toLowerCase();
      let pool = base.filter((w) => norm(w.infraspecific_name) === varL);
      if (state && county) {
        const locFiltered = pool.filter((w) => norm(w.state) === norm(state) && norm(w.county) === norm(county));
        if (locFiltered.length) pool = locFiltered;
      }
      const slugHits = pool.filter((w) => w.id.includes(`/clone-${letter}-`) || w.id.endsWith(`/clone-${letter}`));
      if (slugHits.length) return { match: slugHits[0], confidence: "high" };
    }

    // Tier 2 (medium): species + variety + county + state.
    if (varL && county && state) {
      const loc = base.filter((w) =>
        norm(w.infraspecific_name) === varL &&
        norm(w.state) === norm(state) &&
        norm(w.county) === norm(county));
      if (loc.length) return { match: loc[0], confidence: "medium" };
    }

    // Tier 3 (low): species + variety match — not auto-rendered.
    if (varL) {
      const var_ = base.filter((w) => norm(w.infraspecific_name) === varL);
      if (var_.length) return { match: var_[0], confidence: "low" };
    }

    // Tier 4 (low): just species — not auto-rendered.
    return { match: base[0], confidence: "low" };
  }

  // ---- bootstrap ----------------------------------------------------------

  injectStyles();
  load().then(() => watchForRenders());

  // Expose for debugging.
  window.wikiLink = { load, getWikiUrl, decorateAllCards };
})();
