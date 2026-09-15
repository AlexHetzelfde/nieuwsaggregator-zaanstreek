// hulpmiddelen.js
// Gedeelde functies die door meerdere scrapers gebruikt worden.

const Parser = require("rss-parser");
const rssParser = new Parser();

const GEBRUIKERSAGENT =
  "NieuwsaggregatorZaanstreekBot/1.0 (+journalistiek studentenproject; contact via github repo)";

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
      console.warn(`Poging ${poging}/${pogingen} mislukt voor ${url}: ${fout.message}`);
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

module.exports = { haalOp, parseerRssTekst, GEBRUIKERSAGENT };
