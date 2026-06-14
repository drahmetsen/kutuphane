// ============================================================
//  app.js  —  Kütüphane & Eserler
// ============================================================
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAGE_SIZE = 25;

// ---- per-tab configuration -------------------------------------------------
// Each tab declares its table, the columns shown in the ledger, the filter
// dropdowns, and the fields in the add/edit form. Adding a column later is a
// one-line change here.
const LANGS = [["tr", "Türkçe"], ["en", "İngilizce"], ["other", "Diğer"]];
const OWNERS = [["A", "A"], ["H", "H"], ["U", "U"], ["E", "E"], ["Z", "Z"]];
const WORK_TYPES = [["article", "Makale"], ["story", "Hikâye"], ["other", "Diğer"]];

const TABS = {
  library: {
    table: "library",
    searchCols: ["title", "author"],
    columns: [
      { key: "title",    label: "Başlık", cls: "cell-title" },
      { key: "author",   label: "Yazar" },
      { key: "publisher", label: "Yayınevi", cls: "hide-sm" },
      { key: "year",     label: "Yıl",   cls: "hide-sm" },
      { key: "pages",    label: "Sayfa", cls: "hide-sm" },
      { key: "original_language", label: "Orij. Dil", cls: "hide-sm" },
      { key: "field",    label: "Alan",  cls: "hide-sm", render: tag },
      { key: "owner",    label: "Sahip", render: tag },
    ],
    filters: [
      { key: "owner",    label: "Sahip",   options: OWNERS },
      { key: "language", label: "Dil",     options: LANGS },
      { key: "field",    label: "Alan",    dynamic: true },
    ],
    fields: [
      { key: "title",    label: "Başlık", type: "text", required: true, full: true },
      { key: "author",   label: "Yazar",  type: "text" },
      { key: "publisher", label: "Yayınevi", type: "text" },
      { key: "year",     label: "Yıl",    type: "number" },
      { key: "pages",    label: "Sayfa sayısı", type: "number" },
      { key: "language", label: "Dil (baskı)", type: "select", options: LANGS },
      { key: "original_language", label: "Orijinal dil", type: "text" },
      { key: "type",     label: "Tür",    type: "text" },
      { key: "field",    label: "Alan",   type: "text" },
      { key: "owner",    label: "Sahip",  type: "select", options: OWNERS, required: true },
    ],
  },
  works: {
    table: "works",
    searchCols: ["title", "authors"],
    columns: [
      { key: "title",   label: "Başlık", cls: "cell-title" },
      { key: "authors", label: "Yazarlar" },
      { key: "year",    label: "Yıl",  cls: "hide-sm" },
      { key: "type",    label: "Tür",  render: (v) => tag(labelOf(WORK_TYPES, v)) },
      { key: "external_url", label: "Bağlantı", render: linkCell },
    ],
    filters: [
      { key: "type",     label: "Tür",  options: WORK_TYPES },
      { key: "language", label: "Dil",  options: LANGS },
      { key: "field",    label: "Alan", dynamic: true },
    ],
    fields: [
      { key: "title",        label: "Başlık",    type: "text", required: true, full: true },
      { key: "authors",      label: "Yazarlar",  type: "text", full: true },
      { key: "year",         label: "Yıl",       type: "number" },
      { key: "language",     label: "Dil",       type: "select", options: LANGS },
      { key: "type",         label: "Tür",       type: "select", options: WORK_TYPES },
      { key: "field",        label: "Alan",      type: "text" },
      { key: "external_url", label: "Bağlantı (URL)", type: "text", full: true },
    ],
  },
};

// ---- app state -------------------------------------------------------------
const state = {
  tab: "library",
  search: "",
  filters: {},        // {colKey: value}
  sort: { col: "title", asc: true },
  page: 0,
  total: 0,
  isOwner: false,
  editingId: null,
};

// ---- tiny DOM helpers ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};
function tag(v) { return v ? `<span class="tag">${esc(v)}</span>` : ""; }
function labelOf(pairs, v) { const p = pairs.find((x) => x[0] === v); return p ? p[1] : v; }
function linkCell(v) { return v ? `<a href="${esc(v)}" target="_blank" rel="noopener">aç ↗</a>` : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---- auth ------------------------------------------------------------------
async function refreshAuth() {
  const { data: { user } } = await db.auth.getUser();
  // We don't know the allowlist client-side; we infer ownership by trying.
  // Simpler + safe: treat any logged-in user as a candidate editor; the DB's
  // RLS is the real gate (writes fail for non-owners). We reflect that in UI.
  state.isOwner = !!user;
  $("#who").textContent = user ? user.email : "";
  $("#who").hidden = !user;
  $("#loginBtn").hidden = !!user;
  $("#logoutBtn").hidden = !user;
  $("#addBtn").hidden = !user;
  renderRows(); // re-render so per-row edit buttons appear/disappear
}

async function doLogin() {
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const errEl = $("#loginError");
  errEl.hidden = true;
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = "Giriş başarısız: " + error.message; errEl.hidden = false; return; }
  $("#loginModal").hidden = true;
  $("#password").value = "";
  await refreshAuth();
  toast("Giriş yapıldı");
}

async function doLogout() {
  await db.auth.signOut();
  await refreshAuth();
  toast("Çıkış yapıldı");
}

// ---- data fetch ------------------------------------------------------------
async function fetchRows() {
  const cfg = TABS[state.tab];
  let q = db.from(cfg.table).select("*", { count: "exact" }).eq("is_archived", false);

  // filters
  for (const [k, v] of Object.entries(state.filters)) {
    if (v) q = q.eq(k, v);
  }
  // search (OR across searchable columns)
  if (state.search) {
    const term = state.search.replace(/[%,]/g, " ").trim();
    if (term) q = q.or(cfg.searchCols.map((c) => `${c}.ilike.%${term}%`).join(","));
  }
  // sort + pagination
  q = q.order(state.sort.col, { ascending: state.sort.asc, nullsFirst: false });
  const from = state.page * PAGE_SIZE;
  q = q.range(from, from + PAGE_SIZE - 1);

  const { data, error, count } = await q;
  if (error) { toast("Veri okunamadı: " + error.message); return []; }
  state.total = count ?? 0;
  return data ?? [];
}

let lastRows = [];
async function load() {
  lastRows = await fetchRows();
  renderRows();
  renderPager();
  await maybeFillDynamicFilters();
}

// ---- rendering -------------------------------------------------------------
function renderHead() {
  const cfg = TABS[state.tab];
  const tr = el("tr");
  for (const c of cfg.columns) {
    const arrow = state.sort.col === c.key ? `<span class="arrow">${state.sort.asc ? "↑" : "↓"}</span>` : "";
    const th = el("th", { innerHTML: `${c.label} ${arrow}` });
    if (c.cls) th.className = c.cls;
    th.onclick = () => {
      if (state.sort.col === c.key) state.sort.asc = !state.sort.asc;
      else state.sort = { col: c.key, asc: true };
      state.page = 0;
      load();
    };
    tr.append(th);
  }
  if (state.isOwner) tr.append(el("th", { textContent: "" }));
  $("#thead").replaceChildren(tr);
}

function renderRows() {
  const cfg = TABS[state.tab];
  const body = $("#tbody");
  body.replaceChildren();
  $("#empty").hidden = lastRows.length > 0;

  for (const row of lastRows) {
    const tr = el("tr");
    for (const c of cfg.columns) {
      const td = el("td");
      if (c.cls) td.className = c.cls;
      td.innerHTML = c.render ? c.render(row[c.key]) : esc(row[c.key] ?? "");
      tr.append(td);
    }
    if (state.isOwner) {
      const td = el("td");
      const btn = el("button", { className: "row-edit", textContent: "düzenle" });
      btn.onclick = () => openEdit(row);
      td.append(btn);
      tr.append(td);
    }
    body.append(tr);
  }
  $("#count").textContent = state.total ? `${state.total} kayıt` : "";
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  $("#pageInfo").textContent = `${state.page + 1} / ${pages}`;
  $("#prev").disabled = state.page <= 0;
  $("#next").disabled = state.page >= pages - 1;
}

// ---- filters ---------------------------------------------------------------
function renderFilters() {
  const cfg = TABS[state.tab];
  const box = $("#filters");
  box.replaceChildren();
  for (const f of cfg.filters) {
    const sel = el("select");
    sel.append(el("option", { value: "", textContent: f.label + ": hepsi" }));
    if (!f.dynamic) {
      for (const [val, lab] of f.options) sel.append(el("option", { value: val, textContent: lab }));
    }
    sel.dataset.key = f.key;
    sel.value = state.filters[f.key] ?? "";
    sel.onchange = () => {
      state.filters[f.key] = sel.value || undefined;
      state.page = 0;
      load();
    };
    box.append(sel);
  }
}

// distinct values for "field" come from the data itself
let dynamicFilled = false;
async function maybeFillDynamicFilters() {
  const cfg = TABS[state.tab];
  const dyn = cfg.filters.filter((f) => f.dynamic);
  if (!dyn.length || dynamicFilled) return;
  for (const f of dyn) {
    const { data } = await db.from(cfg.table).select(f.key).eq("is_archived", false).not(f.key, "is", null);
    const vals = [...new Set((data ?? []).map((r) => r[f.key]).filter(Boolean))].sort();
    const sel = [...$("#filters").children].find((s) => s.dataset.key === f.key);
    if (sel) for (const v of vals) sel.append(el("option", { value: v, textContent: v }));
  }
  dynamicFilled = true;
}

// ---- add / edit modal ------------------------------------------------------
function renderForm(row = {}) {
  const cfg = TABS[state.tab];
  const form = $("#form");
  form.replaceChildren();
  for (const f of cfg.fields) {
    const wrap = el("label", { className: "field" + (f.full ? " full" : "") });
    wrap.append(el("span", { textContent: f.label }));
    let input;
    if (f.type === "select") {
      input = el("select");
      input.append(el("option", { value: "", textContent: "—" }));
      for (const [val, lab] of f.options) input.append(el("option", { value: val, textContent: lab }));
    } else {
      input = el("input", { type: f.type });
    }
    input.name = f.key;
    if (f.required) input.required = true;
    if (row[f.key] != null) input.value = row[f.key];
    wrap.append(input);
    form.append(wrap);
  }
}

function openAdd() {
  state.editingId = null;
  $("#modalTitle").textContent = state.tab === "works" ? "Yeni eser" : "Yeni kitap";
  $("#archiveBtn").hidden = true;
  renderForm({});
  $("#modal").hidden = false;
}

function openEdit(row) {
  state.editingId = row.id;
  $("#modalTitle").textContent = "Düzenle";
  $("#archiveBtn").hidden = false;
  renderForm(row);
  $("#modal").hidden = false;
}

function collectForm() {
  const cfg = TABS[state.tab];
  const out = {};
  for (const f of cfg.fields) {
    const input = $("#form").querySelector(`[name="${f.key}"]`);
    let v = input.value.trim();
    if (v === "") { out[f.key] = null; continue; }
    out[f.key] = f.type === "number" ? Number(v) : v;
  }
  return out;
}

async function save() {
  const cfg = TABS[state.tab];
  const payload = collectForm();
  // light client validation
  for (const f of cfg.fields) {
    if (f.required && !payload[f.key]) { toast(f.label + " gerekli"); return; }
  }
  let res;
  if (state.editingId == null) {
    res = await db.from(cfg.table).insert(payload);
  } else {
    res = await db.from(cfg.table).update(payload).eq("id", state.editingId);
  }
  if (res.error) {
    // RLS rejection lands here for non-allowlisted accounts
    toast("Kaydedilemedi: " + res.error.message);
    return;
  }
  $("#modal").hidden = true;
  toast(state.editingId == null ? "Eklendi" : "Güncellendi");
  load();
}

async function archive() {
  if (state.editingId == null) return;
  if (!confirm("Bu kaydı arşivlemek istiyor musunuz? (silinmez, gizlenir)")) return;
  const cfg = TABS[state.tab];
  const { error } = await db.from(cfg.table).update({ is_archived: true }).eq("id", state.editingId);
  if (error) { toast("Arşivlenemedi: " + error.message); return; }
  $("#modal").hidden = true;
  toast("Arşivlendi");
  load();
}

// ---- tab switching ---------------------------------------------------------
function switchTab(name) {
  state.tab = name;
  state.search = "";
  state.filters = {};
  state.sort = { col: "title", asc: true };
  state.page = 0;
  dynamicFilled = false;
  $("#search").value = "";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  renderHead();
  renderFilters();
  load();
}

// ---- wiring ----------------------------------------------------------------
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function init() {
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $("#search").oninput = debounce((e) => { state.search = e.target.value; state.page = 0; load(); }, 300);
  $("#prev").onclick = () => { if (state.page > 0) { state.page--; load(); } };
  $("#next").onclick = () => { state.page++; load(); };

  $("#addBtn").onclick = openAdd;
  $("#cancelBtn").onclick = () => ($("#modal").hidden = true);
  $("#saveBtn").onclick = save;
  $("#archiveBtn").onclick = archive;

  $("#loginBtn").onclick = () => { $("#loginError").hidden = true; $("#loginModal").hidden = false; };
  $("#loginCancel").onclick = () => ($("#loginModal").hidden = true);
  $("#loginSubmit").onclick = doLogin;
  $("#logoutBtn").onclick = doLogout;
  $("#loginForm").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doLogin(); } });

  // close modals on backdrop click / Escape
  for (const id of ["#modal", "#loginModal"]) {
    $(id).addEventListener("click", (e) => { if (e.target.id === id.slice(1)) e.currentTarget.hidden = true; });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("#modal").hidden = true; $("#loginModal").hidden = true; }
  });

  renderHead();
  renderFilters();
  refreshAuth();
  load();
}

init();