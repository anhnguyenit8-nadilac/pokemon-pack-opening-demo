// Tiny i18n for the pack-opening page: ja (default), en, zh.
// Language comes from ?lang=, then the site-wide choice in localStorage, then Japanese.

const DICT = {
  ja: {
    'eyebrow': 'メガシンカ · M6',
    'title': '拡張パック「エメラルドストーム」',
    'loading': '読み込み中…',
    'btn.open': 'このパックを開ける',
    'btn.tear': '開封する',
    'btn.skip': '結果までスキップ',
    'btn.again': 'もう1パック開ける',
    'btn.viewVault': 'コレクションを見る',
    'vault': 'コレクション',
    'vault.aria': 'コレクションを開く（スペシャルカード{n}枚）',
    'vault.title': 'マイコレクション',
    'vault.close': '閉じる',
    'vault.empty': 'スペシャルカードはまだありません。パックを開けると、スペシャルカードはケースに入れてここに保存されます。',
    'vault.summary': 'スペシャルカード {n}枚',
    'vault.item': 'No.{n}・{r}（{d}開封）を見る',
    'viewer.hint': 'ドラッグで回転',
    'viewer.back': 'コレクションに戻る',
    'viewer.aria': 'カードケースビューア',
    'viewer.caption': 'シリアル {s}・{d}開封',
    'results.title': '今回のカード',
    'results.inVault': 'コレクションに追加済み',
    'card.alt': 'カード No.{n}、レアリティ {r}',
    'rarity.RR': 'ダブルレア',
    'rarity.R': 'レア',
    'back': 'エメラルドストームのサイトに戻る',
    'lang.nav': '言語',
    'hint.select': 'ドラッグでパックを回転・タップで開封',
    'hint.swipe': '線に沿ってスワイプしてパックを開けよう',
    'hint.swipeStart': '点線の左端からスワイプしてね',
    'hint.keepGoing': 'もう少し！最後までスワイプしよう',
    'hint.tapReveal': 'タップしてカードをめくろう',
    'hint.special': '何かスペシャルな予感…タップしてめくろう',
    'hint.next': 'スワイプかタップで次のカードへ',
    'hint.caseIt': 'タップしてケースに入れよう',
    'hint.seeAll': 'タップして結果を見よう',
    'hint.error': 'パックを読み込めませんでした：{m}',
    'toast.cased': 'ケースに入れてコレクションに追加しました',
    'disclaimer': 'コンセプトデモ（プロトタイプ）・株式会社ポケモンとは関係ありません',
  },
  en: {
    'eyebrow': 'Mega Evolution · M6',
    'title': 'Emerald Storm Booster Pack',
    'loading': 'Loading…',
    'btn.open': 'Open this pack',
    'btn.tear': 'Tear open',
    'btn.skip': 'Skip to results',
    'btn.again': 'Open another pack',
    'btn.viewVault': 'View vault',
    'vault': 'Vault',
    'vault.aria': 'Open vault, {n} special cards',
    'vault.title': 'Your Vault',
    'vault.close': 'Close',
    'vault.empty': 'No special cards yet. Open a pack: every special pull is cased and saved here.',
    'vault.summary': '{n} special cards collected',
    'vault.item': 'View No.{n}, {r}, opened {d}',
    'viewer.hint': 'Drag to rotate',
    'viewer.back': 'Back to vault',
    'viewer.aria': 'Card case viewer',
    'viewer.caption': 'Serial {s} · opened {d}',
    'results.title': 'Your pulls',
    'results.inVault': 'In your Vault',
    'card.alt': 'Card No. {n}, rarity {r}',
    'rarity.RR': 'Double Rare',
    'rarity.R': 'Rare',
    'back': 'Back to the Emerald Storm site',
    'lang.nav': 'Language',
    'hint.select': 'Drag to spin the packs · tap one to open it',
    'hint.swipe': 'Swipe along the line to tear the pack open',
    'hint.swipeStart': 'Start the swipe at the left edge of the dashed line',
    'hint.keepGoing': 'Keep going: swipe all the way across',
    'hint.tapReveal': 'Tap the card to reveal it',
    'hint.special': 'Something special is waiting… tap to reveal',
    'hint.next': 'Swipe or tap for the next card',
    'hint.caseIt': 'Tap to put it in a case',
    'hint.seeAll': 'Tap to see all your pulls',
    'hint.error': 'Could not load the pack: {m}',
    'toast.cased': 'Cased and added to your Vault',
    'disclaimer': 'Concept prototype for a pitch · not affiliated with The Pokémon Company',
  },
  zh: {
    'eyebrow': '超級進化 · M6',
    'title': '擴充包「綠寶石風暴」',
    'loading': '載入中…',
    'btn.open': '打開這包',
    'btn.tear': '撕開',
    'btn.skip': '跳到結果',
    'btn.again': '再開一包',
    'btn.viewVault': '查看收藏庫',
    'vault': '收藏庫',
    'vault.aria': '打開收藏庫（{n} 張特別卡）',
    'vault.title': '我的收藏庫',
    'vault.close': '關閉',
    'vault.empty': '還沒有特別卡。打開擴充包，抽到的特別卡都會裝進卡盒並保存在這裡。',
    'vault.summary': '已收藏 {n} 張特別卡',
    'vault.item': '查看 No.{n}・{r}（{d} 開啟）',
    'viewer.hint': '拖曳旋轉',
    'viewer.back': '返回收藏庫',
    'viewer.aria': '卡盒檢視器',
    'viewer.caption': '序號 {s}・{d} 開啟',
    'results.title': '本次抽到的卡',
    'results.inVault': '已加入收藏庫',
    'card.alt': '卡牌 No.{n}，稀有度 {r}',
    'rarity.RR': '雙重稀有',
    'rarity.R': '稀有',
    'back': '返回綠寶石風暴網站',
    'lang.nav': '語言',
    'hint.select': '拖曳旋轉擴充包・點擊即可開啟',
    'hint.swipe': '沿著虛線滑動，撕開擴充包',
    'hint.swipeStart': '請從虛線左端開始滑動',
    'hint.keepGoing': '再滑遠一點，滑到底！',
    'hint.tapReveal': '點擊翻開卡牌',
    'hint.special': '有特別的東西在等你…點擊翻開',
    'hint.next': '滑動或點擊看下一張',
    'hint.caseIt': '點擊放入卡盒',
    'hint.seeAll': '點擊查看全部結果',
    'hint.error': '無法載入擴充包：{m}',
    'toast.cased': '已裝盒並加入收藏庫',
    'disclaimer': '概念示範（原型）・與 The Pokémon Company 無關',
  },
};

const HTML_LANG = { ja: 'ja', en: 'en', zh: 'zh-Hant-HK' };
const LOCALE = { ja: 'ja-JP', en: 'en-US', zh: 'zh-HK' };
const SITE_PAGE = {};

function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && DICT[q]) return q;
  const h = location.hash.slice(1).toLowerCase().split('-').find((x) => DICT[x]);   // e.g. #en, #ja-rr
  if (h) return h;
  try { const s = localStorage.getItem('site-lang'); if (s && DICT[s]) return s; } catch { /* storage blocked */ }
  return 'ja';
}

let lang = detect();
const listeners = [];

export const getLang = () => lang;
export const locale = () => LOCALE[lang];

export function t(key, vars = {}) {
  const s = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function formatDate(ts, long = false) {
  return new Date(ts).toLocaleDateString(LOCALE[lang], long ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Apply translations to elements marked with data-i18n / data-i18n-aria / data-i18n-title. */
export function applyStatic(root = document) {
  document.documentElement.lang = HTML_LANG[lang];
  document.documentElement.dataset.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-lang-link]').forEach((el) => { el.setAttribute('aria-current', el.dataset.langLink === lang ? 'true' : 'false'); });
  const back = root.querySelector('.po-back');
  if (back) back.setAttribute('href', SITE_PAGE[lang]);
  document.title = `${t('title')} | Pack Opening`;
}

export function setLang(next) {
  if (!DICT[next] || next === lang) return;
  lang = next;
  try { localStorage.setItem('site-lang', lang); } catch { /* storage blocked */ }
  try { history.replaceState(null, '', '#' + lang); } catch { /* sandboxed frame */ }
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) { listeners.push(fn); }

// keep the choice for the main site too
try { localStorage.setItem('site-lang', lang); } catch { /* storage blocked */ }
