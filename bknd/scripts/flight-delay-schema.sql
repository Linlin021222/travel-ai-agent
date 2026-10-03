-- Aggregated airline on-time / delay-cause statistics.
-- Grain: one row per (year, month, carrier, arrival airport).
-- Source: BTS flight-level archive files (trip_airline_delay/*.csv).

CREATE TABLE IF NOT EXISTS flight_delay (
  id              BIGSERIAL PRIMARY KEY,
  year            SMALLINT         NOT NULL,
  month           SMALLINT         NOT NULL,
  carrier_code    TEXT             NOT NULL,
  carrier_name    TEXT             NOT NULL,
  airport_code    TEXT             NOT NULL,
  airport_name    TEXT             NOT NULL,
  arr_flights         DOUBLE PRECISION NOT NULL DEFAULT 0,
  arr_del15           DOUBLE PRECISION NOT NULL DEFAULT 0,
  carrier_ct          DOUBLE PRECISION NOT NULL DEFAULT 0,
  weather_ct          DOUBLE PRECISION NOT NULL DEFAULT 0,
  nas_ct              DOUBLE PRECISION NOT NULL DEFAULT 0,
  security_ct         DOUBLE PRECISION NOT NULL DEFAULT 0,
  late_aircraft_ct    DOUBLE PRECISION NOT NULL DEFAULT 0,
  arr_cancelled       DOUBLE PRECISION NOT NULL DEFAULT 0,
  arr_diverted        DOUBLE PRECISION NOT NULL DEFAULT 0,
  arr_delay           DOUBLE PRECISION NOT NULL DEFAULT 0,
  carrier_delay       DOUBLE PRECISION NOT NULL DEFAULT 0,
  weather_delay       DOUBLE PRECISION NOT NULL DEFAULT 0,
  nas_delay           DOUBLE PRECISION NOT NULL DEFAULT 0,
  security_delay      DOUBLE PRECISION NOT NULL DEFAULT 0,
  late_aircraft_delay DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT flight_delay_grain_unique UNIQUE (year, month, carrier_code, airport_code)
);

CREATE INDEX IF NOT EXISTS idx_flight_delay_year_month
  ON flight_delay (year, month);
CREATE INDEX IF NOT EXISTS idx_flight_delay_carrier
  ON flight_delay (carrier_code);
CREATE INDEX IF NOT EXISTS idx_flight_delay_airport
  ON flight_delay (airport_code);
CREATE INDEX IF NOT EXISTS idx_flight_delay_carrier_airport
  ON flight_delay (carrier_code, airport_code);
CREATE INDEX IF NOT EXISTS idx_flight_delay_year_month_carrier_airport
  ON flight_delay (year, month, carrier_code, airport_code);
