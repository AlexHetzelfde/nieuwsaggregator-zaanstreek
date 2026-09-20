// scrapers/gemini-recept.js
//
// Generieke scraper voor bronnen die zijn toegevoegd via voeg-bron-toe.js.
// Gebruikt het eenmalig door Gemini gegenereerde "recept" (CSS-selectors,
// opgeslagen in bronnen.js bij bron.selectors) om dagelijks te scrapen —
// puur met cheerio, geen Gemini-aanroep per dag nodig.

const cheerio = require("cheerio");
const { haalOp } = require("../hulpmiddelen");

async function scrapeGeminiRecept(bron) {
  if (!bron.selectors) {
    console.error(`[${bron.id}] Geen 'selectors' gevonden in bronnen.js voor dit gemini-recept-type — bron overgeslagen.`);
    return [];
  }

  const html = await haalOp(bron.url);
  const $ = cheerio.load(html);
  const { itemSelector, titelSelector, linkSelector, datumSelector, datumAttribuut } = bron.selectors;

  const berichten = [];
  $(itemSelector).each((_, el) => {
    const titelEl = titelSelector ? $(el).find(titelSelector).first() : $(el);
    const titel = titelEl.text().trim();
    if (!titel) return;

    let link = null;
    if (linkSelector === "self") {
      link = titelEl.is("a") ? titelEl.attr("href") : titelEl.find("a").attr("href");
    } else if (linkSelector) {
      link = $(el).find(linkSelector).attr("href");
    }
    if (!link) return;

    let datumTekst = null;
    if (datumSelector) {
      const datumEl = $(el).find(datumSelector).first();
      datumTekst = datumAttribuut ? datumEl.attr(datumAttribuut) : datumEl.text().trim();
    }

    berichten.push({
      bronId: bron.id,
      bronNaam: bron.naam,
      categorie: bron.categorie,
      titel,
      url: new URL(link, bron.url).toString(),
      samenvatting: "",
      gepubliceerdOp: parseerDatum(datumTekst),
      opgehaaldOp: new Date().toISOString(),
    });
  });

  const zonderDatum = berichten.filter((b) => !b.gepubliceerdOp).length;
  if (zonderDatum > 0) {
    console.warn(`[${bron.id}] ${zonderDatum} van ${berichten.length} berichten (gemini-recept) hadden geen herkenbare datum.`);
  }

  return berichten;
}

function parseerDatum(tekst) {
  if (!tekst) return null;
  const d = new Date(tekst);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { scrapeGeminiRecept };
