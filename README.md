# Niš — Kvalitet vazduha

Mala statička web aplikacija za prikaz kvaliteta vazduha u Nišu. Browser učitava samo lokalne JSON fajlove iz repozitorijuma, dok GitHub Actions periodično preuzima podatke sa SEPA/Kosava Open Data API-ja.

## Arhitektura

```text
SEPA / Kosava Open Data API
        ↓
GitHub Actions (Node.js)
        ↓
data/nis-7d.json + data/nis-30d.json
        ↓
GitHub Pages
        ↓
index.html
```

Browser **ne poziva Kosava API**, pa CORS nije potreban kao trajno rešenje.

## API koji se koristi

Aktuelna dokumentacija je na https://opendata.kosava.cloud/api-docs.

Skripta koristi:

- `GET /api/v1/metadata`
- `GET /api/v1/stations?active=true`
- `GET /api/v1/observations?station_id=...&from=...&to=...`

Aktuelni API navodi rolling retention od 30 dana, satne `hourly_mean` vrednosti i `data_status=preliminary`. API ne zahteva API ključ.

Konfigurisane Niš stanice su:

- `36` — Kamenički Vis EMEP — `RS1055G`
- `37` — Niš O.š. Sveti Sava — `RS1056A`
- `38` — Niš IZJZ Niš — `RS1057A`
- `106` — Niš Dimitrija Leka — `RS1067A`

Frontend prikazuje pet polutanata koje SEPA koristi za svoj kratkoročni indeks: `PM10`, `PM2.5`, `NO2`, `SO2`, `O3`.

## Metodologija indikatora

Aplikacija **ne prikazuje proizvoljan broj kao zvanični indeks**.

Koristi kategorije i satne pragove koje SEPA trenutno objavljuje za svoj indeks kvaliteta vazduha:

| Polutant | Dobar | Prihvatljiv | Umeren | Zagađen | Veoma zagađen | Izuzetno zagađen |
|---|---:|---:|---:|---:|---:|---:|
| SO2 1h µg/m³ | 0–20 | 20–40 | 40–125 | 125–190 | 190–275 | >275 |
| PM10 1h µg/m³ | 0–15 | 15–45 | 45–120 | 120–195 | 195–270 | >270 |
| O3 1h µg/m³ | 0–60 | 60–100 | 100–120 | 120–160 | 160–180 | >180 |
| NO2 1h µg/m³ | 0–10 | 10–25 | 25–60 | 60–100 | 100–150 | >150 |
| PM2.5 1h µg/m³ | 0–5 | 5–15 | 15–50 | 50–90 | 90–140 | >140 |

Za svaki lokalni dan aplikacija uzima **najveću dostupnu satnu sredinu** za svaki polutant. Dnevni **„Indikator aplikacije“** je najviša kategorija među dostupnim polutantima i Niš stanicama tog dana. Ako podatak ne postoji, ne interpolira se i ne izmišlja se vrednost.

Ovo je namerno označeno kao **Indikator aplikacije**, a ne kao zvanični „SEPA indeks za dan“. SEPA navodi da je njihov indeks zasnovan na neverifikovanim satnim vrednostima i da nije alat za proveru usklađenosti sa zakonskim graničnim vrednostima.

Vrednost polutanta na kartici je označena kao **maks. satna**, a uz nju se navode stanica i lokalno vreme merenja.

## Lokalno pokretanje

Potrebna je moderna verzija Node.js-a (workflow koristi Node 22).

U PowerShell/CMD-u:

```powershell
cd nis-air
node scripts/update-data.js
```

Skripta će napraviti/obnoviti:

```text
data/nis-7d.json
data/nis-30d.json
```

Za lokalni frontend nemoj otvarati `index.html` preko `file://`, već pokreni jednostavan statički server. Na primer, ako imaš Python:

```powershell
python -m http.server 8000
```

zatim otvori `http://localhost:8000`.

Ako koristiš VS Code/Visual Studio lokalni server, dovoljno je da služi root folder projekta.

## Postavljanje na GitHub

1. Napravi novi GitHub repository, npr. `nis-air`.
2. Kopiraj sve fajlove ovog projekta u repository.
3. Commit + push na podrazumevanu granu, npr. `main`.
4. Proveri da su `.github/workflows/update-data.yml` i `scripts/update-data.js` u repozitorijumu.

Primer:

```powershell
git init
git add .
git commit -m "Initial Niš air quality app"
git branch -M main
git remote add origin https://github.com/USERNAME/nis-air.git
git push -u origin main
```

Zameni `USERNAME` svojim GitHub korisničkim imenom.

## GitHub Pages

U repository-u otvori:

`Settings → Pages`

U delu **Build and deployment** izaberi:

- Source: **Deploy from a branch**
- Branch: `main`
- Folder: `/ (root)`

Sačuvaj. GitHub će zatim objaviti `index.html` kao GitHub Pages sajt.

## GitHub Action

Workflow se pokreće:

- automatski jednom na sat, u 17. minutu (`17 * * * *`),
- ručno preko `Actions → Update Niš air quality data → Run workflow`.

Satni interval je kompromis između dovoljno svežih podataka i nepotrebnog ponavljanja preuzimanja. API već daje satne agregacije, pa nema smisla osvežavati frontend svakih nekoliko minuta.

Workflow koristi Node.js 22, poziva `scripts/update-data.js`, a zatim commit-uje samo ako su JSON fajlovi promenjeni.

Ako API privremeno vrati grešku, skripta prekida rad **pre zamene postojećih JSON fajlova**. Postojeći validni feedovi zato ostaju netaknuti.

## Kako proveriti da li radi

### 1. Proveri Action

GitHub → `Actions` → `Update Niš air quality data`.

Uspešan run treba da završi korake:

- Checkout
- Setup Node.js
- Update JSON feeds
- Commit changed feeds

### 2. Proveri JSON

Otvori u repository-u:

- `data/nis-7d.json`
- `data/nis-30d.json`

Treba da postoje `generated_at_utc`, `stations`, `parameters` i `days`.

### 3. Proveri Pages

Na GitHub Pages sajtu prvo se učitava `nis-7d.json`. `nis-30d.json` se ne učitava dok korisnik ne pritisne **30 dana**.

### 4. Proveri osvežavanje

Posle uspešnog Action run-a proveri `generated_at_utc` u JSON-u i tekst `Osveženo` na sajtu.

## Važne napomene

- Podaci mogu biti preliminarni i naknadno se menjati.
- 30 dana je ograničenje koje trenutno navodi Kosava HVD API.
- Nema API ključa u frontend-u niti u GitHub Secrets jer aktuelni API ne zahteva autentikaciju.
- Ako se ID stanice promeni u budućnosti, potrebno je promeniti `STATION_IDS` u `scripts/update-data.js`.
- Aplikacija namerno ne koristi mapu, backend server niti CORS proxy.

## Izvori

- SEPA/Kosava API dokumentacija: https://opendata.kosava.cloud/api-docs
- HVD metadata: https://opendata.kosava.cloud/api/v1/metadata
- HVD stations: https://opendata.kosava.cloud/api/v1/stations?active=true
- HVD parameters: https://opendata.kosava.cloud/api/v1/parameters
- SEPA indeks kvaliteta vazduha i pragovi: https://vazduh.sepa.gov.rs/
