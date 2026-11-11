/* fx-trend.js：HouseYang 首頁「各區成交」旁邊的歷年單價走勢圖。
   資料 market-trend.json＝正式主機成交資料庫逐年彙總（只有件數與單價中位數，由 prod/rp_trend.py 唯讀匯出、gen_trend.py 整理）。
   跟排行（fx-market.js）鬆耦合：聽縣市下拉的 change、聽排行列的滑入／點選，自己畫圖；排行沒載成功時這張圖也不出現。 */
(() => {
  'use strict';
  const host = document.querySelector('[data-fx-market]');
  if (!host || !window.FX) return;
  const { reduce, clamp } = window.FX;
  const src = host.dataset.fxTrend;
  const select = host.querySelector('[data-market="county"]');
  const bars = host.querySelector('[data-market="bars"]');
  if (!src || !select || !bars) return;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}, parent) => { const n = document.createElementNS(NS, name); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.append(n); return n; };
  const W = 560, H = 320, L = 46, R = 14, T = 14, B = 30;

  const init = data => {
    const years = data.years, N = years.length;
    const fig = document.createElement('figure'); fig.className = 'market-trend';
    const cap = document.createElement('p'); cap.className = 'trend-cap'; cap.textContent = '歷年單價走勢（住宅買賣，萬元／坪）';
    const read = document.createElement('p'); read.className = 'trend-read'; read.setAttribute('aria-live', 'polite');
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'application', tabindex: '0', 'aria-label': '歷年單價走勢圖。滑鼠移到圖上，或用鍵盤左右鍵，可以看每一年的數字。' });
    const note = document.createElement('p'); note.className = 'small trend-note';
    note.textContent = '每一年取單價中位數；樣本不到 ' + data.minN + ' 筆的年份不畫。最近幾年還有預售屋交屋後才補登錄的，數字之後會再動。';
    fig.append(cap, read, svg, note);
    bars.after(fig);
    host.classList.add('has-trend');

    const gGrid = el('g', { class: 'trend-grid' }, svg), gLines = el('g', {}, svg), gHover = el('g', { class: 'trend-hover' }, svg);
    const pathNation = el('path', { class: 'trend-line is-nation' }, gLines), pathCounty = el('path', { class: 'trend-line is-county' }, gLines), pathTown = el('path', { class: 'trend-line is-town' }, gLines);
    const rule = el('line', { class: 'trend-rule', y1: T, y2: H - B }, gHover);
    const dots = [el('circle', { class: 'trend-dot is-nation', r: 3.5 }, gHover), el('circle', { class: 'trend-dot is-county', r: 4.5 }, gHover), el('circle', { class: 'trend-dot is-town', r: 4.5 }, gHover)];
    const st = { county: '', town: '', year: N - 2, top: 100 }; // 預設看最近一個完整年度
    const X = i => L + (W - L - R) * i / (N - 1);
    const Y = v => H - B - (H - B - T) * v / st.top;
    const line = p => { let d = '', pen = false; p.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); return d; };
    const seriesOf = () => { const c = data.counties[st.county]; return [data.nation, c || null, c && st.town && c.t[st.town] ? c.t[st.town] : null]; };
    const fmtN = n => n.toLocaleString('en-US');
    const chip = (cls, name, s) => {
      const span = document.createElement('span'); span.className = 'trend-chip ' + cls;
      const v = s.p[st.year];
      span.append(name + ' ');
      const b = document.createElement('b'); b.textContent = v == null ? '樣本不足' : v.toFixed(1); span.append(b);
      if (v != null) span.append(' 萬／坪');
      // 各年件數不顯示：最近兩三年還有預售屋交屋後才補登錄的，件數看起來會像腰斬，容易誤會
      return span;
    };
    const draw = () => {
      const [nation, county, town] = seriesOf();
      const max = Math.max(10, ...[nation, county, town].filter(Boolean).flatMap(s => s.p.filter(v => v != null)));
      const step = max > 120 ? 50 : max > 60 ? 25 : max > 30 ? 10 : 5;
      st.top = Math.ceil(max * 1.08 / step) * step;
      gGrid.replaceChildren();
      for (let v = 0; v <= st.top; v += step) {
        el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v ? 'trend-gridline' : 'trend-axis' }, gGrid);
        el('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'trend-tick' }, gGrid).textContent = v;
      }
      years.forEach((y, i) => { if ((N - 1 - i) % 2 === 0) el('text', { x: X(i), y: H - 9, 'text-anchor': 'middle', class: 'trend-tick' }, gGrid).textContent = y; });
      pathNation.setAttribute('d', line(nation.p));
      pathCounty.setAttribute('d', county ? line(county.p) : '');
      pathTown.setAttribute('d', town ? line(town.p) : '');
      hover();
    };
    const hover = () => {
      const [nation, county, town] = seriesOf(), i = st.year, x = X(i);
      rule.setAttribute('x1', x); rule.setAttribute('x2', x);
      [nation, county, town].forEach((s, k) => {
        const v = s ? s.p[i] : null;
        dots[k].style.display = v == null ? 'none' : '';
        if (v != null) { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(v)); }
      });
      const year = document.createElement('span'); year.className = 'trend-year'; year.textContent = years[i] + ' 年';
      const parts = [year];
      if (town) parts.push(chip('is-town', st.town, town));
      if (county) parts.push(chip('is-county', st.county, county));
      parts.push(chip('is-nation', '全台', nation));
      read.replaceChildren(...parts);
    };
    const setCounty = name => { st.county = data.counties[name] ? name : ''; st.town = ''; fig.classList.remove('is-in'); draw(); requestAnimationFrame(() => fig.classList.add('is-in')); };
    const setTown = name => { const c = data.counties[st.county]; const t = c && c.t[name] ? name : ''; if (t === st.town) return; st.town = t; draw(); };
    // 從排行的某一列找出區名：列裡的文字包含哪個區名就是哪一區（不依賴排行那邊的 class 名稱）
    const townIn = node => { const row = node && node.closest ? node.closest('li') : null; const c = data.counties[st.county]; if (!row || !c) return ''; const text = row.textContent; return Object.keys(c.t).sort((a, b) => b.length - a.length).find(t => text.includes(t)) || ''; };
    // 排行那邊下拉的 value 是序號，縣市名在選項文字裡
    const countyName = () => { const o = select.options[select.selectedIndex]; return o ? o.textContent.trim() : ''; };
    select.addEventListener('change', () => setCounty(countyName()));
    bars.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') setTown(townIn(e.target)); }, { passive: true });
    bars.addEventListener('focusin', e => setTown(townIn(e.target)));
    // 點擊、滑鼠離開、焦點離開：一律以排行自己標的「選中那一列」（aria-pressed）為準。
    // 排行的處理先跑（它掛在按鈕上），這裡在外層後跑，讀到的是更新後的狀態；不自己猜是選取還是取消。
    const pressedTown = () => { const on = bars.querySelector('[aria-pressed="true"]'); return on ? townIn(on) : ''; };
    bars.addEventListener('click', () => setTown(pressedTown()));
    bars.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') setTown(pressedTown()); }, { passive: true });
    bars.addEventListener('focusout', e => { if (!bars.contains(e.relatedTarget)) setTown(pressedTown()); });
    // 地圖（fx-pmap.js）指定某一區：同一個縣市才畫那一區的線
    host.addEventListener('fx:town', e => { if (e.detail && e.detail.county === st.county) setTown(e.detail.town || ''); });
    // 年份沒變就不重畫讀數（它是 aria-live，同樣的內容一直重建會讓螢幕報讀重複念）
    const setYear = i => { if (i === st.year) return; st.year = i; hover(); };
    const pick = e => { const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W; setYear(clamp(Math.round((x - L) / (W - L - R) * (N - 1)), 0, N - 1)); };
    svg.addEventListener('pointermove', pick, { passive: true });
    svg.addEventListener('pointerdown', pick, { passive: true });
    svg.addEventListener('keydown', e => { const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!d) return; e.preventDefault(); setYear(clamp(st.year + d, 0, N - 1)); });
    setCounty(countyName());
    if (reduce.matches) fig.classList.add('is-in');
  };

  // 等排行把縣市下拉填好（選項出現）再開始，最多等 8 秒
  const start = () => fetch(src).then(r => { if (!r.ok) throw new Error('trend'); return r.json(); }).then(init).catch(() => {});
  if (select.options.length) start();
  else {
    const mo = new MutationObserver(() => { if (select.options.length) { mo.disconnect(); clearTimeout(giveUp); start(); } });
    mo.observe(select, { childList: true });
    const giveUp = setTimeout(() => mo.disconnect(), 8000);
  }
})();
