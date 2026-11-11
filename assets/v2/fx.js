/* fx.js：體感層 v1（六站共用同一支。來源 D:/HouseYang/sites-v2/fx/src，改來源再同步到各站，不要各站各改）
   內容：里程表數字、首屏照片滑鼠景深、手機框立體轉、主按鈕磁吸、入口列受光、捲動進度線、換頁預抓。
   全部是加分項：任何一段失敗都不影響頁面原本的內容與 site.js。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const safe = fn => { try { fn(); } catch (e) { /* 加分項失敗就算了 */ } };
  root.classList.add('fx');

  // 共用：一個 rAF 迴圈帶所有「追著目標值跑」的東西，全部到位就自己停
  const chasers = new Set();
  let ticking = false;
  const tick = () => {
    let alive = false;
    chasers.forEach(c => { if (c.step()) alive = true; else chasers.delete(c); });
    if (alive) requestAnimationFrame(tick); else ticking = false;
  };
  const chase = c => { chasers.add(c); if (!ticking) { ticking = true; requestAnimationFrame(tick); } };
  // 追值器：cur 以每格 k 的比例靠近 to，差距小於 eps 視為到位
  const chaser = (n, k, eps, apply) => {
    const c = {
      cur: new Array(n).fill(0), to: new Array(n).fill(0),
      step() {
        let moving = false;
        for (let i = 0; i < n; i++) {
          const d = c.to[i] - c.cur[i];
          if (Math.abs(d) > eps) { c.cur[i] += d * k; moving = true; } else c.cur[i] = c.to[i];
        }
        apply(c.cur);
        return moving;
      },
      set(...v) { v.forEach((x, i) => { c.to[i] = x; }); chase(c); }
    };
    return c;
  };

  // 一、里程表數字：把 [data-count] 換成逐位翻動（原本的從 0 跑到目標值由這裡接手）
  safe(() => {
    // fx.css 沒載到（404、被擋）就不換：沒有樣式的話原數字和整串翻動數字會一起露出來
    if (reduce.matches || !('IntersectionObserver' in window) || !CSS.supports('height', '1lh') || !getComputedStyle(root).getPropertyValue('--fx-out').trim()) return;
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      e.target.classList.add('in');
    }), { threshold: .4 });
    $$('[data-count]').forEach(src => {
      const text = src.dataset.count;
      if (!/^[\d.,]+$/.test(text)) return;
      const el = document.createElement('span');
      el.className = (src.className ? src.className + ' ' : '') + 'fx-odo';
      const ghost = document.createElement('span');
      ghost.className = 'fx-odo-ghost'; ghost.textContent = text;
      const row = document.createElement('span');
      row.className = 'fx-odo-row'; row.setAttribute('aria-hidden', 'true');
      const digits = text.replace(/\D/g, '').length;
      let seen = 0;
      [...text].forEach(ch => {
        const col = document.createElement('span');
        col.className = 'fx-odo-col';
        if (/\d/.test(ch)) {
          // 越右邊的位數多轉幾圈，像里程表
          const loops = Math.min(2, digits - 1 - seen);
          const strip = document.createElement('span');
          strip.className = 'fx-odo-strip';
          const seq = [];
          for (let l = 0; l < loops; l++) for (let d = 0; d < 10; d++) seq.push(d);
          for (let d = 0; d <= +ch; d++) seq.push(d);
          if (seq.length === 1) seq.unshift(0); // 目標是 0 也至少翻一格
          seq.forEach(d => { const s = document.createElement('span'); s.textContent = d; strip.append(s); });
          strip.style.setProperty('--fx-end', seq.length - 1);
          strip.style.setProperty('--fx-odo-time', 1000 + seen * 140 + 'ms');
          col.append(strip); seen++;
        } else col.textContent = ch;
        row.append(col);
      });
      el.append(ghost, row);
      src.replaceWith(el);
      io.observe(el);
    });
  });

  // 二、捲動進度細線
  safe(() => {
    if (!CSS.supports('animation-timeline', 'scroll()')) return;
    const bar = document.createElement('div');
    bar.className = 'fx-progress'; bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);
  });

  // 三、換頁預抓：滑鼠停在站內連結上就先抓那一頁，點下去幾乎秒開
  safe(() => {
    if (navigator.connection && navigator.connection.saveData) return;
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ where: { and: [{ href_matches: '/*' }, { not: { selector_matches: '[target=_blank],[download],[href*="#"]' } }] }, eagerness: 'moderate' }] });
      document.head.append(s);
      return;
    }
    const done = new Set();
    const warm = e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.origin !== location.origin || a.pathname === location.pathname || done.has(a.pathname)) return;
      done.add(a.pathname);
      const l = document.createElement('link');
      l.rel = 'prefetch'; l.href = a.pathname; document.head.append(l);
    };
    addEventListener('pointerover', warm, { passive: true });
    addEventListener('touchstart', warm, { passive: true });
  });

  // 三之二、產品入口列：整張照片都可以點（等於點那一列的第一個連結），入口更好按
  safe(() => {
    $$('.product-row').forEach(row => {
      const link = row.querySelector('a[href]'), fig = row.querySelector('figure');
      if (!link || !fig) return;
      fig.style.cursor = 'pointer';
      fig.addEventListener('click', () => link.click());
    });
  });

  // 以下都是滑鼠效果：觸控裝置、減少動態時不作用。
  // 事件一律先掛好，每次觸發時才看當下的狀態；開頁後才切「減少動態」或換成觸控，馬上停手並把元素放回原位。
  const active = () => fine.matches && !reduce.matches;
  const resets = [];
  const pointerFx = () => {
    // 四、首屏照片景深：照片往滑鼠反方向慢慢移，像鏡頭有重量
    $$('.hero-photo img, .hero-picture img').forEach(img => {
      const hero = img.closest('section, header, .hero') || img.parentElement;
      const c = chaser(2, .07, .05, ([x, y]) => { img.style.translate = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px'; });
      resets.push(() => { c.cur.fill(0); c.to.fill(0); img.style.translate = ''; });
      hero.addEventListener('pointermove', e => {
        if (!active()) return;
        const r = hero.getBoundingClientRect();
        c.set(-((e.clientX - r.left) / r.width - .5) * 22, -((e.clientY - r.top) / r.height - .5) * 12);
      }, { passive: true });
      hero.addEventListener('pointerleave', () => c.set(0, 0), { passive: true });
    });

    // 五、手機框、截圖框：跟著滑鼠立體轉（最多 5 度）
    $$('.phone, .device, .tablet, .screenshot, .menu-phone, [data-fx-tilt]').forEach(el => {
      if (el.closest('[data-fx-tilt="off"]')) return;
      let armed = false;
      const c = chaser(3, .12, .01, ([rx, ry, lift]) => {
        const deg = Math.hypot(rx, ry);
        el.style.rotate = deg < .01 ? '' : (-ry / deg).toFixed(3) + ' ' + (rx / deg).toFixed(3) + ' 0 ' + deg.toFixed(2) + 'deg';
        el.style.translate = lift < .01 ? '' : '0 ' + (-lift).toFixed(2) + 'px';
      });
      resets.push(() => { c.cur.fill(0); c.to.fill(0); el.style.rotate = ''; el.style.translate = ''; });
      el.addEventListener('pointermove', e => {
        if (!active()) return;
        if (!armed) { armed = true; el.classList.add('fx-tilt'); if (el.parentElement) el.parentElement.style.perspective = '1400px'; }
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        c.set(px * 10, py * 10, 6);
      }, { passive: true });
      el.addEventListener('pointerleave', () => c.set(0, 0, 0), { passive: true });
    });

    // 六、主按鈕磁吸：滑鼠在按鈕上時，按鈕往滑鼠靠一點
    $$('.hero .button, .hero .button-primary, .photo-band .button, .cta-content .button, .header-inner > .button, .nav-cta').forEach(el => {
      const c = chaser(2, .2, .05, ([x, y]) => { el.style.translate = (x || y) ? x.toFixed(2) + 'px ' + y.toFixed(2) + 'px' : ''; });
      resets.push(() => { c.cur.fill(0); c.to.fill(0); el.style.translate = ''; });
      el.addEventListener('pointermove', e => {
        if (!active()) return;
        const r = el.getBoundingClientRect();
        c.set(clamp((e.clientX - r.left - r.width / 2) * .22, -7, 7), clamp((e.clientY - r.top - r.height / 2) * .3, -5, 5));
      }, { passive: true });
      el.addEventListener('pointerleave', () => c.set(0, 0), { passive: true });
    });

    // 七、入口列、方案卡：滑鼠所在位置受光
    $$('.product-row, .plan-card, .earn-card, [data-fx-glint]').forEach(el => {
      el.classList.add('fx-glint');
      const c = chaser(1, .18, .01, ([a]) => { el.style.setProperty('--fx-a', a.toFixed(3)); });
      resets.push(() => { c.cur.fill(0); c.to.fill(0); el.style.setProperty('--fx-a', '0'); });
      el.addEventListener('pointermove', e => {
        if (!active()) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--fx-x', (e.clientX - r.left).toFixed(0) + 'px');
        el.style.setProperty('--fx-y', (e.clientY - r.top).toFixed(0) + 'px');
        c.set(1);
      }, { passive: true });
      el.addEventListener('pointerleave', () => c.set(0), { passive: true });
    });
  };
  safe(() => {
    pointerFx();
    const onMode = () => { if (!active()) resets.forEach(fn => fn()); };
    reduce.addEventListener('change', onMode);
    fine.addEventListener('change', onMode);
  });

  // 給各站招牌互動共用的小工具
  window.FX = { reduce, fine, chaser, clamp, $$ };
})();
