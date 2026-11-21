-- In-app notifications (QA follow-up 2026-11-21): a faculty member hears about decisions on their entries and profile
-- updates and about new notices; the Office of Research hears about new submissions. Each person marks them as read.
CREATE TABLE notification (
  id          BIGSERIAL PRIMARY KEY,
  app_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  read_at     TIMESTAMPTZ
);
CREATE INDEX notification_user ON notification(app_user_id, read_at, at DESC);
