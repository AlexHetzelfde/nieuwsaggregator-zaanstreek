// hulpmiddelen.js
// Gedeelde functies die door meerdere scrapers gebruikt worden.

const Parser = require("rss-parser");
const rssParser = new Parser();

const GEBRUIKERSAGENT =
  "NieuwsaggregatorZaanstreekBot/1.0 (+journalistiek studentenproject; contact via github repo)";

// Centrale leeftijdsgrens: berichten ouder dan dit worden nergens meegenomen.
// Dit staat hier, op ÉÉN plek, en wordt door zowel index.js (als centrale,
// gezaghebbende filter voor ALLE bronnen) als door ibabs.js (als vroege
// filter, vóór het dure documentinhoud-ophalen) gebruikt — nooit los
// gedupliceerd per scraper.
const MAX_LEEFTIJD_DAGEN = 7;

/**
 * True als een datum binnen de leeftijdsgrens valt. Een bericht ZONDER
 * betrouwbaar herkende datum telt hier bewust als "te oud"/niet toegestaan —
 * niet als "onbekend dus maar meenemen". Dat laatste zorgde er in de praktijk
 * voor dat een kapotte datumherkenning van een bron (zoals gebeurde bij de
 * WordPress-fallback en bij één van de iBabs-rapporten) onopgemerkt bleef en
 * alle historische berichten liet doorsijpelen in plaats van alleen recente.
 * Een bron waarvan structureel geen datum wordt herkend, levert nu dus 0
 * berichten op — zichtbaar fout, in plaats van onzichtbaar fout.
 */
function binnenLeeftijdsgrens(gepubliceerdOpIso) {
  if (!gepubliceerdOpIso) return false;
  const datum = new Date(gepubliceerdOpIso);
  if (isNaN(datum.getTime())) return false;
  const grens = Date.now() - MAX_LEEFTIJD_DAGEN * 24 * 60 * 60 * 1000;
  return datum.getTime() >= grens;
}

/**
 * Leeftijd van een bericht in dagen (kan een fractie zijn), of null als er
 * geen betrouwbare datum is. Wordt door score.js gebruikt voor de
 * recency-bonus.
 */
function leeftijdInDagen(gepubliceerdOpIso) {
  if (!gepubliceerdOpIso) return null;
  const datum = new Date(gepubliceerdOpIso);
  if (isNaN(datum.getTime())) return null;
  return (Date.now() - datum.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Node's ingebouwde fetch (undici) gooit bij netwerkproblemen bijna altijd
 * alleen de generieke `TypeError: fetch failed` als `.message` — de échte
 * reden (DNS, timeout, connectie geweigerd, TLS-probleem, ...) zit dan in
 * `.cause`, die door Node zelf NIET wordt meegeprint met `fout.message`.
 * Deze helper haalt die oorzaak eruit zodat we hem overal waar we een
 * fetch-fout loggen ook echt kunnen zien, in plaats van alleen "fetch
 * failed" zonder verdere context.
 */
function oorzaakTekst(fout) {
  const oorzaak = fout && fout.cause;
  if (!oorzaak) return "";
  const code = oorzaak.code ? ` [${oorzaak.code}]` : "";
  const tekst = oorzaak.message || String(oorzaak);
  return ` — oorzaak: ${tekst}${code}`;
}

/**
 * Haalt een URL op met een nette user-agent en duidelijke timeout/foutmelding.
 * Wordt door alle scrapers gebruikt zodat we op één plek retry-/timeoutlogica
 * kunnen aanpassen.
 */
async function haalOp(url, pogingen = 3) {
  let laatsteFout;
  for (let poging = 1; poging <= pogingen; poging++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, {
        headers: { "User-Agent": GEBRUIKERSAGENT },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} voor ${url}`);
      }
      return await response.text();
    } catch (fout) {
      laatsteFout = fout;
      console.warn(`Poging ${poging}/${pogingen} mislukt voor ${url}: ${fout.message}${oorzaakTekst(fout)}`);
      if (poging < pogingen) {
        await nieuweWacht(1000 * poging); // simpele backoff: 1s, 2s, 3s...
      }
    }
  }
  throw laatsteFout;
}

function nieuweWacht(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parset RSS-XML-tekst naar een lijst van genormaliseerde berichtobjecten.
 * Elk <item> wordt hier al een los, duidelijk gescheiden bericht (zie ook
 * scrapers/rss.js) — dit is dus het punt waarop "elk nieuwsbericht duidelijk
 * gescheiden" in de RSS wordt gegarandeerd.
 */
async function parseerRssTekst(tekst, bron) {
  const feed = await rssParser.parseString(tekst);
  return (feed.items || []).map((item) => ({
    bronId: bron.id,
    bronNaam: bron.naam,
    categorie: bron.categorie,
    titel: (item.title || "").trim(),
    url: item.link || "",
    samenvatting: schoonmakenSamenvatting(item.contentSnippet || item.content || ""),
    gepubliceerdOp: item.isoDate || item.pubDate || null,
    opgehaaldOp: new Date().toISOString(),
  }));
}

function schoonmakenSamenvatting(tekst) {
  return tekst.replace(/\s+/g, " ").trim().slice(0, 600);
}

module.exports = {
  haalOp,
  parseerRssTekst,
  oorzaakTekst,
  GEBRUIKERSAGENT,
  MAX_LEEFTIJD_DAGEN,
  binnenLeeftijdsgrens,
  leeftijdInDagen,
};
