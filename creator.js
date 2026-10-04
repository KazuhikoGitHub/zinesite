import { jsonRequest, mediaUrl, request, uploadRequest } from "./api.js";

const categories = ["エッセイ", "写真", "イラスト", "カルチャー", "旅と散歩"];
const A4_RATIO = 210 / 297;
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}
export function creatorPage(layout) {
  return layout(
    `<div class="inner-head"><div><p class="eyebrow">Creator studio / Drafts</p><h1>ZINEを投稿する</h1></div><p>基本情報、入稿、公開確認の順に進みます。</p></div><section class="section"><details class="my-zines-accordion" open><summary class="my-zines-summary"><h2 class="section-title">あなたの作品</h2></summary><div data-my-zines class="creator-zines-list"><div class="empty">--</div></div></details></section><nav class="workflow-steps" data-workflow-steps aria-label="投稿ステップ"><button type="button" data-step="1">1 基本情報</button><button type="button" data-step="2">2 入稿</button><button type="button" data-step="3">3 公開</button></nav><section class="section" data-workflow-content></section>`,
  );
}

// Crops the source file to the frame's on-screen rect, mapped back to natural pixels via the current pan/zoom.
function cropImage(file, state, frameRect) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = state.minZoom * state.zoom;
      const dispW = state.naturalWidth * scale;
      const dispH = state.naturalHeight * scale;
      let cropX = (dispW / 2 - frameRect.width / 2 - state.offsetX) / scale;
      let cropY = (dispH / 2 - frameRect.height / 2 - state.offsetY) / scale;
      let cropW = frameRect.width / scale;
      let cropH = frameRect.height / scale;
      cropX = Math.max(0, Math.min(state.naturalWidth - cropW, cropX));
      cropY = Math.max(0, Math.min(state.naturalHeight - cropH, cropY));
      cropW = Math.round(cropW);
      cropH = Math.round(cropH);
      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      canvas
        .getContext("2d")
        .drawImage(
          image,
          Math.round(cropX),
          Math.round(cropY),
          cropW,
          cropH,
          0,
          0,
          cropW,
          cropH,
        );
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(
                new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
                  type: "image/jpeg",
                }),
              )
            : reject(new Error("画像を切り出せませんでした")),
        "image/jpeg",
        0.9,
      );
    };
    image.onerror = () => reject(new Error("画像を読み込めませんでした"));
    image.src = URL.createObjectURL(file);
  });
}
function cropEditor(file, ratio, label) {
  const state = {
    naturalWidth: 0,
    naturalHeight: 0,
    minZoom: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  };
  const wrapper = document.createElement("div");
  wrapper.className = "crop-editor crop-editor-compact";
  wrapper.innerHTML = `<div class="crop-canvas"><img draggable="false" alt="${label}"><div class="crop-frame" style="aspect-ratio:${ratio}"></div></div><div class="crop-copy"><strong>${label}</strong><small>ドラッグして位置を調整できます</small><label class="crop-zoom-label">拡大 <input type="range" data-crop-zoom min="1" max="3" step="0.01" value="1"></label></div>`;
  const canvas = wrapper.querySelector(".crop-canvas");
  const image = wrapper.querySelector("img");
  const frame = wrapper.querySelector(".crop-frame");
  const zoomInput = wrapper.querySelector("[data-crop-zoom]");

  const clampOffsets = () => {
    const frameRect = frame.getBoundingClientRect();
    const scale = state.minZoom * state.zoom;
    const maxOffsetX = Math.max(0, (state.naturalWidth * scale - frameRect.width) / 2);
    const maxOffsetY = Math.max(0, (state.naturalHeight * scale - frameRect.height) / 2);
    state.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, state.offsetX));
    state.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, state.offsetY));
  };
  const render = () => {
    const scale = state.minZoom * state.zoom;
    image.style.transform = `translate(-50%, -50%) translate(${state.offsetX}px, ${state.offsetY}px) scale(${scale})`;
  };
  image.addEventListener("load", () => {
    requestAnimationFrame(() => {
      state.naturalWidth = image.naturalWidth;
      state.naturalHeight = image.naturalHeight;
      const frameRect = frame.getBoundingClientRect();
      state.minZoom = Math.max(
        frameRect.width / state.naturalWidth,
        frameRect.height / state.naturalHeight,
      );
      state.zoom = 1;
      state.offsetX = 0;
      state.offsetY = 0;
      zoomInput.value = "1";
      render();
    });
  });
  image.src = URL.createObjectURL(file);
  image.addEventListener("dragstart", (event) => event.preventDefault());

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    state.dragging = true;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startOffsetX = state.offsetX;
    state.startOffsetY = state.offsetY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    state.offsetX = state.startOffsetX + (event.clientX - state.startX);
    state.offsetY = state.startOffsetY + (event.clientY - state.startY);
    clampOffsets();
    render();
  });
  const endDrag = () => {
    state.dragging = false;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  zoomInput.addEventListener("input", () => {
    state.zoom = Math.max(1, Math.min(3, Number(zoomInput.value) || 1));
    clampOffsets();
    render();
  });

  wrapper.getCropped = () => cropImage(file, state, frame.getBoundingClientRect());
  return wrapper;
}

function renderStep(state, layout) {
  const content = document.querySelector("[data-workflow-content]");
  const indicator = document.querySelector("[data-workflow-steps]");
  if (!content || !indicator) return;
  indicator.querySelectorAll("[data-step]").forEach((button) => {
    const step = Number(button.dataset.step);
    button.classList.toggle("active", step === state.step);
    button.classList.toggle("complete", step < state.step);
    button.disabled = step > state.step;
  });
  const resetToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (state.step === 1) {
    const existing = state.existing;
    content.innerHTML = `<p class="eyebrow">Step 1 / Basic information</p><h2 class="section-title">タイトルとテーマを決める</h2><form class="form" data-workflow-meta><div class="field"><label>タイトル</label><input name="title" required maxlength="200" value="${escapeHtml(existing?.title)}"></div><div class="field"><label>カテゴリ</label><select name="category" required><option value="">選択してください</option>${categories.map((category) => `<option ${existing?.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></div><div class="field"><label>タグ</label><input name="tags" value="${escapeHtml(existing?.tags)}"></div><div class="field"><label>説明文</label><textarea name="description" required rows="5">${escapeHtml(existing?.description)}</textarea></div><label class="check"><input name="age_restricted" type="checkbox" ${existing && Number(existing.age_restricted) ? "checked" : ""}> 年齢制限・注意書きあり</label><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="button button-dark">基本情報を保存して次へ</button><button type="button" class="button button-outline" data-save-draft>下書き保存して一覧へ</button></div></form>`;
    content.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (state.zineId) data.zine_id = state.zineId;
      const payload = await jsonRequest(
        state.zineId ? "update_zine" : "create_zine",
        data,
      );
      state.zineId = payload.zine_id || state.zineId;
      state.existing = { ...state.existing, ...data };
      state.step = 2;
      renderStep(state, layout);
    });
    content
      .querySelector("[data-save-draft]")
      .addEventListener("click", async () => {
        const form = content.querySelector("form");
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        if (state.zineId) data.zine_id = state.zineId;
        const payload = await jsonRequest(
          state.zineId ? "update_zine" : "create_zine",
          data,
        );
        state.zineId = payload.zine_id || state.zineId;
        state.existing = { ...state.existing, ...data };
        alert("下書きを保存しました");
        location.hash = "#creator";
        resetToTop();
      });
    return;
  }
  if (state.step === 2) {
    content.innerHTML = `<p class="eyebrow">Step 2 / Manuscript</p><h2 class="section-title">表紙と本文を入稿する</h2><p><a class="text-link" href="#creator">保存して一覧へ戻る ↗</a></p><div class="upload-tabs"><button type="button" class="${state.mode === "pdf" ? "active" : ""}" data-upload-tab="pdf">PDF</button><button type="button" class="${state.mode === "images" ? "active" : ""}" data-upload-tab="images">画像</button></div><div data-upload-panel></div><div data-workflow-pages></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="button button-outline" data-workflow-back>戻る</button><button type="button" class="button button-dark" data-workflow-next disabled>入稿を完了して次へ</button></div>`;
    const panel = document.querySelector("[data-upload-panel]");
    const pages = document.querySelector("[data-workflow-pages]");
    const next = document.querySelector("[data-workflow-next]");
    const refresh = async () => {
      const payload = await request("pages", {}, `zine_id=${state.zineId}`);
      state.pages = payload.items || [];
      pages.innerHTML = state.pages.length
        ? `<div class="workflow-pages"><p class="eyebrow">本文ページ</p>${state.pages.map((page, index) => `<article class="workflow-page"><span>${index + 1}</span>${page.file_path.toLowerCase().endsWith(".pdf") ? `<a href="${mediaUrl(page.file_path)}" target="_blank" rel="noopener">PDF本文</a>` : `<img src="${mediaUrl(page.file_path)}" alt="本文ページ ${index + 1}">`}<button type="button" class="button button-outline" data-delete-page="${page.id}">削除</button></article>`).join("")}</div>`
        : '<p class="empty">本文ページを追加してください。</p>';
      pages.querySelectorAll("[data-delete-page]").forEach((button) =>
        button.addEventListener("click", async () => {
          if (!confirm("この本文を削除しますか？")) return;
          await jsonRequest("delete_page", { page_id: Number(button.dataset.deletePage) });
          await refresh();
        }),
      );
      next.disabled = state.pages.length === 0 || !state.coverUploaded;
    };
    const renderPanel = (mode) => {
      state.mode = mode;
      panel.innerHTML =
        mode === "pdf"
          ? `<div class="upload-panel"><h3>PDF本文</h3><form data-pdf-body class="form" enctype="multipart/form-data"><input name="pdf" type="file" accept="application/pdf" required><button class="button button-outline">PDFをアップロード</button></form><h3>PDF表紙画像</h3><form data-cover-form class="form" enctype="multipart/form-data"><input name="cover" type="file" accept="image/jpeg,image/png,image/webp" required><div data-cover-editor></div><button class="button button-outline">表紙をアップロード</button></form>${state.coverUploaded ? '<button type="button" class="button button-outline" data-delete-cover>表紙を削除</button>' : ""}</div>`
          : `<div class="upload-panel"><h3>画像表紙</h3><form data-cover-form class="form" enctype="multipart/form-data"><input name="cover" type="file" accept="image/jpeg,image/png,image/webp" required><div data-cover-editor></div><button class="button button-outline">表紙をアップロード</button></form>${state.coverUploaded ? '<button type="button" class="button button-outline" data-delete-cover>表紙を削除</button>' : ""}<h3>画像本文</h3><form data-pages-form class="form" enctype="multipart/form-data"><input name="pages" type="file" accept="image/jpeg,image/png,image/webp" multiple required><div data-pages-editor></div><button class="button button-outline">本文をアップロード</button></form></div>`;
      panel.querySelector("[data-delete-cover]")?.addEventListener("click", async () => {
        if (!confirm("表紙を削除しますか？")) return;
        await jsonRequest("delete_cover", { zine_id: state.zineId });
        state.coverUploaded = false;
        renderPanel(state.mode);
        await refresh();
      });
      panel.querySelectorAll("[data-cover-form]").forEach((form) => {
        form.querySelector('[name="cover"]').addEventListener("change", () => {
          const file = form.querySelector('[name="cover"]').files[0];
          if (file) {
            const editor = cropEditor(file, A4_RATIO, "表紙");
            form.querySelector("[data-cover-editor]").replaceChildren(editor);
            form._editor = editor;
          }
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const file = form._editor
            ? await form._editor.getCropped()
            : form.querySelector('[name="cover"]').files[0];
          if (!file) return;
          const data = new FormData();
          data.append("zine_id", state.zineId);
          data.append("cover", file);
          await uploadRequest("upload_cover", data);
          state.coverUploaded = true;
          await refresh();
        });
      });
      panel
        .querySelector("[data-pdf-body]")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          data.append("zine_id", state.zineId);
          await uploadRequest("upload_pdf", data);
          await refresh();
        });
      panel
        .querySelector("[data-pages-form]")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const files = form._editors
            ? await Promise.all(form._editors.map((editor) => editor.getCropped()))
            : [...form.querySelector('[name="pages"]').files];
          if (state.pages.length + files.length > 50) {
            alert(`1作品あたりの最大ページ数は50ページです（現在: ${state.pages.length}ページ、追加: ${files.length}ページ）`);
            return;
          }
          const startNumber = state.pages.length + 1;
          for (let index = 0; index < files.length; index += 1) {
            const data = new FormData();
            data.append("zine_id", state.zineId);
            data.append("page_number", startNumber + index);
            data.append("page", files[index]);
            await uploadRequest("upload_page", data);
          }
          form.reset();
          form.querySelector("[data-pages-editor]").replaceChildren();
          form._editors = null;
          await refresh();
        });
      panel
        .querySelector('[data-pages-form] [name="pages"]')
        ?.addEventListener("change", (event) => {
          const form = event.currentTarget.form;
          const editor = document.createElement("div");
          editor.className = "crop-editor crop-editor-grid";
          editor.innerHTML = [...event.currentTarget.files]
            .map((file, index) => `<div data-page-crop="${index}"></div>`)
            .join("");
          form.querySelector("[data-pages-editor]").replaceChildren(editor);
          form._editors = [...event.currentTarget.files].map((file, index) => {
                        const item = cropEditor(file, A4_RATIO, `本文 ${index + 1}`);
            editor
              .querySelector(`[data-page-crop="${index}"]`)
              .replaceChildren(item);
            return item;
          });
        });
    };
    document.querySelectorAll("[data-upload-tab]").forEach((button) =>
      button.addEventListener("click", () => {
        document
          .querySelectorAll("[data-upload-tab]")
          .forEach((item) => item.classList.toggle("active", item === button));
        renderPanel(button.dataset.uploadTab);
      }),
    );
    content.querySelector("[data-workflow-back]").addEventListener("click", () => {
      state.step = 1;
      renderStep(state, layout);
    });
    next.addEventListener("click", () => {
      state.step = 3;
      renderStep(state, layout);
    });
    renderPanel(state.mode);
    refresh();
    return;
  }
  content.innerHTML = `<p class="eyebrow">Step 3 / Publish</p><h2 class="section-title">確認して公開する</h2><p>表紙と本文ページが揃っています。</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="button button-outline" data-workflow-back>戻る</button><button type="button" class="button button-dark" data-workflow-publish>公開</button><button type="button" class="button button-outline" data-workflow-save-draft>下書き保存</button></div>`;
  content.querySelector("[data-workflow-back]").addEventListener("click", () => {
    state.step = 2;
    renderStep(state, layout);
  });
  content
    .querySelector("[data-workflow-publish]")
    .addEventListener("click", async () => {
      await jsonRequest("publish_zine", { zine_id: state.zineId });
      alert("ZINEを公開しました");
      location.hash = "#creator";
      resetToTop();
    });
  content
    .querySelector("[data-workflow-save-draft]")
    .addEventListener("click", () => {
      alert("下書きを保存しました");
      location.hash = "#creator";
      resetToTop();
    });
}

export async function activateCreator(layout) {
  if (location.hash.slice(1).split("?")[0] !== "creator") return;
  const zineId = Number(
    new URLSearchParams(location.hash.split("?")[1] || "").get("id") || 0,
  );
  const state = {
    step: 1,
    zineId: zineId || 0,
    mode: "pdf",
    pages: [],
    coverUploaded: false,
    existing: null,
  };
  if (zineId) {
    try {
      const payload = await request("my_zines", {});
      state.existing =
        payload.items?.find((item) => Number(item.id) === zineId) || null;
      state.coverUploaded = Boolean(state.existing?.cover_path);
    } catch (error) {
      state.existing = null;
    }
  }
  renderStep(state, layout);
}
