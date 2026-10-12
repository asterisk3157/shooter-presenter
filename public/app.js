// ============================================================================
//  Shooter Presenter … PDF をスライドとして映し、シューターをレーザーポインターにする
// ============================================================================
//  PDF は、このブラウザの中だけで開く（どこにも送らない）。
//  シューター（C4's の銃型コントローラー）とは、USB のシリアル通信（Web Serial）で話す。
//    1. ポートを開く（115200）→ "WHO" → "HELLO <id> <fw> <slot> [caps]"
//    2. "BIND 0" → "BOUND ..." → 以後 "S <x> <y>" が 100Hz で届く（度）
//    3. 引き金は "T"（押した）/ "TU"（離した）。リセットボタンは "R"
//    4. 5秒なにも送らないと割り当てが外れるので、1秒ごとに "PING" を送る
// ============================================================================
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const $ = id => document.getElementById(id);
const canvas = $('page'), ctx = canvas.getContext('2d');
const hasSerial = 'serial' in navigator;
let pdf = null, pageNum = 1, rendering = false, wanted = null;

// ---- PDF --------------------------------------------------------------------
async function openPdf(data) {
  let doc;
  try {
    // isEvalSupported: false … PDF の中の文字データから命令を組み立てて実行する処理を止める
    doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    toast(e && e.name === 'PasswordException' ? 'パスワード付きのPDFは開けません' : 'このPDFは開けませんでした');
    return;
  }
  pdf = doc; pageNum = 1; rendering = false; wanted = null;
  $('empty').hidden = true; canvas.hidden = false;
  document.body.classList.remove('start');
  showBar();
  await show(1);
  toast(isTouch ? `${pdf.numPages}ページ。右側をタップで次へ、左側で前へ` : `${pdf.numPages}ページを読みこみました`);
}

async function show(n) {
  if (!pdf) return;
  n = Math.max(1, Math.min(pdf.numPages, n));
  if (rendering) { wanted = n; return; }
  rendering = true;
  const doc = pdf;
  try {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(innerWidth / base.width, innerHeight / base.height);
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: fit * dpr });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    canvas.style.width = Math.round(vp.width / dpr) + 'px'; canvas.style.height = Math.round(vp.height / dpr) + 'px';
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (doc === pdf) { pageNum = n; $('pageno').textContent = `${n} / ${pdf.numPages}`; gun.showPage(n); }
  } catch (_) { toast('このページは表示できませんでした'); }
  rendering = false;
  if (wanted !== null) { const w = wanted; wanted = null; if (w !== pageNum) show(w); }
}
const next = () => { if (pdf && pageNum < pdf.numPages) { show(pageNum + 1); gun.feedback(); } };
const prev = () => { if (pdf && pageNum > 1) { show(pageNum - 1); gun.feedback(); } };

// PDF 以外（PowerPoint など）を置かれたら、開かずに PDF への書き出し方を案内する
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
async function handleFile(f) {
  if (!f) return;
  if (isPdf(f)) openPdf(new Uint8Array(await f.arrayBuffer()));
  else showGuide(f.name);
}
function showGuide(name) {
  $('guideLead').textContent = (name ? `「${name}」はPDFではありません。` : '') +
    'このビューアが開けるのはPDFです。元の資料を作ったアプリで、PDFに書き出してください。';
  $('guide').hidden = false;
}
const hideGuide = () => { $('guide').hidden = true; };

for (const input of document.querySelectorAll('input.file'))
  input.addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
addEventListener('dragover', e => { e.preventDefault(); $('empty').classList.add('over'); });
addEventListener('dragleave', () => $('empty').classList.remove('over'));
addEventListener('drop', e => {
  e.preventDefault(); $('empty').classList.remove('over');
  const files = [...e.dataTransfer.files];
  handleFile(files.find(isPdf) || files[0]);
});
addEventListener('resize', () => show(pageNum));
$('howto').addEventListener('click', () => showGuide(''));
$('guideClose').addEventListener('click', hideGuide);
$('guide').addEventListener('click', e => { if (e.target === $('guide')) hideGuide(); });

// ---- レーザーポインター ------------------------------------------------------
const dot = $('dot');
const pointer = { x: 0, y: 0, tx: 0, ty: 0, visible: false };
let gainDeg = +(localStorage.getItem('gainDeg') || 25);        // 画面の端から端までを、左右 ±何度で動かすか
// 画面での向き。実機で確かめた向きを初めの値にしている。
// 逆に動く機体では X キー・Y キーで反転でき、その設定はこのブラウザに覚えておく。
let flipX = +(localStorage.getItem('flipX') || -1), flipY = +(localStorage.getItem('flipY') || -1);

function aimTo(xDeg, yDeg) {                 // シューターの向き（度）→ 画面の位置
  const half = innerWidth / 2;
  const pxPerDeg = half / gainDeg;
  pointer.tx = clamp(innerWidth / 2 - xDeg * pxPerDeg, 0, innerWidth);
  pointer.ty = clamp(innerHeight / 2 - yDeg * pxPerDeg, 0, innerHeight);
  if (!pointer.visible) setPointer(true);
}
function setPointer(on) { pointer.visible = on; dot.classList.toggle('on', on); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
(function tick() {                           // 少しだけなめらかに追いかける（手ぶれをおさえる）
  pointer.x += (pointer.tx - pointer.x) * 0.45;
  pointer.y += (pointer.ty - pointer.y) * 0.45;
  dot.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
  requestAnimationFrame(tick);
})();

// ---- 引き金 ------------------------------------------------------------------
//   短く引く → 次へ。0.6秒より長く引いてから離す → 前へ。
const HOLD_MS = 600;
let downAt = 0, holdTimer = null;
function triggerDown() {
  downAt = performance.now();
  dot.classList.add('held');
  holdTimer = setTimeout(() => toast('離すと前のページ'), HOLD_MS);
}
function triggerUp() {
  if (!downAt) return;
  const held = performance.now() - downAt;
  downAt = 0; clearTimeout(holdTimer); dot.classList.remove('held');
  held >= HOLD_MS ? prev() : next();
}

// ---- シューター（Web Serial）--------------------------------------------------
const gun = {
  port: null, writer: null, id: '', caps: [], bound: false, pingTimer: null, legacy: false, legacyTimer: null, legacySeen: false,

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
    } catch (e) { toast('接続をやめました'); this.port = null; return; }
    this.writer = this.port.writable.getWriter();
    status('シューター: 探しています…');
    this.readLoop();
    await sleep(250);                         // 開いた直後は落ち着くまで待つ
    await this.send('WHO');
    this.pingTimer = setInterval(() => this.send('PING'), 1000);
    // 2026年版のプログラムなら HELLO が返る。返らなければ、2025年版の通信で話してみる
    setTimeout(() => { if (this.port && !this.id) this.startLegacy(); }, 2500);
  },

  async readLoop() {
    const dec = new TextDecoder(); let buf = '';
    const reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { this.onLine(buf.slice(0, i).replace(/\r/g, '').trim()); buf = buf.slice(i + 1); }
      }
    } catch (_) { /* 抜かれた */ }
    finally { try { reader.releaseLock(); } catch (_) {} this.disconnected(); }
  },

  // 2025年版: こちらから "Gyro" と聞くと "x: 1.23 | y: 4.56" が返る。引き金は "Trigger" を含む行（離した知らせは無い）
  startLegacy() {
    this.legacy = true;
    clearInterval(this.pingTimer);
    this.legacyTimer = setInterval(() => this.send('Gyro'), 20);
    status('シューター: 2025年版として接続を試しています…');
    setTimeout(() => { if (this.legacy && !this.legacySeen) toast('返事がありません。別のポートかもしれません'); }, 3000);
  },

  onLine(line) {
    if (!line) return;
    if (this.legacy) {
      if (line.startsWith('x:')) {
        const m = line.split('|');
        const x = parseFloat(m[0].replace('x:', '')), y = parseFloat((m[1] || '').replace('y:', ''));
        if (!isNaN(x) && !isNaN(y)) {
          if (!this.legacySeen) { this.legacySeen = true; status('シューター: ', '2025年版', ' 接続中'); toast('つながりました（2025年版。引き金は「次へ」だけ）'); }
          aimTo(x * flipX, y * flipY);
        }
      } else if (line.includes('Trigger')) { next(); }
      return;
    }
    if (line[0] === 'S' && line[1] === ' ') {                 // 照準（1秒に 100回届く）
      const p = line.split(' ');
      const x = parseFloat(p[1]), y = parseFloat(p[2]);
      if (!isNaN(x) && !isNaN(y)) aimTo(x * flipX, y * flipY);
      return;
    }
    const p = line.split(' ');
    switch (p[0]) {
      case 'HELLO':                                           // HELLO <id> <fw> <slot> [caps]
        this.id = (p[1] || '').slice(0, 32); this.caps = (p[4] || '').split(',').filter(Boolean);
        if (!this.bound) this.send('BIND 0');                 // 割り当てる（このとき向いている方向が中央になる）
        break;
      case 'BOUND':
        this.bound = true;
        status('シューター: ', this.id, ' 接続中');
        toast('つながりました。向けている方向が画面の中央です');
        this.showPage(pageNum);
        break;
      case 'T': triggerDown(); break;
      case 'TU': triggerUp(); break;
      case 'R': toast('照準を中央に戻しました'); break;      // 銃のリセットボタン（銃が自分で中央を取り直す）
    }
  },

  async send(cmd) {
    if (!this.writer) return;
    try { await this.writer.write(new TextEncoder().encode(cmd + '\n')); } catch (_) {}
  },
  feedback() { if (this.bound && !this.legacy) { this.send('MOTOR 60'); this.send('LED 80'); } },   // ページをめくった手応え
  showPage(n) { if (this.bound && this.caps.includes('7seg')) this.send('SEG ' + n); },   // 7セグにページ番号
  recenter() { if (this.bound) this.send('RECENTER'); },

  disconnected() {
    clearInterval(this.pingTimer); clearInterval(this.legacyTimer); this.legacy = this.legacySeen = false;
    try { this.writer && this.writer.releaseLock(); } catch (_) {}
    try { this.port && this.port.close(); } catch (_) {}
    this.port = this.writer = null; this.bound = false; this.id = '';
    status('シューター: 未接続'); setPointer(false);
  },
};
addEventListener('beforeunload', () => { if (!gun.legacy) { gun.send('SEG'); gun.send('UNBIND'); } });

// シューターにつなげないブラウザ（Safari・Firefox・スマホ）では、接続まわりの表示を出さない
if (hasSerial) status('シューター: 未接続');
else for (const id of ['connect', 'gainBox', 'gunHelp']) $(id).hidden = true;

// ---- マウスをポインターにする --------------------------------------------------
let mouseMode = false;
$('mouse').addEventListener('click', () => {
  mouseMode = !mouseMode; setPointer(mouseMode);
  $('mouse').textContent = mouseMode ? 'マウスをポインターにする: 入' : 'マウスをポインターにする';
  if (mouseMode) toast('クリックで次へ、長押しして離すと前へ');
});
addEventListener('mousemove', e => {
  if (performance.now() - lastTouch < 800) return;            // タップのあとに届く、見かけのマウス操作は無視
  showBar();
  if (mouseMode) { pointer.tx = e.clientX; pointer.ty = e.clientY; }
});
$('stage').addEventListener('mousedown', () => { if (mouseMode && performance.now() - lastTouch >= 800) triggerDown(); });
$('stage').addEventListener('mouseup', () => { if (mouseMode && performance.now() - lastTouch >= 800) triggerUp(); });

// ---- タップ（スマホ・タブレット）------------------------------------------------
//   上の端: メニューを出す。左の 3分の1: 前へ。それ以外: 次へ。
let isTouch = false, lastTouch = -1e9;
$('stage').addEventListener('pointerup', e => {
  if (e.pointerType !== 'touch') return;
  isTouch = true; lastTouch = performance.now(); document.body.classList.add('touch');
  if (!pdf) return;
  if (e.clientY < 90) showBar();
  else if (e.clientX < innerWidth / 3) prev();
  else next();
});

// ---- そのほかの操作 ------------------------------------------------------------
$('connect').addEventListener('click', () => gun.port ? toast('すでにつながっています') : gun.connect());
$('full').addEventListener('click', toggleFull);
$('gain').addEventListener('input', e => { gainDeg = +e.target.value; localStorage.setItem('gainDeg', gainDeg); $('gainv').textContent = `±${gainDeg}°`; });
$('gain').value = gainDeg; $('gainv').textContent = `±${gainDeg}°`;
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  else toast('このブラウザは全画面にできません');
}
addEventListener('fullscreenchange', () => { document.body.classList.toggle('present', !!document.fullscreenElement); setTimeout(() => show(pageNum), 100); });

addEventListener('keydown', e => {
  if (!$('guide').hidden) { if (e.key === 'Escape' || e.key === 'Enter') { hideGuide(); e.preventDefault(); } return; }
  if (!pdf) return;                         // 最初の画面では、ボタンをキーボードで押せるように何もしない
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ': case 'Enter': next(); break;
    case 'ArrowLeft': case 'PageUp': case 'Backspace': prev(); break;
    case 'Home': show(1); break;
    case 'End': if (pdf) show(pdf.numPages); break;
    case 'f': case 'F': toggleFull(); break;
    case 'c': case 'C': gun.recenter(); break;
    case 'p': case 'P': setPointer(!pointer.visible); break;
    case 'x': case 'X': flipX = -flipX; localStorage.setItem('flipX', flipX); toast('左右の向きを反転しました'); break;
    case 'y': case 'Y': flipY = -flipY; localStorage.setItem('flipY', flipY); toast('上下の向きを反転しました'); break;
    default: return;
  }
  e.preventDefault();
});

let barTimer = null;
function showBar() {
  $('bar').classList.remove('hide'); clearTimeout(barTimer);
  barTimer = setTimeout(() => { if (pdf) $('bar').classList.add('hide'); }, isTouch ? 4000 : 2500);
}
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600); }
// シューターの状態。strong の部分だけを強調する（機体から届いた名前を、そのまま文字として入れる）
function status(text, strong, tail) {
  const s = $('status'); s.textContent = text;
  if (strong) { const b = document.createElement('b'); b.textContent = strong; s.append(b, tail || ''); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 動作確認用（?sim=1）: 本物の代わりに、同じ形の行を流す ----------------------
if (new URLSearchParams(location.search).has('sim')) {
  window.simLine = line => gun.onLine(line);
  gun.send = async cmd => { (window.simSent = window.simSent || []).push(cmd); if (cmd === 'BIND 0') gun.onLine('BOUND SIM_01 0'); };
  if (new URLSearchParams(location.search).get('sim') === 'legacy') { gun.legacy = true; } else gun.onLine('HELLO SIM_01 2.5.0 -1 motor,7seg');
}
