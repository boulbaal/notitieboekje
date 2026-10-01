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
  const PLEK = PREFIX + 'pos.';   // per blaadje: waar de cursor stond en hoe ver gescrold
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
    if (s && typeof s === 'object') {
      // meervoudsvormen: kies de juiste via Intl.PluralRules
      const n = vars && typeof vars.n === 'number' ? vars.n : 0;
      let soort = 'other';
      try { soort = new Intl.PluralRules(taal).select(n); } catch {}
      s = s[soort] || s.other;
    }
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
  const meerKnop = $('meerKnop');
  const meerMenu = $('meerMenu');
  const importBestand = $('importBestand');
  const bevestig = $('bevestig');
  const wisNee = $('wisNee');
  const wisJa = $('wisJa');

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
    const zet = () => {
      document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      document.documentElement.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
    };
    vv.addEventListener('resize', zet);
    vv.addEventListener('scroll', zet);
    zet();
  }

  /* ================= meldingen ================= */
  let meldingTimer = null;
  function toonMelding(sleutel, blijvend) {
    melding.classList.remove('info');
    melding.textContent = t(sleutel);
    melding.dataset.sleutel = sleutel;
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(verbergMelding, blijvend ? 12000 : 7000);
  }
  // een gewone mededeling (geen fout), met een al vertaalde tekst
  function toonBericht(tekst) {
    melding.classList.add('info');
    melding.textContent = tekst;
    delete melding.dataset.sleutel;
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(verbergMelding, 7000);
  }
  function verbergMelding() {
    clearTimeout(meldingTimer);
    melding.textContent = '';
    melding.classList.remove('info');
    delete melding.dataset.sleutel;
  }
  melding.addEventListener('click', verbergMelding);

  /* ================= de lijst ================= */
  let openLi = null;          // rij waarvan de acties (delen, uitscheuren) open staan
  let slikVolgendeKlik = false;

  function toonLijst(focusId) {
    openLi = null;
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

  function icoon(d, grootte) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(grootte || 22));
    svg.setAttribute('height', String(grootte || 22));
    svg.setAttribute('aria-hidden', 'true');
    const pad = document.createElementNS(ns, 'path');
    pad.setAttribute('d', d);
    pad.setAttribute('fill', 'none');
    pad.setAttribute('stroke', 'currentColor');
    pad.setAttribute('stroke-width', '2');
    pad.setAttribute('stroke-linecap', 'round');
    pad.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pad);
    return svg;
  }
  // het algemene deelicoon: drie bolletjes met twee lijntjes
  const ICOON_DELEN = 'M20.5 5.5a2.75 2.75 0 1 1-5.5 0a2.75 2.75 0 1 1 5.5 0ZM9 12a2.75 2.75 0 1 1-5.5 0a2.75 2.75 0 1 1 5.5 0ZM20.5 18.5a2.75 2.75 0 1 1-5.5 0a2.75 2.75 0 1 1 5.5 0ZM8.6 10.65l6.8-3.8M8.6 13.35l6.8 3.8';
  const ICOON_WEG = 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M10.5 11v6M13.5 11v6';
  const ICOON_MEER = 'M5 12h.01M12 12h.01M19 12h.01';

  // In welke richting schuift de rij opzij om de acties te tonen? (LTR naar links, RTL naar rechts)
  const opzij = () => (document.documentElement.dir === 'rtl' ? 1 : -1);

  function maakRij(n) {
    const titel = eersteRegel(n.t);
    const kort = titel.slice(0, 60);
    const li = document.createElement('li');
    li.dataset.id = n.id;

    const acties = document.createElement('div');
    acties.className = 'acties';
    const deelKnop = document.createElement('button');
    deelKnop.type = 'button';
    deelKnop.className = 'actie delen';
    deelKnop.setAttribute('aria-label', t('share') + ': ' + kort);
    deelKnop.title = t('share');
    deelKnop.appendChild(icoon(ICOON_DELEN));
    const wegKnop = document.createElement('button');
    wegKnop.type = 'button';
    wegKnop.className = 'actie weg';
    wegKnop.setAttribute('aria-label', t('tear') + ': ' + kort);
    wegKnop.title = t('tear');
    wegKnop.appendChild(icoon(ICOON_WEG));
    acties.append(deelKnop, wegKnop);

    const rij = document.createElement('button');
    rij.type = 'button';
    rij.className = 'rij';
    const span = document.createElement('span');
    span.dir = 'auto';
    span.textContent = titel;
    rij.appendChild(span);

    // voor toetsenbord en schermlezer: een klein menuknopje dat dezelfde twee acties opent
    const menuKnop = document.createElement('button');
    menuKnop.type = 'button';
    menuKnop.className = 'rijmenu';
    menuKnop.setAttribute('aria-label', t('actions') + ': ' + kort);
    menuKnop.setAttribute('aria-expanded', 'false');
    menuKnop.appendChild(icoon(ICOON_MEER, 20));

    li.append(acties, rij, menuKnop);

    rij.addEventListener('click', (e) => {
      // de klik die de browser meteen na een veeg of lang drukken stuurt, telt niet
      if (performance.now() < (li._slikTot || 0)) { e.preventDefault(); return; }
      if (slikVolgendeKlik) { slikVolgendeKlik = false; return; }   // deze tik sloot een open rij
      if (openLi === li) { sluitRij(false); return; }
      openBlad(n.id);
    });
    rij.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        scheurUit(n.id, li, 0);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ander = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
        if (ander) { e.preventDefault(); ander.querySelector('.rij').focus(); }
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        openRij(li, true);
      }
    });
    menuKnop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openLi === li) sluitRij(true); else openRij(li, true);
    });
    acties.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluitRij(true); }
    });
    deelKnop.addEventListener('click', (e) => { e.stopPropagation(); deel(n.id); });
    wegKnop.addEventListener('click', (e) => { e.stopPropagation(); scheurUit(n.id, li, opzij()); });
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openRij(li, false);
    });
    veegbaar(li);
    return li;
  }

  function actieBreedte(li) {
    return li.querySelector('.acties').offsetWidth || 124;
  }
  function openRij(li, focusActie) {
    if (openLi && openLi !== li) sluitRij(false);
    openLi = li;
    li.classList.add('open');
    li.querySelector('.rij').style.transform = 'translateX(' + (opzij() * actieBreedte(li)) + 'px)';
    li.querySelector('.rijmenu').setAttribute('aria-expanded', 'true');
    if (focusActie) li.querySelector('.actie.delen').focus({ preventScroll: true });
  }
  function sluitRij(focusRij) {
    const li = openLi;
    if (!li) return;
    openLi = null;
    li.classList.remove('open');
    li.querySelector('.rij').style.transform = '';
    li.querySelector('.rijmenu').setAttribute('aria-expanded', 'false');
    if (focusRij) li.querySelector('.rij').focus({ preventScroll: true });
  }
  // oude naam, nog gebruikt bij het openen van een blaadje en dergelijke
  const ontwapen = () => sluitRij(false);

  document.addEventListener('pointerdown', (e) => {
    slikVolgendeKlik = false;
    if (openLi && !openLi.contains(e.target)) {
      sluitRij(false);
      // tikte je op een andere rij, dan sluit die tik alleen de open rij
      if (e.target.closest && e.target.closest('#lijst .rij')) slikVolgendeKlik = true;
    }
    if (!doneerPaneel.hidden && !doneerPaneel.contains(e.target) && !doneerKnop.contains(e.target)) sluitDoneer();
    if (!meerMenu.hidden && !meerMenu.contains(e.target) && !meerKnop.contains(e.target)) sluitMenu(false);
    if (!bevestig.hidden && !bevestig.contains(e.target)) sluitBevestig(false);
  }, true);

  // Vegen met de vinger (of de muis): de rij schuift opzij en toont delen en uitscheuren.
  // Een korte veeg klikt open, terugvegen (of ergens anders tikken) sluit weer.
  function veegbaar(li) {
    const rij = li.querySelector('.rij');
    let start = null;
    let sleept = false;
    let lang = false;
    let langTimer = null;
    let verschuiving = 0;

    const reset = () => {
      clearTimeout(langTimer);
      start = null;
      sleept = false;
      lang = false;
    };

    li.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.acties') || e.target.closest('.rijmenu')) return;
      const basis = openLi === li ? opzij() * actieBreedte(li) : 0;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, basis };
      sleept = false;
      lang = false;
      clearTimeout(langTimer);
      if (e.pointerType !== 'mouse') {
        langTimer = setTimeout(() => {
          if (start && !sleept) {
            lang = true;
            openRij(li, false);
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
        if (openLi && openLi !== li) sluitRij(false);   // maar één rij tegelijk open
        li.classList.add('sleept');
        try { li.setPointerCapture(e.pointerId); } catch {}
      }
      e.preventDefault();
      // in de richting van de acties tot net voorbij hun breedte, de andere kant op niet voorbij 0
      const max = actieBreedte(li);
      const naarOpen = Math.max(-12, Math.min(max + 24, (start.basis + dx) * opzij()));
      verschuiving = naarOpen;
      rij.style.transform = 'translateX(' + (opzij() * naarOpen) + 'px)';
    });
    const einde = (e) => {
      if (!start || e.pointerId !== start.id) return;
      clearTimeout(langTimer);
      if (!sleept) {
        if (lang) li._slikTot = performance.now() + 60;
        reset();
        return;
      }
      li._slikTot = performance.now() + 60;
      li.classList.remove('sleept');
      const wasOpen = start.basis !== 0;
      // korte veeg opent; vanuit open is een kleine veeg terug genoeg om te sluiten
      const drempel = wasOpen ? actieBreedte(li) - 36 : 44;
      if (e.type !== 'pointercancel' && verschuiving > drempel) openRij(li, false);
      else { if (openLi === li) sluitRij(false); else rij.style.transform = ''; }
      reset();
    };
    li.addEventListener('pointerup', einde);
    li.addEventListener('pointercancel', einde);
  }

  /* ================= delen ================= */
  async function kopieer(tekst) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(tekst);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = tekst;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch { return false; }
  }
  // Delen via het deelmenu van de telefoon (mail, WhatsApp ...); anders kopiëren.
  async function deel(id) {
    const n = leesNotitie(id);
    const li = openLi;
    if (!n) { toonLijst(null); return; }
    let klaar = false;
    if (navigator.share) {
      try {
        await navigator.share({ title: eersteRegel(n.t), text: n.t });
        klaar = true;
      } catch (e) {
        if (e && e.name === 'AbortError') klaar = true;     // zelf afgebroken: niets aan de hand
      }
    }
    if (!klaar) {
      if (await kopieer(n.t)) toonBericht(t('copied'));
      else toonMelding('share.fail');
    }
    if (openLi === li) sluitRij(false);
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
    openLi = null;
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
      li.classList.add('scheurt');
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
    sluitMenu(false);
    sluitBevestig(false);
    ontwapen();
    try { history.pushState({ nb: 'blad' }, ''); } catch {}
    toonAangemaakt();
    blad.hidden = false;
    // Een nieuw blaadje: meteen schrijven (toetsenbord op). Een bestaand blaadje open je
    // vooral om te lezen: op een telefoon geen toetsenbord, dat komt pas als je in de
    // tekst tikt. De cursor en het scrollen staan waar je ze de vorige keer liet.
    const plek = n ? leesPlek(n.id, n.t.length) : { p: 0, e: 0, s: 0 };
    const schrijven = !n || !isAanraak();
    if (schrijven) tekst.focus({ preventScroll: true });
    else terug.focus({ preventScroll: true });
    try { tekst.setSelectionRange(plek.p, plek.e); } catch {}
    tekst.scrollTop = plek.s;
    slaOm(begin, 'weg', () => { if (huidig) begin.hidden = true; });
  }

  // telefoon of tablet: aanraken, geen muis
  function isAanraak() {
    try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
  }

  function leesPlek(id, lengte) {
    try {
      const v = JSON.parse(opslag.lees(PLEK + id) || 'null');
      if (v && typeof v === 'object') {
        const p = Math.max(0, Math.min(lengte, Number(v.p) || 0));
        const e = Math.max(p, Math.min(lengte, Number(v.e) || p));
        return { p, e, s: Math.max(0, Number(v.s) || 0) };
      }
    } catch {}
    // nog nooit open geweest: bovenaan lezen, de cursor achteraan om verder te schrijven
    return { p: lengte, e: lengte, s: 0 };
  }
  function bewaarPlek() {
    if (!huidig || blad.hidden) return;
    if (tekst.value.trim() === '') { opslag.wis(PLEK + huidig.id); return; }
    const v = { p: tekst.selectionStart || 0, e: tekst.selectionEnd || 0, s: Math.round(tekst.scrollTop) };
    opslag.schrijf(PLEK + huidig.id, JSON.stringify(v));
  }
  // plekken van blaadjes die er niet meer zijn opruimen
  function ruimPlekkenOp() {
    for (const k of opslag.sleutels()) {
      if (k.startsWith(PLEK) && opslag.lees(NOTE + k.slice(PLEK.length)) === null) opslag.wis(k);
    }
  }

  // de datum waarop het blaadje begonnen is, rechtsboven
  const aangemaakt = $('aangemaakt');
  function toonAangemaakt() {
    const c = huidig && huidig.c;
    if (!c) { aangemaakt.textContent = ''; aangemaakt.removeAttribute('datetime'); aangemaakt.removeAttribute('aria-label'); return; }
    const d = new Date(c);
    let tekstDatum;
    try {
      tekstDatum = new Intl.DateTimeFormat(taal, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    } catch {
      tekstDatum = d.toLocaleString();
    }
    aangemaakt.textContent = tekstDatum;
    aangemaakt.setAttribute('datetime', d.toISOString());
    aangemaakt.setAttribute('aria-label', t('created', { date: tekstDatum }));
    aangemaakt.title = aangemaakt.getAttribute('aria-label');
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
  // Escape: terug naar de lijst, ook als de focus niet in de tekst staat (lezen)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && !blad.hidden) { e.preventDefault(); naarBegin(); }
  });

  function naarBegin(vanHistorie) {
    if (blad.hidden) return;
    bewaar();
    bewaarPlek();
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
    slaOm(begin, 'terug', () => { if (huidig) return; blad.hidden = true; tekst.value = ''; probeerUpdateHerladen(); });
  }
  let terugViaHistorie = false;
  window.addEventListener('popstate', () => {
    if (terugViaHistorie) { terugViaHistorie = false; return; }
    if (!blad.hidden) naarBegin(true);
  });

  terug.addEventListener('click', () => naarBegin());
  plus.addEventListener('click', () => openBlad(null));

  /* ================= omslaan over de bovenkant ================= */
  // De kaft slaat om over de spiraal zoals echt papier: ze buigt. Bij het openen
  // gaat de onderrand voorop en krult naar je toe; bij het terugvallen hangt de
  // onderrand wat achter en landt de pagina zacht. Voorbij de rechte stand zie je
  // de achterkant van de kaft.
  // Hoe: een kopie van de pagina in horizontale repen knippen en elke reep op een
  // gebogen lijn zetten (zijaanzicht van het papier). Alles als Web Animations met
  // vooraf berekende sleutelbeelden, zodat het ook vloeiend blijft terwijl het
  // toetsenbord opkomt.
  const OMSLAG = {
    weg:   { ms: 760, eind: 182, krul: 70 },
    terug: { ms: 660, eind: 182, krul: 60 },
  };
  const PERSPECTIEF = 2200;
  let lopend = null;   // { finish() }

  const glad = (x) => x * x * (3 - 2 * x);
  // stand van de pagina op tijdstip t (0..1): hoek aan de spiraal en extra buiging aan de onderrand
  function stand(richting, t) {
    const o = OMSLAG[richting];
    if (richting === 'weg') {
      // eerst rustig optillen (de onderrand komt los en krult naar je toe),
      // rond 70% van de tijd staat de pagina recht, daarna vlot over de top
      const h = o.eind * glad(Math.pow(t, 1.5));
      const c = o.krul * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.3 * t);
      return { h, c };
    }
    // terug: komt over de top, valt, de onderrand hangt achter, zachte landing
    const u = 1 - Math.pow(1 - t, 1.35);
    const h = o.eind * (1 - glad(u));
    const c = o.krul * Math.sin(Math.PI * Math.min(1, t * 1.08)) * (1 - 0.2 * t);
    return { h, c };
  }

  // licht valt van boven-voor op het papier: (0, -0.5, 1). Het deel dat net naar je
  // toe krult vangt meer licht (glans), wat schuiner staat wordt donkerder.
  const LICHT = Math.hypot(0.5, 1);
  const VLAK = 1 / LICHT;
  function belichting(th) {
    const r = th * Math.PI / 180;
    const voor = th <= 90;
    const d = (0.5 * Math.sin(r) + Math.cos(r)) / LICHT;   // normaal (0, -sin, cos)
    if (voor) {
      const v = d - VLAK;
      return { donker: v < 0 ? Math.min(0.5, -v * 0.9) : 0, glans: v > 0 ? Math.min(0.22, v * 2.2) : 0 };
    }
    // achterkant: normaal (0, sin, -cos), licht van voren komt er schuin op
    const a = Math.max(0, (-0.5 * Math.sin(r) - Math.cos(r)) / LICHT);
    return { donker: 0.06 + 0.22 * (1 - a), glans: 0 };
  }

  // zijaanzicht: per reep de hoek, en waar de bovenrand van de reep komt (y omlaag, z naar je toe)
  function buig(randen, h, c) {
    const L = randen[randen.length - 1];
    const uit = [];
    let y = 0, z = 0;
    for (let i = 0; i < randen.length - 1; i++) {
      const s0 = randen[i], s1 = randen[i + 1];
      const m = (s0 + s1) / 2 / L;
      const th = Math.min(h + c * m * m, OMSLAG.weg.eind + 4);
      uit.push({ s0, y, z, th });
      const r = th * Math.PI / 180;
      y += (s1 - s0) * Math.cos(r);
      z += (s1 - s0) * Math.sin(r);
    }
    uit.eind = { y, z, th: uit[uit.length - 1].th };
    return uit;
  }

  // een kopie van de pagina zonder id's en zonder de rijen die toch niet in beeld staan
  function kopieVan(pagina) {
    const k = pagina.cloneNode(true);
    k.removeAttribute('id');
    k.classList.remove('boven');
    k.style.opacity = '';
    for (const e of k.querySelectorAll('[id]')) e.removeAttribute('id');
    const vak = pagina.querySelector('.lijstvak');
    const kVak = k.querySelector('.lijstvak');
    const kLijst = k.querySelector('.lijst');
    let scroll = 0;
    if (vak && kVak && kLijst) {
      scroll = vak.scrollTop;
      const onder = scroll + vak.clientHeight;
      const rijen = pagina.querySelectorAll('.lijst > li');
      const kRijen = kLijst.children;
      let boven = 0;
      for (let i = rijen.length - 1; i >= 0; i--) {
        const r = rijen[i];
        const zicht = r.offsetTop + r.offsetHeight > scroll && r.offsetTop < onder;
        if (!zicht) { if (r.offsetTop < scroll) boven = Math.max(boven, r.offsetTop + r.offsetHeight); kRijen[i].remove(); }
      }
      kLijst.style.paddingTop = boven + 'px';
    }
    return { k, scroll };
  }

  function slaOm(pagina, richting, klaar) {
    if (lopend) { lopend.finish(); lopend = null; }
    const af = () => { pagina.classList.remove('boven'); klaar && klaar(); };
    if (!beweging() || !pagina.animate) { af(); return; }

    const o = OMSLAG[richting];
    const L = bladen.clientHeight;
    const B = bladen.clientWidth;
    if (!L || !B) { af(); return; }

    // de repen: kleiner onderaan, daar buigt het papier het meest
    const n = Math.max(10, Math.min(16, Math.round(L / 48)));
    const randen = [];
    for (let i = 0; i <= n; i++) randen.push(Math.round(L * (1 - Math.pow(1 - i / n, 1.35))));

    const laag = document.createElement('div');
    laag.className = 'omslag';
    laag.setAttribute('aria-hidden', 'true');
    laag.inert = true;
    laag.style.height = L + 'px';   // vast: het toetsenbord mag de pagina niet halverwege kleiner maken

    const schaduw = document.createElement('div');
    schaduw.className = 'omslag-schaduw';
    laag.appendChild(schaduw);

    const { k: sjabloon, scroll } = kopieVan(pagina);
    const repen = [];
    for (let i = 0; i < n; i++) {
      const reep = document.createElement('div');
      reep.className = 'reep';
      const boven = Math.max(0, randen[i] - 0.75);
      const onder = Math.max(0, L - randen[i + 1] - 0.75);
      reep.style.clipPath = 'inset(' + boven + 'px 0 ' + onder + 'px 0)';
      reep.style.transformOrigin = '50% ' + randen[i] + 'px';
      const k = i === n - 1 ? sjabloon : sjabloon.cloneNode(true);
      const licht = document.createElement('div');
      licht.className = 'reep-licht';
      const achter = document.createElement('div');
      achter.className = 'reep-achter';
      const glans = document.createElement('div');
      glans.className = 'reep-glans';
      reep.append(k, achter, licht, glans);
      laag.appendChild(reep);
      repen.push({ reep, k, licht, achter, glans });
    }
    bladen.appendChild(laag);
    for (const r of repen) { const v = r.k.querySelector('.lijstvak'); if (v) v.scrollTop = scroll; }
    pagina.style.opacity = '0';

    // sleutelbeelden
    const K = 40;
    const kf = repen.map(() => ({ reep: [], licht: [], achter: [], glans: [] }));
    const kfSchaduw = [];
    const oy = L * 0.3;
    for (let j = 0; j <= K; j++) {
      const t = j / K;
      const { h, c } = stand(richting, t);
      const vorm = buig(randen, h, c);
      for (let i = 0; i < n; i++) {
        const { s0, y, z, th } = vorm[i];
        const voor = th <= 90;
        const b = belichting(th);
        kf[i].reep.push({ offset: t, transform: 'translate3d(0,' + (y - s0).toFixed(2) + 'px,' + z.toFixed(2) + 'px) rotateX(' + th.toFixed(2) + 'deg)' });
        kf[i].licht.push({ offset: t, opacity: b.donker.toFixed(3) });
        kf[i].glans.push({ offset: t, opacity: b.glans.toFixed(3) });
        // voor- of achterkant: meteen omschakelen, niet half doorschijnend
        kf[i].achter.push({ offset: t, opacity: voor ? 0 : 1, easing: 'step-start' });
      }
      // schaduw van de opgetilde onderrand op het blaadje eronder
      const e = vorm.eind;
      const yProj = oy + (e.y - oy) * PERSPECTIEF / Math.max(400, PERSPECTIEF - e.z);
      const hoek = Math.min(e.th, 180) * Math.PI / 180;
      kfSchaduw.push({
        offset: t,
        transform: 'translateY(' + Math.max(-40, Math.min(L, yProj)).toFixed(1) + 'px)',
        opacity: (0.55 * Math.sin(hoek / 2) * (1 - t * 0.6) * (e.th > 178 ? 0 : 1)).toFixed(3),
      });
    }
    const opties = { duration: o.ms, easing: 'linear', fill: 'both' };
    const anims = [];
    for (let i = 0; i < n; i++) {
      anims.push(repen[i].reep.animate(kf[i].reep, opties));
      anims.push(repen[i].licht.animate(kf[i].licht, opties));
      anims.push(repen[i].achter.animate(kf[i].achter, opties));
      anims.push(repen[i].glans.animate(kf[i].glans, opties));
    }
    anims.push(schaduw.animate(kfSchaduw, opties));

    const ctrl = {
      klaar: false,
      finish() {
        if (ctrl.klaar) return;
        ctrl.klaar = true;
        for (const a of anims) { try { a.cancel(); } catch {} }
        laag.remove();
        pagina.style.opacity = '';
        if (lopend === ctrl) lopend = null;
        af();
      },
    };
    lopend = ctrl;
    anims[0].onfinish = () => ctrl.finish();
  }

  /* ================= bewaren bij weggaan ================= */
  window.addEventListener('pagehide', () => { bewaar(); bewaarPlek(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      bewaar();
      bewaarPlek();
      // staat er een nieuwe versie klaar, dan is dit een veilig moment (alles is bewaard)
      if (nieuweVersie) herlaadVoorUpdate();
    } else {
      zoekUpdate();
    }
  });
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
    // (veel wijzigingen tegelijk, zoals alles wissen in een ander tabblad: één keer tekenen)
    if (lijstVerversGepland) return;
    lijstVerversGepland = true;
    setTimeout(() => {
      lijstVerversGepland = false;
      if (!begin.hidden && blad.hidden) {
        const focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest('li[data-id]');
        toonLijst(focusId ? focusId.dataset.id : null);
      }
    }, 30);
  });
  let lijstVerversGepland = false;

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

  // De taalkeuze is zo breed als de gekozen taal (zonder field-sizing, zoals in Safari, meten we zelf).
  function pasTaalBreedteAan() {
    if (window.CSS && CSS.supports && CSS.supports('field-sizing', 'content')) return;
    const m = document.createElement('span');
    const cs = getComputedStyle(taalKeuze);
    m.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    m.style.font = cs.font;
    m.textContent = TALEN[taal].naam;
    document.body.appendChild(m);
    taalKeuze.style.width = Math.ceil(m.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2) + 'px';
    m.remove();
  }

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
    if (!blad.hidden) toonAangemaakt();
    leeg.textContent = t('empty');
    taalKeuze.setAttribute('aria-label', t('lang.pick'));
    taalKeuze.title = t('lang.pick');
    if (taalKeuze.value !== taal) taalKeuze.value = taal;
    pasTaalBreedteAan();
    versieEl.textContent = 'v' + VERSIE;
    versieEl.title = t('version', { v: VERSIE });
    ververs.setAttribute('aria-label', t('refresh'));
    ververs.title = t('refresh');
    doneerKnop.textContent = t('donate.button');
    meerKnop.setAttribute('aria-label', t('more'));
    meerKnop.title = t('more');
    $('exportTekst').textContent = t('export');
    $('importTekst').textContent = t('import');
    $('wisTekst').textContent = t('wipe');
    $('bevestigTitel').textContent = t('wipe.title');
    $('bevestigTekst').textContent = t('wipe.text');
    wisNee.textContent = t('wipe.cancel');
    wisJa.textContent = t('wipe.confirm');
    $('wisExport').textContent = t('wipe.export');
    vulDoneer();
    if (strookje.classList.contains('zichtbaar')) {
      strookjeTekst.textContent = t('torn');
      ongedaanKnop.textContent = t('undo');
    }
    if (melding.dataset.sleutel) melding.textContent = t(melding.dataset.sleutel);
    if (installModus) { vulInstall(); pasLijstRuimteAan(); }
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
    if (open) { sluitMenu(false); sluitBevestig(false); verbergMelding(); }
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
    handmatig = true;
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

  /* ================= meer: exporteren en importeren ================= */
  const menuItems = () => Array.from(meerMenu.querySelectorAll('[role="menuitem"]'));
  function openMenu() {
    sluitDoneer();
    sluitBevestig(false);
    verbergMelding();
    meerMenu.hidden = false;
    meerKnop.setAttribute('aria-expanded', 'true');
    menuItems()[0].focus({ preventScroll: true });
  }
  function sluitMenu(focusTerug) {
    if (meerMenu.hidden) return;
    meerMenu.hidden = true;
    meerKnop.setAttribute('aria-expanded', 'false');
    if (focusTerug) meerKnop.focus({ preventScroll: true });
  }
  meerKnop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (meerMenu.hidden) openMenu(); else sluitMenu(true);
  });
  meerMenu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[j].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sluitMenu(true);
    } else if (e.key === 'Tab') {
      sluitMenu(false);
    }
  });

  function datumVoorNaam(d) {
    const twee = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + twee(d.getMonth() + 1) + '-' + twee(d.getDate());
  }
  // Exporteren: ons eigen JSON-bestand; delen (telefoon) of downloaden.
  async function exporteer() {
    bewaar();
    const notities = alleNotities();
    if (!notities.length) { toonBericht(t('export.empty')); return; }
    const nu = new Date();
    const inhoud = JSON.stringify(self.NB_IMPORT.maakExport(notities, nu.getTime()), null, 2);
    const naam = 'notitieboekje-' + datumVoorNaam(nu) + '.json';
    const blob = new Blob([inhoud], { type: 'application/json' });
    let bestand = null;
    try { bestand = new File([blob], naam, { type: 'application/json' }); } catch {}
    if (bestand && navigator.share && navigator.canShare) {
      try {
        if (navigator.canShare({ files: [bestand] })) {
          await navigator.share({ files: [bestand], title: naam });
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;     // de gebruiker brak het delen af
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = naam;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Importeren: alleen toevoegen, nooit overschrijven of wissen; dezelfde tekst slaan we over.
  function voegToe(notes) {
    const bestaand = new Set(alleNotities().map((n) => n.t));
    let toegevoegd = 0;
    let dubbel = 0;
    let vol = false;
    for (const n of notes) {
      if (bestaand.has(n.text)) { dubbel++; continue; }
      let id = n.id && opslag.lees(NOTE + n.id) === null ? n.id : nieuwId();
      while (opslag.lees(NOTE + id) !== null) id = nieuwId();
      const r = schrijfNotitie({ id, t: n.text, u: n.updated, c: n.created });
      if (r === 'vol') { vol = true; break; }
      bestaand.add(n.text);
      toegevoegd++;
    }
    return { toegevoegd, dubbel, vol };
  }
  async function importeer(bestand) {
    let gelezen;
    try {
      const buffer = bestand.arrayBuffer ? await bestand.arrayBuffer() : await new Response(bestand).arrayBuffer();
      gelezen = self.NB_IMPORT.lees(buffer, bestand.name || '', bestand.lastModified, Date.now());
    } catch {
      toonMelding('import.error');
      return;
    }
    const r = voegToe(gelezen.notes);
    toonLijst(null);
    if (r.toegevoegd > 0) vraagBlijvendeOpslag();
    if (r.vol) { toonMelding('quota'); return; }
    let bericht = t('import.added', { n: r.toegevoegd });
    if (r.dubbel > 0) bericht += t('import.sep') + t('import.skipped', { n: r.dubbel });
    if (gelezen.verwijderd > 0) bericht += t('import.sep') + t('import.deleted', { n: gelezen.verwijderd });
    toonBericht(bericht);
  }
  $('exportKnop').addEventListener('click', () => { sluitMenu(false); meerKnop.focus({ preventScroll: true }); exporteer(); });
  $('importKnop').addEventListener('click', () => {
    sluitMenu(false);
    meerKnop.focus({ preventScroll: true });
    importBestand.value = '';
    importBestand.click();
  });

  // Alles wissen: eerst bevestigen op een briefje (Annuleren heeft de focus).
  // Taal en het gesloten installatiebriefje blijven bewaard.
  function openBevestig() {
    sluitMenu(false);
    sluitDoneer();
    verbergMelding();
    bevestig.hidden = false;
    wisNee.focus({ preventScroll: true });
  }
  function sluitBevestig(focusTerug) {
    if (bevestig.hidden) return;
    bevestig.hidden = true;
    if (focusTerug) meerKnop.focus({ preventScroll: true });
  }
  function wisAlles() {
    for (const k of opslag.sleutels()) if (k.startsWith(NOTE) || k.startsWith(PLEK)) opslag.wis(k);
    if (uitgescheurd) verbergStrookje();
    sluitBevestig(false);
    toonLijst(null);
    plus.focus({ preventScroll: true });
    toonBericht(t('wipe.done'));
  }
  $('wisKnop').addEventListener('click', openBevestig);
  wisNee.addEventListener('click', () => sluitBevestig(true));
  wisJa.addEventListener('click', wisAlles);
  $('wisExport').addEventListener('click', () => { exporteer(); });
  bevestig.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sluitBevestig(true);
    } else if (e.key === 'Tab') {
      // de focus blijft op het briefje
      const knoppen = Array.from(bevestig.querySelectorAll('button'));
      const i = knoppen.indexOf(document.activeElement);
      const j = e.shiftKey ? (i <= 0 ? knoppen.length - 1 : i - 1) : (i + 1) % knoppen.length;
      e.preventDefault();
      knoppen[j].focus();
    }
  });

  importBestand.addEventListener('change', () => {
    const f = importBestand.files && importBestand.files[0];
    importBestand.value = '';
    if (f) importeer(f);
  });

  /* ================= nieuwe versies: vanzelf bijwerken ================= */
  // De service worker zoekt bij het starten, bij terugkeren naar de app en elk half uur
  // naar een nieuwe versie. Neemt die het over, dan herladen we op een veilig moment:
  // meteen op de beginpagina, anders pas als je teruggaat of de app verlaat.
  // Nooit tijdens het typen, en altijd eerst bewaren.
  let registratie = null;
  let nieuweVersie = false;
  let handmatig = false;
  async function zoekUpdate() {
    if (!registratie || navigator.onLine === false) return;
    try { await registratie.update(); } catch {}
  }
  function herlaadVoorUpdate() {
    if (!nieuweVersie || handmatig) return;
    // tegen een herlaadlus: per (oude) versie hoogstens één keer vanzelf herladen
    const sleutel = PREFIX + 'auto.' + VERSIE;
    try {
      if (window.sessionStorage.getItem(sleutel)) return;
      window.sessionStorage.setItem(sleutel, '1');
    } catch {}
    bewaar();
    location.reload();
  }
  function probeerUpdateHerladen() {
    if (!nieuweVersie) return;
    if (blad.hidden && document.activeElement !== tekst) herlaadVoorUpdate();
  }

  function serviceWorker() {
    if (!('serviceWorker' in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // de eerste keer (eerste bezoek) neemt de service worker alleen de pagina over: niets te verversen
      if (!hadController) { hadController = true; return; }
      nieuweVersie = true;
      ververs.classList.add('nieuw');
      window.notitieboekje.updateKlaar = true;
      probeerUpdateHerladen();
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((r) => { registratie = r; zoekUpdate(); })
      .catch(() => {});
    setInterval(zoekUpdate, 30 * 60 * 1000);
  }

  /* ================= op het beginscherm zetten ================= */
  // Een browser installeert nooit zonder een tik van de gebruiker. Wij tonen alleen een
  // briefje met de weg ernaartoe:
  // - Android: meteen een uitleg via het menu van de browser (Chrome, Samsung Internet,
  //   Firefox ...). Chrome meldt pas na wat gebruik (een tik en ongeveer 30 seconden) dat
  //   installeren kan (beforeinstallprompt); dan wordt het briefje een knop.
  // - iOS: de uitleg via Delen.
  // - De ingebouwde browser van WhatsApp, Facebook, Instagram ...: eerst openen in de browser.
  const installeer = $('installeer');
  const installTitel = $('installTitel');
  const installUitleg = $('installUitleg');
  const installKnop = $('installKnop');
  const installDicht = $('installDicht');
  const K_INSTALL = PREFIX + 'install.dicht';
  const INSTALL_RUST = 14 * 24 * 3600 * 1000;   // na sluiten 14 dagen niet meer tonen
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosAndereBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isSamsung = /SamsungBrowser/.test(ua);
  // ingebouwde browsers van apps: daar kan je niets op het beginscherm zetten
  const inApp = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Pinterest|Twitter/.test(ua)
    || (isAndroid && /; wv\)/.test(ua));
  let installModus = null;     // 'knop', 'ios', 'android', 'samsung' of 'inapp'
  let installEvent = null;

  function isStandalone() {
    try { if (window.matchMedia('(display-mode: standalone)').matches) return true; } catch {}
    return navigator.standalone === true;
  }
  function isTelefoonOfTablet() {
    try { if (window.matchMedia('(pointer: coarse)').matches) return true; } catch {}
    return window.innerWidth < 768;
  }
  function onlangsGesloten() {
    const t0 = parseInt(opslag.lees(K_INSTALL) || '0', 10) || 0;
    return t0 > 0 && Date.now() - t0 < INSTALL_RUST;
  }
  function deelIcoon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('install.share'));
    svg.setAttribute('class', 'deel-icoon');
    const pad = document.createElementNS(ns, 'path');
    pad.setAttribute('d', 'M8.5 9.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2h-1.5M12 3v11.5M8.5 6.5 12 3l3.5 3.5');
    pad.setAttribute('fill', 'none');
    pad.setAttribute('stroke', 'currentColor');
    pad.setAttribute('stroke-width', '1.9');
    pad.setAttribute('stroke-linecap', 'round');
    pad.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pad);
    return svg;
  }
  // het menuknopje van de browser zoals het eruitziet: ⋮ (Chrome, Firefox, apps op Android),
  // ≡ (Samsung Internet) of ⋯ (apps op de iPhone)
  function menuIcoon(soort) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('install.menuname'));
    svg.setAttribute('class', 'deel-icoon');
    if (soort === 'lijnen') {
      const pad = document.createElementNS(ns, 'path');
      pad.setAttribute('d', 'M5 7h14M5 12h14M5 17h14');
      pad.setAttribute('fill', 'none');
      pad.setAttribute('stroke', 'currentColor');
      pad.setAttribute('stroke-width', '2');
      pad.setAttribute('stroke-linecap', 'round');
      svg.appendChild(pad);
    } else {
      const liggend = soort === 'liggend';
      for (const d of [-6, 0, 6]) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', String(liggend ? 12 + d : 12));
        c.setAttribute('cy', String(liggend ? 12 : 12 + d));
        c.setAttribute('r', '1.9');
        c.setAttribute('fill', 'currentColor');
        svg.appendChild(c);
      }
    }
    return svg;
  }
  // tekst met één {plaatshouder} die een icoontje wordt
  function metIcoon(tekst, sleutel, svg) {
    const delen = tekst.split('{' + sleutel + '}');
    installUitleg.append(document.createTextNode(delen[0] || ''), svg, document.createTextNode(delen[1] || ''));
  }
  function vulInstall() {
    installTitel.textContent = t('install.title');
    installKnop.textContent = t('install.button');
    installDicht.setAttribute('aria-label', t('install.close'));
    installDicht.title = t('install.close');
    installKnop.hidden = installModus !== 'knop';
    installUitleg.hidden = installModus === 'knop';
    installUitleg.textContent = '';
    if (installModus === 'ios') {
      metIcoon(t('install.ios'), 'share', deelIcoon());
      if (iosAndereBrowser) installUitleg.append(document.createTextNode(' ' + t('install.safari')));
    } else if (installModus === 'samsung') {
      metIcoon(t('install.samsung'), 'menu', menuIcoon('lijnen'));
    } else if (installModus === 'android') {
      metIcoon(t('install.menu'), 'menu', menuIcoon('staand'));
      // in een tabblad dat WhatsApp of Gmail opent staat "installeren" niet in het menu
      installUitleg.append(document.createTextNode(' ' + t('install.notthere')));
    } else if (installModus === 'inapp') {
      metIcoon(t('install.inapp'), 'menu', menuIcoon(isIOS ? 'liggend' : 'staand'));
    }
  }
  function pasLijstRuimteAan() {
    // zodat de onderste blaadjes niet achter het briefje verdwijnen
    lijstvak.style.paddingBottom = installeer.hidden ? '' : (installeer.offsetHeight + 14) + 'px';
  }
  function toonInstall(modus) {
    if (!isTelefoonOfTablet() || isStandalone() || onlangsGesloten()) return;
    if (installModus === 'knop' && modus !== 'knop') return;   // de knop is altijd beter
    installModus = modus;
    vulInstall();
    installeer.hidden = false;
    pasLijstRuimteAan();
  }
  function verbergInstall() {
    installeer.hidden = true;
    installModus = null;
    pasLijstRuimteAan();
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    toonInstall('knop');
  });
  // Al geïnstalleerd en toch in de browser geopend? (Chrome op Android kan dat vertellen
  // via related_applications in het manifest.)
  async function alGeinstalleerd() {
    try {
      if (!navigator.getInstalledRelatedApps) return false;
      const apps = await navigator.getInstalledRelatedApps();
      return Array.isArray(apps) && apps.length > 0;
    } catch { return false; }
  }
  window.addEventListener('appinstalled', () => { installEvent = null; verbergInstall(); });
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', () => { if (isStandalone()) verbergInstall(); });
  } catch {}
  installKnop.addEventListener('click', async () => {
    const e = installEvent;
    if (!e) { verbergInstall(); return; }
    installEvent = null;                      // prompt() mag maar één keer
    try { await e.prompt(); } catch {}
    try { await e.userChoice; } catch {}
    verbergInstall();
  });
  installDicht.addEventListener('click', () => {
    opslag.schrijf(K_INSTALL, String(Date.now()));
    verbergInstall();
  });
  if (isIOS) toonInstall(inApp ? 'inapp' : 'ios');
  else if (isAndroid) {
    toonInstall(inApp ? 'inapp' : (isSamsung ? 'samsung' : 'android'));
    alGeinstalleerd().then((ja) => { if (ja && installModus !== 'knop') verbergInstall(); });
  }

  /* ================= start ================= */
  ruimPlekkenOp();
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
