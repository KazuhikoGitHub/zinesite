import { mediaUrl as apiMediaUrl, request, jsonRequest, uploadRequest } from "./api.js";
import { readerPage, loadReader } from "./reader.js";
import { creatorPage, activateCreator } from "./creator.js";

const mediaUrl = apiMediaUrl;

async function activateContact() {
    if (location.hash.slice(1).split("?")[0] !== "contact") return;
    app.innerHTML = contactPage();
}
function activateReport() {
    const detail = document.querySelector("[data-zine-detail]");
    if (!detail || detail.querySelector("[data-report-form]")) return;
    detail.insertAdjacentHTML(
        "beforeend",
        '<details class="report-accordion"><summary class="report-summary">通報</summary><form class="form" data-report-form><p class="eyebrow">Report</p><div class="field"><label>理由</label><select name="reason" required><option value="copyright">著作権侵害</option><option value="inappropriate">不適切なコンテンツ</option><option value="privacy">プライバシー</option><option value="other">その他</option></select></div><div class="field"><label>詳細</label><textarea name="detail" rows="4" required></textarea></div><button class="button button-outline" type="submit">通報する</button></form></details>',
    );
}
document.addEventListener(
    "submit",
    async (event) => {
        const form = event.target;
        if (!form.matches("[data-report-form]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const id =
            new URLSearchParams(location.hash.split("?")[1] || "").get("id") || "0";
        const data = Object.fromEntries(new FormData(form));
        data.zine_id = Number(id);
        const response = await fetch(
            new URL("api.php?action=report", window.location.href),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(data),
            },
        );
        const payload = await response.json();
        alert(payload.error || "通報を受け付けました");
        if (response.ok) form.reset();
    },
    true,
);
function activateFaq() {
    if (location.hash.slice(1).split("?")[0] === "help")
        app.innerHTML = faqPage();
}
document.addEventListener(
    "submit",
    async (event) => {
        const form = event.target;
        if (!form.matches("[data-contact-form]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const response = await fetch(
            new URL("api.php?action=contact", window.location.href),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
            },
        );
        const payload = await response.json();
        alert(payload.error || payload.message || "お問い合わせを受け付けました");
        if (response.ok) form.reset();
    },
    true,
);
const zines = [];
const app = document.querySelector("#app");
const headerActions = document.querySelector(".header-actions");
document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const target = link.getAttribute("href");
    if (!target || target === "#") return;
    event.preventDefault();
    location.hash = target.slice(1);
});
function layout(content) {
    return `<div class="page">${content}</div>`;
}
async function syncAuthHeader() {
    if (!headerActions) return;
    try {
        const response = await fetch(
            new URL("api.php?action=me", window.location.href),
            { credentials: "same-origin" },
        );
        const payload = await response.json();
        if (payload.user) {
            headerActions.innerHTML =
                '<button class="icon-btn" data-action="search" aria-label="検索">⌕</button><a class="text-link" href="#creator">投稿する</a><a class="button button-dark button-small" href="#dashboard">アカウント ↗</a><button class="button button-outline button-small" data-action="logout">ログアウト</button>';
            return;
        }
        headerActions.innerHTML =
            '<button class="icon-btn" data-action="search" aria-label="検索">⌕</button><a class="text-link" href="#login">ログイン</a><a class="button button-dark button-small" href="#register">はじめる</a>';
    } catch (error) {
        console.warn("Auth state unavailable", error);
    }
}
document.addEventListener("click", async (event) => {
    const button = event.target.closest('[data-action="logout"]');
    if (!button) return;
    try {
        const response = await fetch(
            new URL("api.php?action=logout", window.location.href),
            { method: "POST", credentials: "same-origin" },
        );
        if (response.ok) {
            alert("ログアウトしました");
            await syncAuthHeader();
            location.hash = "#home";
        } else {
            alert("ログアウトに失敗しました");
        }
    } catch (error) {
        alert("ログアウトに失敗しました");
    }
});
function card(z) {
    const coverStyle = z.cover_path ? ` style="background-image:url('${mediaUrl(z.cover_path)}')"` : "";
    return `<article class="zine-card"><a href="#zine?id=${encodeURIComponent(z.id || 1)}"><div class="cover ${z.cover || ""}"${coverStyle}></div><div class="zine-meta"><div><p class="zine-title">${z.title}</p><p class="zine-author">${z.author}</p></div><span class="zine-stats">◉ ${z.views}</span></div></a></article>`;
}
function home() {
    return layout(
        `<section class="hero"><div class="hero-copy"><p class="eyebrow">Independent zine library / 2025</p><h1>まだ名前のない<br><em>物語</em>に出会う。</h1><p>個人の視点でつくられた、小さな出版物のための場所。読む人も、つくる人も、ここから。</p><div class="hero-actions"><a class="button button-dark" href="#discover">ZINEを探す <span>↗</span></a><a class="arrow-link" href="#creator">つくってみる</a></div></div><div class="hero-art"><div class="art-copy">MAKE<br>SPACE</div><div class="art-note">a small publication for a large world</div></div></section><section class="section"><div class="section-header"><h2 class="section-title">新着のZINE <span>JUST IN</span></h2><a class="view-all" href="#discover">すべて見る ↗</a></div><div class="zine-grid" data-home-new><div class="empty">--</div></div></section><section class="split-section"><div class="split-block"><div class="section-header"><h2 class="section-title">いま読まれている <span>RANKING</span></h2><a class="view-all" href="#ranking">詳細 ↗</a></div><div class="rank-tabs"><button class="active" data-tab="zine">ZINEビュー数</button><button data-tab="author">作者ビュー数</button><button data-tab="favorite">お気に入り数</button></div><div data-home-ranking><div class="empty">--</div></div></div><div class="split-block"><div class="section-header"><h2 class="section-title">テーマから探す <span>BY TOPIC</span></h2></div><div class="tag-list" data-home-categories><div class="empty">--</div></div></div></section><section class="section"><div class="newsletter"><div><h2>週末に、ひとつの発見。</h2><p>新着ZINEと編集部のピックアップを月2回お届けします。</p></div><form class="newsletter-form" data-demo-form><input type="email" placeholder="メールアドレス" required><button>登録する</button></form></div></section>`,
    );
}
function discover() {
    const selectedCategory =
        new URLSearchParams(location.hash.split("?")[1] || "").get("category") ||
        "";
    const categoryOptions = [
        "すべてのカテゴリ",
        "エッセイ",
        "写真",
        "イラスト",
        "カルチャー",
        "旅と散歩",
    ];
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">Explore the collection</p><h1>ZINEを探す</h1></div><p>誰かの視点を、あなたのペースで。<br>キーワードやテーマから見つけよう。</p></div><div class="filters"><input class="search-input" id="search" placeholder="タイトル、著者、キーワードで検索" value=""><select class="select">${categoryOptions.map((option) => `<option ${option === selectedCategory ? "selected" : ""}>${option}</option>`).join("")}</select><select class="select"><option>新着順</option><option>人気順</option><option>ビュー数順</option></select></div><div class="zine-grid" id="results">${zines.concat(zines).map(card).join("")}</div></section>`,
    );
}
function categoriesPage() {
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">Browse by topic</p><h1>カテゴリ</h1></div><p>読みたいテーマから、<br>あなたに合うZINEを見つけます。</p></div><section class="section"><div class="tag-list" data-categories><div class="empty">--</div></div></section>`,
    );
}
async function activateCategories() {
    if (location.hash.slice(1).split("?")[0] !== "categories") return;
    app.innerHTML = categoriesPage();
    try {
        const response = await fetch(
            new URL("api.php?action=categories", window.location.href),
        );
        if (!response.ok) throw new Error("categories request failed");
        const payload = await response.json();
        const container = document.querySelector("[data-categories]");
        container.innerHTML = payload.items?.length
            ? payload.items
                .map(
                    (category) =>
                        `<a class="tag" href="#discover?category=${encodeURIComponent(category.name)}">${category.name} <small>${Number(category.count).toLocaleString()}</small></a>`,
                )
                .join("")
            : '<div class="empty">公開されているカテゴリはありません。</div>';
    } catch (error) {
        const container = document.querySelector("[data-categories]");
        if (container)
            container.innerHTML =
                '<div class="empty">カテゴリを取得できませんでした。</div>';
    }
}
window.addEventListener("hashchange", activateCategories);
activateCategories();
function detail() {
    return layout(
        `<div class="detail" data-zine-detail><div><div class="detail-cover"><span class="cover-loading" role="status" aria-label="読み込み中"></span></div></div><div><p class="eyebrow">ZINE / PUBLICATION</p><h1>--</h1><p class="zine-author">--</p><p class="lead">--</p><div class="detail-info"><span>--</span></div><div class="hero-actions"><a class="button button-dark" href="#reader" aria-disabled="true">読む ↗</a><button class="button button-outline" data-favorite disabled>♡ お気に入り</button></div></div></div>`,
    );
}
function formPage(title, desc, action = "送信する") {
    const auth =
        title.includes("ログイン") || action.includes("ログイン")
            ? "login"
            : title.includes("登録") || action.includes("登録")
                ? "register"
                : title.includes("パスワード")
                    ? "password_reset_request"
                    : "";
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku account</p><h1>${title}</h1><p>${desc}</p><form class="form" data-demo-form data-auth="${auth}">${auth === "register" ? '<div class="field"><label>表示名</label><input name="display_name" required placeholder="表示名"></div>' : ""}<div class="field"><label>メールアドレス</label><input name="email" type="email" required placeholder="you@example.com"></div>${auth === "login" || auth === "register" ? `<div class="field"><label>パスワード</label><input name="password" type="password" required placeholder="8文字以上"></div>` : ""}${auth === "register" ? '<label class="check"><input type="checkbox" required> 利用規約とプライバシーポリシーに同意します</label>' : ""}<button class="button button-dark" type="submit">${action} ↗</button></form>${auth === "login" ? '<p class="form-link"><a href="#forgot">パスワードを忘れた方はこちら</a></p>' : ""}</div>`,
    );
}
function resetPasswordPage() {
    const token =
        new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku account</p><h1>新しいパスワード</h1><p>新しいパスワードを入力してください。</p><form class="form" data-password-reset><input type="hidden" name="token" value="${token}"><div class="field"><label>新しいパスワード</label><input name="password" type="password" required minlength="8" placeholder="8文字以上"></div><button class="button button-dark" type="submit">変更する ↗</button></form></div>`,
    );
}
function settingsPage() {
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku account</p><h1>アカウント設定</h1><p>プロフィールとアカウント情報を変更できます。</p><form class="form" data-profile-form><div class="field"><label>表示名</label><input name="display_name" required maxlength="80"></div><div class="field"><label>自己紹介</label><textarea name="bio" rows="5" maxlength="2000"></textarea></div><button class="button button-dark" type="submit">プロフィールを保存 ↗</button></form><form class="form" data-change-email><div class="field"><label>新しいメールアドレス</label><input name="email" type="email" required></div><button class="button button-outline" type="submit">確認メールを送る ↗</button></form><form class="form" data-change-password><div class="field"><label>現在のパスワード</label><input name="current_password" type="password" required></div><div class="field"><label>新しいパスワード</label><input name="new_password" type="password" minlength="8" required></div><button class="button button-outline" type="submit">パスワードを変更 ↗</button></form></div>`,
    );
}
function collectionPage(kind) {
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">My space / Reader</p><h1>${kind === "favorites" ? "お気に入り本棚" : "閲覧履歴"}</h1></div><p>あなたの読書をいつでも続きから。</p></div><section class="section"><div data-collection class="zine-grid"><div class="empty">--</div></div></section>`,
    );
}
function authorPage() {
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">Creator profile</p><h1 data-author-name>著者プロフィール</h1></div><p data-author-bio>--</p></div><section class="section"><div class="notice" data-author-stats></div><div class="zine-grid" data-author-zines></div></section>`,
    );
}
function contactPage() {
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku / Contact</p><h1>お問い合わせ</h1><p>ご質問やご意見をお聞かせください。</p><form class="form" data-contact-form><div class="field"><label>メールアドレス</label><input name="email" type="email" required></div><div class="field"><label>件名</label><input name="subject" maxlength="200" required></div><div class="field"><label>本文</label><textarea name="message" rows="8" required></textarea></div><button class="button button-dark" type="submit">送信する ↗</button></form></div>`,
    );
}
function activateDiscover() {
    if (location.hash.slice(1).split("?")[0] !== "discover") return;
    const input = document.querySelector("#search");
    const category = document.querySelector(".filters .select");
    const sort = document.querySelectorAll(".filters .select")[1];
    const results = document.querySelector("#results");
    if (!input || !results) return;
    const fetchResults = async () => {
        const params = new URLSearchParams({
            q: input.value,
            category:
                category?.value === "すべてのカテゴリ" ? "" : category?.value || "",
            sort:
                sort?.value === "人気順"
                    ? "popular"
                    : sort?.value === "ビュー数順"
                        ? "views"
                        : "new",
        });
        const response = await fetch(
            new URL("api.php?action=zines&" + params, window.location.href),
        );
        const payload = await response.json();
        results.innerHTML = payload.items?.length
            ? payload.items
                .map((item) =>
                    card({
                        ...item,
                        views: Number(item.view_count).toLocaleString(),
                        tag: item.category || "ZINE",
                        cover: "cover-a",
                    }),
                )
                .join("")
            : '<div class="empty">該当するZINEが見つかりませんでした。</div>';
    };
    input.addEventListener("input", fetchResults);
    category?.addEventListener("change", fetchResults);
    sort?.addEventListener("change", fetchResults);
    fetchResults();
}
function dashboard(kind = "reader") {
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">My space / ${kind === "creator" ? "Creator" : "Reader"}</p><h1>${kind === "creator" ? "作品を育てる。" : "おかえりなさい。"}</h1></div><p>あなたの読書と創作のための<br>パーソナルダッシュボード。</p></div><div class="dashboard-grid"><div class="metric"><span>${kind === "creator" ? "総ビュー数" : "最近読んだ作品"}</span><strong>--</strong></div><div class="metric"><span>${kind === "creator" ? "お気に入り数" : "お気に入り"}</span><strong>--</strong></div><div class="metric"><span>お知らせ</span><strong>--</strong></div></div><div class="notice">新着のお知らせを確認できます。 <a href="#discover">ZINEを探す →</a></div><section class="section"><div class="section-header"><h2 class="section-title">${kind === "creator" ? "My ZINE" : "最近読んだ作品"}</h2><a class="view-all" href="#discover">一覧を見る ↗</a></div><div class="zine-grid">${zines.slice(0, 3).map(card).join("")}</div></section>`,
    );
}
function staticPage(title, body) {
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku / Information</p><h1>${title}</h1><p>${body}</p><div class="notice" style="margin-top:35px">このページは公開準備中です。お問い合わせはフォームからどうぞ。</div></div>`,
    );
}
function termsPage() {
    return layout(
        `<article class="form-page legal-page"><p class="eyebrow">YOHaku / Information</p><h1>利用規約</h1><p>この利用規約（以下、「本規約」といいます）は、<strong>YOHaku</strong>（以下、「当サービス」といいます）が提供するすべてのサービスにおいて、利用条件を定めるものです。利用者の皆様（以下、「ユーザー」といいます）には、本規約に従って当サービスをご利用いただきます。</p><section><h2>第1条（適用）</h2><ol><li>本規約は、ユーザーと当サービス運営者（以下、「運営者」といいます）間のサービスの利用に関わる一切の関係に適用されるものとします。</li><li>運営者は本規約のほか、利用にあたってのルール等（以下、「個別規定」といいます）を定めることがあります。これらは名称のいかんに関わらず、本規約の一部を構成するものとします。</li></ol></section><section><h2>第2条（アカウント登録）</h2><ol><li>当サービスの利用を希望する者は、本規約に同意の上、運営者の定める方法によってアカウント登録を行うものとし、登録が完了した時点からサービスの利用を開始できるものとします。</li><li>運営者は、登録希望者に以下の事由があると判断した場合、登録を拒否、または事後的にアカウントの利用停止（バン）等の措置をとることがあり、その理由については一切の開示義務を負わないものとします。</li></ol><ul><li>登録事項に虚偽、誤記または記入漏れがあった場合</li><li>過去に本規約に違反した者である場合</li><li>その他、運営者が利用を相当でないと判断した場合</li></ul></section><section><h2>第3条（コンテンツの権利と責任）</h2><ol><li>ユーザーが当サービス上で公開・投稿する雑誌、画像、文章、その他のデータ（以下、「コンテンツ」といいます）の著作権は、原則として当該ユーザーまたは正当な権利者に帰属します。</li><li>ユーザーは、運営者に対し、コンテンツを当サービスの提供、運営、宣伝広告などのために必要な範囲で、無償かつ非独占的に利用（複製、公衆送信、翻案等を含みます）することを許諾するものとします。</li><li>ユーザーは、自己の責任においてコンテンツを公開するものとし、第三者の著作権、商標権、プライバシー権等の権利を侵害していないことを保証します。</li></ol></section><section><h2>第4条（禁止事項）</h2><p>ユーザーは、当サービスの利用にあたり、以下の行為をしてはなりません。</p><ul><li>法令または公序良俗に違反する行為</li><li>犯罪行為に関連する行為</li><li>第三者の著作権、商標権、プライバシー権、名誉権その他の権利を侵害する行為</li><li><strong>成人向けコンテンツ（わいせつな表現、過度に性的な描写、アダルトグッズ等に関する情報を含みますがこれらに限られません）を投稿、公開、または送信する行為</strong></li><li>過度な暴力表現、グロテスクな表現、残酷な表現など、他者に不快感を与えるコンテンツを投稿・公開する行為</li><li>当サービスのサーバーまたはネットワークの機能を破壊したり、妨害したりする行為</li><li>当サービスの運営を妨害するおそれのある行為</li><li>他のユーザーに成りすます行為</li><li>反社会的勢力に対して利益を供与する行為</li><li>その他、運営者が不適切と判断する行為</li></ul></section><section><h2>第5条（サービスの提供の停止等）</h2><ol><li>運営者は、以下のいずれかの事由があると判断した場合、ユーザーに事前に通知することなく、当サービスの全部または一部の提供を停止または中断することができるものとします。</li></ol><ul><li>当サービスにかかるコンピュータシステムの保守点検または更新を行う場合</li><li>地震、落雷、火災、停電または天災などの不可抗力により、当サービスの提供が困難となった場合</li><li>コンピュータまたは通信回線等が事故により停止した場合</li><li>その他、運営者が当サービスの提供が困難と判断した場合</li></ul><ol start="2"><li>運営者は、当サービスの提供の停止または中断により、ユーザーまたは第三者が被ったいかなる不利益または損害についても、一切の責任を負わないものとします。</li></ol></section><section><h2>第6条（利用制限およびアカウント削除・バン）</h2><ol><li>運営者は、ユーザーが以下のいずれかに該当する場合には、事前の通知なく、該当するコンテンツの削除、ユーザーに対する当サービスの利用制限、またはアカウントの凍結・削除（バン）を行うことができるものとします。</li></ol><ul><li>本規約のいずれかの条項に違反した場合</li><li>登録事項に虚偽の事実があることが判明した場合</li><li><strong>成人向けコンテンツやその他禁止事項に該当するコンテンツを投稿した場合</strong></li><li>その他、運営者が当サービスの利用を適当でないと判断した場合</li></ul><ol start="2"><li>運営者は、本条に基づき運営者が行った行為によりユーザーに生じた損害について、一切の責任を負いません。</li></ol></section><section><h2>第7条（免責事項）</h2><ol><li>運営者は、当サービスに事実上または法律上の瑕疵（安全性、信頼性、正確性、完全性、有効性、特定の目的への適合性、セキュリティなどに関する欠陥、エラーやバグ、権利侵害などを含みます）がないことを明示的にも黙示的にも保証しておりません。</li><li>運営者は、当サービスに起因してユーザーに生じたあらゆる損害について、運営者の故意または重過失による場合を除いて、一切の責任を負いません。</li></ol></section><section><h2>第8条（利用規約の変更）</h2><p>運営者は、必要と判断した場合には、ユーザーに通知することなくいつでも本規約を変更することができるものとします。なお、変更後の本規約は、当サービス上に掲示した時点から効力を生じるものとします。</p></section><section><h2>第9条（準拠法・裁判管轄）</h2><ol><li>本規約の解釈にあたっては、日本法を準拠法とします。</li><li>当サービスに関して紛争が生じた場合には、運営者の住所地を管轄する裁判所を専属的合意管轄とします。</li></ol></section></article>`,
    );
}
function privacyPage() {
    return layout(
        `<article class="form-page legal-page"><p class="eyebrow">YOHaku / Information</p><h1>プライバシーポリシー</h1><p><strong>YOHaku</strong>（以下、「当サービス」といいます）は、当サービスにおけるユーザーの個人情報の取扱いについて、以下のとおりプライバシーポリシー（以下、「本ポリシー」といいます）を定めます。</p><section><h2>第1条（個人情報）</h2><p>「個人情報」とは、個人情報保護法にいう「個人情報」を指すものとし、生存する個人に関する情報であって、当該情報に含まれる氏名、生年月日、住所、電話番号、連絡先その他の記述等により特定の個人を識別できる情報（個人識別情報）を指します。</p></section><section><h2>第2条（個人情報の収集方法）</h2><p>当サービスは、ユーザーが利用登録をする際に、メールアドレス、パスワードなどの個人情報をお尋ねすることがあります。また、ユーザーと提携先などとの間でなされたユーザーの個人情報を含む取引記録や決済に関する情報を、当サービスの提携先などから収集することがあります。</p></section><section><h2>第3条（個人情報を収集・利用する目的）</h2><p>当サービスが個人情報を収集・利用する目的は、以下のとおりです。</p><ol><li>当サービスの提供・運営のため</li><li>ユーザーからのお問い合わせに回答するため（本人確認を行うことを含む）</li><li>ユーザーが利用しているサービスの新機能、更新情報、キャンペーン等及び運営者が提供する他のサービスの案内のメールを送付するため</li><li>メンテナンス、重要なお知らせなど必要に応じたご連絡のため</li><li>利用規約に違反したユーザーや、不正・不当な目的でサービスを利用しようとするユーザーを特定し、利用をお断りするため</li><li>ユーザーにご自身の登録情報の閲覧や変更、削除、利用状況の閲覧を行っていただくため</li><li>有料サービスにおいて、ユーザーに利用料金を請求するため</li><li>上記の利用目的に付随する目的</li></ol></section><section><h2>第4条（利用目的の変更）</h2><ol><li>運営者は、利用目的が変更前と関連性を有すると合理的に認められる場合に限り、個人情報の利用目的を変更するものとします。</li><li>利用目的の変更を行った場合、変更後の目的について、当サービス上において公表するものとします。</li></ol></section><section><h2>第5条（個人情報の第三者提供）</h2><ol><li>運営者は、次に掲げる場合を除いて、あらかじめユーザーの同意を得ることなく、第三者に個人情報を提供することはありません。ただし、個人情報保護法その他の法令で認められる場合を除きます。</li></ol><ul><li>人の生命、身体または財産の保護のために必要がある場合であって、本人の同意を得ることが困難であるとき</li><li>公衆衛生の向上または児童の健全な育成の推進のために特に必要がある場合であって、本人の同意を得ることが困難であるとき</li><li>国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、本人の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがあるとき</li><li>予め次の事項を告知あるいは公表し、かつ運営者が個人情報保護委員会に届出をしたとき<ul><li>利用目的に第三者への提供を含むこと</li><li>第三者に提供されるデータの項目</li><li>第三者への提供の手段または方法</li><li>本人の求めに応じて個人情報の第三者への提供を停止すること</li><li>本人の求めを受け付ける方法</li></ul></li></ul><ol start="2"><li>前項の定めにかかわらず、次に掲げる場合には、当該情報の提供先は第三者に該当しないものとします。</li></ol><ul><li>運営者が利用目的の達成に必要な範囲内において個人情報の取扱いの全部または一部を委託する場合</li><li>合併その他の事由による事業の承継に伴って個人情報が提供される場合</li><li>特定の者との間で共同して利用される個人情報が当該者に提供される場合であって、その旨並びに共同して利用される個人情報の項目、共同して利用する者の範囲、利用する者の利用目的および当該個人情報の管理について責任を有する者の氏名または名称について、あらかじめ本人に通知し、または本人が容易に知り得る状態に置いている場合</li></ul></section><section><h2>第6条（個人情報の開示）</h2><ol><li>運営者は、本人から個人情報の開示を求められたときは、本人に対し、遅滞なくこれを開示します。ただし、開示することにより次のいずれかに該当する場合は、その全部または一部を開示しないこともあり、開示しない決定をした場合には、その旨を遅滞なく通知します。</li></ol><ul><li>本人または第三者の生命、身体、財産その他の権利利益を害するおそれがある場合</li><li>運営者の業務の適正な実施に著しい支障を及ぼすおそれがある場合</li><li>その他法令に違反することとなる場合</li></ul><ol start="2"><li>前項の定めにかかわらず、履歴情報および特性情報などの個人情報以外の情報については、原則として開示いたしません。</li></ol></section><section><h2>第7条（個人情報の訂正および削除）</h2><ol><li>ユーザーは、運営者の保有する自己の個人情報が誤った情報である場合には、運営者が定める手続きにより、運営者に対して個人情報の訂正、追加または削除（以下、「訂正等」といいます）を請求することができます。</li><li>運営者は、ユーザーから前項の請求を受けてその請求に応じる必要があると判断した場合には、遅滞なく、当該個人情報の訂正等を行うものとします。</li><li>運営者は、前項の規定に基づき訂正等を行った場合、または訂正等を行わない旨の決定をしたときは遅滞なくこれをユーザーに通知します。</li></ol></section><section><h2>第8条（個人情報の利用停止等）</h2><ol><li>運営者は、本人から、個人情報が、利用目的の範囲を超えて取り扱われているという理由、または不正の手段により取得されたものであるという理由により、その利用の停止または消去（以下、「利用停止等」といいます）を求められたときは、遅滞なく必要な調査を行います。</li><li>前項の調査結果に基づき、その請求に応じる必要があると判断した場合には、遅滞なく、当該個人情報の利用停止等を行います。</li><li>運営者は、前項の規定に基づき利用停止等を行った場合、または利用停止等を行わない旨の決定をしたときは、遅滞なく、ユーザーに通知します。</li></ol></section><section><h2>第9条（プライバシーポリシーの変更）</h2><ol><li>本ポリシーの内容は、法令その他本ポリシーに別段の定めのある事項を除いて、ユーザーに通知することなく、変更することができるものとします。</li><li>運営者が別途定める場合を除いて、変更後のプライバシーポリシーは、当サービス上に掲載した時から効力を生じるものとします。</li></ol></section><section><h2>第10条（お問い合わせ窓口）</h2><p>本ポリシーに関するお問い合わせは、下記の窓口までお願いいたします。</p><ul><li>運営者名：YOHaku運営グループ</li><li>お問い合わせ窓口 / メールアドレス：yohaku_service@mkazu.hiho.jp</li></ul></section></article>`,
    );
}
function faqPage() {
    return layout(
        `<div class="form-page"><p class="eyebrow">YOHaku / Help</p><h1>ヘルプ / FAQ</h1><details open><summary>登録したのにログインできません</summary><p>登録メールの確認リンクを開いてからログインしてください。</p></details><details><summary>ZINEを公開するには？</summary><p>基本情報、表紙、本文ページを登録してからクリエイター画面で公開します。</p></details><details><summary>PDFは登録できますか？</summary><p>クリエイター画面から50MBまでのPDFを登録できます。</p></details></div>`,
    );
}
function adminPage(title, body) {
    return layout(
        `<div class="inner-head"><div><p class="eyebrow">Admin console / Restricted</p><h1>${title}</h1></div><p>管理者権限と2FAが必要なエリアです。<br>操作履歴はすべて記録されます。</p></div><div class="dashboard-grid" data-admin-stats><div class="metric"><span>会員数</span><strong>--</strong></div><div class="metric"><span>総PV</span><strong>--</strong></div><div class="metric"><span>公開ZINE</span><strong>--</strong></div></div><div class="notice" data-admin-message>${body}</div><section class="section"><div class="section-header"><h2 class="section-title">通報一覧</h2></div><div data-admin-reports class="empty">--</div></section>`,
    );
}
function render() {
    const hash = location.hash.slice(1);
    const [route, queryString = ""] = hash.split("?");
    const routeName = route || "home";
    const params = new URLSearchParams(queryString);
    const pages = {
        home,
        discover,
        ranking: discover,
        categories: categoriesPage,
        zine: detail,
        reader: readerPage,
        creator: () => creatorPage(layout),
        "edit-zine": editZinePage,
        dashboard,
        login: () =>
            formPage(
                "ログイン",
                "メールアドレスとパスワードでログインしてください。",
                "ログイン",
            ),
        register: () =>
            formPage(
                "アカウントをつくる",
                "無料でZINEを読んだり、あなたの作品を公開できます。",
                "登録する",
            ),
        forgot: () =>
            formPage(
                "パスワードを再設定",
                "登録したメールアドレスに再設定用リンクを送ります。",
                "再設定メールを送る",
            ),
        "reset-password": resetPasswordPage,
        mypage: dashboard,
        favorites: () => dashboard(),
        history: () => dashboard(),
        settings: settingsPage,
        terms: () =>
            termsPage(),
        privacy: () => privacyPage(),
        help: () =>
            staticPage("ヘルプ / FAQ", "よくある質問と使い方をご案内します。"),
        contact: () =>
            formPage(
                "お問い合わせ",
                "ご質問やご意見をお聞かせください。",
                "送信する",
            ),
        about: () =>
            staticPage(
                "YOHakuについて",
                "YOHakuは個人の視点から生まれる小さな出版物を、読む人へ届ける場所です。",
            ),
        admin: () =>
            adminPage(
                "管理ダッシュボード",
                "管理画面のデモです。ユーザー、ZINE、通報、セキュリティログをここから管理します。",
            ),
        adminLogin: () =>
            formPage(
                "管理者ログイン",
                "IP制限と2FAで保護された管理者専用ログインです。",
                "2FAを確認",
            ),
        reports: () => adminPage("通報管理", "未対応の通報はありません。"),
        security: () =>
            adminPage(
                "システム・セキュリティログ",
                "直近の不審なアクセスはありません。",
            ),
    };
    app.innerHTML = (
        pages[routeName] ||
        (() => staticPage("404", "お探しのページは見つかりませんでした。"))
    )();
    if (routeName === "creator") activateCreator(layout);
    bind();
    window.scrollTo(0, 0);
    if (routeName === "zine") loadZine(params.get("id") || "1", routeName);
    if (routeName === "reader") loadReader(params.get("id") || "1").catch((error) => {
        const stage = document.querySelector("[data-reader-stage]");
        if (stage) stage.innerHTML = '<p class="empty">ページを読み込めませんでした。</p>';
        console.warn("ZINE reader unavailable", error);
    });
}
function bind() {
    document.querySelectorAll("[data-demo-form]").forEach((f) =>
        f.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!f.dataset.auth) {
                alert("送信しました。ありがとうございます。");
                return;
            }
            try {
                const response = await fetch(
                    new URL(
                        "api.php?action=" + f.dataset.auth,
                        window.location.href,
                    ),
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(Object.fromEntries(new FormData(f))),
                    },
                );
                const body = await response.text();
                let payload = {};
                try {
                    payload = body ? JSON.parse(body) : {};
                } catch (error) {
                    payload = { error: "サーバーがJSONを返しませんでした" };
                }
                if (!response.ok) {
                    alert(payload.error || `サーバーエラー (${response.status})`);
                    return;
                }
                if (f.dataset.auth === "register") {
                    alert(payload.message || "確認メールを送信しました");
                    location.hash = "#login";
                    return;
                }
                alert("ログインしました");
                location.hash = "#dashboard";
            } catch (error) {
                alert("通信に失敗しました。時間をおいて再度お試しください");
            }
        }),
    );
    document
        .querySelector("[data-favorite]")
        ?.addEventListener("click", async (e) => {
            const zineId = Number(e.currentTarget.dataset.zineId) || 1;
            const response = await fetch(
                new URL("api.php?action=favorite", window.location.href),
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({ zine_id: zineId }),
                },
            );
            const body = await response.text();
            let payload = {};
            try {
                payload = body ? JSON.parse(body) : {};
            } catch (error) { }
            if (!response.ok) {
                alert(payload.error || `サーバーエラー (${response.status})`);
                return;
            }
            e.currentTarget.textContent = "♥ お気に入り済み";
            e.currentTarget.style.background = "var(--lime)";
        });
    const search = document.querySelector("#search");
    search?.addEventListener("input", (e) => {
        const value = e.target.value.toLowerCase();
        document.querySelector("#results").innerHTML =
            zines
                .concat(zines)
                .filter(
                    (z) =>
                        z.title.toLowerCase().includes(value) ||
                        z.author.toLowerCase().includes(value),
                )
                .map(card)
                .join("") ||
            '<div class="empty">該当するZINEが見つかりませんでした。</div>';
    });
}
async function loadZine(id, route) {
    try {
        const response = await fetch(
            new URL(
                "api.php?action=zine&id=" + encodeURIComponent(id),
                window.location.href,
            ),
        );
        if (!response.ok) return;
        const payload = await response.json();
        const zine = payload.item;
        if (route === "zine" && document.querySelector("[data-zine-detail]")) {
            document.querySelector("[data-zine-detail] h1").textContent = zine.title;
            document.querySelector("[data-zine-detail] .zine-author").textContent =
                "by " + zine.author;
            document.querySelector("[data-zine-detail] .lead").textContent =
                zine.description;
            document.querySelector(
                "[data-zine-detail] .detail-cover",
            ).style.backgroundImage = `url("${mediaUrl(zine.cover_path)}")`;
            document.querySelector("[data-zine-detail] .cover-loading")?.remove();
            document.querySelector("[data-zine-detail] .detail-info").innerHTML =
                `<span>◉ ${Number(zine.view_count).toLocaleString()} views</span><span>♡ ${Number(zine.favorite_count).toLocaleString()} likes</span><span>${zine.pages.length} pages</span>`;
            document.querySelector("[data-zine-detail] .button-dark").href =
                "#reader?id=" + zine.id;
            document.querySelector(
                "[data-zine-detail] [data-favorite]",
            ).dataset.zineId = zine.id;
            document.querySelector("[data-zine-detail] [data-favorite]").disabled = false;
        }
        if (route === "reader" && document.querySelector("[data-reader]")) {
            const pages = zine.pages || [];
            const viewer = document.querySelector("[data-reader]");
            viewer.querySelector(".viewer-title").textContent = zine.title;
            viewer.querySelector(".viewer-bar>a").href = "#zine?id=" + zine.id;
            viewer.querySelector("#page-count").textContent = "01 / " + pages.length;
            viewer.dataset.zineId = zine.id;
            viewer.dataset.pageTotal = pages.length;
            if (pages[0]) {
                const source = pages[0].file_path;
                viewer.querySelector(".viewer-page h2").innerHTML = source
                    .toLowerCase()
                    .endsWith(".pdf")
                    ? '<iframe src="' + mediaUrl(source) + '" title="PDF原稿"></iframe>'
                    : '<img src="' + mediaUrl(source) + '" alt="ページ1">';
            }
            if (pages[1]) {
                viewer.querySelector(".viewer-page.second h2").innerHTML =
                    '<img src="' + mediaUrl(pages[1].file_path) + '" alt="ページ2">';
            }
        }
    } catch (error) {
        console.warn("ZINE detail unavailable", error);
    }
}
async function syncAdmin() {
    const statsResponse = await fetch(
        new URL("api.php?action=admin_stats", window.location.href),
        { credentials: "same-origin" },
    );
    const message = document.querySelector("[data-admin-message]");
    if (!statsResponse.ok) {
        if (message) message.textContent = "管理者権限または許可IPが必要です。";
        return;
    }
    const statsPayload = await statsResponse.json();
    const values = [
        statsPayload.stats.users,
        statsPayload.stats.total_views,
        statsPayload.stats.published_zines,
    ];
    document
        .querySelectorAll("[data-admin-stats] strong")
        .forEach((element, index) => {
            element.textContent = Number(values[index] || 0).toLocaleString();
        });
    const reportResponse = await fetch(
        new URL("api.php?action=admin_reports", window.location.href),
        { credentials: "same-origin" },
    );
    if (!reportResponse.ok) return;
    const reportPayload = await reportResponse.json();
    const container = document.querySelector("[data-admin-reports]");
    if (!reportPayload.items.length) {
        container.textContent = "未対応の通報はありません。";
        return;
    }
    container.innerHTML = reportPayload.items
        .map(
            (report) =>
                `<div class="notice"><strong>${report.zine_title || "対象不明"}</strong><br>${report.reason} / ${report.status}<br>${report.detail}</div>`,
        )
        .join("");
}
function apiZine(item, index = 0) {
    return {
        ...item,
        author: item.author || "Unknown author",
        views: Number(item.view_count || item.views || 0).toLocaleString(),
        tag: item.category || "ZINE",
        cover: ["cover-a", "cover-b", "cover-c", "cover-d"][index % 4],
    };
}
async function syncHomeData() {
    const route = location.hash.slice(1).split("?")[0] || "home";
    if (route !== "home") return;
    const newContainer = document.querySelector("[data-home-new]");
    const rankingContainer = document.querySelector("[data-home-ranking]");
    const categoriesContainer = document.querySelector("[data-home-categories]");
    const renderRanking = (items, type = "zine") => {
        rankingContainer.innerHTML = items?.length
            ? items
                .slice(0, 3)
                .map((item, index) => {
                    const coverStyle = item.cover_path
                        ? ` style="background-image:url('${mediaUrl(item.cover_path)}')"`
                        : "";
                    const value = type === "favorite"
                        ? `♡ ${Number(item.favorites || 0).toLocaleString()}`
                        : Number(item.views || 0).toLocaleString();
                    const row = `<span class="rank-number">0${index + 1}</span><span class="mini-cover ${item.cover_path ? "" : index === 1 ? "green" : index === 2 ? "yellow" : ""}"${coverStyle}></span><span class="rank-name">${item.title || item.author}<small class="rank-author">${item.author}</small></span><span class="rank-value">${value}</span>`;
                    const href = type === "author"
                        ? `#author?id=${encodeURIComponent(item.id)}`
                        : `#zine?id=${encodeURIComponent(item.id)}`;
                    return item.id
                        ? `<a class="rank-row" href="${href}">${row}</a>`
                        : `<div class="rank-row">${row}</div>`;
                })
                .join("")
            : '<div class="empty">まだランキングデータがありません。</div>';
    };
    const loadRanking = async (type = "zine") => {
        const response = await fetch(
            new URL(`api.php?action=ranking&type=${type}`, window.location.href),
        );
        if (!response.ok) throw new Error("ranking request failed");
        const payload = await response.json();
        renderRanking(payload.items, type);
    };
    try {
        const [newResponse, rankingResponse, categoriesResponse] =
            await Promise.all([
                fetch(
                    new URL("api.php?action=zines&sort=new", window.location.href),
                ),
                fetch(new URL("api.php?action=ranking&type=zine", window.location.href)),
                fetch(new URL("api.php?action=categories", window.location.href)),
            ]);
        const [newPayload, rankingPayload, categoriesPayload] = await Promise.all([
            newResponse.json(),
            rankingResponse.json(),
            categoriesResponse.json(),
        ]);
        newContainer.innerHTML = newPayload.items?.length
            ? newPayload.items
                .slice(0, 4)
                .map((item, index) => card(apiZine(item, index)))
                .join("")
            : '<div class="empty">公開されているZINEはありません。</div>';
        renderRanking(rankingPayload.items);
        categoriesContainer.innerHTML = categoriesPayload.items?.length
            ? categoriesPayload.items
                .slice(0, 10)
                .map(
                    (category) =>
                        `<a class="tag" href="#discover?category=${encodeURIComponent(category.name)}">${category.name}</a>`,
                )
                .join("")
            : '<div class="empty">公開されているカテゴリはありません。</div>';
        document.querySelectorAll("[data-tab]").forEach((button) =>
            button.addEventListener("click", async () => {
                document
                    .querySelectorAll("[data-tab]")
                    .forEach((item) => item.classList.toggle("active", item === button));
                try {
                    await loadRanking(button.dataset.tab);
                } catch (error) {
                    rankingContainer.innerHTML =
                        '<div class="empty">ランキングを取得できませんでした。</div>';
                }
            }),
        );
    } catch (error) {
        newContainer.innerHTML =
            '<div class="empty">ZINEを取得できませんでした。</div>';
        rankingContainer.innerHTML =
            '<div class="empty">ランキングを取得できませんでした。</div>';
        categoriesContainer.innerHTML =
            '<div class="empty">カテゴリを取得できませんでした。</div>';
        console.warn("YOHaku homepage data unavailable", error);
    }
}
async function syncZines() {
    try {
        const endpoint = new URL("api.php?action=zines", window.location.href);
        const response = await fetch(endpoint);
        if (!response.ok) return;
        const payload = await response.json();
        zines.splice(0, zines.length, ...(payload.items || []).map(apiZine));
        render();
        syncHomeData();
    } catch (error) {
        console.warn("YOHaku API is unavailable", error);
    }
}
document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (
        form.matches("[data-profile-form]") ||
        form.matches("[data-change-password]")
    ) {
        event.preventDefault();
        const action = form.matches("[data-profile-form]")
            ? "update_profile"
            : "change_password";
        const response = await fetch(
            new URL("api.php?action=" + action, window.location.href),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
            },
        );
        const payload = await response.json();
        if (!response.ok) {
            alert(payload.error || "保存に失敗しました");
            return;
        }
        alert(payload.message || "保存しました");
        return;
    }
    if (!form.matches("[data-password-reset]")) return;
    event.preventDefault();
    const response = await fetch(
        new URL("api.php?action=password_reset", window.location.href),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
        },
    );
    const payload = await response.json();
    if (!response.ok) {
        alert(payload.error || "パスワード変更に失敗しました");
        return;
    }
    alert(payload.message);
    location.hash = "#login";
});
async function syncCreator() {
    const container = document.querySelector("[data-my-zines]");
    if (!container) return;
    const response = await fetch(
        new URL("api.php?action=my_zines", window.location.href),
        { credentials: "same-origin" },
    );
    if (!response.ok) {
        container.innerHTML = '<div class="empty">ログインすると作品を管理できます。</div>';
        return;
    }
    const payload = await response.json();
    if (!payload.items || !payload.items.length) {
        container.innerHTML = '<div class="empty">まだ作品がありません。</div>';
        return;
    }
    container.innerHTML = payload.items
        .map(
            (z) => {
                const statusLabel = { draft: "下書き", published: "公開中", private: "非公開" }[z.status] || z.status;
                const isPublished = z.status === "published";
                const coverStyle = z.cover_path ? ` style="background-image:url('${mediaUrl(z.cover_path)}');width:60px;height:85px;flex:0 0 60px;margin-bottom:0"` : ' style="width:60px;height:85px;flex:0 0 60px;margin-bottom:0"';
                return `<div class="my-zine-item"><a class="cover" href="#zine?id=${z.id}"${coverStyle}></a><div class="my-zine-body"><div class="my-zine-info"><a class="my-zine-title" href="#zine?id=${z.id}">${z.title}</a><span class="my-zine-meta"><span class="my-zine-status my-zine-status-${z.status}">${statusLabel}</span> / ${Number(z.view_count || 0).toLocaleString()} 回閲覧 / お気に入り ${Number(z.favorite_count || 0).toLocaleString()}</span></div><div class="my-zine-actions"><a class="button button-outline button-small" href="#creator?id=${z.id}">編集</a><button class="button button-outline button-small" data-toggle-public-zine="${z.id}" data-published="${isPublished}">${isPublished ? "非公開にする" : "公開する"}</button><button class="button button-outline button-small" data-delete-zine="${z.id}">削除</button></div></div></div>`;
            },
        )
        .join("");
}
function editZinePage() {
    const id = new URLSearchParams(location.hash.split("?")[1] || "").get("id") || "0";
    return layout(`<div class="form-page"><p class="eyebrow">Creator studio / Edit</p><h1>ZINEを編集する</h1><p>タイトル、説明文、カテゴリを更新できます。</p><form class="form" data-edit-zine-form><input type="hidden" name="zine_id" value="${id}"><div class="field"><label>タイトル</label><input name="title" required maxlength="200"></div><div class="field"><label>カテゴリ</label><select name="category" required><option value="">選択してください</option><option>エッセイ</option><option>写真</option><option>イラスト</option><option>カルチャー</option><option>旅と散歩</option></select></div><div class="field"><label>説明文</label><textarea name="description" required rows="7"></textarea></div><label class="check"><input name="age_restricted" type="checkbox"> 年齢制限・注意書きあり</label><button class="button button-dark" type="submit">変更を保存</button> <a class="button button-outline" href="#creator">戻る</a></form></div>`);
}
async function activateEditZine() {
    if (location.hash.slice(1).split("?")[0] !== "edit-zine") return;
    const form = document.querySelector("[data-edit-zine-form]");
    if (!form) return;
    const id = form.elements.zine_id.value;
    const response = await fetch(new URL("api.php?action=my_zines", window.location.href), { credentials: "same-origin" });
    const payload = await response.json();
    const zine = payload.items?.find((item) => String(item.id) === String(id));
    if (!response.ok || !zine) { form.innerHTML = '<div class="empty">編集できるZINEが見つかりません。</div>'; return; }
    form.elements.title.value = zine.title;
    form.elements.category.value = zine.category;
    form.elements.description.value = zine.description;
    form.elements.age_restricted.checked = Boolean(Number(zine.age_restricted));
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const updateResponse = await fetch(new URL("api.php?action=update_zine", window.location.href), { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        const updatePayload = await updateResponse.json();
        if (!updateResponse.ok) { alert(updatePayload.error || "保存できませんでした"); return; }
        alert("変更を保存しました");
        location.hash = "#creator";
    });
}
async function syncSecurityLogs() {
    const reports = document.querySelector("[data-admin-reports]");
    if (!reports || document.querySelector("[data-security-logs]")) return;
    const response = await fetch(
        new URL("api.php?action=admin_security_logs", window.location.href),
        { credentials: "same-origin" },
    );
    if (!response.ok) return;
    const payload = await response.json();
    reports.parentElement.insertAdjacentHTML(
        "afterend",
        '<section class="section"><div class="section-header"><h2 class="section-title">セキュリティログ</h2></div><div data-security-logs></div></section>',
    );
    const container = document.querySelector("[data-security-logs]");
    container.innerHTML = payload.items.length
        ? payload.items
            .map(
                (log) =>
                    `<div class="rank-row"><span>${log.created_at}</span><strong>${log.event}</strong><small>${log.email || "guest"} / ${log.ip_address || ""}</small></div>`,
            )
            .join("")
        : "ログはありません。";
}
document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-toggle-public-zine]");
    if (!button) return;
    const action = button.dataset.published === "true" ? "unpublish_zine" : "publish_zine";
    const response = await fetch(
        new URL(`api.php?action=${action}`, window.location.href),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ zine_id: Number(button.dataset.togglePublicZine) }),
        },
    );
    const payload = await response.json();
    alert(payload.error || "公開状態を更新しました");
    if (response.ok) syncCreator();
});
document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-zine]");
    if (!button) return;
    if (!confirm("このZINEを削除しますか？この操作は取り消せません。")) return;
    const response = await fetch(new URL("api.php?action=delete_zine", window.location.href), { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ zine_id: Number(button.dataset.deleteZine) }) });
    const payload = await response.json();
    if (!response.ok) { alert(payload.error || "削除できませんでした"); return; }
    alert("ZINEを削除しました");
    syncCreator();
});
function activateSettings() {
    if (location.hash.slice(1).split("?")[0] === "settings") {
        app.innerHTML = settingsPage();
        bind();
    }
}
async function activateCollection() {
    const kind = location.hash.slice(1).split("?")[0];
    if (!["favorites", "history"].includes(kind)) return;
    app.innerHTML = collectionPage(kind);
    const response = await fetch(
        new URL("api.php?action=" + kind, window.location.href),
        { credentials: "same-origin" },
    );
    const payload = await response.json();
    const container = document.querySelector("[data-collection]");
    if (!response.ok) {
        container.innerHTML =
            '<div class="empty">ログインすると確認できます。</div>';
        return;
    }
    container.innerHTML = payload.items.length
        ? payload.items
            .map(
                (item) =>
                    `<article class="zine-card"><a href="#zine?id=${item.id}"><div class="cover cover-a"></div><div class="zine-meta"><div><p class="zine-title">${item.title}</p><p class="zine-author">${item.author}</p></div></div></a></article>`,
            )
            .join("")
        : '<div class="empty">まだ作品がありません。</div>';
}
async function activateAuthor() {
    if (location.hash.slice(1).split("?")[0] !== "author") return;
    const id =
        new URLSearchParams(location.hash.split("?")[1] || "").get("id") || "0";
    app.innerHTML = authorPage();
    const response = await fetch(
        new URL(
            "api.php?action=author&id=" + encodeURIComponent(id),
            window.location.href,
        ),
    );
    const payload = await response.json();
    if (!response.ok) {
        document.querySelector("[data-author-bio]").textContent =
            payload.error || "著者が見つかりません";
        return;
    }
    const author = payload.item;
    document.querySelector("[data-author-name]").textContent =
        author.display_name;
    document.querySelector("[data-author-bio]").textContent =
        author.bio || "プロフィールは未登録です。";
    document.querySelector("[data-author-stats]").textContent =
        `累計ビュー ${Number(author.total_views).toLocaleString()}`;
    document.querySelector("[data-author-zines]").innerHTML = author.zines.length
        ? author.zines
            .map(
                (item) =>
                    `<article class="zine-card"><a href="#zine?id=${item.id}"><div class="cover cover-a"></div><div class="zine-meta"><p class="zine-title">${item.title}</p><p class="zine-author">${item.category}</p></div></a></article>`,
            )
            .join("")
        : '<div class="empty">公開作品はありません。</div>';
}
document.addEventListener(
    "submit",
    async (event) => {
        const form = event.target;
        if (
            !form.matches(
                '[data-demo-form][data-auth="login"], [data-demo-form][data-auth="login_2fa"]',
            )
        )
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const action = form.dataset.auth;
        const data = Object.fromEntries(new FormData(form));
        const response = await fetch(
            new URL("api.php?action=" + action, window.location.href),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(data),
            },
        );
        const payload = await response.json();
        if (payload.requires_2fa) {
            form.dataset.auth = "login_2fa";
            if (!form.querySelector('[name="code"]'))
                form.insertAdjacentHTML(
                    "beforeend",
                    '<div class="field"><label>認証アプリのコード</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" required></div>',
                );
            alert(payload.message);
            return;
        }
        if (!response.ok) {
            alert(payload.error || "ログインに失敗しました");
            return;
        }
        alert("ログインしました");
        location.hash = "#dashboard";
    },
    true,
);
document.addEventListener(
    "submit",
    async (event) => {
        const form = event.target;
        if (!form.matches("[data-change-email]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const response = await fetch(
            new URL("api.php?action=change_email", window.location.href),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
            },
        );
        const payload = await response.json();
        alert(payload.error || payload.message || "確認メールを送信しました");
    },
    true,
);
document.addEventListener(
    "submit",
    async (event) => {
        const form = event.target;
        if (!form.matches('[data-demo-form][data-auth="password_reset_request"]'))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const response = await fetch(
            new URL(
                "api.php?action=password_reset_request",
                window.location.href,
            ),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
            },
        );
        const payload = await response.json();
        alert(payload.error || payload.message || "再設定メールを送信しました");
        if (response.ok) location.hash = "#login";
    },
    true,
);
window.addEventListener("hashchange", () => {
    render();
    syncAuthHeader();
    syncHomeData();
    activateCategories();
    syncAdmin();
    syncSecurityLogs();
    activateSettings();
    activateCollection();
    activateAuthor();
    activateContact();
    activateFaq();
    activateDiscover();
    activateReport();
    syncCreator();
    activateTwoFactor();
    activateEditZine();
});
render();
syncAuthHeader();
syncZines();
syncHomeData();
activateCategories();
syncAdmin();
syncSecurityLogs();
activateSettings();
activateCollection();
activateAuthor();
activateContact();
activateFaq();
activateDiscover();
activateReport();
syncCreator();
activateTwoFactor();
activateEditZine();
