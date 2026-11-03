ALTER TABLE institution ADD COLUMN closing_since TIMESTAMPTZ;

CREATE TABLE usage_counter (
  institution_id    BIGINT NOT NULL REFERENCES institution(id),
  month             DATE NOT NULL,
  active_researchers INT NOT NULL,
  PRIMARY KEY (institution_id, month)
);
