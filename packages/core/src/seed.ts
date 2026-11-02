import { postArt, type ArtMotif } from './art.js';
import type { Services } from './services.js';
import type { Actor, Network } from './types.js';

// Ukázková data pro demo. Všechny firmy, lidé a domény jsou smyšlené (.example je rezervovaná doména).
// Data vznikají přes skutečné služby: posty projdou kontrolou značky, schválením i publikací.

export interface SeedClock {
  /** Nastaví hodiny služeb na daný okamžik; null = zpět na reálný čas. */
  set(iso: string | null): void;
}

export interface SeedResult {
  agencyId: string;
  personas: { key: 'owner' | 'manager' | 'client'; userId: string; name: string; email: string; label: string }[];
}

type PostSpec = { brand: 'pek' | 'fit' | 'nov'; day: number; hour: number; title: string; body: string; networks: Network[] };

const DAY = 864e5;

export async function seedDemo(s: Services, clock: SeedClock, today: Date = new Date()): Promise<SeedResult> {
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 8, 0);
  const at = (dayOffset: number, hour = 9) => new Date(base + dayOffset * DAY + (hour - 8) * 3600e3).toISOString();

  clock.set(at(-75));
  const { agency, user: ownerUser } = await s.tenancy.registerAgency({
    agencyName: 'Studio Dobrý Den', ownerEmail: 'tereza@studio-dobryden.example', ownerName: 'Tereza Nováková',
  });
  const owner = await s.tenancy.resolveActor(ownerUser.id, agency.id);
  const mgrM = await s.tenancy.inviteMember(owner, { email: 'marek@studio-dobryden.example', name: 'Marek Dvořák', role: 'manager' });
  const manager = await s.tenancy.resolveActor(mgrM.userId, agency.id);

  const cPek = await s.catalog.createClient(owner, { name: 'Pekárna U Lípy', contactEmail: 'jana@pekarna-ulipy.example' });
  const cFit = await s.catalog.createClient(owner, { name: 'FitZóna Brno', contactEmail: 'petr@fitzona.example' });
  const cNov = await s.catalog.createClient(owner, { name: 'Novák & syn stavby', contactEmail: 'info@novak-stavby.example' });

  const pek = await s.catalog.createBrand(owner, {
    clientId: cPek.id, name: 'Pekárna U Lípy',
    profile: {
      tone: 'Vřelý, rodinný, s chutí. Tykáme. Krátké věty, žádné superlativy.',
      audience: 'Rodiny a lidé z okolí, 25–55 let, kteří si potrpí na poctivé pečivo.',
      bannedWords: ['nejlevnější', 'akce!!!', 'průmyslové'],
      examples: ['Ranní dávka kváskového chleba je venku z pece. Do 9:00 ho máme ještě teplý. 🍞'],
      defaultHashtags: ['#pekarnaulipy', '#kvas'], maxHashtags: 3, languages: ['cs'], emoji: 'few', color: '#c2410c',
    },
  });
  const fit = await s.catalog.createBrand(owner, {
    clientId: cFit.id, name: 'FitZóna',
    profile: {
      tone: 'Energický a povzbudivý, bez body-shamingu. Tykáme.',
      audience: 'Lidé 20–45 let v Brně, začátečníci i pokročilí.',
      bannedWords: ['hubnutí zaručeno', 'rychle zhubnout', 'dokonalé tělo'],
      examples: ['Nemusíš být fit, abys začal. Stačí přijít. Úterní lekce pro začátečníky má ještě 3 volná místa.'],
      defaultHashtags: ['#fitzonabrno', '#brno'], maxHashtags: 4, languages: ['cs'], emoji: 'many', color: '#16a34a',
    },
  });
  const nov = await s.catalog.createBrand(owner, {
    clientId: cNov.id, name: 'Novák Stavby',
    profile: {
      tone: 'Věcný a odborný. Vykáme. Konkrétní čísla místo přívlastků.',
      audience: 'Investoři, developeři a majitelé domů, 35–65 let.',
      bannedWords: ['levně', 'super'],
      examples: ['Dokončili jsme hrubou stavbu bytového domu v Líšni: 24 jednotek, 7 měsíců, bez skluzu.'],
      defaultHashtags: ['#stavebnictvi'], maxHashtags: 2, languages: ['cs'], emoji: 'none', color: '#1d4ed8',
    },
  });

  for (const [b, nets] of [[pek, ['facebook', 'instagram']], [fit, ['facebook', 'instagram', 'linkedin']], [nov, ['facebook', 'linkedin']]] as const) {
    for (const n of nets) {
      await s.catalog.connectAccount(owner, { brandId: b.id, network: n, handle: `@${b.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '')}` });
    }
  }

  const jana = await s.tenancy.inviteMember(owner, { email: 'jana@pekarna-ulipy.example', name: 'Jana Lípová', role: 'client', clientId: cPek.id });
  const petr = await s.tenancy.inviteMember(owner, { email: 'petr@fitzona.example', name: 'Petr Svoboda', role: 'client', clientId: cFit.id });
  const pavel = await s.tenancy.inviteMember(owner, { email: 'pavel@novak-stavby.example', name: 'Pavel Novák', role: 'client', clientId: cNov.id });
  const clients: Record<'pek' | 'fit' | 'nov', Actor> = {
    pek: await s.tenancy.resolveActor(jana.userId, agency.id),
    fit: await s.tenancy.resolveActor(petr.userId, agency.id),
    nov: await s.tenancy.resolveActor(pavel.userId, agency.id),
  };
  const brands = { pek, fit, nov };
  const motifs: Record<string, ArtMotif> = { [pek.id]: 'bakery', [fit.id]: 'fitness', [nov.id]: 'build' };
  const colorOf: Record<string, string> = { [pek.id]: pek.profile.color, [fit.id]: fit.profile.color, [nov.id]: nov.profile.color };
  // Ukázkové posty dostanou ilustraci v barvě značky (prázdný koncept ne).
  const createPost: Services['content']['createPost'] = (a, input) =>
    s.content.createPost(a, {
      ...input,
      media: input.media ?? (input.body ? [{ id: `art-${input.title}`, kind: 'image', url: postArt(input.title ?? input.body, colorOf[input.brandId]!, motifs[input.brandId]!), alt: input.title ?? '' }] : []),
    });

  // ---------- Historie: publikované posty za poslední ~2,5 měsíce ----------
  const history: PostSpec[] = [
    { brand: 'pek', day: -70, hour: 7, title: 'Kváskový chléb každé ráno', networks: ['facebook', 'instagram'], body: 'Kváskový chléb z naší pece je každé ráno od 6:30. Žádné zrychlovače, jen mouka, voda, sůl a čas. 🍞\n\n#pekarnaulipy #kvas' },
    { brand: 'pek', day: -61, hour: 15, title: 'Podzimní dýňové koláče', networks: ['facebook', 'instagram'], body: 'Dýně z farmy od Hrušek se proměnila v koláče. Jsou u nás do neděle, pak už zase až za rok.\n\n#pekarnaulipy' },
    { brand: 'pek', day: -48, hour: 8, title: 'Pekař Tonda slaví 20 let', networks: ['facebook'], body: 'Tonda u nás peče dvacet let. Za tu dobu vytáhl z pece odhadem 400 000 bochníků. Díky, Tondo! 🙌' },
    { brand: 'pek', day: -33, hour: 7, title: 'Nové otevírací hodiny', networks: ['facebook', 'instagram'], body: 'Od listopadu otevíráme už v 6:00. Ať stihneš čerstvé rohlíky i před prací.\n\n#pekarnaulipy' },
    { brand: 'pek', day: -19, hour: 16, title: 'Svatomartinské rohlíčky', networks: ['facebook', 'instagram'], body: 'Svatomartinské rohlíčky s mákem a povidly jsou zpět. Upečeme jich 300 denně, tak přijď včas. 🥐\n\n#pekarnaulipy #svatymartin' },
    { brand: 'pek', day: -6, hour: 7, title: 'Žitný chléb se semínky', networks: ['instagram'], body: 'Novinka: žitný chléb se slunečnicí a lnem. Vydrží měkký i tři dny.\n\n#pekarnaulipy #kvas' },
    { brand: 'fit', day: -66, hour: 18, title: 'Začátečnická lekce v úterý', networks: ['facebook', 'instagram'], body: 'Nemusíš být fit, abys začal. Úterní lekce pro začátečníky v 18:00 je přesně pro tebe. 💪\n\n#fitzonabrno #brno' },
    { brand: 'fit', day: -52, hour: 12, title: 'Hledáme trenéra/trenérku', networks: ['linkedin', 'facebook'], body: 'Rozšiřujeme tým! Hledáme trenéra nebo trenérku funkčního tréninku na plný úvazek v Brně-Židenicích. Ozvi se na kariera@fitzona.example.\n\n#fitzonabrno #prace' },
    { brand: 'fit', day: -40, hour: 7, title: 'Ranní běh s FitZónou', networks: ['instagram'], body: 'Každou sobotu v 8:00 běháme z Lužánek. 5 km, tempo pro všechny, kafe po doběhu. ☕🏃\n\n#fitzonabrno #brno #beh' },
    { brand: 'fit', day: -27, hour: 17, title: 'Příběh Hanky', networks: ['facebook', 'instagram'], body: 'Hanka k nám před rokem přišla po operaci kolene. Dnes dřepuje se 40 kg a minulý měsíc uběhla svou první desítku. 🔥\n\n#fitzonabrno' },
    { brand: 'fit', day: -12, hour: 18, title: 'Nová sauna', networks: ['facebook', 'instagram'], body: 'Hotovo! Nová finská sauna je otevřená každý den od 16:00. Pro členy v ceně permanentky. 🧖\n\n#fitzonabrno #brno' },
    { brand: 'fit', day: -3, hour: 12, title: 'Firemní členství', networks: ['linkedin'], body: 'Firemní členství FitZóna: jedna faktura, přístup pro celý tým a úvodní konzultace s trenérem zdarma. Napište si o nabídku.\n\n#fitzonabrno #benefity' },
    { brand: 'nov', day: -58, hour: 10, title: 'Hrubá stavba v Líšni', networks: ['linkedin', 'facebook'], body: 'Dokončili jsme hrubou stavbu bytového domu v Brně-Líšni: 24 jednotek, 7 měsíců, bez skluzu harmonogramu.\n\n#stavebnictvi' },
    { brand: 'nov', day: -37, hour: 10, title: 'Rekonstrukce školy v Kuřimi', networks: ['linkedin'], body: 'Zahájili jsme rekonstrukci ZŠ v Kuřimi. Výuka pokračuje bez přerušení, hlučné práce plánujeme na odpoledne a víkendy.\n\n#stavebnictvi' },
    { brand: 'nov', day: -15, hour: 10, title: 'Nová pasivní hala', networks: ['linkedin', 'facebook'], body: 'Pro klienta z Modřic stavíme halu v pasivním standardu. Spotřeba na vytápění 12 kWh/m² za rok, předání v březnu.\n\n#stavebnictvi' },
  ];

  for (const h of history) {
    await publishAt(h);
  }

  async function publishAt(h: PostSpec) {
    const b = brands[h.brand];
    clock.set(at(h.day - 3, 10));
    const p = await createPost(manager, { brandId: b.id, title: h.title, body: h.body, networks: h.networks, aiAssisted: h.day % 2 === 0 });
    await s.content.submitForApproval(manager, p.id);
    clock.set(at(h.day - 2, 14));
    await s.content.decide(clients[h.brand], p.id, 'approved');
    clock.set(at(h.day - 1, 9));
    await s.content.schedule(manager, p.id, at(h.day, h.hour));
    clock.set(at(h.day, h.hour) .replace(':00.000Z', ':01.000Z'));
    await s.publishing.runDue();
  }

  // ---------- Současnost ----------
  clock.set(at(-1, 15));
  // Čeká na schválení klientem
  const r1 = await createPost(manager, {
    brandId: pek.id, title: 'Vánoční cukroví na objednávku', networks: ['facebook', 'instagram'], aiAssisted: true,
    body: 'Letos poprvé pečeme vánoční cukroví i na objednávku. Kilo směsi z 12 druhů, vyzvednutí od 18. prosince. Objednávky přijímáme v prodejně do 10. 12. 🎄\n\n#pekarnaulipy #cukrovi',
    scheduledAt: at(4, 8),
  });
  await s.content.submitForApproval(manager, r1.id, { note: 'Jano, cenu doplníme, až ji potvrdíš.' });
  const r2 = await createPost(manager, {
    brandId: fit.id, title: 'Vánoční dárkové poukazy', networks: ['facebook', 'instagram'],
    body: 'Dej pod stromeček pohyb! 🎁 Dárkové poukazy na 10 vstupů nebo měsíční permanentku koupíš na recepci i online.\n\n#fitzonabrno #darek',
    scheduledAt: at(3, 17),
  });
  await s.content.submitForApproval(manager, r2.id);

  // Vráceno k úpravě
  const r3 = await createPost(manager, {
    brandId: nov.id, title: 'Den otevřených dveří na stavbě', networks: ['linkedin', 'facebook'],
    body: 'Zveme vás na den otevřených dveří na stavbě bytového domu v Líšni. Provedeme vás stavbou a ukážeme technologie, které používáme.\n\n#stavebnictvi',
    scheduledAt: at(9, 10),
  });
  await s.content.submitForApproval(manager, r3.id);
  clock.set(at(0, 8));
  await s.content.decide(clients.nov, r3.id, 'changes_requested', 'Prosím doplňte datum (sobota 14. 12.) a že je nutná registrace kvůli bezpečnosti.');

  // Schváleno a naplánováno
  clock.set(at(-2, 11));
  const sch = await createPost(manager, {
    brandId: fit.id, title: 'Večerní běh s čelovkami', networks: ['facebook', 'instagram'], aiAssisted: true,
    body: 'Tma nás nezastaví! Ve středu v 19:00 vybíháme z Lužánek na večerní běh s čelovkami. 5 km, tempo pro všechny, čelovky půjčíme. 🔦🏃\n\n#fitzonabrno #brno #beh',
  });
  await s.content.submitForApproval(manager, sch.id);
  await s.content.decide(clients.fit, sch.id, 'approved');
  await s.content.schedule(manager, sch.id, at(2, 18));

  const sch2 = await createPost(manager, {
    brandId: pek.id, title: 'Perníčky s dětmi', networks: ['facebook'],
    body: 'V sobotu od 10:00 zdobíme perníčky s dětmi přímo v pekárně. Zástěry půjčíme, poleva je na nás. 🙌',
  });
  await s.content.submitForApproval(manager, sch2.id);
  await s.content.decide(clients.pek, sch2.id, 'approved');
  await s.content.schedule(manager, sch2.id, at(5, 9));

  // Schváleno, čeká na naplánování
  const ap = await createPost(manager, {
    brandId: nov.id, title: 'PF 2027', networks: ['linkedin'],
    body: 'Děkujeme investorům, projektantům i subdodavatelům za spolupráci v roce 2026. Do nového roku přejeme pevné základy.\n\n#stavebnictvi',
  });
  await s.content.submitForApproval(manager, ap.id);
  await s.content.decide(clients.nov, ap.id, 'approved');

  // Koncepty
  await createPost(manager, {
    brandId: fit.id, title: 'Novoroční předsevzetí', networks: ['instagram'], scheduledAt: at(12, 7),
    body: 'Předsevzetí, která vydrží: místo „budu chodit každý den“ zkus „přijdu 2× týdně“. ',
  });
  await createPost(manager, { brandId: pek.id, title: 'Tříkrálový koláč', networks: ['facebook', 'instagram'], body: '' });
  await createPost(manager, {
    brandId: fit.id, title: 'Permanentka na 3 měsíce', networks: ['facebook', 'instagram'],
    body: 'Nový rok, nová rutina. Tříměsíční permanentka teď s úvodní konzultací u trenéra v ceně. 💪\n\n#fitzonabrno',
  });
  await createPost(manager, {
    brandId: nov.id, title: 'Referenční stavba: hala Modřice', networks: ['linkedin'],
    body: 'Hala v Modřicích v pasivním standardu je pod střechou. Spotřeba na vytápění 12 kWh/m² za rok.\n\n#stavebnictvi',
  });

  clock.set(null);
  await s.reports.collectMetrics(agency.id);

  return {
    agencyId: agency.id,
    personas: [
      { key: 'owner', userId: ownerUser.id, name: 'Tereza Nováková', email: 'tereza@studio-dobryden.example', label: 'Majitelka agentury' },
      { key: 'manager', userId: manager.userId, name: 'Marek Dvořák', email: 'marek@studio-dobryden.example', label: 'Social media manažer' },
      { key: 'client', userId: jana.userId, name: 'Jana Lípová', email: 'jana@pekarna-ulipy.example', label: 'Klientka – Pekárna U Lípy' },
    ],
  };
}
