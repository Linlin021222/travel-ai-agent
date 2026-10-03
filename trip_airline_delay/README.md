# Raw flight data (not committed)

This directory holds the raw **BTS Airline On-Time Performance** archives (one CSV per year, 2009–2018, ~7.2 GB in total). They are excluded from Git by `.gitignore` because of their size.

## Download

1. Open the [BTS TranStats on-time performance download page](https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ&QO_fu146_anzr=b0-gvzr).
2. Select years 2009–2018 and all fields used by the ingestion script
   (`FL_DATE, OP_CARRIER, OP_CARRIER_FL_NUM, ORIGIN, DEST, CRS_DEP_TIME, DEP_TIME,
   DEP_DELAY, TAXI_OUT, WHEELS_OFF, WHEELS_ON, TAXI_IN, CRS_ARR_TIME, ARR_TIME,
   ARR_DELAY, CANCELLED, CANCELLATION_CODE, DIVERTED, CRS_ELAPSED_TIME,
   ACTUAL_ELAPSED_TIME, AIR_TIME, DISTANCE, CARRIER_DELAY, WEATHER_DELAY,
   NAS_DELAY, SECURITY_DELAY, LATE_AIRCRAFT_DELAY`).
3. Save each year as `<year>.csv` in this directory.

## Ingest

```bash
cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d
cd bknd
npm install
npm run ingest:flight-delay   # 61,556,974 rows -> 150,860 aggregated rows
```

The ingestion script aggregates flight-level rows to a
`year + month + carrier + arrival airport` grain with 21 business measures.
See `bknd/scripts/flight-delay-schema.sql` for the table definition and indexes.
