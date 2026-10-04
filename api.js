const endpoint = (action, query = "") => {
    const suffix = query ? `&${query}` : "";
    return new URL(`api.php?action=${action}${suffix}`, window.location.href);
};

export async function request(action, options = {}, query = "") {
    const response = await fetch(endpoint(action, query), {
        credentials: "same-origin",
        ...options,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `サーバーエラー (${response.status})`);
    return payload;
}

export function jsonRequest(action, data, method = "POST") {
    return request(action, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}

export function uploadRequest(action, formData) {
    return request(action, { method: "POST", body: formData });
}

export function mediaUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return endpoint("media", `path=${encodeURIComponent(path)}`).href;
}
