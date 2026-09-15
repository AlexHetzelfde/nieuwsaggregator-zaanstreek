// scrapers/ibabs.js
//
// De rapportpagina's op *.bestuurlijkeinformatie.nl (iBabs) laden hun tabel
// via JavaScript op — een gewone HTTP-fetch krijgt alleen een lege tabel met
// een "Loading..."-plaatje terug. Daarom gebruiken we hier Playwright: een
// echte (headless) browser die de pagina opent, wacht tot de tabel gevuld is,
// en dan de rijen uitleest. Dit is trager dan de andere scrapers, maar het is
// de enige betrouwbare manier om bij deze data te komen zonder een privé-API
// te reverse-engineeren die zonder waarschuwing kan veranderen.
//
// LET OP: dit bestand heeft het pakket "playwright" nodig (zie package.json)
// en de GitHub Actions-workflow installeert de bijbehorende browserbinaries
// via `npx playwright install --with-deps chromium`.

const { chromium } = require("playwright");

async function scrapeIbabs(bron) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(bron.url, { waitUntil: "networkidle", timeout: 30_000 });

    // Wacht tot de tabel echte rijen heeft (niet meer alleen de throbber-rij).
    // Als er na 15s nog niets staat, nemen we aan dat de lijst voor dit
    // rapport leeg is (kan gebeuren, bijvoorbeeld in een rustige week) en
    // geven we gewoon een lege lijst terug in plaats van te crashen.
    try {
      await page.waitForFunction(
        () => {
          const rijen = document.querySelectorAll("table tbody tr");
          if (rijen.length === 0) return false;
          // De throbber-rij bevat een <img> en geen tekstcellen met inhoud.
          return Array.from(rijen).some((rij) => rij.innerText.trim().length > 0 && !rij.querySelector("img"));
        },
        { timeout: 15_000 }
      );
    } catch {
      console.warn(`[${bron.id}] Geen gevulde tabel binnen 15s gevonden — vermoedelijk lege lijst.`);
      return [];
    }

    const ruweRijen = await page.$$eval("table tbody tr", (rijen) =>
      rijen
        .filter((rij) => !rij.querySelector("img")) // throbber-rij eruit filteren
        .map((rij) => {
          const cellen = Array.from(rij.querySelectorAll("td")).map((cel) => cel.innerText.trim());
          const link = rij.querySelector("a");
          return {
            cellen,
            href: link ? link.href : null,
          };
        })
    );

    return ruweRijen
      .filter((rij) => rij.cellen.some((c) => c.length > 0))
      .map((rij) => normaliseerIbabsRij(rij, bron));
  } finally {
    await browser.close();
  }
}

/**
 * De kolomvolgorde in iBabs-rapporten is meestal:
 * [Onderwerp, Datum publicatie, Datum bericht, Portefeuillehouder, Type document, Afhandeling]
 * maar dit kan per gemeente/rapport verschillen. We pakken daarom de eerste
 * kolom als titel en zoeken zelf naar iets wat op een datum lijkt, in plaats
 * van blind op kolomindex te vertrouwen.
 */
function normaliseerIbabsRij(rij, bron) {
  const titel = rij.cellen[0] || "(geen onderwerp)";
  const datumKolom = rij.cellen.find((c) => /^\d{1,2}-\d{1,2}-\d{4}/.test(c));

  return {
    bronId: bron.id,
    bronNaam: bron.naam,
    categorie: bron.categorie,
    titel,
    url: rij.href || bron.url,
    samenvatting: rij.cellen.slice(1).filter(Boolean).join(" — "),
    gepubliceerdOp: parseerNlDatum(datumKolom),
    opgehaaldOp: new Date().toISOString(),
  };
}

function parseerNlDatum(tekst) {
  if (!tekst) return null;
  const match = tekst.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!match) return null;
  const [, dag, maand, jaar] = match;
  const iso = new Date(Number(jaar), Number(maand) - 1, Number(dag)).toISOString();
  return iso;
}

module.exports = { scrapeIbabs };
