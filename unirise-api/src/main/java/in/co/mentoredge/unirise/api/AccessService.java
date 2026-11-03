package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Role + scope rules (ACCESS_AND_VISIBILITY_MODEL.md §3, TRD §3). Every read and write of people data goes through here. */
@Service
public class AccessService {
	/** all = no restriction; otherwise only these researcher ids. */
	public record Visible(boolean all, Set<Long> ids) {
		boolean allows(long id) { return all || ids.contains(id); }
	}

	private static final List<String> SCOPE_ROLES = List.of("RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "VIEWER");
	/** The one definition of an active relationship, used by every check so they cannot drift apart. */
	private static final String CURRENT = " valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)";
	private final JdbcClient db;

	public AccessService(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	public Actor actor(HttpServletRequest req) {
		if (req.getAttribute("service") != null) return Actor.serviceActor();
		Long uid = (Long) req.getAttribute("userId");
		if (uid == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
		var users = db.sql("SELECT researcher_id FROM app_user WHERE id = :u AND active").param("u", uid)
			.query((r, n) -> java.util.Optional.ofNullable((Long) r.getObject("researcher_id"))).list();
		if (users.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); // deactivated or unknown user
		Long researcher = users.get(0).orElse(null);
		List<Actor.Grant> grants = db.sql("""
			SELECT role, scope_unit_id FROM role_grant WHERE app_user_id = :u
			AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)""")
			.param("u", uid).query((r, n) -> new Actor.Grant(r.getString("role"), (Long) r.getObject("scope_unit_id"))).list();
		return new Actor(uid, researcher, false, grants);
	}

	public void requireAdmin(Actor a) {
		if (!a.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
	}

	public Visible visible(Actor a) {
		boolean whole = a.isAdmin() || a.grants().stream().anyMatch(g -> g.scopeUnitId() == null && SCOPE_ROLES.contains(g.role()));
		if (whole) return new Visible(true, Set.of());
		Set<Long> ids = new HashSet<>();
		if (a.researcherId() != null) {
			ids.add(a.researcherId());
			ids.addAll(db.sql("""
				SELECT mentee_id FROM relationship WHERE mentor_id = :m AND""" + CURRENT)
				.param("m", a.researcherId()).query(Long.class).list());
		}
		List<Long> units = a.grants().stream().filter(g -> g.scopeUnitId() != null && SCOPE_ROLES.contains(g.role())).map(Actor.Grant::scopeUnitId).toList();
		if (!units.isEmpty()) {
			ids.addAll(db.sql("""
				SELECT DISTINCT a.researcher_id FROM appointment a JOIN org_unit_closure c ON c.descendant_id = a.org_unit_id
				WHERE c.ancestor_id IN (:units) AND a.valid_from <= current_date AND (a.valid_to IS NULL OR a.valid_to >= current_date)""")
				.param("units", units).query(Long.class).list());
		}
		return new Visible(false, ids);
	}

	/** Executive or Dean reading a named person they only see through their scope is logged. */
	public void logDrillDown(Actor a, long researcherId) {
		if (a.userId() == null || !a.hasRole("EXECUTIVE", "DEAN")) return;
		boolean own = a.researcherId() != null && a.researcherId() == researcherId;
		boolean mentee = a.researcherId() != null && db.sql("SELECT count(*) FROM relationship WHERE mentor_id = :m AND mentee_id = :t AND" + CURRENT)
			.param("m", a.researcherId()).param("t", researcherId).query(Long.class).single() > 0;
		if (!own && !mentee) {
			db.sql("INSERT INTO access_log(actor_user_id, action, target_researcher_id) VALUES (:u, 'view.person', :t)").param("u", a.userId()).param("t", researcherId).update();
		}
	}
}
