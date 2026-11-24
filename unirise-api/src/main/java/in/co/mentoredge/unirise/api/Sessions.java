package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Provisioner;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Browser sessions (BACKEND_PLAN G2), stored as hashes in the control plane's user_token table so they survive a restart
 * and work across tasks. A session ends after 8 hours without use (30 minutes for the Office of Research) or 12 hours
 * after sign-in, whichever comes first, and whenever the account is suspended, its role changes or its password is reset.
 */
@Service
public class Sessions {
	public static final String COOKIE = "unirise_sid";
	static final int USER_IDLE_SECONDS = 8 * 3600, OFFICE_IDLE_SECONDS = 30 * 60, ABSOLUTE_HOURS = 12;

	public record Session(long institutionId, long userId, String tokenHash) {}

	private final JdbcClient control;

	public Sessions(@Qualifier("controlJdbc") JdbcClient control) { this.control = control; }

	/** Starts a session and returns the token for the cookie; only its hash is stored. */
	public String start(long institutionId, long userId, boolean office) {
		String token = Provisioner.randomHex(32);
		control.sql("""
			INSERT INTO user_token(token_hash, institution_id, app_user_id, kind, expires_at, last_seen_at, idle_seconds)
			VALUES (:h, :i, :u, 'session', now() + make_interval(hours => :abs), now(), :idle)""")
			.param("h", Provisioner.hash(token)).param("i", institutionId).param("u", userId).param("abs", ABSOLUTE_HOURS)
			.param("idle", office ? OFFICE_IDLE_SECONDS : USER_IDLE_SECONDS).update();
		return token;
	}

	/** A live session for this cookie value, with its idle timeout slid forward; empty when expired or unknown. */
	public Optional<Session> read(String token) {
		if (token == null || token.isEmpty() || token.length() > 200) return Optional.empty();
		String h = Provisioner.hash(token);
		var s = control.sql("""
			SELECT institution_id, app_user_id FROM user_token
			WHERE token_hash = :h AND kind = 'session' AND expires_at > now()
			AND (idle_seconds IS NULL OR last_seen_at + make_interval(secs => idle_seconds) > now())""")
			.param("h", h).query((r, n) -> new Session(r.getLong("institution_id"), r.getLong("app_user_id"), h)).optional();
		if (s.isEmpty()) { end(token); return s; }
		// Slide the idle timeout, at most once a minute so reads do not turn into a write per request.
		control.sql("UPDATE user_token SET last_seen_at = now() WHERE token_hash = :h AND last_seen_at < now() - interval '1 minute'").param("h", h).update();
		return s;
	}

	/** The password was just confirmed in this session (sensitive actions are allowed for a few minutes). */
	public void confirm(String tokenHash) {
		control.sql("UPDATE user_token SET confirmed_at = now() WHERE token_hash = :h AND kind = 'session'").param("h", tokenHash).update();
	}

	/** Whether this session confirmed the password within the last {@code seconds}. */
	public boolean confirmedWithin(String tokenHash, int seconds) {
		return tokenHash != null && control.sql("SELECT count(*) FROM user_token WHERE token_hash = :h AND kind = 'session' AND confirmed_at > now() - make_interval(secs => :s)")
			.param("h", tokenHash).param("s", seconds).query(Long.class).single() > 0;
	}

	public void end(String token) {
		if (token != null && !token.isEmpty() && token.length() <= 200) control.sql("DELETE FROM user_token WHERE token_hash = :h AND kind = 'session'").param("h", Provisioner.hash(token)).update();
	}

	/** Signs the user out everywhere, optionally keeping the session the request came from. */
	public void endAll(long institutionId, long userId, String exceptHash) {
		control.sql("DELETE FROM user_token WHERE kind = 'session' AND institution_id = :i AND app_user_id = :u AND token_hash <> :keep")
			.param("i", institutionId).param("u", userId).param("keep", exceptHash == null ? "" : exceptHash).update();
	}
}
