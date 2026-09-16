// scrapers/generieke-lijst.js
//
// Voor institutionele/overheidssites (musea, waterschap, provincie, scholen)
// die geen WordPress draaien en dus geen voorspelbare /feed/ hebben. We
// proberen eerst alsnog een RSS/Atom-feed te vinden via een <link>-tag in de
// <head> — sommige custom CMS'en hebben die wel, ook zonder dat de URL
// voorspelbaar is. Lukt dat niet, dan scrapen we de HTML met een bredere set
// patronen dan de WordPress-scraper, omdat deze sites onderling veel meer
// van elkaar verschillen.
//
// LET OP: dit is bewust een brede, algemene aanpak — geen scraper die precies
// op de HTML van elke individuele site is afgestemd (dat vereist inzage in
// de broncode per site, die we hier niet hebben kunnen inspecteren). Voor
// sommige bronnen zal deze aanpak in één keer goed werken, voor andere zal
// er na de eerste run bijgesteld moeten worden — check de bericht-aantallen
// in de logs per bron; 0 berichten van een bron die duidelijk wel nieuws
// heeft is het signaal om deze scraper voor die specifieke bron te verfijnen.

const cheerio = require("cheerio");
const { haalOp, parseerRssTekst } = require("../hulpmiddelen");

// Volgorde van kandidaat-selectors voor één nieuwsitem-blok, breed naar smal.
const ITEM_SELECTORS = [
  "article",
  ".news-item",
  ".nieuws-item",
  "li.nieuwsitem",
  ".card",
  ".teaser",
  ".list-item",
  "li",
];

async function scrapeGeneriekeLijst(bron) {
  // Stap 1: kijk of de pagina zelf naar een RSS/Atom-feed linkt.
  try {
    const html = await haalOp(bron.url);
    const $ = cheerio.load(html);
    const feedHref = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').attr("href");

    if (feedHref) {
      const feedUrl = new URL(feedHref, bron.url).toString();
      try {
        const feedTekst = await haalOp(feedUrl);
        const items = parseerRssTekst(feedTekst, bron);
        if (items.length > 0) return items;
      } catch (fout) {
        console.warn(`[${bron.id}] Gevonden feed (${feedUrl}) kon niet geladen worden: ${fout.message}.`);
      }
    }

    // Stap 2: HTML-scrape met de bredere patronenset.
    return scrapeHtml($, bron);
  } catch (fout) {
    console.error(`[${bron.id}] Generieke lijst-scraper mislukt: ${fout.message}`);
    return [];
  }
}

function scrapeHtml($, bron) {
  for (const selector of ITEM_SELECTORS) {
    const berichten = [];
    $(selector).each((_, el) => {
      const titelEl = $(el).find("h1, h2, h3, h4").first();
      const titel = titelEl.text().trim();
      const link = titelEl.find("a").attr("href") || $(el).find("a").first().attr("href");
      if (!titel || !link || titel.length < 8) return; // te korte "titels" zijn meestal menu-items, geen nieuws

      const datumTekst =
        $(el).find("time").attr("datetime") ||
        $(el).find("time").text().trim() ||
        ($(el).text().match(/\d{1,2}[\s\-\/]\w+[\s\-\/]\d{4}/) || [])[0];

      berichten.push({
        bronId: bron.id,
        bronNaam: bron.naam,
        categorie: bron.categorie,
        titel,
        url: new URL(link, bron.url).toString(),
        samenvatting: $(el).find("p").first().text().trim().slice(0, 400),
        gepubliceerdOp: parseerDatum(datumTekst),
        opgehaaldOp: new Date().toISOString(),
      });
    });

    // Zodra een selector minstens een paar bruikbare berichten oplevert,
    // gaan we daarvan uit — anders proberen we de volgende, bredere selector.
    if (berichten.length >= 3) {
      return dedupliceerOpUrl(berichten);
    }
  }

  console.warn(`[${bron.id}] Geen van de generieke patronen leverde berichten op — deze bron heeft waarschijnlijk maatwerk nodig.`);
  return [];
}

function dedupliceerOpUrl(berichten) {
  const gezien = new Set();
  return berichten.filter((b) => {
    if (gezien.has(b.url)) return false;
    gezien.add(b.url);
    return true;
  });
}

function parseerDatum(tekst) {
  if (!tekst) return null;
  const d = new Date(tekst);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { scrapeGeneriekeLijst };
