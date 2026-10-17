// Flowt landing. External file because the site's CSP blocks inline scripts.
(function () {
  'use strict';

  document.documentElement.classList.add('js');
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = motionQuery.matches;

  // es-ES leaves four-digit numbers ungrouped ("1850"); the app and the bank emails write "1.850".
  function group(intPart) { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function money(n) {
    var parts = Math.abs(n).toFixed(2).split('.');
    return group(parts[0]) + ',' + parts[1];
  }

  // ---------- sticky nav ----------
  var nav = document.getElementById('nav');
  function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- the hero machine: email in, tidy movement out ----------
  var examples = [
    { bank: 'Revolut', time: 'ahora', subject: 'Has pagado 3,40 € en CAFETERIA LA PEPA SL', emoji: '☕', name: 'Cafetería La Pepa', cat: 'Restaurantes', dot: '#ff9f0a', wallet: 'Día a día', amount: -3.4 },
    { bank: 'BBVA', time: 'ahora', subject: 'Compra con tarjeta: MERCADONA 47,85 EUR', emoji: '🛒', name: 'Mercadona', cat: 'Alimentación', dot: '#0ea5e9', wallet: 'Día a día', amount: -47.85 },
    { bank: 'Unicaja', time: 'ahora', subject: 'Abono de nómina: 1.850,00 EUR', emoji: '💸', name: 'Nómina', cat: 'Ingresos', dot: '#10b981', wallet: 'Repartida en 5 carteras', amount: 1850 },
    { bank: 'ING', time: 'ahora', subject: 'Cargo recibo SPOTIFY P1A2B3 7,50 EUR', emoji: '🎧', name: 'Spotify Duo', cat: 'Suscripciones', dot: '#a855f7', wallet: 'Suscripciones', amount: -7.5 },
    { bank: 'Santander', time: 'ahora', subject: 'Pago Bizum enviado 12,00 EUR · Cena viernes', emoji: '🍕', name: 'Cena del viernes', cat: 'Ocio', dot: '#ef4466', wallet: 'Ocio', amount: -12 }
  ];
  var mail = document.getElementById('mail');
  var tx = document.getElementById('tx');
  var bar = document.getElementById('wallet-bar');
  var machine = document.querySelector('.machine');
  var left = 412.6;
  var i = 0;

  function set(key, value) {
    var el = machine.querySelector('[data-k="' + key + '"]');
    if (el) el.textContent = value;
  }

  function fill(ex) {
    set('bank', ex.bank); set('time', ex.time); set('subject', ex.subject);
    set('emoji', ex.emoji); set('name', ex.name); set('cat', ex.cat); set('wallet', ex.wallet);
    machine.querySelector('[data-k="catdot"]').style.background = ex.dot;
    var amount = machine.querySelector('[data-k="amount"]');
    amount.textContent = (ex.amount > 0 ? '+' : '−') + money(ex.amount) + ' €';
    amount.classList.toggle('is-in', ex.amount > 0);
  }

  function updateWallet(ex) {
    // A paycheck refills what is free until the next one; spending eats into it.
    left = ex.amount > 0 ? 640 : Math.max(0, left + ex.amount);
    set('left', money(left) + ' €');
    bar.style.width = Math.min(100, (left / 660) * 100).toFixed(1) + '%';
  }

  function swap(el, cls) {
    el.classList.remove('is-leaving', 'is-arriving');
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  var paused = false;
  function step() {
    if (paused) return;
    i = (i + 1) % examples.length;
    var ex = examples[i];
    swap(mail, 'is-leaving');
    swap(tx, 'is-leaving');
    setTimeout(function () {
      fill(ex);
      swap(mail, 'is-arriving');
      setTimeout(function () { swap(tx, 'is-arriving'); updateWallet(ex); }, 380);
    }, 450);
  }

  // Runs only while the tab is visible and motion is welcome; hovering the example holds it still to read.
  var timer = null;
  function schedule() {
    clearInterval(timer);
    timer = !reduced && !document.hidden ? setInterval(step, 3600) : null;
  }
  document.addEventListener('visibilitychange', schedule);
  var onMotionChange = function (e) { reduced = e.matches; schedule(); };
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
  else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  machine.addEventListener('mouseenter', function () { paused = true; });
  machine.addEventListener('mouseleave', function () { paused = false; });
  schedule();

  // ---------- reveal and strike-through on scroll ----------
  var revealables = document.querySelectorAll('.never__list li, .step, .h2, .calc, .vault, .checks li, .shot, .lede.center');
  var strikes = document.querySelectorAll('.never__list li');
  if ('IntersectionObserver' in window && !reduced) {
    revealables.forEach(function (el) { el.classList.add('reveal'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealables.forEach(function (el) { io.observe(el); });

    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var idx = Array.prototype.indexOf.call(strikes, e.target);
        setTimeout(function () { e.target.classList.add('is-struck'); }, 500 + idx * 140);
        so.unobserve(e.target);
      });
    }, { threshold: 1, rootMargin: '0px 0px -20% 0px' });
    strikes.forEach(function (el) { so.observe(el); });
  } else {
    strikes.forEach(function (el) { el.classList.add('is-struck'); });
  }

  // ---------- showcase tabs ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      var id = t.getAttribute('aria-controls');
      document.getElementById(id).hidden = !on;
      document.querySelector('.panel-text[data-for="' + id + '"]').hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, n) {
    tab.addEventListener('click', function () { select(tab); });
    tab.addEventListener('keydown', function (e) {
      var target =
        e.key === 'ArrowRight' ? tabs[(n + 1) % tabs.length] :
        e.key === 'ArrowLeft' ? tabs[(n - 1 + tabs.length) % tabs.length] :
        e.key === 'Home' ? tabs[0] :
        e.key === 'End' ? tabs[tabs.length - 1] : null;
      if (!target) return;
      e.preventDefault();
      select(target, true);
    });
  });

  // ---------- price in hours of work ----------
  var price = document.getElementById('price');
  var salary = document.getElementById('salary');
  var result = document.getElementById('result');
  var big = document.getElementById('result-big');
  var small = document.getElementById('result-small');

  var HOURS_PER_MONTH = 160;

  function parse(v) {
    // Spanish input: "1.229,50", "1229,5", "1.850" or "1229.5". Anything else is not a number.
    v = String(v).trim().replace(/\s|€/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
    else if (/^\d+([.,]\d+)?$/.test(v)) v = v.replace(',', '.');
    else return 0;
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function oneDecimal(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }
  function unit(n, one, many) { var t = oneDecimal(n); return t + ' ' + (t === '1' ? one : many); }

  function describe(minutes) {
    var total = Math.round(minutes);
    var hours = minutes / 60;
    if (total < 1) return ['menos de 1 min', 'ni lo notas'];
    if (total < 60) return [total + ' min', 'de tu vida trabajando'];
    if (hours < 8) {
      var h = Math.floor(total / 60), m = total % 60;
      return [h + ' h' + (m ? ' ' + m + ' min' : ''), 'de tu vida trabajando'];
    }
    var days = hours / 8;
    if (days < 5) return [unit(days, 'día', 'días'), 'de jornada completa. Piénsalo un poco.'];
    if (hours < HOURS_PER_MONTH) return [unit(days / 5, 'semana', 'semanas'), 'trabajando solo para esto. Uf.'];
    var months = hours / HOURS_PER_MONTH;
    if (months >= 1200) return ['más de 100 años', 'ni en toda tu vida laboral'];
    return [unit(months, 'mes', 'meses'), 'de nómina entera. ¿Seguro?'];
  }

  function calc() {
    var p = parse(price.value), s = parse(salary.value);
    var out = !s ? ['—', 'dime cuánto cobras'] :
      !p ? ['—', 'dime cuánto cuesta'] :
      describe(p / (s / HOURS_PER_MONTH) * 60);
    if (big.textContent !== out[0]) {
      result.classList.remove('is-bump'); void result.offsetWidth; result.classList.add('is-bump');
    }
    big.textContent = out[0];
    small.textContent = out[1];
  }

  price.addEventListener('input', calc);
  salary.addEventListener('input', calc);
  document.getElementById('calc').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () {
      price.value = money(parseFloat(b.dataset.price)).replace(/,00$/, '');
      calc();
    });
  });
  calc();

  // ---------- vault: press and hold to peek on touch; Enter or Space toggles it ----------
  var vault = document.getElementById('vault');
  var secret = document.getElementById('vault-secret');
  function setOpen(on) {
    vault.classList.toggle('is-open', on);
    vault.setAttribute('aria-pressed', String(on));
    secret.setAttribute('aria-hidden', String(!on));
  }
  vault.addEventListener('touchstart', function () { setOpen(true); }, { passive: true });
  vault.addEventListener('touchend', function () { setOpen(false); });
  vault.addEventListener('touchcancel', function () { setOpen(false); });
  vault.addEventListener('blur', function () { setOpen(false); });
  vault.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) setOpen(!vault.classList.contains('is-open'));
  });
})();
