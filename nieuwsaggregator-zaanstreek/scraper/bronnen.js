// bronnen.js
// Centrale lijst van bronnen. Elke bron krijgt een categorie: "lokaal" of "landelijk".
// Voeg hier nieuwe bronnen toe zodra je er meer wilt scrapen — de rest van de
// pipeline (scoren, AI-beoordeling, front-end) werkt automatisch mee.

module.exports = [
  {
    id: "zaansche-molen",
    naam: "De Zaansche Molen — Nieuws",
    categorie: "lokaal",
    type: "wordpress-html", // scraapt de HTML van een WordPress-nieuwsoverzicht
    url: "https://www.zaanschemolen.nl/nieuws/",
  },
  {
    id: "ibabs-collegeberichten",
    naam: "Zaanstad — Collegeberichten (iBabs)",
    categorie: "lokaal",
    type: "ibabs",
    url: "https://zaanstad.bestuurlijkeinformatie.nl/Reports/Details/8ea04074-52e6-4284-bd1a-66e378b40ec1",
  },
  {
    id: "ibabs-ingekomen-stukken",
    naam: "Zaanstad — Ingekomen stukken (iBabs)",
    categorie: "lokaal",
    type: "ibabs",
    url: "https://zaanstad.bestuurlijkeinformatie.nl/Reports/Details/58e397b1-0b36-49e2-90ed-325405f27f72",
  },
  {
    id: "nos-binnenland",
    naam: "NOS — Binnenland",
    categorie: "landelijk",
    type: "rss",
    url: "https://feeds.nos.nl/nosnieuwsbinnenland",
  },
];
