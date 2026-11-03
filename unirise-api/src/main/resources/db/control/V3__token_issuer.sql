ALTER TABLE user_token ADD COLUMN issued_by BIGINT; -- tenant app_user id of the admin who issued an invitation (null for the service key)
