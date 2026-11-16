package in.co.mentoredge.unirise.api;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** The institution's audit log of changes made by the Office of Research and of sign-ins to Office accounts (G23, D7). */
@Service
public class AdminLog {
	private final JdbcClient db;

	public AdminLog(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	public void record(Actor by, String action, String target, String detail) {
		db.sql("INSERT INTO admin_log(actor_user_id, actor_name, action, target, detail) VALUES (:u, :n, :a, :t, :d)")
			.param("u", by == null ? null : by.userId()).param("n", by == null ? "UniRise" : by.name()).param("a", action).param("t", target).param("d", detail).update();
	}
}
