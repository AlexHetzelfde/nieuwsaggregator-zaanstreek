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
const { scoorBericht } = require("./score");
const { beoordeelBerichten } = require("./gemini");

const DATA_MAP = path.join(__dirname, "..", "data");
const DAGCAP_GEMINI = Number(process.env.DAGCAP_GEMINI || 40);

const SCRAPER_PER_TYPE = {
  "wordpress-html": scrapeWordpress,
  ibabs: scrapeIbabs,
  rss: scrapeRss,
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

function filterOpVandaag(berichten) {
  // "De scraper hoeft alleen alles van die dag te scrapen": we filteren hier
  // op berichten van vandaag OF zonder betrouwbare datum (fallback — beter
  // een bericht te veel meenemen dan een echt nieuw bericht missen omdat een
  // bron geen datum meegeeft).
  const vandaag = new Date();
  vandaag.setHours(0, 0, 0, 0);

  return berichten.filter((b) => {
    if (!b.gepubliceerdOp) return true; // geen datum bekend -> voorzichtigheidshalve meenemen
    return new Date(b.gepubliceerdOp) >= vandaag;
  });
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

  // Stap 1b: dedupliceren + alleen vandaag (per bron al een "nieuw vandaag"-
  // proxy via URL-dedup, plus een datumfilter als extra check)
  const berichtenVanVandaag = verwijderDubbelen(filterOpVandaag(ruweBerichten));

  // Stap 2: tellen, vóórdat de AI wordt aangeroepen
  console.log(`Totaal aantal nieuwe berichten vandaag: ${berichtenVanVandaag.length}`);

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
