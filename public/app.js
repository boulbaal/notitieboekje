/* Notitieboekje: een klein geel notitieboekje.
 * Alles blijft op het toestel (localStorage, sleutels met "notitieboekje.").
 * Geen server, geen account, geen synchronisatie.
 * Tekst van de gebruiker wordt nooit als HTML behandeld: altijd textContent of value.
 */
'use strict';

(function () {
  const { TALEN, TEKSTEN } = self.NB_I18N;

  // Wordt bij het deployen vervangen door het korte git-commitnummer.
  const VERSION = '__VERSION__';
  const VERSIE = VERSION.startsWith('__') ? 'dev' : VERSION;
  // PayPal.me-naam voor de donatieknop.
  const PAYPAL = 'ABoulbahaiem';

  const PREFIX = 'notitieboekje.';
  const NOTE = PREFIX + 'n.';
  const K_LANG = PREFIX + 'lang';
  const K_HINT = PREFIX + 'hint';
  const K_PERSIST = PREFIX + 'persist';
  const BEWAAR_NA = 300;       // ms na de laatste toetsaanslag
  const ONGEDAAN_MS = 5000;    // zo lang blijft "ongedaan maken" staan
  const MAX_VOORBEELD = 200;   // tekens in de lijst (de rest valt toch weg met ...)

  const $ = (id) => document.getElementById(id);
  const beweging = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= opslag ================= */
  // localStorage met een vangnet: lukt het niet (privévenster, uitgeschakeld),
  // dan werkt alles in het geheugen en tonen we een klein bericht.
  const opslag = (() => {
    let ls = null;
    try {
      const k = PREFIX + '__test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      ls = window.localStorage;
    } catch { ls = null; }
    const geheugen = new Map();
    const isVol = (e) => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    return {
      werkt: !!ls,
      sleutels() {
        if (!ls) return Array.from(geheugen.keys());
        const uit = [];
        try { for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k) uit.push(k); } } catch {}
        for (const k of geheugen.keys()) if (!uit.includes(k)) uit.push(k);
        return uit;
      },
      lees(k) {
        if (ls) { try { const v = ls.getItem(k); if (v !== null) return v; } catch {} }
        return geheugen.has(k) ? geheugen.get(k) : null;
      },
      // geeft 'ok', 'vol' of 'geheugen'
      schrijf(k, v) {
        if (!ls) { geheugen.set(k, v); return 'geheugen'; }
        try { ls.setItem(k, v); geheugen.delete(k); return 'ok'; }
        catch (e) { return isVol(e) ? 'vol' : (geheugen.set(k, v), 'geheugen'); }
      },
      wis(k) {
        geheugen.delete(k);
        if (ls) { try { ls.removeItem(k); } catch {} }
      },
    };
  })();

  function leesNotitie(id) {
    const ruw = opslag.lees(NOTE + id);
    if (ruw === null) return null;
    try {
      const n = JSON.parse(ruw);
      if (n && typeof n.t === 'string') return { id, t: n.t, u: Number(n.u) || 0, c: Number(n.c) || 0 };
    } catch {}
    return null;
  }
  function alleNotities() {
    const uit = [];
    for (const k of opslag.sleutels()) {
      if (!k.startsWith(NOTE)) continue;
      const n = leesNotitie(k.slice(NOTE.length));
      if (n && n.t.trim() !== '') uit.push(n);
    }
    uit.sort((a, b) => (b.u - a.u) || (b.c - a.c) || (a.id < b.id ? 1 : -1));
    return uit;
  }
  function schrijfNotitie(n) {
    return opslag.schrijf(NOTE + n.id, JSON.stringify({ t: n.t, u: n.u, c: n.c }));
  }
  function nieuwId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  // eerste niet-lege regel, ingekort
  function eersteRegel(tekst) {
    const regels = tekst.split(/\r\n|\r|\n/);
    for (const r of regels) {
      const s = r.trim();
      if (s) return s.length > MAX_VOORBEELD ? s.slice(0, MAX_VOORBEELD) + '…' : s;
    }
    return '';
  }

  let persistGevraagd = false;
  function vraagBlijvendeOpslag() {
    if (persistGevraagd) return;
    persistGevraagd = true;
    if (opslag.lees(K_PERSIST)) return;
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
        opslag.schrijf(K_PERSIST, '1');
      }
    } catch {}
  }

  /* ================= talen ================= */
  function browserTalen() {
    const l = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    return Array.from(l, String);
  }
  function bepaalTaal() {
    const bewaard = opslag.lees(K_LANG);
    if (bewaard && TALEN[bewaard]) return bewaard;
    for (const tag of browserTalen()) {
      const b = tag.toLowerCase().split('-')[0];
      if (TALEN[b]) return b;
      if (b === 'tzm' || b === 'ber' || b === 'kab' || b === 'shi' || b === 'rif') return 'zgh';
      if (b === 'kmr') return 'ku';
    }
    return 'en';
  }
  let taal = bepaalTaal();
  function t(sleutel, vars) {
    let s = (TEKSTEN[taal] && TEKSTEN[taal][sleutel]) || TEKSTEN.en[sleutel] || sleutel;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  /* ================= elementen ================= */
  const bladen = $('bladen');
  const begin = $('begin');
  const blad = $('blad');
  const lijstvak = $('lijstvak');
  const lijst = $('lijst');
  const leeg = $('leeg');
  const hint = $('hint');
  const tekst = $('tekst');
  const plus = $('plus');
  const terug = $('terug');
  const taalKeuze = $('taal');
  const versieEl = $('versie');
  const ververs = $('ververs');
  const doneerKnop = $('doneerKnop');
  const doneerPaneel = $('doneerPaneel');
  const strookje = $('strookje');
  const strookjeTekst = $('strookjeTekst');
  const ongedaanKnop = $('ongedaan');
  const melding = $('melding');

  /* ================= lijnen precies onder de basislijn ================= */
  // We meten waar de basislijn van het lettertype in een regel valt en zetten de lijn
  // daar 1 px onder. Zo staat de tekst op de lijn, op elk toestel en bij elke zoom.
  function meetLijn() {
    const proef = document.createElement('div');
    proef.setAttribute('aria-hidden', 'true');
    proef.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;padding:0;margin:0;';
    proef.className = 'tekst';
    const woord = document.createElement('span');
    woord.textContent = 'Hxg';
    const basis = document.createElement('span');
    basis.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
    proef.append(woord, basis);
    document.body.appendChild(proef);
    const lh = parseFloat(getComputedStyle(proef).lineHeight);
    const basislijn = basis.getBoundingClientRect().top - proef.getBoundingClientRect().top;
    proef.remove();
    if (lh > 0 && basislijn > 0 && basislijn < lh) {
      const ry = Math.min(lh - 1, Math.round(basislijn + 1.5));
      document.documentElement.style.setProperty('--ry', ry + 'px');
    }
  }

  /* ================= toetsenbord op de telefoon: hoogte volgen ================= */
  function volgHoogte() {
    const vv = window.visualViewport;
    if (!vv) return;
    const zet = () => document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    vv.addEventListener('resize', zet);
    zet();
  }

  /* ================= meldingen ================= */
  let meldingTimer = null;
  function toonMelding(sleutel, blijvend) {
    melding.textContent = t(sleutel);
    melding.dataset.sleutel = sleutel;
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(verbergMelding, blijvend ? 12000 : 7000);
  }
  function verbergMelding() {
    clearTimeout(meldingTimer);
    melding.textContent = '';
    delete melding.dataset.sleutel;
  }
  melding.addEventListener('click', verbergMelding);

  /* ================= de lijst ================= */
  let gewapend = null;   // rij met zichtbaar uitscheur-knopje (na lang drukken)

  function toonLijst(focusId) {
    const notities = alleNotities();
    lijst.textContent = '';
    for (const n of notities) lijst.appendChild(maakRij(n));
    leeg.hidden = notities.length > 0;
    toonHint(notities.length);
    if (focusId) {
      const r = lijst.querySelector('li[data-id="' + CSS.escape(focusId) + '"] .rij');
      if (r) {
        r.focus({ preventScroll: true });
        const li = r.parentElement;
        if (li.offsetTop < lijstvak.scrollTop || li.offsetTop + li.offsetHeight > lijstvak.scrollTop + lijstvak.clientHeight) {
          lijstvak.scrollTop = Math.max(0, li.offsetTop - lijstvak.clientHeight / 3);
        }
      }
    }
  }

  let hintGeteld = false;
  function toonHint(aantal) {
    const n = parseInt(opslag.lees(K_HINT) || '0', 10) || 0;
    if (aantal > 0 && n < 4) {
      if (!hintGeteld) { hintGeteld = true; opslag.schrijf(K_HINT, String(n + 1)); }
      hint.textContent = t('hint');
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }
  function hintKlaar() {
    opslag.schrijf(K_HINT, '99');
    hint.hidden = true;
  }

  function maakRij(n) {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    const rij = document.createElement('button');
    rij.type = 'button';
    rij.className = 'rij';
    const span = document.createElement('span');
    span.dir = 'auto';
    span.textContent = eersteRegel(n.t);
    rij.appendChild(span);
    const scheur = document.createElement('button');
    scheur.type = 'button';
    scheur.className = 'scheur';
    scheur.textContent = t('tear');
    scheur.setAttribute('aria-label', t('tear') + ': ' + eersteRegel(n.t).slice(0, 60));
    li.append(rij, scheur);

    rij.addEventListener('click', (e) => {
      // de klik die de browser meteen na een veeg of lang drukken stuurt, telt niet
      if (performance.now() < (li._slikTot || 0)) { e.preventDefault(); return; }
      if (gewapend) { ontwapen(); return; }
      openBlad(n.id);
    });
    rij.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        scheurUit(n.id, li, 0);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ander = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
        if (ander) { e.preventDefault(); ander.querySelector('.rij').focus(); }
      }
    });
    scheur.addEventListener('click', (e) => {
      e.stopPropagation();
      scheurUit(n.id, li, 0);
    });
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      wapen(li);
    });
    veegbaar(li, n.id);
    return li;
  }

  function wapen(li) {
    if (gewapend && gewapend !== li) gewapend.classList.remove('gewapend');
    gewapend = li;
    li.classList.add('gewapend');
  }
  function ontwapen() {
    if (gewapend) gewapend.classList.remove('gewapend');
    gewapend = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (gewapend && !gewapend.contains(e.target)) ontwapen();
  }, true);

  // Wegvegen met de vinger (of de muis): de rij volgt, voorbij de drempel wordt ze uitgescheurd.
  function veegbaar(li, id) {
    const rij = li.querySelector('.rij');
    let start = null;
    let sleept = false;
    let lang = false;
    let langTimer = null;

    const reset = () => {
      clearTimeout(langTimer);
      start = null;
      sleept = false;
      lang = false;
    };

    li.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.scheur')) return;
      start = { x: e.clientX, y: e.clientY, tijd: performance.now(), id: e.pointerId };
      sleept = false;
      lang = false;
      clearTimeout(langTimer);
      if (e.pointerType !== 'mouse') {
        langTimer = setTimeout(() => {
          if (start && !sleept) {
            lang = true;
            wapen(li);
            try { navigator.vibrate && navigator.vibrate(10); } catch {}
          }
        }, 550);
      }
    });
    li.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!sleept) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }   // gewoon scrollen
        if (Math.abs(dx) < 10) return;
        sleept = true;
        clearTimeout(langTimer);
        ontwapen();
        li.classList.add('sleept');
        try { li.setPointerCapture(e.pointerId); } catch {}
      }
      e.preventDefault();
      rij.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 60).toFixed(2) + 'deg)';
      rij.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / (li.clientWidth * 1.1)));
    });
    const einde = (e) => {
      if (!start || e.pointerId !== start.id) return;
      clearTimeout(langTimer);
      if (!sleept) {
        if (lang) li._slikTot = performance.now() + 60;
        reset();
        return;
      }
      const dx = e.clientX - start.x;
      const tijd = Math.max(1, performance.now() - start.tijd);
      const snel = Math.abs(dx) / tijd > 0.6 && Math.abs(dx) > 40;
      li._slikTot = performance.now() + 60;
      if (e.type !== 'pointercancel' && (Math.abs(dx) > li.clientWidth * 0.33 || snel)) {
        scheurUit(id, li, dx < 0 ? -1 : 1);
      } else {
        terugOpZijnPlaats(li);
      }
      reset();
    };
    li.addEventListener('pointerup', einde);
    li.addEventListener('pointercancel', einde);
  }

  function terugOpZijnPlaats(li) {
    const rij = li.querySelector('.rij');
    const klaar = () => { rij.style.transform = ''; rij.style.opacity = ''; li.classList.remove('sleept'); };
    if (beweging() && rij.animate) {
      const a = rij.animate([{ transform: rij.style.transform || 'none', opacity: rij.style.opacity || 1 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: 'ease-out' });
      a.onfinish = klaar; a.oncancel = klaar;
      klaar();
    } else klaar();
  }

  /* ================= uitscheuren en ongedaan maken ================= */
  let uitgescheurd = null;    // { notitie, timer }

  function scheurUit(id, li, richting) {
    const n = leesNotitie(id);
    if (!n) { toonLijst(); return; }
    const volgende = li && (li.nextElementSibling || li.previousElementSibling);
    const volgendeId = volgende ? volgende.dataset.id : null;
    const hadFocus = li && li.contains(document.activeElement);
    opslag.wis(NOTE + id);
    hintKlaar();
    ontwapen();
    toonStrookje(n);

    const naAfloop = () => {
      toonLijst();
      if (hadFocus) {
        const r = volgendeId && lijst.querySelector('li[data-id="' + CSS.escape(volgendeId) + '"] .rij');
        (r || plus).focus({ preventScroll: true });
      }
    };
    if (li && beweging() && li.animate) {
      const rij = li.querySelector('.rij');
      li.classList.add('sleept');
      const r = richting || 1;
      const a = rij.animate([
        { transform: rij.style.transform || 'none', opacity: rij.style.opacity || 1 },
        { transform: 'translateX(' + (r * 115) + '%) translateY(-6px) rotate(' + (r * 9) + 'deg)', opacity: 0 },
      ], { duration: 230, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' });
      a.onfinish = naAfloop;
    } else {
      naAfloop();
    }
  }

  function toonStrookje(n) {
    if (uitgescheurd) clearTimeout(uitgescheurd.timer);
    uitgescheurd = { notitie: n, timer: setTimeout(verbergStrookje, ONGEDAAN_MS) };
    strookjeTekst.textContent = t('torn');
    ongedaanKnop.textContent = t('undo');
    strookje.classList.add('zichtbaar');
  }
  function verbergStrookje() {
    if (uitgescheurd) clearTimeout(uitgescheurd.timer);
    uitgescheurd = null;
    strookje.classList.remove('zichtbaar');
    // tekst pas leegmaken na de overgang, zodat het strookje niet leeg wegschuift
    setTimeout(() => { if (!uitgescheurd) { strookjeTekst.textContent = ''; ongedaanKnop.textContent = ''; } }, 250);
  }
  function maakOngedaan() {
    if (!uitgescheurd) return;
    const n = uitgescheurd.notitie;
    const r = schrijfNotitie(n);
    if (r === 'vol') toonMelding('quota');
    const hadFocus = strookje.contains(document.activeElement);
    verbergStrookje();
    if (!blad.hidden && huidig) return;
    toonLijst(hadFocus ? n.id : null);
  }
  ongedaanKnop.addEventListener('click', maakOngedaan);
  document.addEventListener('keydown', (e) => {
    if (uitgescheurd && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && blad.hidden) {
      e.preventDefault();
      maakOngedaan();
    }
  });

  /* ================= een blaadje ================= */
  let huidig = null;        // { id, c, bewaard: tekst zoals laatst bewaard }
  let bewaarTimer = null;

  function openBlad(id) {
    const n = id ? leesNotitie(id) : null;
    huidig = n ? { id: n.id, c: n.c, bewaard: n.t } : { id: nieuwId(), c: Date.now(), bewaard: '' };
    tekst.value = n ? n.t : '';
    if (uitgescheurd) verbergStrookje();
    sluitDoneer();
    ontwapen();
    try { history.pushState({ nb: 'blad' }, ''); } catch {}
    // eerst het blaadje zichtbaar (onder de beginpagina) en de focus erin, dan omslaan:
    // zo komt op de telefoon meteen het toetsenbord op.
    blad.hidden = false;
    tekst.focus({ preventScroll: true });
    const eind = tekst.value.length;
    try { tekst.setSelectionRange(eind, eind); } catch {}
    tekst.scrollTop = tekst.scrollHeight;
    slaOm(begin, 'weg', () => { begin.hidden = true; });
  }

  function bewaar() {
    clearTimeout(bewaarTimer);
    bewaarTimer = null;
    if (!huidig) return;
    const waarde = tekst.value;
    if (waarde === huidig.bewaard) return;
    if (waarde.trim() === '') {
      // een leeg blaadje houden we niet
      opslag.wis(NOTE + huidig.id);
      huidig.bewaard = waarde;
      return;
    }
    const r = schrijfNotitie({ id: huidig.id, t: waarde, u: Date.now(), c: huidig.c });
    if (r === 'vol') { toonMelding('quota'); return; }
    huidig.bewaard = waarde;
    if (r === 'ok') vraagBlijvendeOpslag();
  }

  tekst.addEventListener('input', () => {
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(bewaar, BEWAAR_NA);
  });
  tekst.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); naarBegin(); }
  });

  function naarBegin(vanHistorie) {
    if (blad.hidden) return;
    bewaar();
    const id = huidig && huidig.bewaard.trim() !== '' ? huidig.id : null;
    huidig = null;
    if (!vanHistorie && history.state && history.state.nb === 'blad') {
      // de terugknop van de browser doet de rest (popstate)
      terugViaHistorie = true;
      history.back();
    }
    begin.hidden = false;
    toonLijst(null);
    const r = id && lijst.querySelector('li[data-id="' + CSS.escape(id) + '"] .rij');
    if (r) r.focus({ preventScroll: true }); else plus.focus({ preventScroll: true });
    if (tekst === document.activeElement) tekst.blur();
    slaOm(begin, 'terug', () => { blad.hidden = true; tekst.value = ''; });
  }
  let terugViaHistorie = false;
  window.addEventListener('popstate', () => {
    if (terugViaHistorie) { terugViaHistorie = false; return; }
    if (!blad.hidden) naarBegin(true);
  });

  terug.addEventListener('click', () => naarBegin());
  plus.addEventListener('click', () => openBlad(null));

  /* ================= omslaan over de bovenkant ================= */
  // Een reportersblokje slaat je naar boven om: de pagina draait rond de spiraal.
  let lopend = null;
  function slaOm(pagina, richting, klaar) {
    if (lopend) { try { lopend.finish(); } catch {} lopend = null; }
    const af = () => { pagina.classList.remove('boven'); klaar && klaar(); };
    if (!beweging() || !pagina.animate) { af(); return; }
    pagina.classList.add('boven');
    const plat = { transform: 'rotateX(0deg)', filter: 'brightness(1)' };
    const op = { transform: 'rotateX(118deg)', filter: 'brightness(.82)' };
    const kf = richting === 'weg' ? [plat, op] : [op, plat];
    const a = pagina.animate(kf, {
      duration: 460,
      easing: richting === 'weg' ? 'cubic-bezier(.45,.05,.75,.6)' : 'cubic-bezier(.2,.5,.35,1)',
    });
    lopend = a;
    a.onfinish = () => { if (lopend === a) lopend = null; af(); };
    a.oncancel = () => { if (lopend === a) lopend = null; af(); };
  }

  /* ================= bewaren bij weggaan ================= */
  window.addEventListener('pagehide', bewaar);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bewaar(); });
  window.addEventListener('beforeunload', bewaar);

  /* ================= twee tabbladen ================= */
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.startsWith(PREFIX)) return;
    if (e.key === K_LANG) {
      const nieuw = opslag.lees(K_LANG);
      if (nieuw && TALEN[nieuw] && nieuw !== taal) { taal = nieuw; pasTaalToe(); }
      return;
    }
    // Het open blaadje laten we met rust: wat je hier typt gaat niet verloren
    // (per blaadje wint de laatste die bewaart). De lijst werken we wel bij.
    if (!begin.hidden && blad.hidden) {
      const focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest('li[data-id]');
      toonLijst(focusId ? focusId.dataset.id : null);
    }
  });

  /* ================= voet: taal, doneren, versie, verversen ================= */
  function bouwTaalKeuze() {
    taalKeuze.textContent = '';
    for (const code of Object.keys(TALEN)) {
      const o = document.createElement('option');
      o.value = code;
      o.lang = code;
      o.textContent = TALEN[code].naam;
      if (code === taal) o.selected = true;
      taalKeuze.appendChild(o);
    }
  }
  taalKeuze.addEventListener('change', () => {
    const code = taalKeuze.value;
    if (!TALEN[code]) return;
    taal = code;
    opslag.schrijf(K_LANG, code);
    pasTaalToe();
  });

  function pasTaalToe() {
    const html = document.documentElement;
    html.lang = taal;
    html.dir = TALEN[taal].rtl ? 'rtl' : 'ltr';
    const beschrijving = document.querySelector('meta[name="description"]');
    if (beschrijving) beschrijving.setAttribute('content', t('tagline'));
    plus.setAttribute('aria-label', t('new'));
    plus.title = t('new');
    terug.setAttribute('aria-label', t('back'));
    terug.title = t('back');
    lijst.setAttribute('aria-label', t('list'));
    $('lijstHulp').textContent = t('list.help');
    $('tekstLabel').textContent = t('note');
    tekst.placeholder = t('placeholder');
    leeg.textContent = t('empty');
    taalKeuze.setAttribute('aria-label', t('lang.pick'));
    taalKeuze.title = t('lang.pick');
    if (taalKeuze.value !== taal) taalKeuze.value = taal;
    versieEl.textContent = 'v' + VERSIE;
    versieEl.title = t('version', { v: VERSIE });
    ververs.setAttribute('aria-label', t('refresh'));
    ververs.title = t('refresh');
    doneerKnop.textContent = t('donate.button');
    vulDoneer();
    if (strookje.classList.contains('zichtbaar')) {
      strookjeTekst.textContent = t('torn');
      ongedaanKnop.textContent = t('undo');
    }
    if (melding.dataset.sleutel) melding.textContent = t(melding.dataset.sleutel);
    toonLijst(null);
  }

  // PayPal.me-links met vaste bedragen, zoals bij Whenly.
  function paypalLink(bedrag) {
    return bedrag
      ? 'https://www.paypal.com/paypalme/' + PAYPAL + '/' + bedrag + 'EUR'
      : 'https://www.paypal.com/paypalme/' + PAYPAL;
  }
  function vulDoneer() {
    doneerPaneel.textContent = '';
    const p = (klasse, sleutel) => { const e = document.createElement('p'); if (klasse) e.className = klasse; e.textContent = t(sleutel); return e; };
    const knop = (bedrag) => {
      const a = document.createElement('a');
      a.className = 'doneer-bedrag';
      a.textContent = '€' + bedrag;
      a.href = paypalLink(bedrag);
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    };
    const rij = (bedragen) => { const d = document.createElement('div'); d.className = 'doneer-rij'; bedragen.forEach((b) => d.appendChild(knop(b))); return d; };
    const vrij = document.createElement('a');
    vrij.className = 'doneer-vrij';
    vrij.textContent = t('donate.free');
    vrij.href = paypalLink(null);
    vrij.target = '_blank';
    vrij.rel = 'noopener';
    doneerPaneel.append(p('doneer-intro', 'donate.intro'), rij([1, 2, 5]), p('doneer-joke', 'donate.joke'), rij([20, 50]), vrij);
  }
  function sluitDoneer() {
    doneerPaneel.hidden = true;
    doneerKnop.setAttribute('aria-expanded', 'false');
  }
  doneerKnop.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = doneerPaneel.hidden;
    doneerPaneel.hidden = !open;
    doneerKnop.setAttribute('aria-expanded', String(open));
    if (open) { const eerste = doneerPaneel.querySelector('a'); if (eerste) eerste.focus({ preventScroll: true }); }
  });
  document.addEventListener('click', (e) => {
    if (!doneerPaneel.hidden && !doneerPaneel.contains(e.target) && e.target !== doneerKnop) sluitDoneer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!doneerPaneel.hidden) { sluitDoneer(); doneerKnop.focus(); }
      ontwapen();
    }
  });

  // Verversen: nieuwste versie ophalen en meteen gebruiken.
  ververs.addEventListener('click', async () => {
    if (ververs.classList.contains('bezig')) return;
    ververs.classList.add('bezig');
    bewaar();
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch {}
          const nieuw = reg.installing || reg.waiting;
          if (nieuw) {
            await new Promise((klaar) => {
              const kijk = () => { if (nieuw.state === 'activated' || nieuw.state === 'redundant') klaar(); };
              nieuw.addEventListener('statechange', kijk);
              try { nieuw.postMessage('skipWaiting'); } catch {}
              kijk();
              setTimeout(klaar, 6000);
            });
          }
        }
      }
    } catch {}
    location.reload();
  });

  function serviceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // een nieuwe versie staat klaar: toon een klein stipje bij verversen
      if (hadController) ververs.classList.add('nieuw');
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  /* ================= start ================= */
  meetLijn();
  volgHoogte();
  bouwTaalKeuze();
  pasTaalToe();
  if (!opslag.werkt) toonMelding('nostorage', true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(meetLijn).catch(() => {});
  window.addEventListener('resize', () => { clearTimeout(volgHoogte.t); volgHoogte.t = setTimeout(meetLijn, 150); });
  if (document.readyState === 'complete') serviceWorker();
  else window.addEventListener('load', serviceWorker);

  // voor de testen en voor wie in de console kijkt
  window.notitieboekje = { versie: VERSIE };
})();
