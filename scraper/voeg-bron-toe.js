// voeg-bron-toe.js
//
// Eenmalig, lokaal te draaien hulpprogramma: haalt een nieuwe bron op, laat
// Gemini de HTML-structuur analyseren tot een "recept" (CSS-selectors),
// test dat recept tegen de echte pagina, en voegt de bron pas toe aan
// bronnen.js als het recept écht werkt (minstens 3 gevonden berichten).
//
// Gebruik (vanuit de map scraper/):
//   npm install                                  (eenmalig)
//   GEMINI_API_KEY=jouw-key node voeg-bron-toe.js <url> <bron-id> <categorie>
//
// Voorbeeld:
//   GEMINI_API_KEY=xxx node voeg-bron-toe.js https://voorbeeld.nl/nieuws/ voorbeeld-nieuws lokaal
//
// Dit script draait NIET automatisch mee in de dagelijkse workflow — het is
// een los hulpmiddel voor als je zelf een nieuwe bron wil toevoegen zonder
// dat iemand de site eerst handmatig hoeft te analyseren.
//
// BEPERKING: werkt niet voor JavaScript-gerenderde sites (zoals de iBabs-
// pagina's) — Gemini krijgt dan, net als dit script zelf, alleen de lege
// "Loading..."-HTML te zien. Voor dat soort sites blijft handmatig
// uitzoeken (of een speciale scraper zoals ibabs.js) nodig.

const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const GEMINI_MODEL = "gemini-flash-lite-latest";
const GEBRUIKERSAGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_HTML_TEKENS_VOOR_GEMINI = 25_000;
const MINIMUM_GEVONDEN_BERICHTEN = 3;

async function main() {
  const [, , url, bronId, categorie = "lokaal"] = process.argv;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!url || !bronId) {
    console.error("Gebruik: GEMINI_API_KEY=... node voeg-bron-toe.js <url> <bron-id> <categorie: lokaal|landelijk>");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("GEMINI_API_KEY ontbreekt. Zet 'm voor het commando: GEMINI_API_KEY=xxx node voeg-bron-toe.js ...");
    process.exit(1);
  }
  if (!["lokaal", "landelijk"].includes(categorie)) {
    console.error('Categorie moet "lokaal" of "landelijk" zijn.');
    process.exit(1);
  }

  console.log(`Bron ophalen: ${url}`);
  let html;
  try {
    html = await fetch(url, { headers: { "User-Agent": GEBRUIKERSAGENT } }).then((r) => r.text());
  } catch (fout) {
    console.error(`Kon de pagina niet ophalen: ${fout.message}`);
    process.exit(1);
  }

  // Stap 1: is er een RSS/Atom-feed? Dat is betrouwbaarder dan Gemini-
  // gegenereerde selectors en kost geen Gemini-call, dus die proberen we
  // eerst.
  const $ = cheerio.load(html);
  const feedHref = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').attr("href");
  if (feedHref) {
    const feedUrl = new URL(feedHref, url).toString();
    console.log(`Feed gevonden: ${feedUrl}`);
    console.log('Geen Gemini nodig — dit werkt al met het bestaande "wordpress-html"-scraper-type (probeert feeds eerst).');
    await voegBronToe({ id: bronId, naam: bronId, categorie, type: "wordpress-html", url });
    console.log(`\n✓ Bron "${bronId}" toegevoegd aan bronnen.js.`);
    return;
  }

  // Stap 2: geen feed — Gemini vragen de structuur te herkennen.
  console.log("Geen RSS-feed gevonden — Gemini analyseert de HTML-structuur...");
  const htmlVoorGemini = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .slice(0, MAX_HTML_TEKENS_VOOR_GEMINI);

  const recept = await vraagGeminiOmRecept(htmlVoorGemini, apiKey);
  if (!recept) {
    console.error("Gemini kon geen bruikbaar recept maken (of de site is JS-gerenderd, zoals iBabs). Niet toegevoegd.");
    process.exit(1);
  }
  console.log("Voorgesteld recept:", JSON.stringify(recept, null, 2));

  // Stap 3: recept testen tegen de echte, al opgehaalde pagina.
  const testResultaten = testRecept($, recept, url);
  console.log(`\nTest: ${testResultaten.length} bericht(en) gevonden met dit recept.`);
  testResultaten.slice(0, 3).forEach((r, i) => console.log(`  ${i + 1}. "${r.titel}" — datum: ${r.datum || "(geen datum gevonden)"}`));

  if (testResultaten.length < MINIMUM_GEVONDEN_BERICHTEN) {
    console.error(`\nTe weinig berichten gevonden (${testResultaten.length}, minimaal ${MINIMUM_GEVONDEN_BERICHTEN} nodig) — recept werkt waarschijnlijk niet. NIET automatisch toegevoegd.`);
    console.error("Stuur dit resultaat door om samen verder uit te zoeken, of pas het recept handmatig aan.");
    process.exit(1);
  }

  const zonderDatum = testResultaten.filter((r) => !r.datum).length;
  if (zonderDatum > 0) {
    console.warn(`\nLet op: ${zonderDatum} van ${testResultaten.length} berichten hadden geen datum — die zouden dagelijks als "te oud" worden gezien. Overweeg het recept te verbeteren.`);
  }

  await voegBronToe({ id: bronId, naam: bronId, categorie, type: "gemini-recept", url, selectors: recept });
  console.log(`\n✓ Bron "${bronId}" toegevoegd aan bronnen.js met een Gemini-gegenereerd recept.`);
  console.log("Commit en push bronnen.js om 'm mee te nemen in de volgende dagelijkse run.");
}

async function vraagGeminiOmRecept(html, apiKey) {
  const prompt = `Je krijgt de HTML van een nieuwsoverzichtspagina. Zoek het herhalende
HTML-blok dat één nieuwsbericht voorstelt, en geef CSS-selectors terug
waarmee daaruit de titel, de link en de publicatiedatum te halen zijn.

Geef ALLEEN geldig JSON terug, exact dit formaat, geen markdown-fences,
geen andere tekst:
{
  "itemSelector": "CSS-selector voor één herhalend nieuwsbericht-blok",
  "titelSelector": "CSS-selector voor de titel, relatief aan het item-blok (leeg-string als het item-blok zelf de titel bevat)",
  "linkSelector": "CSS-selector voor de <a> met de link naar het volledige artikel, relatief aan het item-blok, of het woord self als de titel zelf (of een omvattend element) de link is",
  "datumSelector": "CSS-selector voor het element met de datum, relatief aan het item-blok, of null als er geen datum te vinden is",
  "datumAttribuut": "naam van het HTML-attribuut waar de datum in staat (bijvoorbeeld datetime), of null om gewoon de zichtbare tekst van het element te gebruiken"
}

Als er geen duidelijk herhalend nieuwsbericht-blok te vinden is (bijvoorbeeld
omdat de pagina leeg is of duidelijk met JavaScript wordt opgebouwd, zoals
een lege tabel met een "Loading..."-melding), geef dan terug:
{"itemSelector": null}

HTML:
${html}`;

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      }
    );
  } catch (fout) {
    console.error(`Gemini-aanroep mislukt: ${fout.message}`);
    return null;
  }

  if (!response.ok) {
    console.error(`Gemini HTTP ${response.status}`);
    return null;
  }

  const data = await response.json();
  const tekst = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!tekst) return null;

  let recept;
  try {
    recept = JSON.parse(tekst);
  } catch {
    console.error("Gemini gaf geen geldige JSON terug.");
    return null;
  }

  if (!recept.itemSelector) return null;
  return recept;
}

function testRecept($, recept, baseUrl) {
  const resultaten = [];
  $(recept.itemSelector).each((_, el) => {
    const titelEl = recept.titelSelector ? $(el).find(recept.titelSelector).first() : $(el);
    const titel = titelEl.text().trim();
    if (!titel) return;

    let link = null;
    if (recept.linkSelector === "self") {
      link = titelEl.is("a") ? titelEl.attr("href") : titelEl.find("a").attr("href");
    } else if (recept.linkSelector) {
      link = $(el).find(recept.linkSelector).attr("href");
    }
    if (!link) return;

    let datum = null;
    if (recept.datumSelector) {
      const datumEl = $(el).find(recept.datumSelector).first();
      datum = recept.datumAttribuut ? datumEl.attr(recept.datumAttribuut) : datumEl.text().trim();
    }

    resultaten.push({ titel, link: new URL(link, baseUrl).toString(), datum });
  });
  return resultaten;
}

async function voegBronToe(bron) {
  const pad = path.join(__dirname, "bronnen.js");
  const inhoud = await fs.readFile(pad, "utf-8");

  const nieuweRegel = bron.selectors
    ? `  {
    id: "${bron.id}",
    naam: "${bron.naam}",
    categorie: "${bron.categorie}",
    type: "gemini-recept",
    url: "${bron.url}",
    selectors: ${JSON.stringify(bron.selectors)},
  },
];`
    : `  {
    id: "${bron.id}",
    naam: "${bron.naam}",
    categorie: "${bron.categorie}",
    type: "${bron.type}",
    url: "${bron.url}",
  },
];`;

  const bijgewerkt = inhoud.replace(/\];\s*$/, nieuweRegel);
  await fs.writeFile(pad, bijgewerkt, "utf-8");
}

main().catch((fout) => {
  console.error("Onverwachte fout:", fout);
  process.exit(1);
});
