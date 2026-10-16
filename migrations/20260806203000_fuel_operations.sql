CREATE TABLE IF NOT EXISTS fuel_stations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  address text,
  manager_name text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_stations_org_code_uidx UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  code text NOT NULL,
  product_type text NOT NULL,
  storage_type text NOT NULL DEFAULT 'underground_tank',
  capacity_litres real NOT NULL CHECK (capacity_litres > 0),
  current_level_litres real NOT NULL DEFAULT 0 CHECK (current_level_litres >= 0),
  reorder_level_litres real NOT NULL DEFAULT 0 CHECK (reorder_level_litres >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_tanks_station_code_uidx UNIQUE (station_id, code),
  CONSTRAINT fuel_tanks_level_capacity_chk CHECK (current_level_litres <= capacity_litres),
  CONSTRAINT fuel_tanks_reorder_capacity_chk CHECK (reorder_level_litres <= capacity_litres)
);

CREATE TABLE IF NOT EXISTS fuel_pumps (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  tank_id integer NOT NULL REFERENCES fuel_tanks(id),
  code text NOT NULL,
  current_meter_litres real NOT NULL DEFAULT 0 CHECK (current_meter_litres >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_pumps_station_code_uidx UNIQUE (station_id, code)
);

CREATE TABLE IF NOT EXISTS fuel_tank_readings (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  tank_id integer NOT NULL REFERENCES fuel_tanks(id),
  level_litres real NOT NULL CHECK (level_litres >= 0),
  water_level_mm real NOT NULL DEFAULT 0 CHECK (water_level_mm >= 0),
  temperature_c real,
  source text NOT NULL DEFAULT 'manual',
  recorded_by integer,
  recorded_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  tank_id integer NOT NULL REFERENCES fuel_tanks(id),
  supplier_id integer REFERENCES suppliers(id),
  delivery_reference text NOT NULL,
  quantity_litres real NOT NULL CHECK (quantity_litres > 0),
  unit_cost real CHECK (unit_cost IS NULL OR unit_cost >= 0),
  status text NOT NULL DEFAULT 'received',
  delivered_at timestamp NOT NULL DEFAULT now(),
  received_by integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_shift_reconciliations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  pump_id integer NOT NULL REFERENCES fuel_pumps(id),
  opening_meter_litres real NOT NULL CHECK (opening_meter_litres >= 0),
  closing_meter_litres real NOT NULL CHECK (closing_meter_litres >= opening_meter_litres),
  measured_sales_litres real NOT NULL CHECK (measured_sales_litres >= 0),
  reported_sales_litres real NOT NULL CHECK (reported_sales_litres >= 0),
  sales_amount real NOT NULL DEFAULT 0 CHECK (sales_amount >= 0),
  variance_litres real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'balanced',
  shift_started_at timestamp NOT NULL,
  shift_ended_at timestamp NOT NULL,
  recorded_by integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_shift_time_chk CHECK (shift_ended_at >= shift_started_at)
);

CREATE TABLE IF NOT EXISTS fuel_prices (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  product_type text NOT NULL,
  price_per_litre real NOT NULL CHECK (price_per_litre > 0),
  effective_from timestamp NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_safety_inspections (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  tank_id integer REFERENCES fuel_tanks(id),
  inspection_type text NOT NULL,
  result text NOT NULL,
  checklist jsonb,
  notes text,
  next_due_at timestamp,
  inspected_at timestamp NOT NULL DEFAULT now(),
  inspector_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_cylinders (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  station_id integer NOT NULL REFERENCES fuel_stations(id),
  serial_number text NOT NULL,
  gas_family text NOT NULL DEFAULT 'LPG',
  capacity_kg real NOT NULL CHECK (capacity_kg > 0),
  tare_weight_kg real CHECK (tare_weight_kg IS NULL OR tare_weight_kg > 0),
  status text NOT NULL DEFAULT 'full',
  test_due_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_cylinders_org_serial_uidx UNIQUE (organization_id, serial_number)
);

CREATE INDEX IF NOT EXISTS fuel_tanks_org_station_idx ON fuel_tanks (organization_id, station_id, status);
CREATE INDEX IF NOT EXISTS fuel_pumps_org_station_idx ON fuel_pumps (organization_id, station_id, status);
CREATE INDEX IF NOT EXISTS fuel_readings_org_recorded_idx ON fuel_tank_readings (organization_id, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fuel_deliveries_org_delivered_idx ON fuel_deliveries (organization_id, delivered_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fuel_shifts_org_created_idx ON fuel_shift_reconciliations (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fuel_prices_org_active_idx ON fuel_prices (organization_id, station_id, active, effective_from DESC);
CREATE INDEX IF NOT EXISTS fuel_inspections_org_due_idx ON fuel_safety_inspections (organization_id, next_due_at, result);
CREATE INDEX IF NOT EXISTS fuel_cylinders_org_station_idx ON fuel_cylinders (organization_id, station_id, status);
