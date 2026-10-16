/* 备忘录 + 相册同步逻辑（通过 GitHub API 读写仓库） */
const API = "https://api.github.com";
const RAW = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/`;
const MEMO_FILE = "data/memos.json";
const PHOTO_DIR = "data/photos";

let memosData = { memos: [] };
let memosSha = null;
let pendingPhotos = []; // 待上传的 File 对象

/* ---------- 基础工具 ---------- */
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2000);
}

function showLoading(on) {
  $("loading").classList.toggle("hidden", !on);
}

// UTF-8 安全的 base64 编解码
function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ---------- GitHub API ---------- */
async function gh(path, options = {}) {
  const res = await fetch(`${API}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CONFIG.token}`,
      Accept: "application/vnd.github+json",
      ...(options.headers || {})
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API 错误: ${res.status}`);
  return res.json();
}

async function uploadFile(path, base64Content, message) {
  const existing = await gh(path);
  const body = { message, content: base64Content, branch: CONFIG.branch };
  if (existing && existing.sha) body.sha = existing.sha;
  await gh(path, { method: "PUT", body: JSON.stringify(body) });
}

/* ---------- 备忘录数据 ---------- */
async function loadMemos() {
  const file = await gh(MEMO_FILE);
  if (file) {
    memosSha = file.sha;
    memosData = JSON.parse(b64decode(file.content.replace(/\n/g, "")));
  } else {
    memosData = { memos: [] };
    memosSha = null;
  }
}

async function saveMemos(msg) {
  const content = b64encode(JSON.stringify(memosData, null, 2));
  const body = { message: msg, content, branch: CONFIG.branch };
  if (memosSha) body.sha = memosSha;
  const res = await gh(MEMO_FILE, { method: "PUT", body: JSON.stringify(body) });
  memosSha = res.content.sha;
}

/* ---------- 渲染 ---------- */
function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderMemos() {
  const list = $("memoList");
  list.innerHTML = "";
  [...memosData.memos].sort((a, b) => b.time - a.time).forEach((m) => {
    const card = document.createElement("div");
    card.className = "card";
    const photos = (m.photos || [])
      .map((p) => `<img src="${RAW}${p}" loading="lazy" onclick="viewPhoto('${RAW}${p}')">`)
      .join("");
    card.innerHTML = `
      <div class="memo-time">${formatTime(m.time)}
        <button class="memo-del" data-id="${m.id}">✕</button>
      </div>
      <div class="memo-text">${m.text.replace(/</g, "&lt;")}</div>
      ${photos ? `<div class="memo-photos">${photos}</div>` : ""}
    `;
    card.querySelector(".memo-del").onclick = () => deleteMemo(m.id);
    list.appendChild(card);
  });
}

async function renderAlbum() {
  const grid = $("albumGrid");
  grid.innerHTML = "";
  const files = await gh(PHOTO_DIR);
  if (!files || !Array.isArray(files)) {
    grid.innerHTML = '<p class="album-tip">还没有照片</p>';
    return;
  }
  files
    .filter((f) => f.type === "file")
    .sort((a, b) => b.name.localeCompare(a.name))
    .forEach((f) => {
      const img = document.createElement("img");
      img.src = f.download_url;
      img.loading = "lazy";
      img.onclick = () => viewPhoto(f.download_url);
      grid.appendChild(img);
    });
}

function viewPhoto(url) {
  $("viewerImg").src = url;
  $("viewer").classList.remove("hidden");
}

/* ---------- 操作 ---------- */
async function addMemo() {
  const text = $("memoText").value.trim();
  if (!text && pendingPhotos.length === 0) {
    toast("先写点内容或选张照片");
    return;
  }
  showLoading(true);
  try {
    const paths = [];
    for (const f of pendingPhotos) {
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      await uploadFile(`${PHOTO_DIR}/${name}`, await fileToBase64(f), "网页上传照片");
      paths.push(`${PHOTO_DIR}/${name}`);
    }
    memosData.memos.push({
      id: Date.now().toString(36),
      text,
      photos: paths,
      time: Date.now()
    });
    await saveMemos("新增备忘录");
    $("memoText").value = "";
    pendingPhotos = [];
    $("previewRow").innerHTML = "";
    renderMemos();
    toast("已保存 ✓");
  } catch (e) {
    toast("保存失败：" + e.message);
  }
  showLoading(false);
}

async function deleteMemo(id) {
  if (!confirm("删除这条备忘录？")) return;
  showLoading(true);
  try {
    memosData.memos = memosData.memos.filter((m) => m.id !== id);
    await saveMemos("删除备忘录");
    renderMemos();
    toast("已删除");
  } catch (e) {
    toast("删除失败：" + e.message);
  }
  showLoading(false);
}

async function refresh() {
  showLoading(true);
  try {
    await loadMemos();
    renderMemos();
    await renderAlbum();
  } catch (e) {
    toast("同步失败：" + e.message);
  }
  showLoading(false);
}

/* ---------- 事件绑定 ---------- */
$("photoInput").onchange = (e) => {
  pendingPhotos = [...e.target.files];
  const row = $("previewRow");
  row.innerHTML = "";
  pendingPhotos.forEach((f) => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    row.appendChild(img);
  });
  e.target.value = "";
};

$("saveBtn").onclick = addMemo;
$("refreshBtn").onclick = refresh;
$("viewer").onclick = () => $("viewer").classList.add("hidden");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.page).classList.add("active");
    $("headerTitle").textContent = tab.dataset.page === "pageMemo" ? "备忘录" : "相册";
    if (tab.dataset.page === "pageAlbum") renderAlbum();
  };
});

/* ---------- 启动 ---------- */
refresh();
