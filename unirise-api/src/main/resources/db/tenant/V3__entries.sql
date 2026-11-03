CREATE TABLE publication (
  id                  BIGSERIAL PRIMARY KEY,
  title               TEXT NOT NULL,
  doi                 TEXT,
  venue               TEXT,
  type                TEXT NOT NULL CHECK (type IN ('journal-article','conference-paper','book-chapter','book','technical-report','preprint','patent')),
  pub_year            INT NOT NULL CHECK (pub_year BETWEEN 1900 AND 2100),
  pub_month           INT CHECK (pub_month BETWEEN 1 AND 12),
  issn                TEXT,
  category            TEXT,
  project_ref         BOOLEAN NOT NULL DEFAULT false,
  project_details     TEXT,
  student_publication BOOLEAN NOT NULL DEFAULT false,
  entry_status        TEXT NOT NULL DEFAULT 'draft' CHECK (entry_status IN ('draft','submitted','approved','rework','revision_required','rejected')),
  review_comment      TEXT,
  owner_id            BIGINT NOT NULL REFERENCES researcher(id),
  version             INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publication_doi ON publication(lower(doi)) WHERE doi IS NOT NULL;
CREATE INDEX publication_owner ON publication(owner_id);
CREATE INDEX publication_year ON publication(pub_year);

CREATE TABLE publication_author (
  id             BIGSERIAL PRIMARY KEY,
  publication_id BIGINT NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
  position       INT NOT NULL,
  researcher_id  BIGINT REFERENCES researcher(id),
  kind           TEXT NOT NULL CHECK (kind IN ('internal-faculty','internal-student','external','ex-faculty','ex-student')),
  name           TEXT NOT NULL,
  institution    TEXT,
  department     TEXT,
  email          TEXT,
  end_date       DATE,
  continent      TEXT
);
CREATE INDEX publication_author_pub ON publication_author(publication_id);
CREATE INDEX publication_author_researcher ON publication_author(researcher_id);

CREATE TABLE research_grant (
  id               BIGSERIAL PRIMARY KEY,
  unit             TEXT,
  type             TEXT,
  source           TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','sanctioned','rework','rejected')),
  utn              TEXT,
  title            TEXT NOT NULL,
  description      TEXT,
  call_title       TEXT,
  agency           TEXT,
  agency_comment   TEXT,
  applied_on       DATE,
  entered_on       DATE NOT NULL DEFAULT current_date,
  sanctioned_on    DATE,
  applied_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (applied_amount >= 0),
  sanctioned_amount NUMERIC(14,2) CHECK (sanctioned_amount >= 0),
  duration_months  INT,
  matching_grant   BOOLEAN NOT NULL DEFAULT false,
  remarks          TEXT,
  review_comment   TEXT,
  owner_id         BIGINT NOT NULL REFERENCES researcher(id),
  version          INT NOT NULL DEFAULT 0
);
CREATE INDEX research_grant_owner ON research_grant(owner_id);

CREATE TABLE grant_investigator (
  id            BIGSERIAL PRIMARY KEY,
  grant_id      BIGINT NOT NULL REFERENCES research_grant(id) ON DELETE CASCADE,
  researcher_id BIGINT REFERENCES researcher(id),
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('PI','Co-PI','Collaborator')),
  is_lead       BOOLEAN NOT NULL DEFAULT false,
  institution   TEXT,
  department    TEXT,
  share_pct     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (share_pct BETWEEN 0 AND 100)
);

CREATE TABLE seed_window (
  id        BIGSERIAL PRIMARY KEY,
  label     TEXT NOT NULL,
  opens_on  DATE NOT NULL,
  closes_on DATE NOT NULL,
  CHECK (closes_on >= opens_on)
);

CREATE TABLE seed_proposal (
  id             BIGSERIAL PRIMARY KEY,
  window_id      BIGINT NOT NULL REFERENCES seed_window(id),
  category       TEXT,
  title          TEXT NOT NULL,
  abstract       TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rework','revision_required','rejected')),
  applied_on     DATE NOT NULL DEFAULT current_date,
  review_comment TEXT,
  owner_id       BIGINT NOT NULL REFERENCES researcher(id),
  version        INT NOT NULL DEFAULT 0
);

CREATE TABLE seed_investigator (
  id            BIGSERIAL PRIMARY KEY,
  proposal_id   BIGINT NOT NULL REFERENCES seed_proposal(id) ON DELETE CASCADE,
  researcher_id BIGINT REFERENCES researcher(id),
  name          TEXT NOT NULL,
  investigator_type TEXT,
  is_lead_pi    BOOLEAN NOT NULL DEFAULT false,
  institution   TEXT,
  department    TEXT
);

-- Workflow history for every reviewable entry.
CREATE TABLE review_event (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('publication','grant','seed')),
  entity_id     BIGINT NOT NULL,
  action        TEXT NOT NULL,
  actor_user_id BIGINT,
  comment       TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX review_event_entity ON review_event(entity_type, entity_id);
