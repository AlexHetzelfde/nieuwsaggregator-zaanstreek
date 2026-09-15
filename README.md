# Nieuwsaggregator Zaanstreek-Waterland

Dagelijkse scraper + AI-pitchmachine voor lokale journalistiek in Zaanstreek-Waterland.
Draait volledig gratis op GitHub Pages + GitHub Actions.

## Hoe het werkt

1. Elke avond om 18:00 (NL-tijd) start een GitHub Actions-workflow.
2. `scraper/index.js` haalt nieuws op van alle bronnen in `scraper/bronnen.js`.
3. Berichten worden geteld, gescoord (zie `scraper/score.js`) en gesplitst in
   een lokale en een landelijke lijst.
4. De hoogst scorende berichten (tot een dagcap) gaan één voor één naar
   Gemini, met de juiste prompt uit `scraper/gemini.js`.
5. De resultaten worden weggeschreven naar `data/*.json`.
6. De workflow committet die JSON-bestanden terug naar de repo.
7. GitHub Pages serveert `index.html`, dat die JSON-bestanden inleest en
   toont — inclusief de top 5 pitches van die dag.

## Eenmalige setup

### 1. Repo op GitHub zetten
Maak een nieuwe (public of private) GitHub-repo aan en push deze hele map
erheen.

### 2. GitHub Pages aanzetten
Ga naar **Settings → Pages** in je repo en zet de bron op **"Deploy from a
branch"**, branch `main`, map `/ (root)`. Na een paar minuten is de site
bereikbaar op `https://<gebruikersnaam>.github.io/<reponaam>/`.

### 3. Gemini API-key aanmaken
Maak een gratis API-key aan via [Google AI Studio](https://aistudio.google.com/apikey)
(inloggen met een Google-account, op "Create API key" klikken).

### 4. Gemini API-key opslaan als GitHub Secret — **hier, en alleen hier**
Dit is de enige veilige plek voor de key. **Zet 'm nooit in een bestand in de
repo zelf** (ook niet in een `.env`-bestand dat je per ongeluk commit) —
alles in een publieke repo is voor iedereen zichtbaar, en zelfs in een
private repo is een los secret veiliger dan een key die in de geschiedenis
van je commits blijft staan.

Zo zet je 'm goed weg:
1. Ga in je GitHub-repo naar **Settings → Secrets and variables → Actions**.
2. Klik op **"New repository secret"**.
3. Naam: `GEMINI_API_KEY`
4. Waarde: plak je Gemini API-key
5. Klik op **"Add secret"**.

GitHub Actions injecteert deze automatisch als omgevingsvariabele in de
workflow (zie `.github/workflows/dagelijkse-run.yml`, regel met
`GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}`). Het script zelf
(`scraper/gemini.js`) leest 'm alleen uit `process.env.GEMINI_API_KEY` — de
key staat dus nergens anders in de code.

Zonder deze secret blijft de scraper + het scoresysteem gewoon werken; alleen
de AI-beoordeling en de top-5 pitches slaan dan over (zie de waarschuwing die
`index.js` in dat geval print).

### 5. Eerste run
Ga naar het tabblad **Actions** in je repo, kies de workflow "Dagelijkse
nieuwsrun" en klik op **"Run workflow"** om 'm handmatig te testen zonder op
18:00 te wachten.

## Bronnen toevoegen
Voeg een nieuwe bron toe in `scraper/bronnen.js`. Kies het juiste `type`:
- `"rss"` — voor sites met een kant-en-klare RSS-feed
- `"wordpress-html"` — voor WordPress-nieuwsoverzichten (probeert eerst
  `/feed/`, valt anders terug op HTML-scrapen)
- `"ibabs"` — voor `*.bestuurlijkeinformatie.nl`-rapportpagina's (gebruikt
  een headless browser omdat die tabellen met JavaScript geladen worden)

Voor een compleet nieuw brontype: voeg een bestand toe in `scraper/scrapers/`
dat een array van genormaliseerde berichtobjecten teruggeeft (zie de
bestaande scrapers voor het exacte formaat), en registreer het in
`SCRAPER_PER_TYPE` in `scraper/index.js`.

## Scoresysteem en AI-prompts aanpassen
Alle trefwoordenlijsten en puntenwaarden staan in `scraper/score.js`. De twee
AI-prompts staan in `scraper/gemini.js`. Beide zijn gebaseerd op het document
"scoringsystemen-en-ai-prompts.md" — pas gerust aan naarmate je merkt dat
bepaalde signalen beter of slechter blijken te werken.

## Lokaal testen
```bash
cd scraper
npm install
npx playwright install --with-deps chromium   # eenmalig, voor de iBabs-scraper
GEMINI_API_KEY=jouw-key npm start
```
De output verschijnt in `../data/*.json`. Open daarna `index.html` lokaal in
de browser (of run `python3 -m http.server` in de hoofdmap) om de front-end
te bekijken.
