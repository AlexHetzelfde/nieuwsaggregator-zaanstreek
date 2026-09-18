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
  {
    id: "ovo-zaanstad",
    naam: "OVO Zaanstad (koepel 7 vo-scholen)",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.ovo-zaanstad.nl/nieuws/",
  },
  {
    id: "blaise-pascal-college",
    naam: "Blaise Pascal College",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.blaisepascalcollege.nl/",
  },
  {
    id: "pascal-zuid",
    naam: "Pascal Zuid",
    categorie: "lokaal",
    type: "wordpress-html",
    url: "https://pascalzuid.nl/pascal-zuid/nieuws/",
  },
  {
    id: "zaans-museum",
    naam: "Zaans Museum — Nieuws & Pers",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://zaansmuseum.nl/nieuws-pers/",
  },
  {
    id: "zaanse-schans",
    naam: "Zaanse Schans — Actueel",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.dezaanseschans.nl/contact/actueel/",
  },
  {
    id: "zaandijk-leeft",
    naam: "Zaandijk Leeft! — Nieuws",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://zaandijkleeft.nl/nieuws/",
  },
  {
    id: "hhnk-nieuws",
    naam: "Hoogheemraadschap Hollands Noorderkwartier — Nieuws",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.hhnk.nl/nieuws",
  },
  {
    id: "hhnk-actueel",
    naam: "Hoogheemraadschap Hollands Noorderkwartier — Actueel",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.hhnk.nl/actueel",
  },
  {
    id: "nh-actueel",
    naam: "Provincie Noord-Holland — Actueel",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.noord-holland.nl/Actueel",
  },
  {
    id: "nh-cultuur",
    naam: "Provincie Noord-Holland — Cultuur en Erfgoed",
    categorie: "lokaal",
    type: "generieke-lijst",
    url: "https://www.noord-holland.nl/Onderwerpen/Cultuur_en_Erfgoed",
  },
];
