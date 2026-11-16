-- Phase 3 (BACKEND_PLAN G4, G5, G8-G14, G16, G17, G21, G22, G28-G31, G35-G37).
-- The UI's data model (rdms-web/src/lib/types.ts) stored as it is: decision D2 keeps reports and analytics in the browser,
-- so the server keeps each record's fields as one JSON document and indexes only what it must check or query.

-- Faculty profile: official details on researcher (employee code = the faculty id shown everywhere).
ALTER TABLE researcher
  ADD COLUMN title        TEXT NOT NULL DEFAULT '',
  ADD COLUMN designation  TEXT NOT NULL DEFAULT '',
  ADD COLUMN department   TEXT NOT NULL DEFAULT '',
  ADD COLUMN phone        TEXT NOT NULL DEFAULT '',
  ADD COLUMN joining_date TEXT NOT NULL DEFAULT '',
  ADD COLUMN active       BOOLEAN NOT NULL DEFAULT true,   -- false = former faculty (G35)
  ADD COLUMN exit_reason  TEXT NOT NULL DEFAULT '',        -- Retired, Resigned, Transferred, Other
  ADD COLUMN exit_date    TEXT NOT NULL DEFAULT '';        -- last working day, yyyy-mm-dd

-- Biodata and researcher profile (G16, G36, G37): one JSON document per faculty member.
CREATE TABLE biodata (
  faculty    TEXT PRIMARY KEY,                -- employee code
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One counter per institution for display ids: PUB1001, GRT1002, SM1003, FDP1004, CNF1005, AWD1006, IPR1007, PRF1008, N1009 (G5).
CREATE SEQUENCE display_seq START 1001;

-- Every workflow record of the seven kinds (G8-G14). Status values and labels as in the UI:
-- Draft, Submitted, UnderReview (Under Review), Rework (Changes Requested), Approved, Rejected (G4).
CREATE TABLE record (
  id          TEXT PRIMARY KEY,                -- display id
  kind        TEXT NOT NULL CHECK (kind IN ('publications','grants','seedMoney','fdps','conferences','awards','ipr')),
  owner       TEXT NOT NULL,                   -- employee code of the faculty member who entered it
  status      TEXT NOT NULL CHECK (status IN ('Draft','Submitted','UnderReview','Approved','Rework','Rejected')),
  data        JSONB NOT NULL,                  -- the kind's fields (types.ts), never workflow fields
  custom      JSONB NOT NULL DEFAULT '{}',     -- institution-defined custom fields (G29)
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  version     INT NOT NULL DEFAULT 0
);
CREATE INDEX record_kind_status ON record(kind, status);
CREATE INDEX record_owner ON record(owner);
CREATE UNIQUE INDEX record_doi ON record(lower(data->>'doi')) WHERE kind = 'publications' AND coalesce(data->>'doi', '') <> '';
CREATE UNIQUE INDEX record_ip_number ON record(lower(data->>'applicationNumber')) WHERE kind = 'ipr' AND coalesce(data->>'applicationNumber', '') <> '';

-- Faculty credited on a record: the owner plus internal faculty co-authors and co-investigators (G15).
CREATE TABLE record_credit (
  record_id TEXT NOT NULL REFERENCES record(id) ON DELETE CASCADE,
  faculty   TEXT NOT NULL,
  PRIMARY KEY (record_id, faculty)
);
CREATE INDEX record_credit_faculty ON record_credit(faculty);

-- A faculty member's proposed profile update, reviewed like an entry (G17). One open request per person.
CREATE TABLE profile_change (
  id         TEXT PRIMARY KEY,
  faculty    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Draft','Submitted','UnderReview','Approved','Rework','Rejected')),
  biodata    JSONB NOT NULL,
  contact    JSONB NOT NULL,
  changed    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX profile_change_faculty ON profile_change(faculty);

-- History of records and profile updates: who did what and when, with comments and replies (G6, G39).
CREATE TABLE record_event (
  id        BIGSERIAL PRIMARY KEY,
  record_id TEXT NOT NULL,                    -- a record id or a profile_change id
  at        TIMESTAMPTZ NOT NULL,
  by_name   TEXT NOT NULL,
  action    TEXT NOT NULL,
  remark    TEXT
);
CREATE INDEX record_event_record ON record_event(record_id, id);

-- Notices from the Office of Research to faculty (G22).
CREATE TABLE notice (
  id    TEXT PRIMARY KEY,
  at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL,
  body  TEXT NOT NULL DEFAULT ''
);

-- Institution settings (G21, G28-G31): name, tagline, departments, academic-year start, seed-money window, targets,
-- score weights; plus enabled features, custom field definitions and option lists, with the UI's defaults.
CREATE TABLE settings (
  id   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data JSONB NOT NULL
);
