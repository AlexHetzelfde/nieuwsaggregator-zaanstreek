// voeg-bron-toe.js
//
// Eenmalig, lokaal (of via de "Bron toevoegen"-workflow) te draaien
// hulpprogramma: haalt een nieuwe bron op en probeert 'm zo automatisch
// mogelijk te herkennen, in drie stappen — elke stap alleen ingeschakeld
// als de vorige niet lukt:
//   1. RSS/Atom-feed?              — betrouwbaarst, kost niets.
//   2. Generieke CSS-patronen?     — gratis, snel, geen AI nodig.
//   3. Gemini-gegenereerd recept   — voor sites met een eigen structuur;
//      krijgt bij een zwakke eerste poging automatisch een herkansing.
// Een bron wordt pas toegevoegd als 'ie écht werkt (minstens 3 gevonden
// berichten), en de foutmeldingen zijn bedoeld om zelf te kunnen inschatten
// of het de moeite waard is om het nog eens te proberen — zonder dat je
// daarvoor eerst iemand anders hoeft te raadplegen.
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
const { oorzaakTekst, probeerKetenTeRepareren, haalOpMetCookies, haalDatumUitTekst } = require("./hulpmiddelen");
const { probeerGeneriekePatronen } = require("./scrapers/generieke-lijst");
const { valideerBronnen } = require("./valideer-bronnen");

const GEMINI_MODEL = "gemini-flash-lite-latest";
const GEBRUIKERSAGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_HTML_TEKENS_VOOR_GEMINI = 25_000;
const MINIMUM_GEVONDEN_BERICHTEN = 3;

/**
 * Haalt de pagina op en probeert onderweg twee bekende, specifieke
 * problemen automatisch te repareren (net als een browser stilzwijgend
 * doet), in plaats van meteen op te geven:
 *   - een onvolledige TLS-certificaatketen (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
 *   - een eindeloze sessie-cookie-redirect (redirect count exceeded)
 * Beide kunnen ook na elkaar nodig zijn voor dezelfde site (zoals bleek bij
 * loket.zaanstad.nl). Andere fouten worden ongewijzigd doorgegeven.
 */
async function haalBronPagina(url) {
  let dispatcher;
  for (let poging = 0; poging < 4; poging++) {
    const opties = { headers: { "User-Agent": GEBRUIKERSAGENT } };
    if (dispatcher) opties.dispatcher = dispatcher;
    try {
      return await fetch(url, opties).then((r) => r.text());
    } catch (fout) {
      if (fout.cause && fout.cause.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" && !dispatcher) {
        console.warn("Certificaatketen van de server is onvolledig — probeer het ontbrekende tussencertificaat zelf op te halen (zoals een browser doet)...");
        const reparatie = await probeerKetenTeRepareren(url).catch(() => null);
        if (reparatie) {
          console.warn(`Ontbrekend tussencertificaat gevonden via ${reparatie.issuerUrl}, opnieuw proberen.`);
          dispatcher = reparatie.dispatcher;
          continue;
        }
      }
      if (fout.cause && fout.cause.message === "redirect count exceeded") {
        console.warn("De site stuurt eindeloos door (waarschijnlijk is een sessie-cookie vereist) — probeer met cookie-ondersteuning zoals een browser dat doet...");
        return await haalOpMetCookies(url, opties);
      }
      throw fout;
    }
  }
  throw new Error(`Kon ${url} niet ophalen na meerdere reparatiepogingen`);
}

/** Print een korte, controleerbare voorproef van de gevonden berichten. */
function toonVoorbeeld(resultaten) {
  resultaten.slice(0, 3).forEach((r, i) => console.log(`  ${i + 1}. "${r.titel}" — datum: ${r.datum || "(geen datum gevonden)"}`));
}

/**
 * Beoordeelt een testresultaat in drie categorieën:
 *   - te weinig berichten            -> niet toevoegen, wel de moeite van
 *                                        een herkansing waard.
 *   - genoeg berichten, geen datums  -> WEL toevoegen (net als de generieke-
 *                                        patronen-route dat ook al deed),
 *                                        maar met een duidelijke waarschuwing
 *                                        — ook de moeite van een herkansing
 *                                        waard, ter verbetering.
 *   - genoeg berichten, (bijna) allemaal met datum -> gewoon toevoegen.
 */
function beoordeelTest(resultaten) {
  if (resultaten.length < MINIMUM_GEVONDEN_BERICHTEN) {
    return {
      goedGenoeg: false,
      magToevoegen: false,
      reden: `Te weinig berichten gevonden (${resultaten.length}, minimaal ${MINIMUM_GEVONDEN_BERICHTEN} nodig).`,
    };
  }
  const zonderDatum = resultaten.filter((r) => !r.datum).length;
  if (zonderDatum === resultaten.length) {
    return {
      goedGenoeg: false,
      magToevoegen: true,
      reden: `${resultaten.length} berichten gevonden, maar geen enkele met een herkenbare datum.`,
      waarschuwing: `Geen van de ${resultaten.length} berichten had een herkenbare datum — ze zouden dagelijks als "te oud" worden gezien. Overweeg het recept in bronnen.js handmatig te verbeteren.`,
    };
  }
  if (zonderDatum > 0) {
    return {
      goedGenoeg: true,
      magToevoegen: true,
      waarschuwing: `${zonderDatum} van ${resultaten.length} berichten hadden geen datum — die zouden dagelijks als "te oud" worden gezien.`,
    };
  }
  return { goedGenoeg: true, magToevoegen: true };
}

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
    html = await haalBronPagina(url);
  } catch (fout) {
    console.error(`\n❌ Kon de pagina niet ophalen: ${fout.message}${oorzaakTekst(fout)}`);
    console.error("Controleer of de URL klopt en of de site normaal bereikbaar is in een browser.");
    process.exit(1);
  }

  const $ = cheerio.load(html);

  // Stap 1: RSS/Atom-feed? Betrouwbaarder dan wat dan ook, en kost niets.
  const feedHref = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').attr("href");
  if (feedHref) {
    const feedUrl = new URL(feedHref, url).toString();
    console.log(`Feed gevonden: ${feedUrl}`);
    console.log('Geen Gemini nodig — dit werkt al met het bestaande "wordpress-html"-scraper-type (probeert feeds eerst).');
    await rondAf({ id: bronId, naam: bronId, categorie, type: "wordpress-html", url });
    return;
  }

  // Stap 2: generieke CSS-patronen — gratis, snel, geen AI nodig. Dit is
  // exact dezelfde functie die de dagelijkse run zelf ook gebruikt voor dit
  // brontype (scrapers/generieke-lijst.js), dus wat hier werkt, werkt daar
  // ook gegarandeerd hetzelfde.
  console.log("Geen RSS-feed gevonden — generieke patronen proberen...");
  const generiek = probeerGeneriekePatronen($, { id: bronId, naam: bronId, categorie, url });
  if (generiek) {
    console.log(`Generiek patroon "${generiek.selector}" werkt — geen Gemini nodig.`);
    const voorbeeld = generiek.berichten.map((b) => ({ titel: b.titel, datum: b.gepubliceerdOp }));
    toonVoorbeeld(voorbeeld);
    const zonderDatum = generiek.berichten.filter((b) => !b.gepubliceerdOp).length;
    if (zonderDatum > 0) {
      console.warn(`\n⚠️  ${zonderDatum} van ${generiek.berichten.length} berichten hadden geen datum — die zouden dagelijks als "te oud" worden gezien. Overweeg later een specifieker recept via Gemini te laten maken.`);
    }
    await rondAf({ id: bronId, naam: bronId, categorie, type: "generieke-lijst", url });
    return;
  }
  console.log("Generieke patronen leverden niets op — Gemini inschakelen.");

  // Stap 3: Gemini vragen de structuur te herkennen, met één automatische
  // herkansing (met feedback over wat er mis was) als de eerste poging niet
  // genoeg oplevert.
  const htmlVoorGemini = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .slice(0, MAX_HTML_TEKENS_VOOR_GEMINI);

  let recept = await vraagGeminiOmRecept(htmlVoorGemini, apiKey);
  if (!recept) {
    console.error("\n❌ Gemini kon geen herhalend berichten-blok herkennen op deze pagina.");
    console.error('Dit gebeurt meestal bij sites die met JavaScript worden opgebouwd (zoals iBabs) of achter een inlogscherm zitten — dat soort bronnen kan dit hulpmiddel (nog) niet automatisch toevoegen. Handmatig uitzoeken (of een eigen scraper, zoals ibabs.js) is dan nodig.');
    process.exit(1);
  }
  console.log("Voorgesteld recept:", JSON.stringify(recept, null, 2));

  let testResultaten = testRecept($, recept, url);
  let beoordeling = beoordeelTest(testResultaten);
  console.log(`\nTest: ${testResultaten.length} bericht(en) gevonden met dit recept.`);
  toonVoorbeeld(testResultaten);

  if (!beoordeling.goedGenoeg) {
    console.warn(`\n${beoordeling.reden} Ik vraag Gemini om een tweede poging, met die informatie erbij...`);
    const tweedeRecept = await vraagGeminiOmRecept(htmlVoorGemini, apiKey, { vorigRecept: recept, probleem: beoordeling.reden });
    if (tweedeRecept) {
      const tweedeTest = testRecept($, tweedeRecept, url);
      const tweedeBeoordeling = beoordeelTest(tweedeTest);
      console.log(`Tweede poging: ${tweedeTest.length} bericht(en) gevonden.`);
      toonVoorbeeld(tweedeTest);

      const beterDanEerst = tweedeTest.length > testResultaten.length || (tweedeBeoordeling.goedGenoeg && !beoordeling.goedGenoeg);
      if (beterDanEerst) {
        console.log("Tweede poging is beter — dit recept gebruiken.");
        recept = tweedeRecept;
        testResultaten = tweedeTest;
        beoordeling = tweedeBeoordeling;
      } else {
        console.log("Tweede poging leverde niets beters op — eerste recept blijft staan.");
      }
    } else {
      console.warn("Tweede poging bij Gemini leverde geen bruikbaar recept op — eerste resultaat blijft staan.");
    }
  }

  if (!beoordeling.magToevoegen) {
    console.error(`\n❌ ${beoordeling.reden}`);
    console.error("Ook na een herkansing lukte het niet. Mogelijk staat het nieuws op een andere pagina van deze site (bijvoorbeeld een specifieke /nieuws/-pagina in plaats van de homepage), of heeft de site een ongebruikelijke opbouw die meer maatwerk nodig heeft. Probeer eventueel een andere URL van dezelfde site.");
    process.exit(1);
  }
  if (beoordeling.waarschuwing) {
    console.warn(`\n⚠️  ${beoordeling.waarschuwing}`);
  }

  await rondAf({ id: bronId, naam: bronId, categorie, type: "gemini-recept", url, selectors: recept });
}

async function vraagGeminiOmRecept(html, apiKey, herkansingContext) {
  const basisInstructie = `Je krijgt de HTML van een nieuwsoverzichtspagina. Zoek het herhalende
HTML-blok dat één nieuwsbericht voorstelt, en geef CSS-selectors terug
waarmee daaruit de titel, de link en de publicatiedatum te halen zijn.`;

  const herkansingInstructie = herkansingContext
    ? `

Dit is een TWEEDE poging voor dezelfde pagina. Het vorige recept was:
${JSON.stringify(herkansingContext.vorigRecept)}
Probleem daarmee: ${herkansingContext.probleem}
Probeer een ANDER, beter passend recept — bijvoorbeeld een breder of juist
specifieker itemSelector. Let op: als de datum geen eigen element heeft maar
wél ergens in de titeltekst zelf verwerkt zit (bijvoorbeeld "2026-09-22
Dinsdag 22 september 2026 om 17.15 uur - ..."), zet datumSelector dan
gerust op null — de titeltekst wordt daarna automatisch alsnog op een datum
doorzocht.`
    : "";

  const prompt = `${basisInstructie}${herkansingInstructie}

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
    console.error(`Gemini-aanroep mislukt: ${fout.message}${oorzaakTekst(fout)}`);
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
    // Zelfde fallback als de dagelijkse scraper (gemini-recept.js): als er
    // geen los datum-element is, kijk of de titel/item-tekst zelf een datum
    // bevat. Zonder dit zou de test hier "geen datum" laten zien terwijl de
    // dagelijkse run 'm straks wél vindt — dan testen we niet wat we later
    // echt draaien.
    datum = datum || haalDatumUitTekst(titel) || haalDatumUitTekst($(el).text());

    resultaten.push({ titel, link: new URL(link, baseUrl).toString(), datum });
  });
  return resultaten;
}

/**
 * Schrijft de bron weg én controleert meteen (dezelfde check die ook als
 * losse stap in de workflow draait, vóór de commit) of bronnen.js daarna
 * nog klopt — dubbele id's, een onbekend type, een ongeldige url. Zo krijg
 * je een begrijpelijke melding op het moment zelf, in plaats van pas een
 * aparte, kortere CI-foutmelding verderop.
 */
async function rondAf(bron) {
  await voegBronToe(bron);

  delete require.cache[require.resolve("./bronnen")];
  const bijgewerkteBronnen = require("./bronnen");
  const fouten = valideerBronnen(bijgewerkteBronnen);
  if (fouten.length > 0) {
    console.error("\n❌ Bron toegevoegd, maar de validatie erna faalt:");
    for (const fout of fouten) console.error(`  - ${fout}`);
    console.error("Dit voorkomt dat de wijziging gecommit wordt — controleer bronnen.js.");
    process.exit(1);
  }

  console.log(`\n✓ Bron "${bron.id}" toegevoegd aan bronnen.js${bron.selectors ? " met een Gemini-gegenereerd recept" : ""}.`);
  console.log("Commit en push bronnen.js om 'm mee te nemen in de volgende dagelijkse run.");
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
