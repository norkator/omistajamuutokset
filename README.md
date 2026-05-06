# omistajamuutokset

Osakkeenomistajien muutokset dashboardi.

## Kehitys

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

Build lukee yhtiökohtaiset Excel-tiedostot kansioista kuten `optomed/shareholder_files/` ja generoi staattisen sivun
`dist/`-kansioon.

## GitHub Pages

Repo sisältää GitHub Actions -workflow'n, joka buildaa ja deployaa `dist/`-kansion GitHub Pagesiin pushista
`main`-haaraan. `Dockerfile` ja `nginx.conf` säilyvät repossa mahdollista myöhempää container-deployta varten.
