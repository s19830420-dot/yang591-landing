(() => {
  'use strict';
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('js');
  root.classList.toggle('motion', !motion.matches);
  const header = document.querySelector('.site-header');
  const menu = document.querySelector('#mobile-menu');
  const toggle = document.querySelector('.menu-toggle');
  const restoreMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
    toggle.focus({preventScroll: true});
  };
  const closeMenu = () => { if (menu.open) menu.close(); restoreMenu(); };
  toggle.addEventListener('click', () => {
    menu.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    menu.querySelector('.menu-close').focus();
  });
  menu.querySelector('.menu-close').addEventListener('click', closeMenu);
  menu.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  menu.addEventListener('close', restoreMenu);
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key !== 'Tab') return;
    const items = [...menu.querySelectorAll('a,button')];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  matchMedia('(min-width: 1024px)').addEventListener('change', e => { if (e.matches) closeMenu(); });

  const mobileCards = matchMedia('(max-width: 767px)');
  document.querySelectorAll('[data-mobile-carousel]').forEach(track => {
    const cards = [...track.children];
    const dots = document.createElement('div');
    dots.className = 'carousel-dots';
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', track.getAttribute('aria-label') + '頁次');
    const buttons = cards.map((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `前往第 ${index + 1} 張，共 ${cards.length} 張`);
      button.addEventListener('click', () => track.scrollTo({left: card.offsetLeft - cards[0].offsetLeft, behavior: motion.matches ? 'instant' : 'smooth'}));
      dots.append(button);
      return button;
    });
    track.after(dots);
    const updateDots = () => {
      let active = 0, distance = Infinity;
      cards.forEach((card, index) => {
        const delta = Math.abs(card.offsetLeft - cards[0].offsetLeft - track.scrollLeft);
        if (delta < distance) { active = index; distance = delta; }
      });
      buttons.forEach((button, index) => button.setAttribute('aria-current', String(index === active)));
    };
    const resizeCards = () => {
      dots.hidden = !mobileCards.matches;
      track.tabIndex = mobileCards.matches ? 0 : -1;
      updateDots();
    };
    track.addEventListener('scroll', updateDots, {passive: true});
    addEventListener('resize', resizeCards, {passive: true});
    resizeCards();
    const revealHash = () => {
      if (!mobileCards.matches || !location.hash) return;
      const card = cards.find(item => '#' + item.id === location.hash);
      if (card) track.scrollTo({left: card.offsetLeft - cards[0].offsetLeft, behavior:'instant'});
    };
    addEventListener('hashchange', revealHash);
    revealHash();
  });

  const observers = [];
  const counts = [...document.querySelectorAll('[data-count]')];
  if (!motion.matches && 'IntersectionObserver' in window) {
    const reveals = [...document.querySelectorAll('[data-reveal]')];
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      });
    }, {rootMargin: '0px 0px -15% 0px', threshold: 0});
    reveals.forEach(el => {
      // Large sections and sticky containers stay visible; their individual rows reveal.
      if (el.getBoundingClientRect().top < innerHeight * .85 || el.offsetHeight > innerHeight * 1.5 || el.hasAttribute('data-story')) return;
      el.classList.add('reveal-ready');
      const siblings = [...el.parentElement.children].filter(n => n.hasAttribute('data-reveal'));
      el.style.setProperty('--reveal-delay', `${Math.min(siblings.indexOf(el), 3) * 70}ms`);
      revealObserver.observe(el);
    });
    observers.push(revealObserver);
    const countObserver = new IntersectionObserver(entries => {
      entries.forEach(({target, isIntersecting}) => {
        if (!isIntersecting) return;
        countObserver.unobserve(target);
        const value = Number(target.dataset.count);
        const decimals = (target.dataset.count.split('.')[1] || '').length;
        const start = performance.now();
        const step = now => {
          if (motion.matches) { target.textContent = target.dataset.count; return; }
          const p = Math.min(1, (now - start) / 1200);
          target.textContent = (value * (1 - Math.pow(1 - p, 3))).toFixed(decimals);
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, {threshold: .15});
    counts.forEach(el => countObserver.observe(el));
    observers.push(countObserver);
  }

  const stories = [...document.querySelectorAll('[data-story]')];
  const photos = [...document.querySelectorAll('[data-parallax]')];
  const toc = [...document.querySelectorAll('.feature-index a')];
  const sections = toc.map(a => document.querySelector(a.hash));
  let previousY = scrollY, scheduled = false;
  const renderScroll = () => {
    scheduled = false;
    const y = scrollY;
    header.classList.toggle('scrolled', y > 24);
    if (!motion.matches) {
      if (Math.abs(y - previousY) > 6) {
        header.classList.toggle('is-hidden', y > previousY && y > 160 && !menu.open && !header.contains(document.activeElement));
        previousY = y;
      }
      photos.forEach(el => {
        const box = el.parentElement.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) return;
        const offset = (innerHeight / 2 - (box.top + box.height / 2)) * Number(el.dataset.parallax);
        el.style.transform = `translateY(${Math.max(-48, Math.min(48, offset))}px)`;
      });
      if (innerWidth >= 1024) stories.forEach(story => {
        const steps = [...story.querySelectorAll('[data-story-step]')];
        let active = 0;
        steps.forEach((step, i) => { if (step.getBoundingClientRect().top < innerHeight * .58) active = i; });
        story.querySelectorAll('[data-story-frame]').forEach((frame, i) => frame.classList.toggle('active', i === active));
      });
    }
    let activeSection = -1;
    sections.forEach((el, i) => { if (el && el.getBoundingClientRect().top < innerHeight * .4) activeSection = i; });
    toc.forEach((a, i) => { a.classList.toggle('active', i === activeSection); if (i === activeSection) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); });
  };
  const onScroll = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(renderScroll); } };
  addEventListener('scroll', onScroll, {passive: true});
  addEventListener('resize', onScroll, {passive: true});
  renderScroll();
  motion.addEventListener('change', () => {
    root.classList.toggle('motion', !motion.matches);
    if (motion.matches) {
      observers.forEach(observer => observer.disconnect());
      document.querySelectorAll('.reveal-ready').forEach(el => el.classList.add('in'));
      counts.forEach(el => { el.textContent = el.dataset.count; });
      photos.forEach(el => { el.style.transform = ''; });
      header.classList.remove('is-hidden');
    }
    onScroll();
  });

  const form = document.querySelector('#trial-form');
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('form-submit');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '送出中…';
    try {
      const r = await fetch(form.action, {method:'POST', body:new FormData(form), headers:{Accept:'application/json'}});
      if (r.ok) {
        form.style.display = 'none';
        document.getElementById('form-note').style.display = 'none';
        const success = document.getElementById('form-success');
        success.style.display = 'block';
        success.focus({preventScroll:true});
      } else {
        btn.disabled = false;
        btn.textContent = '送出申請，開始試用';
        alert('送出失敗，請直接用 LINE 聯絡 HouseYang');
      }
    } catch {
      btn.disabled = false;
      btn.textContent = '送出申請，開始試用';
      alert('網路問題，請稍後再試');
    }
  });
})();
