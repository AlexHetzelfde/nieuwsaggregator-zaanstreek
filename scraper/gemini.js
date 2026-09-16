// gemini.js
//
// Roept de Gemini API aan met één van de twee journalistieke prompts uit
// "scoringsystemen-en-ai-prompts.md", per bericht. Verwacht de API-key in de
// omgevingsvariabele GEMINI_API_KEY (zie README voor hoe je die als GitHub
// Secret instelt — nooit hardcoded in dit bestand of ergens anders in de repo!).

const GEMINI_MODEL = "gemini-flash-latest"; // alias die Google zelf actueel houdt — voorkomt dat dit breekt bij elke nieuwe modelgeneratie
const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

const PROMPT_LOKAAL = `Je bent een redactionele assistent voor een lokale journalist in Zaanstreek-Waterland.
Je krijgt één nieuwsbericht uit een lokale bron (buurtwebsite, schoolwebsite,
gemeentelijk raadsinformatiesysteem, buurtvereniging, etc.).

Beoordeel het bericht op nieuwswaarde volgens deze journalistieke criteria:
- Actualiteit: gebeurt dit nu of zeer recent?
- Afwijking: wijkt dit af van het alledaagse?
- Belang: worden inwoners hier concreet door geraakt (besluit, maatregel, verandering)?
- Nabijheid: speelt dit fysiek in Zaanstreek-Waterland?
- Nieuws van morgen: is dit een vooraankondiging die aandacht verdient?
- Omvang: hoeveel mensen/geld zijn betrokken?
- Voor het eerst: gebeurt dit voor het eerst?
- Wie: is een bekende lokale naam betrokken?

Beoordeel daarnaast of het bericht bijdraagt aan minstens één van deze drie dingen:
1. beter begrip van een maatschappelijk probleem voor de lezer
2. concrete gevolgen voor het dagelijks leven van inwoners
3. beter inzicht in de eigen omgeving

Geef ALLEEN geldig JSON terug, in dit exacte formaat, zonder markdown-fences of andere tekst:
{
  "oppakbaar": "ja" | "twijfel" | "nee",
  "onderbouwing": "max 3 zinnen, expliciet gekoppeld aan de criteria",
  "invalshoek": "één zin met de mogelijke invalshoek, alleen als die direct uit de feiten volgt, anders leeg",
  "teCheckenBronnen": ["bron 1", "bron 2"]
}

Blijf strikt bij wat feitelijk in het bericht staat. Doe geen aannames over motieven,
gevolgen of context die niet genoemd worden.`;

const PROMPT_LANDELIJK = `Je bent een redactionele assistent voor een lokale journalist in Zaanstreek-Waterland.
Je krijgt één landelijk nieuwsbericht. Landelijke en regionale media kiezen bij
landelijk nieuws bijna altijd voor een regionale insteek: ze "regionaliseren"
het onderwerp door het via een lokaal perspectief te bekijken.

Beoordeel of dit landelijke bericht een concrete, feitelijk onderbouwde lokale
invalshoek kan krijgen voor Zaanstreek-Waterland (Zaandam, Zaanstad, Wormerland,
Oostzaan, Purmerend, Edam-Volendam, Waterland).

Denk hierbij aan mogelijke aanknopingspunten:
- Raakt dit een beleidsterrein dat door gemeenten wordt uitgevoerd?
- Is er een sector (onderwijs, zorg, ondernemers, woningbouw, landbouw, industrie)
  die ook lokaal vertegenwoordigd is?
- Is er een landelijke instelling of bedrijf met een lokale vestiging betrokken?
- Gaat het over een groep mensen die ook lokaal aanwezig is (bijvoorbeeld
  arbeidsmigranten, studenten, ouderen, zzp'ers)?
- Bestaat er een lokale/regionale uitsplitsing van de genoemde cijfers?

Geef ALLEEN geldig JSON terug, in dit exacte formaat, zonder markdown-fences of andere tekst:
{
  "lokaleInvalshoek": "ja" | "twijfel" | "nee",
  "aanleiding": "concrete, controleerbare aanleiding die logisch uit het bericht volgt, anders leeg",
  "onderbouwing": "bij twijfel/nee: waarom geen onderbouwde invalshoek te vinden is"
}

Doe nooit een aanname om tot een invalshoek te komen. Een journalist moet elke
gesuggereerde invalshoek nog zelf kunnen checken met feiten en hoor-wederhoor.
Als je geen concreet aanknopingspunt hebt, zeg dat expliciet — verzin er geen bij.`;

/**
 * Beoordeelt één bericht met Gemini. Faalt een call (timeout, rate limit,
 * ongeldige JSON-response), dan wordt het bericht overgeslagen voor deze run
 * in plaats van de hele batch te laten crashen — zoals besproken: liever één
 * gemiste pitch dan een mislukte dagelijkse cyclus.
 */
async function beoordeelMetGemini(bericht, apiKey) {
  const prompt = bericht.categorie === "lokaal" ? PROMPT_LOKAAL : PROMPT_LANDELIJK;
  const volledigePrompt = `${prompt}\n\n---\nBERICHT\nTitel: ${bericht.titel}\nSamenvatting: ${bericht.samenvatting}\nBron: ${bericht.bronNaam}\nURL: ${bericht.url}\nGepubliceerd: ${bericht.gepubliceerdOp || "onbekend"}`;

  try {
    const response = await fetchMetTimeout(
      GEMINI_URL(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: volledigePrompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      },
      25_000
    );

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}`);
    }

    const data = await response.json();
    const tekst = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!tekst) throw new Error("Geen tekst in Gemini-respons");

    const beoordeling = JSON.parse(tekst);
    return { ...bericht, aiBeoordeling: beoordeling, aiFout: null };
  } catch (fout) {
    console.warn(`[${bericht.bronId}] Gemini-beoordeling overgeslagen: ${fout.message}`);
    return { ...bericht, aiBeoordeling: null, aiFout: fout.message };
  }
}

/**
 * Beoordeelt een lijst berichten na elkaar (niet parallel — dat voorkomt dat
 * we in één keer tegen rate limits aanlopen). `maxAantal` is de dagcap: bij
 * veel berichten worden alleen de hoogst scorende (de lijst moet dus al
 * gesorteerd zijn op score) daadwerkelijk naar Gemini gestuurd.
 */
async function beoordeelBerichten(berichten, apiKey, maxAantal = 40) {
  const teBeoordelen = berichten.slice(0, maxAantal);
  const overgeslagen = berichten.slice(maxAantal).map((b) => ({ ...b, aiBeoordeling: null, aiFout: "dagcap bereikt" }));

  const resultaten = [];
  for (const bericht of teBeoordelen) {
    resultaten.push(await beoordeelMetGemini(bericht, apiKey));
  }
  return [...resultaten, ...overgeslagen];
}

async function fetchMetTimeout(url, opties, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opties, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { beoordeelBerichten, beoordeelMetGemini };
