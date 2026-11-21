package in.co.mentoredge.unirise.api;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Writes in-app notifications (tenant table {@code notification}). Faculty: decisions on their entries and profile
 * updates, funding outcomes, new notices. Office of Research: new submissions and resubmissions. Links are the
 * website's own paths (the hash part), opened when the notification is clicked.
 */
@Component
public class Notifier {
	private static final Logger log = LoggerFactory.getLogger(Notifier.class);
	static final Map<String, String> LABEL = Map.of("publications", "Publication", "grants", "Grant", "seedMoney", "Seed money proposal", "fdps", "FDP",
		"conferences", "Conference", "awards", "Honour / award", "ipr", "Intellectual property", "profiles", "Profile update");
	private final JdbcClient db;

	public Notifier(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	/** The active faculty account(s) of a faculty member, by employee code. */
	public void faculty(String code, String title, String body, String link) {
		safely(() -> db.sql("""
			INSERT INTO notification(app_user_id, title, body, link)
			SELECT u.id, :t, :b, :l FROM app_user u JOIN researcher r ON r.id = u.researcher_id
			WHERE r.employee_id = :c AND u.role = 'faculty' AND u.status = 'active'""")
			.param("t", cut(title, 200)).param("b", cut(body, 1000)).param("l", cut(link, 200)).param("c", code).update());
	}

	/** Every active Office of Research account. */
	public void office(String title, String body, String link) { toRole("office", title, body, link); }

	/** Every active faculty account (a new notice). */
	public void allFaculty(String title, String body, String link) { toRole("faculty", title, body, link); }

	private void toRole(String role, String title, String body, String link) {
		safely(() -> db.sql("INSERT INTO notification(app_user_id, title, body, link) SELECT id, :t, :b, :l FROM app_user WHERE role = :r AND status = 'active'")
			.param("t", cut(title, 200)).param("b", cut(body, 1000)).param("l", cut(link, 200)).param("r", role).update());
	}

	/** A notification never stops the action that caused it (for example before an institution's database is migrated). */
	private static void safely(Runnable write) {
		try { write.run(); } catch (RuntimeException e) { log.warn("Notification not saved: {}", e.getMessage()); }
	}

	/** A record's name for messages: its title (or conference name). */
	static String nameOf(Map<String, Object> r) {
		String t = Json.str(r.get("title"), 160).trim();
		if (t.isEmpty()) t = Json.str(r.get("conferenceName"), 160).trim();
		return t.isEmpty() ? "" : "“" + t + "”";
	}

	private static String cut(String s, int max) { s = s == null ? "" : s.replaceAll("[\\p{Cntrl}]", " ").trim(); return s.length() > max ? s.substring(0, max - 1) + "…" : s; }

	/** Latest 50 for one account, newest first. */
	List<Map<String, Object>> latest(long userId) {
		return db.sql("SELECT id, at, title, body, link, read_at FROM notification WHERE app_user_id = :u ORDER BY at DESC, id DESC LIMIT 50").param("u", userId)
			.query((r, n) -> Json.of("id", r.getLong("id"), "at", r.getTimestamp("at").toInstant().toString(), "title", r.getString("title"), "body", r.getString("body"),
				"link", r.getString("link"), "read", r.getTimestamp("read_at") != null)).list();
	}

	long unread(long userId) { return db.sql("SELECT count(*) FROM notification WHERE app_user_id = :u AND read_at IS NULL").param("u", userId).query(Long.class).single(); }

	void markRead(long userId, List<Long> ids) {
		if (ids == null) db.sql("UPDATE notification SET read_at = now() WHERE app_user_id = :u AND read_at IS NULL").param("u", userId).update();
		else if (!ids.isEmpty()) db.sql("UPDATE notification SET read_at = now() WHERE app_user_id = :u AND read_at IS NULL AND id IN (:ids)").param("u", userId).param("ids", ids).update();
	}
}
