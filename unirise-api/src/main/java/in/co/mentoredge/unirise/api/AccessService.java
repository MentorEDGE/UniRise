package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.HashSet;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The three-role access model (BACKEND_PLAN G1, ACCESS_AND_VISIBILITY_MODEL.md). Every read and write of people data goes
 * through here:
 * - Office of Research: the whole institution, every status; administers accounts and settings; the only reviewer.
 * - Top-Level Management: the whole institution, read-only, approved records only (enforced in EntryWorkflow).
 * - Faculty: their own profile and the records they are credited on.
 */
@Service
public class AccessService {
	/** all = no restriction; otherwise only these researcher ids. */
	public record Visible(boolean all, Set<Long> ids) {
		boolean allows(long id) { return all || ids.contains(id); }
	}

	private final JdbcClient db;

	public AccessService(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	/** The caller, read fresh on every request so a suspended account or a changed role takes effect at once. */
	public Actor actor(HttpServletRequest req) {
		if (req.getAttribute("service") != null) return Actor.serviceActor();
		Long uid = (Long) req.getAttribute("userId");
		if (uid == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
		// A faculty account whose profile is marked as former faculty (G35) can no longer act, even with a live session.
		return db.sql("""
			SELECT u.researcher_id, u.role, u.name FROM app_user u LEFT JOIN researcher r ON r.id = u.researcher_id
			WHERE u.id = :u AND u.status = 'active' AND (u.role <> 'faculty' OR r.active)""").param("u", uid)
			.query((r, n) -> new Actor(uid, (Long) r.getObject("researcher_id"), false, r.getString("role"), r.getString("name"))).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED)); // suspended, deactivated or unknown
	}

	/** How long a confirmed password unlocks sensitive actions. */
	static final int CONFIRM_SECONDS = 5 * 60;
	@org.springframework.beans.factory.annotation.Autowired private Sessions sessions;

	/**
	 * Sensitive actions (accounts, roles, temporary passwords, official details, the email sender) need the password
	 * entered in this session within the last 5 minutes (2026-11-24), so an unattended signed-in browser cannot be misused.
	 * The service key is exempt (it has no password).
	 */
	public void requireRecentPassword(HttpServletRequest req) {
		if (req.getAttribute("service") != null) return;
		if (!sessions.confirmedWithin((String) req.getAttribute("sessionHash"), CONFIRM_SECONDS)) throw RuleException.confirmPassword();
	}

	/** Office of Research only (or the service key). */
	public void requireAdmin(Actor a) {
		if (!a.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
	}

	/** Whose people data the caller may see. Faculty: themselves only. */
	public Visible visible(Actor a) {
		if (a.isAdmin() || a.isManagement()) return new Visible(true, Set.of());
		Set<Long> ids = new HashSet<>();
		if (a.researcherId() != null) ids.add(a.researcherId());
		return new Visible(false, ids);
	}

	/** Parked with the progress module (decision D3): supervision relationships no longer grant anything. */
	public boolean isActiveMentor(Long mentorId, long scholarId) { return false; }

	/** Org units the caller may see: null means all; a faculty member sees the units they are appointed to. */
	public Set<Long> visibleUnitIds(Actor a) {
		if (a.isAdmin() || a.isManagement()) return null;
		return new HashSet<>(db.sql("""
			SELECT org_unit_id FROM appointment WHERE researcher_id = :r AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)""")
			.param("r", a.researcherId() == null ? -1L : a.researcherId()).query(Long.class).list());
	}
}
