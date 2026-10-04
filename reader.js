import { mediaUrl, request } from "./api.js";

export function readerPage() {
    return `<div class="viewer" data-reader><div class="viewer-bar"><a href="#zine"><span>←</span> <span class="viewer-title">--</span></a><div class="viewer-tools"><button data-spread type="button">見開き</button><button data-fullscreen type="button">□ 全画面</button><button type="button">☰ 目次</button></div></div><div class="viewer-stage page-reader single" data-reader-stage><span class="cover-loading" role="status" aria-label="読み込み中"></span></div><div class="viewer-controls"><button data-prev type="button">←</button><span id="page-count">01 / 0</span><button data-next type="button">→</button></div></div>`;
}

function updateView(viewer) {
    const pages = [...viewer.querySelectorAll(".reader-page")];
    const spread = viewer.dataset.spread === "true";
    const current = Number(viewer.dataset.current || 0);
    const step = spread && current > 0 ? 2 : 1;
    pages.forEach((page, index) => {
        const active = index >= current && index < current + step;
        if (!active) page._resetZoom?.();
        page.classList.toggle("active", active);
    });
    viewer.querySelector("#page-count").textContent = `${String(current + 1).padStart(2, "0")} / ${pages.length}`;
    viewer.querySelector("[data-prev]").disabled = current === 0;
    viewer.querySelector("[data-next]").disabled = current + step >= pages.length;
    viewer.querySelector("[data-spread]").textContent = spread ? "単ページ" : "見開き";
}

// Pinch-to-zoom and pan for a single reader page, independent of native page zoom.
function attachPinchZoom(page) {
    if (page._zoomBound) return;
    page._zoomBound = true;
    const target = page.querySelector("img, canvas");
    if (!target) return;
    const state = { scale: 1, panX: 0, panY: 0 };
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartPanX = 0;
    let dragStartPanY = 0;
    const clampPan = () => {
        const maxPan = (target.clientWidth * (state.scale - 1)) / 2 + (target.clientHeight * (state.scale - 1)) / 2;
        state.panX = Math.max(-maxPan, Math.min(maxPan, state.panX));
        state.panY = Math.max(-maxPan, Math.min(maxPan, state.panY));
    };
    const apply = () => {
        target.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
        page.classList.toggle("zoomed", state.scale > 1.02);
    };
    const reset = () => {
        state.scale = 1;
        state.panX = 0;
        state.panY = 0;
        apply();
    };
    page.addEventListener(
        "touchstart",
        (event) => {
            if (event.touches.length === 2) {
                event.preventDefault();
                const [t1, t2] = event.touches;
                pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                pinchStartScale = state.scale;
            } else if (event.touches.length === 1 && state.scale > 1) {
                dragging = true;
                dragStartX = event.touches[0].clientX;
                dragStartY = event.touches[0].clientY;
                dragStartPanX = state.panX;
                dragStartPanY = state.panY;
            }
        },
        { passive: false },
    );
    page.addEventListener(
        "touchmove",
        (event) => {
            if (event.touches.length === 2 && pinchStartDist) {
                event.preventDefault();
                const [t1, t2] = event.touches;
                const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                state.scale = Math.max(1, Math.min(4, pinchStartScale * (dist / pinchStartDist)));
                clampPan();
                apply();
            } else if (dragging && event.touches.length === 1) {
                event.preventDefault();
                state.panX = dragStartPanX + (event.touches[0].clientX - dragStartX);
                state.panY = dragStartPanY + (event.touches[0].clientY - dragStartY);
                clampPan();
                apply();
            }
        },
        { passive: false },
    );
    const endTouch = (event) => {
        if (event.touches.length === 0) {
            dragging = false;
            pinchStartDist = 0;
            if (state.scale <= 1) reset();
        }
    };
    page.addEventListener("touchend", endTouch);
    page.addEventListener("touchcancel", endTouch);
    page.addEventListener("dblclick", () => {
        state.scale = state.scale > 1 ? 1 : 2;
        state.panX = 0;
        state.panY = 0;
        apply();
    });
    page.addEventListener(
        "wheel",
        (event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            state.scale = Math.max(1, Math.min(4, state.scale - event.deltaY * 0.01));
            clampPan();
            apply();
        },
        { passive: false },
    );
    page._resetZoom = reset;
}


function bindControls(viewer) {
    viewer.dataset.current = "0";
    viewer.dataset.spread = "false";
    viewer.querySelector("[data-spread]").addEventListener("click", () => { viewer.dataset.spread = viewer.dataset.spread !== "true"; updateView(viewer); });
    viewer.querySelector("[data-prev]").addEventListener("click", () => { const current = Number(viewer.dataset.current); const step = viewer.dataset.spread === "true" && current > 1 ? 2 : 1; viewer.dataset.current = String(Math.max(0, current - step)); updateView(viewer); });
    viewer.querySelector("[data-next]").addEventListener("click", () => { const current = Number(viewer.dataset.current); const step = viewer.dataset.spread === "true" && current > 0 ? 2 : 1; viewer.dataset.current = String(Math.min(Number(viewer.dataset.pageTotal) - 1, current + step)); updateView(viewer); });
    viewer.querySelector("[data-fullscreen]").addEventListener("click", () => viewer.requestFullscreen?.());
}

export async function loadReader(id) {
    const payload = await request("zine", {}, `id=${encodeURIComponent(id)}`);
    const zine = payload.item;
    request("record_view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zine_id: zine.id }),
    }).catch((error) => console.warn("Unable to record zine view", error));
    const viewer = document.querySelector("[data-reader]");
    const stage = viewer.querySelector("[data-reader-stage]");
    viewer.querySelector(".viewer-title").textContent = zine.title;
    viewer.querySelector(".viewer-bar>a").href = `#zine?id=${zine.id}`;
    stage.innerHTML = "";
    const source = zine.pages?.[0]?.file_path || "";
    if (source.toLowerCase().endsWith(".pdf")) {
        const pdf = await window.pdfjsLib.getDocument({ url: mediaUrl(source) }).promise;
        viewer.dataset.pageTotal = String(pdf.numPages);
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.4 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            const article = document.createElement("article"); article.className = "reader-page"; article.appendChild(canvas); stage.appendChild(article);
        }
    } else {
        (zine.pages || []).forEach((page, index) => { const article = document.createElement("article"); article.className = "reader-page"; const image = document.createElement("img"); image.src = mediaUrl(page.file_path); image.alt = `ページ${index + 1}`; article.appendChild(image); stage.appendChild(article); });
        viewer.dataset.pageTotal = String(zine.pages?.length || 0);
    }
    stage.querySelectorAll(".reader-page").forEach(attachPinchZoom);
    bindControls(viewer); updateView(viewer);
}
