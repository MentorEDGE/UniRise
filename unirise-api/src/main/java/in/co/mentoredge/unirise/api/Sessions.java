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

	/** As {@link #start}, remembering the browser and address so the person can recognise their signed-in devices. */
	public String start(long institutionId, long userId, boolean office, String userAgent, String ip) {
		String token = start(institutionId, userId, office);
		control.sql("UPDATE user_token SET user_agent = :ua, ip = :ip WHERE token_hash = :h")
			.param("ua", userAgent == null ? null : userAgent.substring(0, Math.min(300, userAgent.length()))).param("ip", ip).param("h", Provisioner.hash(token)).update();
		return token;
	}

	/** The half-finished sign-in between the password and the authenticator code: 10 minutes, nothing else allowed. */
	public String startTwoStep(long institutionId, long userId) {
		String token = Provisioner.randomHex(32);
		control.sql("INSERT INTO user_token(token_hash, institution_id, app_user_id, kind, expires_at) VALUES (:h, :i, :u, 'mfa', now() + interval '10 minutes')")
			.param("h", Provisioner.hash(token)).param("i", institutionId).param("u", userId).update();
		return token;
	}

	/** {institutionId, userId} of a live half-finished sign-in. */
	public Optional<long[]> readTwoStep(String token) {
		if (token == null || token.isEmpty() || token.length() > 200) return Optional.empty();
		return control.sql("SELECT institution_id, app_user_id FROM user_token WHERE token_hash = :h AND kind = 'mfa' AND expires_at > now()")
			.param("h", Provisioner.hash(token)).query((r, n) -> new long[] { r.getLong(1), r.getLong(2) }).optional();
	}

	public void endTwoStep(String token) {
		if (token != null && !token.isEmpty() && token.length() <= 200) control.sql("DELETE FROM user_token WHERE token_hash = :h AND kind = 'mfa'").param("h", Provisioner.hash(token)).update();
	}

	/** The person's signed-in browsers, most recently active first; id is a short prefix of the stored hash. */
	public java.util.List<java.util.Map<String, Object>> list(long institutionId, long userId, String currentHash) {
		return control.sql("SELECT token_hash, created_at, last_seen_at, user_agent, ip FROM user_token WHERE kind = 'session' AND institution_id = :i AND app_user_id = :u"
			+ " AND expires_at > now() AND (idle_seconds IS NULL OR last_seen_at + make_interval(secs => idle_seconds) > now()) ORDER BY last_seen_at DESC")
			.param("i", institutionId).param("u", userId).query((r, n) -> {
				java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
				m.put("id", r.getString("token_hash").substring(0, 16));
				m.put("signedInAt", r.getTimestamp("created_at").toInstant().toString());
				m.put("lastActiveAt", r.getTimestamp("last_seen_at") == null ? null : r.getTimestamp("last_seen_at").toInstant().toString());
				m.put("browser", r.getString("user_agent"));
				m.put("ip", r.getString("ip"));
				m.put("current", r.getString("token_hash").equals(currentHash));
				return m;
			}).list();
	}

	/** Signs out one of the person's own sessions, by its id. */
	public boolean endOne(long institutionId, long userId, String id) {
		if (id == null || !id.matches("[0-9a-f]{16}")) return false;
		return control.sql("DELETE FROM user_token WHERE kind = 'session' AND institution_id = :i AND app_user_id = :u AND left(token_hash, 16) = :id")
			.param("i", institutionId).param("u", userId).param("id", id).update() > 0;
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

	public void end(String token) {
		if (token != null && !token.isEmpty() && token.length() <= 200) control.sql("DELETE FROM user_token WHERE token_hash = :h AND kind = 'session'").param("h", Provisioner.hash(token)).update();
	}

	/** Signs the user out everywhere, optionally keeping the session the request came from. */
	public void endAll(long institutionId, long userId, String exceptHash) {
		control.sql("DELETE FROM user_token WHERE kind = 'session' AND institution_id = :i AND app_user_id = :u AND token_hash <> :keep")
			.param("i", institutionId).param("u", userId).param("keep", exceptHash == null ? "" : exceptHash).update();
	}
}
