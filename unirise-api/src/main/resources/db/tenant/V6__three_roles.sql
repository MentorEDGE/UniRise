-- Three roles (BACKEND_PLAN phase 2, G1): the Office of Research, Top-Level Management and Faculty.
-- An account's role, name and status live here, in the institution's own database; its email and password hash are in
-- the control plane (account_login). role_grant, relationship and the scoped roles are parked (decision D3).
ALTER TABLE app_user
  ADD COLUMN role          TEXT CHECK (role IN ('office','management','faculty')),
  ADD COLUMN status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deactivated')),
  ADD COLUMN status_reason TEXT,
  ADD COLUMN name          TEXT,
  ADD COLUMN title         TEXT,
  ADD COLUMN designation   TEXT,
  ADD COLUMN department    TEXT,
  ADD COLUMN created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN created_by    TEXT;

-- Users from the old model: research administrators become the Office of Research, readers with an institution-wide
-- or scoped role become Top-Level Management, and anyone linked to a researcher becomes Faculty.
UPDATE app_user u SET status = CASE WHEN u.active THEN 'active' ELSE 'deactivated' END,
  role = CASE
    WHEN EXISTS (SELECT 1 FROM role_grant g WHERE g.app_user_id = u.id AND g.role IN ('RESEARCH_ADMIN','IT_ADMIN')) THEN 'office'
    WHEN EXISTS (SELECT 1 FROM role_grant g WHERE g.app_user_id = u.id AND g.role IN ('EXECUTIVE','DEAN','HOD','VIEWER')) THEN 'management'
    WHEN u.researcher_id IS NOT NULL THEN 'faculty'
    ELSE 'management' END,
  name = COALESCE((SELECT r.name FROM researcher r WHERE r.id = u.researcher_id), u.email);
ALTER TABLE app_user ALTER COLUMN role SET NOT NULL, ALTER COLUMN name SET NOT NULL, DROP COLUMN active;
-- A faculty account is linked to exactly one faculty profile, and a profile to at most one live account.
ALTER TABLE app_user ADD CONSTRAINT faculty_has_profile CHECK (role <> 'faculty' OR researcher_id IS NOT NULL);
CREATE UNIQUE INDEX app_user_one_live_account_per_profile ON app_user(researcher_id) WHERE researcher_id IS NOT NULL AND status <> 'deactivated';

-- What the Office of Research changed, readable by the Office (G23). Changes only, not reads (decision D7).
CREATE TABLE admin_log (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id BIGINT,                 -- null for the institution's service key
  actor_name    TEXT NOT NULL,
  action        TEXT NOT NULL,
  target        TEXT,
  detail        TEXT
);
CREATE INDEX admin_log_at ON admin_log(at DESC);
