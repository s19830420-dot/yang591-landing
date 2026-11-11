/* fx-pmap.js：HouseYang 首頁「全台單價地圖」。
   點陣圖跟母網同一份底圖（tw-grid.bin，每個點知道自己是哪個鄉鎮市區），顏色看那一區最近一個完整年度的住宅單價中位數（market-trend.json）。
   滑到哪一區，旁邊顯示那一區的數字，走勢圖多一條那一區的線；點下去，排行與走勢換成那個縣市。
   跟排行（fx-market.js）、走勢（fx-trend.js）鬆耦合：改縣市＝改下拉並發 change；指定區＝發 fx:town 事件。 */
(() => {
  'use strict';
  const host = document.querySelector('[data-fx-market]');
  if (!host || !window.FX || !('DecompressionStream' in window) || !('ResizeObserver' in window)) return;
  const { clamp, fine } = window.FX;
  const gridSrc = host.dataset.fxPmap, trendSrc = host.dataset.fxTrend;
  const select = host.querySelector('[data-market="county"]'), sum = host.querySelector('[data-market="sum"]');
  if (!gridSrc || !trendSrc || !select || !sum) return;
  const BLOCK = 3, LEVELS = [.2, .36, .54, .74, .96];

  const loadGrid = async () => {
    const res = await fetch(gridSrc);
    if (!res.ok) throw new Error('grid');
    const buf = await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    const n = new DataView(buf).getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    const size = meta.cols * meta.rows, at = 4 + n;
    return { meta, g: new Uint8Array(buf, at + size, size), b: new Uint8Array(buf, at + size * 2, size) };
  };

  const init = ([{ meta, g, b }, trend]) => {
    const { cols, rows, towns, insets } = meta, N = trend.years.length;
    const isLand = i => (b[i] & 128) !== 0;
    const townOf = i => { const t = g[i] | ((b[i] & 3) << 8); return t < towns.length ? t : -1; };
    // 每個鄉鎮：屬於哪個縣市、最近的單價（先看最近一個完整年度，沒有就往前找兩年）
    const info = towns.map(name => {
      const [county, town] = name.split(' ');
      const c = trend.counties[county], s = c && c.t[town];
      let value = null, year = null;
      // 只拿完整的年度：最近一個完整年度沒有就往前找兩年，不拿還沒過完的今年（不然色階會混到不完整的數字）
      if (s) for (const k of [N - 2, N - 3, N - 4]) if (s.p[k] != null) { value = s.p[k]; year = trend.years[k]; break; }
      return { county, town, value, year };
    });
    const sorted = info.map(t => t.value).filter(x => x != null).sort((x, y) => x - y);
    if (sorted.length < 20) throw new Error('few');
    const cuts = [.2, .4, .6, .8].map(q => sorted[Math.floor(sorted.length * q)]);
    info.forEach(t => { t.level = t.value == null ? -1 : cuts.filter(c => t.value > c).length; });
    // 顯示點：BLOCK×BLOCK 格併一點，取這一點裡最多格的那個鄉鎮
    const bw = Math.ceil(cols / BLOCK), bh = Math.ceil(rows / BLOCK), dotTown = new Int16Array(bw * bh).fill(-1);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const votes = {}; let land = 0, best = -1, bestN = 0;
      for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
        const x = bx * BLOCK + dx, y = by * BLOCK + dy; if (x >= cols || y >= rows) continue;
        const i = y * cols + x; if (!isLand(i)) continue;
        land++; const t = townOf(i); if (t < 0) continue;
        votes[t] = (votes[t] || 0) + 1; if (votes[t] > bestN) { bestN = votes[t]; best = t; }
      }
      if (land >= 2) dotTown[by * bw + bx] = best >= 0 ? best : -2; // -2＝有陸地但沒對到鄉鎮
    }

    const fig = document.createElement('figure'); fig.className = 'market-map';
    const cap = document.createElement('p'); cap.className = 'trend-cap'; cap.textContent = '全台單價地圖（顏色越深，單價越高）';
    const box = document.createElement('div'); box.className = 'pmap-box';
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0; canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', '全台單價地圖。滑鼠移到某一區會顯示那一區的單價；點一下，排行與走勢換成那個縣市。鍵盤用方向鍵移動、Enter 選取。');
    const read = document.createElement('p'); read.className = 'pmap-read'; read.setAttribute('aria-live', 'polite');
    const legend = document.createElement('p'); legend.className = 'pmap-legend';
    legend.append('低');
    LEVELS.forEach(a => { const i = document.createElement('i'); i.style.opacity = a; legend.append(i); });
    legend.append('高');
    box.append(canvas); fig.append(cap, box, read, legend);
    sum.before(fig);
    host.classList.add('has-pmap');

    const ctx = canvas.getContext('2d'), css = getComputedStyle(host);
    const v = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();
    const C = { ink: v('--navy', '#0e1b2e'), hot: v('--coral', '#ff5e5b'), line: v('--slate', '#3a4d63') };
    let W = 0, H = 0, S = 1, dpr = 1;
    const st = { county: '', hover: -1, key: [Math.round(cols * .82), Math.round(rows * .09)] };
    const countyName = () => { const o = select.options[select.selectedIndex]; return o ? o.textContent.trim() : ''; };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const r = S * BLOCK * .4;
      // 依「是不是選中的縣市」與單價級距分批畫，少換筆刷
      const batches = {};
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const t = dotTown[by * bw + bx]; if (t === -1) continue;
        const it = t >= 0 ? info[t] : null, on = it && it.county === st.county;
        const key = t === st.hover ? 'hot' : (on ? 'on' : 'off') + (it ? it.level : -1);
        (batches[key] || (batches[key] = [])).push((bx + .5) * BLOCK * S, (by + .5) * BLOCK * S);
      }
      Object.keys(batches).forEach(key => {
        const hot = key === 'hot', on = key.startsWith('on'), level = hot ? 4 : +key.slice(on ? 2 : 3);
        ctx.fillStyle = hot ? C.hot : C.ink;
        ctx.globalAlpha = hot ? 1 : level < 0 ? (on ? .16 : .09) : LEVELS[level] * (on ? 1 : .42);
        ctx.beginPath();
        const pts = batches[key], rad = hot ? r * 1.25 : r;
        for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + rad, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], rad, 0, 6.2832); }
        ctx.fill();
      });
      ctx.globalAlpha = .35; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.font = '500 10px ' + (css.fontFamily || 'sans-serif'); ctx.fillStyle = C.line; ctx.textBaseline = 'top';
      insets.forEach(s => { const x = Math.round((s.col - 2) * S) + .5, y = Math.round((s.row - 2) * S) + .5, w = Math.round((s.w + 4) * S), h = Math.round((s.h + 4) * S); ctx.strokeRect(x, y, w, h); ctx.globalAlpha = .8; ctx.fillText(s.label, x + 3, y + h + 3); ctx.globalAlpha = .35; });
      ctx.globalAlpha = 1;
      // 滑到的那一區外面圈一圈，小區也看得到
      if (batches.hot) { const pts = batches.hot; let sx = 0, sy = 0; for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; } const cx = sx / (pts.length / 2), cy = sy / (pts.length / 2); let far = 0; for (let i = 0; i < pts.length; i += 2) far = Math.max(far, Math.hypot(pts[i] - cx, pts[i + 1] - cy)); ctx.strokeStyle = C.hot; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, far + 7, 0, 6.2832); ctx.stroke(); }
      if (document.activeElement === canvas) { ctx.strokeStyle = C.hot; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(st.key[0] * S, st.key[1] * S, 7, 0, 6.2832); ctx.stroke(); }
    };
    const size = () => { const rect = box.getBoundingClientRect(); if (!rect.width) return; dpr = Math.min(2, window.devicePixelRatio || 1); W = rect.width; H = W * rows / cols; S = W / cols; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); draw(); };
    const say = t => {
      read.replaceChildren();
      if (t < 0) { read.textContent = '把滑鼠移到地圖上（手機用點的），看那一區的單價。'; return; }
      const it = info[t], name = document.createElement('span'); name.className = 'nb'; name.textContent = it.county + ' ' + it.town + '：';
      const val = document.createElement('span'); val.className = 'nb';
      if (it.value == null) val.textContent = '樣本不足，不列單價。';
      else { const b2 = document.createElement('b'); b2.textContent = it.value.toFixed(1); val.append(it.year + ' 年 ', b2, ' 萬／坪'); }
      read.append(name, val);
    };
    // 游標落在哪個顯示點就算那一點的鄉鎮（跟畫出來的點同一套判定），游標在點與點之間就取最近的那一點
    const townAt = (x, y) => { const bx = Math.floor(x / BLOCK), by = Math.floor(y / BLOCK); let best = -1, bd = 1e9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const px = bx + dx, py = by + dy; if (px < 0 || py < 0 || px >= bw || py >= bh) continue; const t = dotTown[py * bw + px]; if (t < 0) continue; const d = ((px + .5) * BLOCK - x) ** 2 + ((py + .5) * BLOCK - y) ** 2; if (d < bd) { bd = d; best = t; } } return best; };
    const setHover = t => { if (t === st.hover) return; st.hover = t; say(t); draw(); const it = t >= 0 ? info[t] : null; host.dispatchEvent(new CustomEvent('fx:town', { detail: { county: it ? it.county : st.county, town: it ? it.town : '' } })); };
    const choose = t => {
      if (t < 0) return;
      const it = info[t], idx = [...select.options].findIndex(o => o.textContent.trim() === it.county);
      if (idx >= 0 && it.county !== st.county) { select.selectedIndex = idx; select.dispatchEvent(new Event('change', { bubbles: true })); }
      st.hover = -1; setHover(t);
    };
    const cell = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cols, (e.clientY - r.top) / r.height * rows]; };
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHover(townAt(...cell(e))); }, { passive: true });
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') setHover(-1); }, { passive: true });
    canvas.addEventListener('click', e => choose(townAt(...cell(e))));
    canvas.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] }[e.key];
      if (d) { e.preventDefault(); st.key = [clamp(st.key[0] + d[0], 0, cols - 1), clamp(st.key[1] + d[1], 0, rows - 1)]; st.hover = -2; setHover(townAt(st.key[0], st.key[1])); draw(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(townAt(st.key[0], st.key[1])); }
    });
    canvas.addEventListener('focus', draw); canvas.addEventListener('blur', draw);
    select.addEventListener('change', () => { st.county = countyName(); st.hover = -1; say(-1); draw(); });
    st.county = countyName(); say(-1);
    new ResizeObserver(size).observe(box); size();
    if (!fine.matches) read.textContent = '點地圖上的任何一區，看那一區的單價，排行與走勢也會換成那個縣市。';
  };

  const start = () => Promise.all([loadGrid(), fetch(trendSrc).then(r => { if (!r.ok) throw new Error('trend'); return r.json(); })]).then(init).catch(() => {});
  if (select.options.length) start();
  else { const mo = new MutationObserver(() => { if (select.options.length) { mo.disconnect(); clearTimeout(giveUp); start(); } }); mo.observe(select, { childList: true }); const giveUp = setTimeout(() => mo.disconnect(), 8000); }
})();
