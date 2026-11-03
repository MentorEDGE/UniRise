package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Projects group a lead, members and outputs. A confidential project is shown in full only to its lead, its members and admins;
 * anyone else who would otherwise see it gets a "Restricted" placeholder with no title, summary or people.
 */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {
	public record Body(String title, String status, String summary, String sensitivity, List<Long> memberIds, Long leadId) {}
	public record View(long id, boolean restricted, String title, Long leadId, String status, String summary, String sensitivity, List<Long> memberIds) {}

	private final JdbcClient db;
	private final AccessService access;

	public ProjectController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	private record P(long id, String title, long leadId, String status, String summary, String sensitivity) {}

	private List<Long> members(long id) {
		return db.sql("SELECT researcher_id FROM project_member WHERE project_id = :id ORDER BY researcher_id").param("id", id).query(Long.class).list();
	}

	/** Null when the caller should not know the project exists. */
	private View view(Actor a, P p, AccessService.Visible v) {
		List<Long> m = members(p.id());
		boolean member = a.researcherId() != null && (p.leadId() == a.researcherId() || m.contains(a.researcherId()));
		boolean reaches = v.allows(p.leadId()) || m.stream().anyMatch(v::allows);
		if (!member && !a.isAdmin() && !reaches) return null;
		if (p.sensitivity().equals("confidential") && !member && !a.isAdmin()) return new View(p.id(), true, "Restricted", null, null, null, "confidential", List.of());
		return new View(p.id(), false, p.title(), p.leadId(), p.status(), p.summary(), p.sensitivity(), m);
	}

	@GetMapping
	List<View> list(HttpServletRequest req) {
		Actor a = access.actor(req);
		var v = access.visible(a);
		return db.sql("SELECT id, title, lead_id, status, summary, sensitivity FROM project ORDER BY id").query(P.class).list().stream().map(p -> view(a, p, v)).filter(x -> x != null).toList();
	}

	@GetMapping("/{id}")
	View get(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		P p = db.sql("SELECT id, title, lead_id, status, summary, sensitivity FROM project WHERE id = :id").param("id", id).query(P.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		View v = view(a, p, access.visible(a));
		if (v == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		return v;
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		check(b);
		long lead = a.researcherId() != null && (b.leadId() == null || b.leadId().equals(a.researcherId())) ? a.researcherId()
			: a.isAdmin() && b.leadId() != null ? b.leadId() : fail(a.researcherId() == null ? HttpStatus.BAD_REQUEST : HttpStatus.FORBIDDEN);
		long id = db.sql("INSERT INTO project(title, lead_id, status, summary, sensitivity) VALUES (:t, :l, COALESCE(:s, 'proposed'), :su, COALESCE(:se, 'internal')) RETURNING id")
			.param("t", b.title().trim()).param("l", lead).param("s", b.status()).param("su", b.summary()).param("se", b.sensitivity()).query(Long.class).single();
		setMembers(id, b.memberIds());
		return Map.of("id", id);
	}

	@PutMapping("/{id}")
	void update(@PathVariable long id, @RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		check(b);
		P p = db.sql("SELECT id, title, lead_id, status, summary, sensitivity FROM project WHERE id = :id").param("id", id).query(P.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (view(a, p, access.visible(a)) == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		if (!a.isAdmin() && (a.researcherId() == null || a.researcherId() != p.leadId())) throw new ResponseStatusException(HttpStatus.FORBIDDEN); // only the lead edits
		db.sql("UPDATE project SET title=:t, status=COALESCE(:s, status), summary=:su, sensitivity=COALESCE(:se, sensitivity) WHERE id=:id")
			.param("t", b.title().trim()).param("s", b.status()).param("su", b.summary()).param("se", b.sensitivity()).param("id", id).update();
		db.sql("DELETE FROM project_member WHERE project_id = :id").param("id", id).update();
		setMembers(id, b.memberIds());
	}

	private static long fail(HttpStatus s) { throw new ResponseStatusException(s); }

	private void setMembers(long id, List<Long> ids) {
		if (ids == null) return;
		for (Long m : Set.copyOf(ids)) db.sql("INSERT INTO project_member(project_id, researcher_id) VALUES (:p, :r)").param("p", id).param("r", m).update();
	}

	private static void check(Body b) {
		if (b == null || b.title() == null || b.title().isBlank() || b.title().length() > 500
			|| (b.status() != null && !Set.of("active", "completed", "proposed").contains(b.status()))
			|| (b.sensitivity() != null && !Set.of("internal", "confidential").contains(b.sensitivity()))) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
	}
}
