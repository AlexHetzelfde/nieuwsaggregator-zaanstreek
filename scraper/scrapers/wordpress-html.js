// scrapers/wordpress-html.js
//
// Scraapt een WordPress-nieuwsoverzichtspagina (zoals zaanschemolen.nl/nieuws/).
// WordPress-sites hebben bijna altijd ook een RSS-feed op /feed/ — die proberen
// we eerst, want dat is veel robuuster dan HTML-scrapen (minder kans op breken
// bij een theme-update). Lukt dat niet, dan valt de functie terug op het
// scrapen van de HTML-lijst zelf.

const cheerio = require("cheerio");
const { haalOp, parseerRssTekst } = require("../hulpmiddelen");

async function scrapeWordpress(bron) {
  // Stap 1: probeer de standaard WordPress RSS-feed.
  const feedUrl = bron.url.replace(/\/?$/, "/feed/");
  try {
    const feedTekst = await haalOp(feedUrl);
    const items = parseerRssTekst(feedTekst, bron);
    if (items.length > 0) {
      return items;
    }
  } catch (fout) {
    console.warn(`[${bron.id}] RSS-feed niet bruikbaar (${feedUrl}): ${fout.message}. Val terug op HTML-scrape.`);
  }

  // Stap 2: fallback — scrape de HTML van de nieuwsoverzichtspagina zelf.
  const html = await haalOp(bron.url);
  const $ = cheerio.load(html);
  const berichten = [];

  // WordPress-thema's verschillen, dus we proberen een paar veelvoorkomende
  // patronen: een <article>, of een blok met een <h2>/<h3> die naar een los
  // artikel linkt, gevolgd door een datum in de buurt.
  $("article, .post, .news-item").each((_, el) => {
    const titelEl = $(el).find("h1, h2, h3").first();
    const titel = titelEl.text().trim();
    const link = titelEl.find("a").attr("href") || $(el).find("a").first().attr("href");
    if (!titel || !link) return;

    const datumTekst = $(el).find("time").attr("datetime") || $(el).find("time").text().trim();

    berichten.push({
      bronId: bron.id,
      bronNaam: bron.naam,
      categorie: bron.categorie,
      titel,
      url: link,
      samenvatting: "",
      gepubliceerdOp: parseerDatum(datumTekst),
      opgehaaldOp: new Date().toISOString(),
    });
  });

  return berichten;
}

function parseerDatum(tekst) {
  if (!tekst) return null;
  const d = new Date(tekst);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { scrapeWordpress };
