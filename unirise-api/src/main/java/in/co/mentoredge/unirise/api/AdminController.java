package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Org structure and access setup. Admin-only writes; org units are readable within the caller's scope. */
@RestController
@RequestMapping("/api")
public class AdminController {
	public record NewUnit(Long parentId, String type, String name) {}
	public record NewAppointment(long researcherId, long orgUnitId, String designation, LocalDate validFrom, LocalDate validTo) {}
	public record NewGrant(long userId, String role, Long scopeUnitId, LocalDate validFrom, LocalDate validTo) {}
	public record NewRelationship(long mentorId, long menteeId, String type, LocalDate validFrom, LocalDate validTo) {}
	public record Unit(long id, Long parentId, String type, String name) {}

	private final JdbcClient db;
	private final AccessService access;

	public AdminController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	@GetMapping("/org-units")
	List<Unit> units(HttpServletRequest req) {
		Actor a = access.actor(req);
		var ids = access.visibleUnitIds(a);
		return db.sql("SELECT id, parent_id AS parentId, type, name FROM org_unit ORDER BY id").query(Unit.class).list().stream().filter(u -> ids == null || ids.contains(u.id())).toList();
	}

	@PostMapping("/org-units")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> addUnit(@RequestBody NewUnit u, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (u.name() == null || u.name().isBlank() || u.type() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		long id = db.sql("INSERT INTO org_unit(parent_id, type, name) VALUES (:p, :t, :n) RETURNING id").param("p", u.parentId()).param("t", u.type()).param("n", u.name()).query(Long.class).single();
		db.sql("INSERT INTO org_unit_closure VALUES (:i, :i, 0)").param("i", id).update();
		if (u.parentId() != null) {
			db.sql("INSERT INTO org_unit_closure SELECT ancestor_id, :i, depth + 1 FROM org_unit_closure WHERE descendant_id = :p").param("i", id).param("p", u.parentId()).update();
		}
		return Map.of("id", id);
	}

	@PostMapping("/appointments")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> addAppointment(@RequestBody NewAppointment a, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		long id = db.sql("INSERT INTO appointment(researcher_id, org_unit_id, designation, valid_from, valid_to) VALUES (:r, :u, :d, COALESCE(:f, current_date), :t) RETURNING id")
			.param("r", a.researcherId()).param("u", a.orgUnitId()).param("d", a.designation()).param("f", a.validFrom()).param("t", a.validTo()).query(Long.class).single();
		return Map.of("id", id);
	}

	@PostMapping("/role-grants")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> grant(@RequestBody NewGrant g, HttpServletRequest req) {
		Actor admin = access.actor(req);
		access.requireAdmin(admin);
		long id = db.sql("INSERT INTO role_grant(app_user_id, role, scope_unit_id, valid_from, valid_to, granted_by) VALUES (:u, :r, :s, COALESCE(:f, current_date), :t, :by) RETURNING id")
			.param("u", g.userId()).param("r", g.role()).param("s", g.scopeUnitId()).param("f", g.validFrom()).param("t", g.validTo()).param("by", admin.userId()).query(Long.class).single();
		return Map.of("id", id);
	}

	@PostMapping("/relationships")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> relate(@RequestBody NewRelationship r, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		long id = db.sql("INSERT INTO relationship(mentor_id, mentee_id, type, valid_from, valid_to) VALUES (:m, :e, :t, COALESCE(:f, current_date), :v) RETURNING id")
			.param("m", r.mentorId()).param("e", r.menteeId()).param("t", r.type()).param("f", r.validFrom()).param("v", r.validTo()).query(Long.class).single();
		return Map.of("id", id);
	}
}
