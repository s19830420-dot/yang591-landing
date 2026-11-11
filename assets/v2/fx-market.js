/* 首頁各區成交排行：只讀既有統計，不重算中位數。 */
(() => {
  'use strict';

  const host = document.querySelector('[data-fx-market]');
  if (!host || !window.FX || !window.fetch || !window.CSS ||
      !CSS.supports('scale', '1 1') || !window.requestAnimationFrame) return;

  const { reduce, fine } = window.FX;
  const countySelect = host.querySelector('[data-market="county"]');
  const metricGroup = host.querySelector('[data-market="metric"]');
  const summary = host.querySelector('[data-market="sum"]');
  const list = host.querySelector('[data-market="bars"]');
  const season = host.querySelector('[data-market="season"]');
  if (!reduce || !fine || !countySelect || !metricGroup || !summary || !list || !season) return;

  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const integer = value => value.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  const decimal = value => value.toFixed(1);
  const metrics = [
    { label: '買賣件數', column: 1, unit: '件', format: integer },
    { label: '買賣單價', column: 2, unit: '萬／坪', format: decimal },
    { label: '租賃件數', column: 3, unit: '件', format: integer },
    { label: '租金', column: 4, unit: '元／坪', format: integer }
  ];
  let counties = [], county, metric = 0, rows = [], selected = null;
  let revision = 0, touchPress = false;

  const showSummary = row => {
    selected = row;
    rows.forEach(item => item.button.setAttribute('aria-pressed', String(item === row)));
    const values = row ? row.values : [county.n, county.sn, county.sp, county.rn, county.rp];
    const fragment = document.createDocumentFragment();
    const clause = (...parts) => {
      const span = make('span', 'nb');
      span.append(...parts);
      fragment.append(span);
    };
    const number = value => make('b', '', value);
    clause(values[0] + (row ? '：住宅買賣 ' : '這一季住宅買賣 '), number(integer(values[1])), ' 件，');
    if (values[2] === null) clause('樣本不足，不列單價；');
    else clause('單價中位數 ', number(decimal(values[2])), ' 萬／坪；');
    clause('租賃 ', number(integer(values[3])), ' 件，');
    if (values[4] === null) clause('樣本不足，不列租金。');
    else clause('租金中位數 ', number(integer(values[4])), ' 元／坪。');
    // 相同狀態不重複報讀；長條動畫不更新 live region。
    if (summary.textContent !== fragment.textContent) summary.replaceChildren(fragment);
  };

  const render = () => {
    const current = ++revision;
    const spec = metrics[metric];
    const ranked = county.t.filter(values => values[spec.column] !== null)
      .slice().sort((a, b) => b[spec.column] - a[spec.column]).slice(0, 10);
    const maximum = ranked.length ? ranked[0][spec.column] : 0;
    const fragment = document.createDocumentFragment();
    touchPress = false;
    rows = ranked.map((values, index) => {
      const li = make('li');
      const button = make('button', 'mb-row');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      const rank = make('span', 'mb-rank', String(index + 1).padStart(2, '0'));
      const name = make('span', 'mb-name', values[0]);
      const track = make('span', 'mb-track');
      track.setAttribute('aria-hidden', 'true');
      const bar = make('i', 'mb-bar');
      const target = (maximum > 0 ? values[spec.column] / maximum : 0) + ' 1';
      bar.style.scale = reduce.matches ? target : '0 1';
      bar.style.transitionDelay = reduce.matches ? '0ms' : index * 30 + 'ms';
      track.append(bar);
      button.append(rank, name, track, make('span', 'mb-value', spec.format(values[spec.column]) + ' ' + spec.unit));
      li.append(button);
      fragment.append(li);
      const row = { values, button, bar, target };
      button.addEventListener('pointerdown', event => {
        touchPress = event.pointerType !== 'mouse';
      });
      button.addEventListener('pointercancel', () => { touchPress = false; });
      button.addEventListener('pointerenter', event => {
        if (fine.matches && event.pointerType === 'mouse') showSummary(row);
      });
      button.addEventListener('focus', () => {
        if (!touchPress) showSummary(row);
      });
      button.addEventListener('keydown', () => { touchPress = false; });
      button.addEventListener('click', event => {
        const isTouch = event.detail !== 0 && (touchPress || !fine.matches);
        showSummary(isTouch && selected === row ? null : row);
        touchPress = false;
      });
      return row;
    });
    // 整個縣市都樣本不足（例如金門的租金）：說清楚，不要留一片空白
    if (!ranked.length) fragment.append(make('li', 'mb-empty', '這個縣市樣本不到 20 筆，這個指標不列排行。'));
    list.replaceChildren(fragment);
    showSummary(null);
    if (!reduce.matches) {
      // 先繪出零長度，再讓 CSS transition 長到目標；快速切換時舊排程作廢。
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (current !== revision || host.hidden) return;
        rows.forEach(row => { row.bar.style.scale = row.target; });
      }));
    }
  };

  const validCount = value => Number.isInteger(value) && value >= 0;
  const validMedian = value => value === null || (Number.isFinite(value) && value >= 0);
  const validValues = values => Array.isArray(values) && values.length === 5 &&
    typeof values[0] === 'string' && values[0].trim() && validCount(values[1]) &&
    validMedian(values[2]) && validCount(values[3]) && validMedian(values[4]);
  const validData = data => data && typeof data.season === 'string' && data.season.trim() &&
    data.minN === 20 && Array.isArray(data.counties) && data.counties.length &&
    data.counties.every(item => item && validValues([item.n, item.sn, item.sp, item.rn, item.rp]) &&
      Array.isArray(item.t) && item.t.every(validValues));

  const init = async () => {
    host.hidden = false;
    host.setAttribute('aria-busy', 'true');
    countySelect.disabled = true;
    summary.setAttribute('aria-atomic', 'true');
    const buttons = metrics.map((spec, index) => {
      const button = make('button', '', spec.label);
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-pressed', String(index === metric));
      button.addEventListener('click', () => {
        if (metric === index) return;
        metric = index;
        buttons.forEach((item, i) => item.setAttribute('aria-pressed', String(i === metric)));
        render();
      });
      metricGroup.append(button);
      return button;
    });
    const response = await fetch(host.dataset.fxMarket);
    if (!response.ok) throw new Error('market');
    const data = await response.json();
    if (!validData(data)) throw new Error('market');
    counties = data.counties;
    counties.forEach((item, index) => {
      const option = make('option', '', item.n);
      option.value = String(index);
      countySelect.append(option);
    });
    const defaultIndex = Math.max(0, counties.findIndex(item => item.n === '新北市'));
    countySelect.value = String(defaultIndex);
    county = counties[defaultIndex];
    season.textContent = data.season;
    countySelect.addEventListener('change', () => {
      county = counties[Number(countySelect.value)] || counties[0];
      render();
    });
    list.addEventListener('pointerleave', event => {
      if (fine.matches && event.pointerType === 'mouse') showSummary(null);
    });
    list.addEventListener('focusout', event => {
      if (!list.contains(event.relatedTarget)) {
        touchPress = false;
        showSummary(null);
      }
    });
    render();
    countySelect.disabled = false;
    buttons.forEach(button => { button.disabled = false; });
    host.removeAttribute('aria-busy');
  };

  init().catch(() => {
    ++revision;
    host.hidden = true;
    host.removeAttribute('aria-busy');
  });
})();
