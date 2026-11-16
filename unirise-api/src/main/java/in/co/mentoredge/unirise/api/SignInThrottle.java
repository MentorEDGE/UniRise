package in.co.mentoredge.unirise.api;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Failed sign-ins: 5 per email or 20 per client address within 15 minutes lock that key for the rest of the window.
 * Kept in the control-plane database so restarts and multiple tasks share the count.
 */
@Service
public class SignInThrottle {
	static final int PER_EMAIL = 5, PER_ADDRESS = 20, WINDOW_MINUTES = 15;
	private final JdbcClient control;

	public SignInThrottle(@Qualifier("controlJdbc") JdbcClient control) { this.control = control; }

	public boolean blocked(String key, int limit) {
		return control.sql("SELECT count(*) FROM sign_in_failure WHERE key = :k AND failures >= :l AND window_end > now()")
			.param("k", key).param("l", limit).query(Long.class).single() > 0;
	}

	public void fail(String key) {
		control.sql("""
			INSERT INTO sign_in_failure(key, failures, window_end) VALUES (:k, 1, now() + make_interval(mins => :w))
			ON CONFLICT (key) DO UPDATE SET
			  failures = CASE WHEN sign_in_failure.window_end > now() THEN sign_in_failure.failures + 1 ELSE 1 END,
			  window_end = now() + make_interval(mins => :w)""")
			.param("k", key).param("w", WINDOW_MINUTES).update();
	}

	public void clear(String key) { control.sql("DELETE FROM sign_in_failure WHERE key = :k").param("k", key).update(); }
}
