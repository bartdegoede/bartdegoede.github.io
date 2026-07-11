/**
 * Three-arm in-browser semantic search benchmark widget.
 *
 * Runs three query encoders (potion, MiniLM q8, ternlight base) against
 * identical frozen document vectors, entirely in the reader's browser, so
 * the numbers in the accompanying post are reproducible on the reader's own
 * hardware rather than quoted from a benchmark machine.
 *
 * Nothing loads until a reader clicks a Run button: no model, no frozen
 * doc vectors. Even the model-size constants below require no network
 * round trip - see the "download" column note in the UI for why those
 * can't be measured live (HuggingFace serves model_quantized.onnx without
 * Timing-Allow-Origin, so performance.getEntriesByType("resource") reports
 * transferSize 0 for it no matter how the fetch happens).
 *
 * Reuses assets/js/semantic/{index,embed,search}.js rather than
 * reimplementing tokenization or scoring - this widget only adds the
 * timing harness and the two CDN-loaded arms around that existing code.
 */

import { loadIndex, searchSemantic } from "../../semantic/index.js";
import { embedQuery } from "../../semantic/embed.js";
import { cosineScores, rollupToPosts } from "../../semantic/search.js";

const FROZEN_BASE = "/search-benchmark";
const RUNS_PER_TIMING = 10;

// Measured constants (jsDelivr/HuggingFace transfer sizes, gzipped where
// applicable). See the module doc comment above for why these can't be
// measured live from this page.
const DOWNLOAD_BYTES = {
  potion: 4205974,
  minilm: 23451268,
  ternlight: 7172511,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(0)} ms`;
}

function formatBytes(bytes) {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

/** post -> {title, href}, built from any chunk array that has post/title/href fields. */
function buildPostMeta(chunks) {
  const meta = new Map();
  for (const chunk of chunks) {
    if (!meta.has(chunk.post)) {
      meta.set(chunk.post, { title: chunk.title, href: chunk.href });
    }
  }
  return meta;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTop3(ranked, postMeta) {
  if (!ranked || ranked.length === 0) {
    return '<span class="ss-benchmark-empty">(no results)</span>';
  }
  const items = ranked.slice(0, 3).map(([post, score]) => {
    const meta = postMeta.get(post);
    const title = meta ? meta.title : post;
    return `<li>${escapeHtml(title)} <span class="ss-benchmark-score">(${score.toFixed(3)})</span></li>`;
  });
  return `<ol class="ss-benchmark-top3">${items.join("")}</ol>`;
}

// --- Frozen benchmark artifacts (static/search-benchmark/) --------------
//
// manifest.json and chunks.json are small JSON, not the multi-MB .bin
// vectors, so fetching the manifest on page load (to render the "corpus
// frozen at" note) does not violate the "nothing loads until Run is
// clicked" rule - that rule is about model downloads and doc vectors.

let frozenManifestPromise = null;
function loadFrozenManifest() {
  if (!frozenManifestPromise) {
    frozenManifestPromise = fetch(`${FROZEN_BASE}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`failed to fetch ${FROZEN_BASE}/manifest.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return frozenManifestPromise;
}

let frozenChunksPromise = null;
function loadFrozenChunks() {
  if (!frozenChunksPromise) {
    frozenChunksPromise = fetch(`${FROZEN_BASE}/chunks.json`).then((r) => {
      if (!r.ok) throw new Error(`failed to fetch ${FROZEN_BASE}/chunks.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return frozenChunksPromise;
}

const frozenDocsPromises = {};
function loadFrozenDocs(armName, path, expectedBytes) {
  if (!frozenDocsPromises[armName]) {
    frozenDocsPromises[armName] = fetch(`${FROZEN_BASE}/${path}`)
      .then((r) => {
        if (!r.ok) throw new Error(`failed to fetch ${FROZEN_BASE}/${path}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const docs = new Int8Array(buf);
        if (docs.byteLength !== expectedBytes) {
          throw new Error(
            `${path} is ${docs.byteLength} bytes, expected ${expectedBytes} - a truncated fetch shifts every row`
          );
        }
        return docs;
      });
  }
  return frozenDocsPromises[armName];
}

/** Frozen manifest + chunks + this arm's docs.bin, all memoized. */
async function loadFrozenArm(armName) {
  const manifest = await loadFrozenManifest();
  const armInfo = manifest.arms[armName];
  const [chunks, docs] = await Promise.all([
    loadFrozenChunks(),
    loadFrozenDocs(armName, armInfo.docs, manifest.n_chunks * armInfo.dims),
  ]);
  return { manifest, chunks, docs, dims: armInfo.dims, nChunks: manifest.n_chunks };
}

function scoreAgainstFrozen(vector, frozen) {
  const scores = cosineScores(vector, frozen.docs, frozen.nChunks, frozen.dims);
  const posts = frozen.chunks.map((c) => c.post);
  return rollupToPosts(posts, scores);
}

// --- Arm definitions ------------------------------------------------------
//
// Each arm exposes load() (memoized by the caller), embedOnce(state, query)
// and searchOnce(state, vector). load() and any CDN imports inside it are
// the only place network I/O happens for MiniLM/ternlight; potion's load()
// delegates entirely to the existing loadIndex().

const ARMS = {
  potion: {
    label: "potion (ours)",
    async load() {
      const idx = await loadIndex();
      return { idx, postMeta: buildPostMeta(idx.chunks) };
    },
    embedOnce(state, query) {
      const ids = state.idx.wp.encode(query);
      if (ids.length === 0) return null; // fully out-of-vocabulary query
      return embedQuery(ids, state.idx.tokens, state.idx.scales, state.idx.manifest.dims);
    },
    searchOnce(state, vector) {
      if (!vector) return [];
      const scores = cosineScores(vector, state.idx.docs, state.idx.manifest.n_chunks, state.idx.manifest.dims);
      const posts = state.idx.chunks.map((c) => c.post);
      return rollupToPosts(posts, scores);
    },
    // Rendering goes through the unmodified searchSemantic() rather than
    // the granular embedOnce/searchOnce split above, so what the widget
    // *shows* is provably the same code path the live site ships. The
    // split above exists only to produce separate embed/search timings.
    async searchForDisplay(query) {
      return searchSemantic(query);
    },
  },

  minilm: {
    label: "MiniLM q8",
    loadingLabel: "downloading model…",
    async load() {
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm"
      );
      env.allowLocalModels = false;
      const extract = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
      const frozen = await loadFrozenArm("minilm");
      return { extract, frozen, postMeta: buildPostMeta(frozen.chunks) };
    },
    async embedOnce(state, query) {
      const out = await state.extract(query, { pooling: "mean", normalize: true });
      return out.data;
    },
    searchOnce(state, vector) {
      return scoreAgainstFrozen(vector, state.frozen);
    },
  },

  ternlight: {
    label: "ternlight base",
    async load() {
      const base = "https://cdn.jsdelivr.net/npm/@ternlight/base@0.1.0/pkg-bundler/";
      const bg = await import(base + "tern_engine_bg.js");
      const bytes = await (await fetch(base + "tern_engine_bg.wasm")).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, { "./tern_engine_bg.js": bg });
      bg.__wbg_set_wasm(instance.exports);
      instance.exports.__wbindgen_start?.();
      const frozen = await loadFrozenArm("ternlight");
      return { bg, frozen, postMeta: buildPostMeta(frozen.chunks) };
    },
    embedOnce(state, query) {
      return state.bg.embed(query);
    },
    searchOnce(state, vector) {
      return scoreAgainstFrozen(vector, state.frozen);
    },
  },
};

// --- Widget -----------------------------------------------------------

function buildWidget(root) {
  root.innerHTML = `
    <div class="ss-benchmark">
      <label class="ss-benchmark-query-label" for="ss-benchmark-query">Query</label>
      <input id="ss-benchmark-query" class="ss-benchmark-query" type="text"
        value="find documents by what they mean" autocomplete="off">
      <table class="ss-benchmark-table">
        <thead>
          <tr>
            <th>Arm</th>
            <th>Run</th>
            <th>Download<br><span class="ss-benchmark-subhead">(measured constant)</span></th>
            <th>Ready<br><span class="ss-benchmark-subhead">(live)</span></th>
            <th>Embed<br><span class="ss-benchmark-subhead">(live, median of ${RUNS_PER_TIMING})</span></th>
            <th>Search<br><span class="ss-benchmark-subhead">(live)</span></th>
            <th>Top 3 posts<br><span class="ss-benchmark-subhead">(live)</span></th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(ARMS)
            .map(
              ([id, arm]) => `
            <tr data-arm="${id}">
              <td class="ss-benchmark-arm">${escapeHtml(arm.label)}</td>
              <td><button type="button" class="ss-benchmark-run" data-arm="${id}">Run</button></td>
              <td class="ss-benchmark-download">${formatBytes(DOWNLOAD_BYTES[id])}</td>
              <td class="ss-benchmark-ready">—</td>
              <td class="ss-benchmark-embed">—</td>
              <td class="ss-benchmark-search">—</td>
              <td class="ss-benchmark-top3">—</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="ss-benchmark-note">Corpus frozen at 13 posts, <span class="ss-benchmark-frozen-at">loading…</span>. Download sizes are measured constants; times are live on your device.</p>
    </div>
  `;

  loadFrozenManifest()
    .then((manifest) => {
      const el = root.querySelector(".ss-benchmark-frozen-at");
      if (el) el.textContent = manifest.frozen_at;
    })
    .catch((err) => {
      const el = root.querySelector(".ss-benchmark-frozen-at");
      if (el) el.textContent = "(unavailable)";
      console.error("benchmark widget: failed to load frozen manifest", err);
    });

  const armState = {}; // id -> memoized load() promise, once it has resolved successfully

  root.querySelectorAll(".ss-benchmark-run").forEach((button) => {
    button.addEventListener("click", () => runArm(root, button.dataset.arm, armState));
  });
}

async function runArm(root, armId, armState) {
  const arm = ARMS[armId];
  const row = root.querySelector(`tr[data-arm="${armId}"]`);
  const button = row.querySelector(".ss-benchmark-run");
  const readyCell = row.querySelector(".ss-benchmark-ready");
  const embedCell = row.querySelector(".ss-benchmark-embed");
  const searchCell = row.querySelector(".ss-benchmark-search");
  const top3Cell = row.querySelector(".ss-benchmark-top3");
  const queryInput = root.querySelector("#ss-benchmark-query");
  const query = queryInput.value.trim();

  row.classList.remove("ss-benchmark-row-error");
  button.disabled = true;
  const wasAlreadyLoaded = Boolean(armState[armId]);
  button.textContent = wasAlreadyLoaded ? "Running…" : arm.loadingLabel || "Loading…";
  if (!wasAlreadyLoaded) {
    readyCell.textContent = "loading…";
  }
  embedCell.textContent = "…";
  searchCell.textContent = "…";
  top3Cell.textContent = "…";

  let state;
  try {
    if (!armState[armId]) {
      armState[armId] = arm.load(); // memoize the in-flight promise itself
    }
    const readyStart = performance.now();
    try {
      state = await armState[armId];
    } catch (loadErr) {
      delete armState[armId]; // a failed load must not be memoized as if it succeeded
      throw loadErr;
    }
    const readyMs = performance.now() - readyStart;
    readyCell.textContent = formatMs(readyMs);
  } catch (err) {
    reportArmError(row, readyCell, embedCell, searchCell, top3Cell, button, err, armId);
    return;
  }

  try {
    // Median-of-N timing for embed and search separately. The query is
    // re-embedded/re-searched fresh on every Run click (only the
    // model/index load is memoized), so typing a new query and clicking
    // Run again reflects that query, not a cached result.
    const embedTimes = [];
    let vector = null;
    for (let i = 0; i < RUNS_PER_TIMING; i++) {
      const start = performance.now();
      vector = await arm.embedOnce(state, query);
      embedTimes.push(performance.now() - start);
    }
    embedCell.textContent = formatMs(median(embedTimes));

    const searchTimes = [];
    let ranked = [];
    for (let i = 0; i < RUNS_PER_TIMING; i++) {
      const start = performance.now();
      ranked = arm.searchOnce(state, vector);
      searchTimes.push(performance.now() - start);
    }
    searchCell.textContent = formatMs(median(searchTimes));

    // Render from the unmodified production path when the arm provides
    // one (potion); otherwise the last timing-loop ranking is exactly
    // what a non-timed call would have produced, since searchOnce is
    // deterministic given the same vector.
    const displayRanked = arm.searchForDisplay ? await arm.searchForDisplay(query) : ranked;
    top3Cell.innerHTML = renderTop3(displayRanked, state.postMeta);

    button.textContent = "Run";
    button.disabled = false;
  } catch (err) {
    // The model/index itself loaded fine here, so it stays memoized -
    // only load() failures evict the memo (handled above).
    reportArmError(row, readyCell, embedCell, searchCell, top3Cell, button, err, armId);
  }
}

function reportArmError(row, readyCell, embedCell, searchCell, top3Cell, button, err, armId) {
  console.error(`benchmark widget: arm "${armId}" failed`, err);
  row.classList.add("ss-benchmark-row-error");
  if (readyCell.textContent === "loading…") readyCell.textContent = "—";
  embedCell.textContent = "—";
  searchCell.textContent = "—";
  top3Cell.innerHTML = `<span class="ss-benchmark-error">Error: ${escapeHtml(err.message || String(err))}</span>`;
  button.textContent = "Run";
  button.disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("ss-benchmark");
  if (!root) return;
  buildWidget(root);
});
