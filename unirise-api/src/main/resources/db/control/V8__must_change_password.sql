-- A password someone else chose (a temporary password from the Office of Research or the UniRise team, including one
-- sent in the account's welcome email) must be replaced by the person at their next sign-in (2026-11-21).
ALTER TABLE account_login ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
