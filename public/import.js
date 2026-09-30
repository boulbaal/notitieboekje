/* Notitieboekje: exporteren en importeren (zonder DOM, ook bruikbaar in node voor de testen).
 *
 * Export: ons eigen JSON-formaat
 *   {"format":"notitieboekje","version":1,"exported":"<ISO>","notes":[{"id","text","created","updated"}]}
 *
 * Import leest:
 *   1. ons eigen JSON-formaat;
 *   2. een gewoon tekstbestand (= één blaadje);
 *   3. de MEMOBK2-back-up van een andere notitie-app (binair, big-endian):
 *      kop:    "MEMOBK2\n", uint32 versie (2), uint32 0
 *      record: "M2RC", uint32 volgnummer, uint32 uuid-lengte (0 of 36), uuid,
 *              int64 A, int64 0, int64 C (wijzigtijd in ms of 0),
 *              int64 vlag, int64 tekstlengte, tekst (UTF-8), 32 bytes (hash, genegeerd)
 *      voet:   "M2FO", uint32 aantal records, 32 bytes (controlegetal, genegeerd)
 *      Het bestand bevat twee lijsten. Zoals Ali's oude app ze opsloeg: het blok records
 *      met positieve A achteraan (oplopend) zijn de notities om te houden (aanmaaktijd = A);
 *      de records met negatieve A (vooraan) had die app als verwijderd gemarkeerd.
 *      Die slaan we over en tellen we (alleen niet-lege). A = 0 komt in de praktijk niet
 *      voor; we behandelen het als onbekend en slaan het ook over.
 *   Bij elke fout in de structuur wordt het hele bestand geweigerd (niets half importeren).
 */
'use strict';
(function (root) {
  const MAX_BYTES = 50 * 1024 * 1024;
  const JAAR_2000 = Date.UTC(2000, 0, 1);

  class LeesFout extends Error {
    constructor(reden) { super(reden); this.name = 'LeesFout'; }
  }
  const fout = (reden) => { throw new LeesFout(reden); };

  // een tijdstip dat we vertrouwen: na 2000 en niet (veel) in de toekomst
  const geldigeTijd = (ms, nu) => Number.isFinite(ms) && ms >= JAAR_2000 && ms <= nu + 864e5;
  const zonderSlotRegels = (s) => s.replace(/[\r\n]+$/, '');

  function isMemo(bytes) {
    const m = 'MEMOBK2\n';
    if (bytes.length < m.length) return false;
    for (let i = 0; i < m.length; i++) if (bytes[i] !== m.charCodeAt(i)) return false;
    return true;
  }

  /* ---------- MEMOBK2 ---------- */
  function leesMemo(buffer, nu) {
    const n = buffer.byteLength;
    const dv = new DataView(buffer);
    const utf8 = new TextDecoder('utf-8', { fatal: true });
    let p = 0;
    const nodig = (len) => { if (len < 0 || p + len > n) fout('te kort'); };
    const ascii = (len) => {
      nodig(len);
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(p + i));
      p += len;
      return s;
    };
    const u32 = () => { nodig(4); const v = dv.getUint32(p, false); p += 4; return v; };
    const i64 = () => { nodig(8); const v = dv.getBigInt64(p, false); p += 8; return v; };

    if (ascii(8) !== 'MEMOBK2\n') fout('geen MEMOBK2');
    if (u32() !== 2) fout('onbekende versie');
    u32();

    const notes = [];
    let records = 0;
    let verwijderd = 0;
    for (;;) {
      const merk = ascii(4);
      if (merk === 'M2FO') {
        const aantal = u32();
        nodig(32); p += 32;
        if (aantal !== records) fout('aantal records klopt niet');
        if (p !== n) fout('gegevens na de voet');
        break;
      }
      if (merk !== 'M2RC') fout('onbekend blok');
      if (u32() !== records) fout('volgnummer klopt niet');
      const uuidLen = u32();
      if (uuidLen !== 0 && uuidLen !== 36) fout('vreemde uuid-lengte');
      nodig(uuidLen); p += uuidLen;
      const a = i64();
      i64();
      const c = i64();
      i64();
      const len = i64();
      if (len < 0n || len > BigInt(n - p)) fout('tekstlengte buiten het bestand');
      const lengte = Number(len);
      let tekst;
      try { tekst = utf8.decode(new Uint8Array(buffer, p, lengte)); } catch { fout('geen geldige UTF-8'); }
      p += lengte;
      nodig(32); p += 32;
      records++;

      tekst = zonderSlotRegels(tekst);
      const leeg = tekst.trim() === '';
      // A <= 0: door de oude app als verwijderd gemarkeerd (of onbekend): niet importeren
      if (a <= 0n) { if (!leeg) verwijderd++; continue; }
      if (leeg) continue;
      const aangemaakt = Number(a);
      const gewijzigd = Number(c);
      const created = geldigeTijd(aangemaakt, nu) ? aangemaakt : (gewijzigd > 0 && geldigeTijd(gewijzigd, nu) ? gewijzigd : nu);
      const updated = gewijzigd > 0 ? gewijzigd : created;
      notes.push({ text: tekst, created, updated });
    }
    return { notes, verwijderd };
  }

  /* ---------- ons eigen JSON ---------- */
  function leesEigen(data, nu) {
    if (!data || typeof data !== 'object' || data.format !== 'notitieboekje' || data.version !== 1 || !Array.isArray(data.notes)) {
      fout('geen Notitieboekje-bestand');
    }
    const notes = [];
    for (const x of data.notes) {
      if (!x || typeof x !== 'object' || typeof x.text !== 'string') fout('ongeldige notitie');
      const tekst = x.text;
      if (tekst.trim() === '') continue;
      const created = geldigeTijd(Number(x.created), nu) ? Number(x.created) : nu;
      const updated = geldigeTijd(Number(x.updated), nu) ? Number(x.updated) : created;
      const n = { text: tekst, created, updated };
      if (typeof x.id === 'string' && /^[a-z0-9]{1,40}$/i.test(x.id)) n.id = x.id;
      notes.push(n);
    }
    return notes;
  }

  /* ---------- alles samen ---------- */
  // buffer: ArrayBuffer; naam en gewijzigd (ms) van het bestand; nu (ms).
  // Geeft { soort, notes: [{ text, created, updated, id? }], verwijderd } of gooit een LeesFout.
  // verwijderd = aantal overgeslagen verwijderde notities (alleen bij MEMOBK2).
  function lees(buffer, naam, gewijzigd, nu) {
    nu = nu || Date.now();
    if (!buffer || buffer.byteLength > MAX_BYTES) fout('te groot of leeg');
    const bytes = new Uint8Array(buffer);
    if (isMemo(bytes)) {
      const m = leesMemo(buffer, nu);
      return { soort: 'memo', notes: m.notes, verwijderd: m.verwijderd };
    }

    let tekst;
    try { tekst = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fout('geen tekst'); }
    if (tekst.charCodeAt(0) === 0xFEFF) tekst = tekst.slice(1);
    if (tekst.includes('\u0000')) fout('binair bestand');
    const isJsonNaam = /\.json$/i.test(naam || '');
    const begin = tekst.trimStart();
    if (begin.startsWith('{') || isJsonNaam) {
      let data = null;
      try { data = JSON.parse(tekst); } catch { if (isJsonNaam) fout('geen geldige JSON'); }
      if (data !== null) {
        if (data && data.format === 'notitieboekje') return { soort: 'json', notes: leesEigen(data, nu), verwijderd: 0 };
        if (isJsonNaam) fout('onbekend JSON-bestand');
      }
    }
    if (/\.memo$/i.test(naam || '')) fout('geen MEMOBK2');
    // gewoon tekstbestand: één blaadje
    const t = zonderSlotRegels(tekst);
    if (t.trim() === '') return { soort: 'txt', notes: [], verwijderd: 0 };
    const tijd = geldigeTijd(Number(gewijzigd), nu) ? Number(gewijzigd) : nu;
    return { soort: 'txt', notes: [{ text: t, created: tijd, updated: tijd }], verwijderd: 0 };
  }

  function maakExport(notities, nu) {
    return {
      format: 'notitieboekje',
      version: 1,
      exported: new Date(nu).toISOString(),
      notes: notities.map((n) => ({ id: n.id, text: n.t, created: n.c, updated: n.u })),
    };
  }

  root.NB_IMPORT = { lees, leesMemo, maakExport, LeesFout };
})(typeof self !== 'undefined' ? self : globalThis);
