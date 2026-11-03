-- TinkrkniT schema. Applied automatically on first run by src/Db.php.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A project is the whole design: tile, panel size, palette, meta.
-- The document itself lives in `doc` as JSON so the shape can evolve without
-- migrations. Columns are only the fields we need to list/sort/search on.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  machine     TEXT    NOT NULL DEFAULT 'sk840',
  tile_w      INTEGER NOT NULL DEFAULT 24,
  tile_h      INTEGER NOT NULL DEFAULT 24,
  panel_w     INTEGER NOT NULL DEFAULT 120,
  panel_h     INTEGER NOT NULL DEFAULT 160,
  doc         TEXT    NOT NULL,
  thumbnail   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- Yarn stock. A palette slot may bind to a yarn id; the slot keeps its own
-- color copy so a deleted yarn never corrupts a design.
CREATE TABLE IF NOT EXISTS yarns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  brand       TEXT    NOT NULL DEFAULT '',
  color       TEXT    NOT NULL,
  fiber       TEXT    NOT NULL DEFAULT '',
  weight      TEXT    NOT NULL DEFAULT '',
  grams       REAL    NOT NULL DEFAULT 0,
  notes       TEXT    NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_yarns_name ON yarns(name);

-- Reusable color palettes, independent of any one project.
CREATE TABLE IF NOT EXISTS palettes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slots       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Stamps: small reusable index grids, either drawn in the stamp editor or
-- captured from a selection on the canvas.
CREATE TABLE IF NOT EXISTS stamps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  tags        TEXT    NOT NULL DEFAULT '',
  w           INTEGER NOT NULL,
  h           INTEGER NOT NULL,
  cells       TEXT    NOT NULL,
  colors      TEXT    NOT NULL DEFAULT '[]',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stamps_name ON stamps(name);

-- Machine gauge presets so the gauge calculator remembers real swatches.
CREATE TABLE IF NOT EXISTS gauges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  yarn_note     TEXT    NOT NULL DEFAULT '',
  tension       TEXT    NOT NULL DEFAULT '',
  sts_per_10cm  REAL    NOT NULL,
  rows_per_10cm REAL    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
