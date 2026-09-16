// index.js — hoofdscript van de dagelijkse run
//
// Volgorde (zoals besproken):
// 1. Alles scrapen (per bron, met eigen scraper-type)
// 2. Tellen hoeveel berichten er zijn, VOORDAT Gemini wordt aangeroepen
// 3. Scoren (score.js) — puntensysteem als sorteersignaal, geen filter
// 4. Splitsen in lokaal/landelijk en sorteren op score
// 5. Per bericht een Gemini-call met de juiste prompt (met dagcap)
// 6. Top-5 pitches bepalen en alles wegschrijven naar /data voor de front-end

const fs = require("fs/promises");
const path = require("path");

const bronnen = require("./bronnen");
const { scrapeWordpress } = require("./scrapers/wordpress-html");
const { scrapeIbabs } = require("./scrapers/ibabs");
const { scrapeRss } = require("./scrapers/rss");
const { scrapeGeneriekeLijst } = require("./scrapers/generieke-lijst");
const { scoorBericht } = require("./score");
const { beoordeelBerichten } = require("./gemini");

const DATA_MAP = path.join(__dirname, "..", "data");
const DAGCAP_GEMINI = Number(process.env.DAGCAP_GEMINI || 40);

const SCRAPER_PER_TYPE = {
  "wordpress-html": scrapeWordpress,
  ibabs: scrapeIbabs,
  rss: scrapeRss,
  "generieke-lijst": scrapeGeneriekeLijst,
};

async function scrapeAlleBronnen() {
  const alleBerichten = [];

  for (const bron of bronnen) {
    const scraper = SCRAPER_PER_TYPE[bron.type];
    if (!scraper) {
      console.warn(`Onbekend brontype "${bron.type}" voor bron ${bron.id} — overgeslagen.`);
      continue;
    }

    try {
      const berichten = await scraper(bron);
      console.log(`[${bron.id}] ${berichten.length} bericht(en) gevonden.`);
      alleBerichten.push(...berichten);
    } catch (fout) {
      // Eén kapotte bron mag de hele dagelijkse run niet laten crashen.
      console.error(`[${bron.id}] Scrapen mislukt: ${fout.message}`);
    }
  }

  return alleBerichten;
}

const GEZIENE_URLS_BESTAND = path.join(DATA_MAP, "geziene-urls.json");

async function laadGezieneUrls() {
  try {
    const inhoud = await fs.readFile(GEZIENE_URLS_BESTAND, "utf-8");
    return new Set(JSON.parse(inhoud));
  } catch {
    return new Set(); // eerste keer draaien, of bestand nog niet aanwezig
  }
}

async function schrijfGezieneUrls(set) {
  await fs.mkdir(DATA_MAP, { recursive: true });
  // Cap op 5000 URL's zodat dit bestand niet oneindig blijft groeien —
  // de oudste worden simpelweg niet meer bijgehouden (Set behoudt invoegvolgorde).
  const array = Array.from(set).slice(-5000);
  await fs.writeFile(GEZIENE_URLS_BESTAND, JSON.stringify(array, null, 2), "utf-8");
}

function filterOpNieuw(berichten, gezieneUrls) {
  // "Nieuw" = URL nog niet eerder gezien in een vorige run. Dit werkt beter
  // dan een datumfilter voor bronnen die onregelmatig posten (zoals
  // zaanschemolen.nl, die soms weken niks plaatst) en voor de iBabs-lijsten,
  // die geen betrouwbare "gepubliceerd vandaag"-datum hebben.
  return berichten.filter((b) => b.url && !gezieneUrls.has(b.url));
}

function verwijderDubbelen(berichten) {
  const geziereUrls = new Set();
  return berichten.filter((b) => {
    if (!b.url || geziereUrls.has(b.url)) return false;
    geziereUrls.add(b.url);
    return true;
  });
}

async function schrijfJson(bestandsnaam, data) {
  await fs.mkdir(DATA_MAP, { recursive: true });
  await fs.writeFile(path.join(DATA_MAP, bestandsnaam), JSON.stringify(data, null, 2), "utf-8");
}

async function main() {
  console.log("Start dagelijkse run:", new Date().toISOString());

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      "GEMINI_API_KEY is niet gezet — de scrape- en scorestap draaien gewoon door, " +
        "maar er worden geen AI-beoordelingen/pitches gegenereerd."
    );
  }

  // Stap 1: scrapen
  const ruweBerichten = await scrapeAlleBronnen();

  // Stap 1b: dedupliceren binnen deze run + alleen berichten die we nog
  // niet eerder (in een vorige run) hebben gezien.
  const gezieneUrls = await laadGezieneUrls();
  const berichtenVanVandaag = filterOpNieuw(verwijderDubbelen(ruweBerichten), gezieneUrls);

  // Stap 2: tellen, vóórdat de AI wordt aangeroepen
  console.log(`Totaal aantal nieuwe berichten vandaag: ${berichtenVanVandaag.length}`);

  // Meteen bijwerken welke URL's we nu gezien hebben, zodat een eventuele
  // latere fout in dit script niet leidt tot het dubbel verwerken van
  // dezelfde berichten bij de volgende run.
  berichtenVanVandaag.forEach((b) => gezieneUrls.add(b.url));
  await schrijfGezieneUrls(gezieneUrls);

  // Stap 3: scoren
  const gescoordeBerichten = berichtenVanVandaag.map(scoorBericht);

  // Stap 4: splitsen + sorteren op score (hoog naar laag)
  const lokaal = gescoordeBerichten
    .filter((b) => b.categorie === "lokaal")
    .sort((a, b) => b.score - a.score);
  const landelijk = gescoordeBerichten
    .filter((b) => b.categorie === "landelijk")
    .sort((a, b) => b.score - a.score);

  console.log(`Lokaal: ${lokaal.length} berichten. Landelijk: ${landelijk.length} berichten.`);

  // Altijd de volledige (gescoorde, niet-beoordeelde) lijsten wegschrijven,
  // ook als er geen Gemini-key is — zodat de front-end nooit leeg staat.
  await schrijfJson("nieuws-lokaal.json", lokaal);
  await schrijfJson("nieuws-landelijk.json", landelijk);

  if (!apiKey) {
    console.log("Klaar (zonder AI-beoordeling).");
    return;
  }

  // Stap 5: Gemini-beoordeling, met dagcap per lijst
  const lokaalBeoordeeld = await beoordeelBerichten(lokaal, apiKey, DAGCAP_GEMINI);
  const landelijkBeoordeeld = await beoordeelBerichten(landelijk, apiKey, DAGCAP_GEMINI);

  await schrijfJson("nieuws-lokaal.json", lokaalBeoordeeld);
  await schrijfJson("nieuws-landelijk.json", landelijkBeoordeeld);

  // Stap 6: top-5 pitches bepalen voor de voorkant van de site.
  // "Oppakbaar" telt als: lokaal -> aiBeoordeling.oppakbaar === "ja";
  // landelijk -> aiBeoordeling.lokaleInvalshoek === "ja".
  const kansrijkeLokaal = lokaalBeoordeeld.filter((b) => b.aiBeoordeling?.oppakbaar === "ja");
  const kansrijkLandelijk = landelijkBeoordeeld.filter((b) => b.aiBeoordeling?.lokaleInvalshoek === "ja");

  const top5Pitches = [...kansrijkeLokaal, ...kansrijkLandelijk]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  await schrijfJson("pitches.json", {
    gegenereerdOp: new Date().toISOString(),
    aantalBerichtenTotaal: berichtenVanVandaag.length,
    top5: top5Pitches,
  });

  console.log(`Klaar. ${top5Pitches.length} pitch(es) klaargezet.`);
}

main().catch((fout) => {
  console.error("Onverwachte fout in de dagelijkse run:", fout);
  process.exit(1);
});
