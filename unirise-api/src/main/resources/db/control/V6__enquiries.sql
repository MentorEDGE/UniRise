-- "Talk to Our Team" enquiries from the public site (G24). Stored first, so nothing is lost when email is not set up;
-- delivered/delivery_note record whether the email to the team went out (SES, phase 7).
CREATE TABLE enquiry (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  data          JSONB NOT NULL,
  delivered     BOOLEAN NOT NULL DEFAULT false,
  delivery_note TEXT
);
