// Maakt een SYNTHETISCH MEMOBK2-bestand (de back-up van een andere notitie-app) voor de testen.
// Alle teksten zijn verzonnen. Opbouw (big-endian):
//   "MEMOBK2\n", uint32 2, uint32 0
//   per record: "M2RC", uint32 volgnummer, uint32 uuid-lengte, uuid, int64 A, int64 0, int64 C,
//               int64 1, int64 tekstlengte, tekst (UTF-8), 32 bytes hash
//   "M2FO", uint32 aantal, 32 bytes controlegetal
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function maakMemo(records, opties = {}) {
  const delen = [];
  const kop = Buffer.alloc(16);
  kop.write('MEMOBK2\n', 0, 'latin1');
  kop.writeUInt32BE(opties.versie ?? 2, 8);
  kop.writeUInt32BE(0, 12);
  delen.push(kop);
  records.forEach((r, i) => {
    const uuid = r.uuid ? Buffer.from(UUID, 'latin1') : Buffer.alloc(0);
    const tekst = Buffer.from(r.text, 'utf8');
    const b = Buffer.alloc(12 + uuid.length + 40 + tekst.length + 32);
    let p = 0;
    b.write('M2RC', p, 'latin1'); p += 4;
    b.writeUInt32BE(i, p); p += 4;
    b.writeUInt32BE(uuid.length, p); p += 4;
    uuid.copy(b, p); p += uuid.length;
    b.writeBigInt64BE(BigInt(r.a), p); p += 8;
    b.writeBigInt64BE(0n, p); p += 8;
    b.writeBigInt64BE(BigInt(r.c || 0), p); p += 8;
    b.writeBigInt64BE(1n, p); p += 8;
    b.writeBigInt64BE(BigInt(r.lengte ?? tekst.length), p); p += 8;
    tekst.copy(b, p); p += tekst.length;
    b.fill(0xab, p, p + 32);
    delen.push(b);
  });
  const voet = Buffer.alloc(40);
  voet.write('M2FO', 0, 'latin1');
  voet.writeUInt32BE(opties.aantal ?? records.length, 4);
  voet.fill(0xcd, 8);
  delen.push(voet);
  return Buffer.concat(delen);
}

// Een voorbeeld met alle randgevallen. Tijden zijn vast, zodat de testen ze kunnen nagaan.
const T = {
  boodschappen: Date.UTC(2026, 8, 20, 9, 30),
  tandarts: Date.UTC(2026, 8, 10, 14, 0),
  tandartsGewijzigd: Date.UTC(2026, 8, 12, 8, 15),
  oud: Date.UTC(2021, 2, 3, 12, 0),        // positief opgeslagen (leest als 1918 met -A)
  raar: Date.UTC(2023, 5, 6, 7, 8),        // alleen C klopt
};
const VOORBEELD = [
  { text: 'Boodschappen\nmelk\nbrood\n', a: -T.boodschappen },
  { text: 'Tandarts vrijdag 10u', a: -T.tandarts, c: T.tandartsGewijzigd, uuid: true },
  { text: 'Café crème, ½ liter, € 3,50', a: -(T.boodschappen - 60000) },
  { text: '🎉 Feestje 👨‍👩‍👧 zaterdag\n\n', a: -(T.boodschappen - 120000), uuid: true },
  { text: 'مرحبا بالعالم\nسطر ثان', a: -(T.boodschappen - 180000) },
  { text: '\n\n', a: -(T.boodschappen - 240000) },            // leeg na inkorten: overslaan
  { text: 'Boodschappen\nmelk\nbrood', a: -(T.boodschappen - 300000) },   // zelfde tekst: dubbel
  { text: 'Rare datum, wel een wijzigtijd', a: -5000, c: T.raar },
  { text: 'Oud briefje van lang geleden', a: T.oud },
];

module.exports = { maakMemo, VOORBEELD, T };
