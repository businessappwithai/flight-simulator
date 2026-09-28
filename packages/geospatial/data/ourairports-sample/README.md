# OurAirports-format sample

A small, hand-assembled sample in the exact column layout of OurAirports' `airports.csv` and `runways.csv`
(https://ourairports.com/data/), used by tests and the route demo when the full dataset is not downloaded.
`XX01` is fictional (a grass strip for small-airport tests). Airport reference points, elevations and runway lengths/headings are approximate; runway threshold coordinates are
left blank, so `runwayGeometry` synthesizes them (and marks them `synthesized`).

For real use, download the current files (public domain, updated daily):

```bash
curl -LO https://davidmegginson.github.io/ourairports-data/airports.csv
curl -LO https://davidmegginson.github.io/ourairports-data/runways.csv
```
