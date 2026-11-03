CREATE TABLE tenant_settings (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  escalation_days INT NOT NULL DEFAULT 30 CHECK (escalation_days BETWEEN 1 AND 365)
);
INSERT INTO tenant_settings DEFAULT VALUES;

CREATE TABLE milestone (
  id           BIGSERIAL PRIMARY KEY,
  scholar_id   BIGINT NOT NULL REFERENCES researcher(id),
  stage        TEXT NOT NULL,
  due_date     DATE NOT NULL,
  completed_at DATE,
  approved_by  BIGINT REFERENCES researcher(id),
  approved_on  DATE,
  feedback     TEXT
);
CREATE INDEX milestone_scholar ON milestone(scholar_id);

-- Confidential: readable only by the scholar and their active supervisors. Never part of any rollup or admin view.
CREATE TABLE meeting_log (
  id         BIGSERIAL PRIMARY KEY,
  scholar_id BIGINT NOT NULL REFERENCES researcher(id),
  mentor_id  BIGINT NOT NULL REFERENCES researcher(id),
  held_on    DATE NOT NULL,
  notes      TEXT NOT NULL
);
CREATE INDEX meeting_log_scholar ON meeting_log(scholar_id);

CREATE TABLE project (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  lead_id     BIGINT NOT NULL REFERENCES researcher(id),
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('active','completed','proposed')),
  summary     TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('internal','confidential'))
);

CREATE TABLE project_member (
  project_id    BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  researcher_id BIGINT NOT NULL REFERENCES researcher(id),
  PRIMARY KEY (project_id, researcher_id)
);
