-- Each institution's own sending address (2026-11-23): emails to its people (temporary passwords, password links,
-- decisions, submission notices) come from the Office of Research's address, never from UniRise. The address's domain
-- is registered with Amazon SES and proven with DKIM DNS records the institution's IT adds; until then no email is sent.
CREATE TABLE institution_mail (
  institution_id BIGINT PRIMARY KEY REFERENCES institution(id) ON DELETE CASCADE,
  from_address   TEXT NOT NULL,
  from_name      TEXT NOT NULL,
  domain         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  dns            JSONB NOT NULL DEFAULT '[]',
  checked_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX institution_mail_domain ON institution_mail(domain);
