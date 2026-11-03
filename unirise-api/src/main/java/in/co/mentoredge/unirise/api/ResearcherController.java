package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/researchers")
public class ResearcherController {
	public record Researcher(long id, String name, String email, String orcid, String employeeId, boolean isScholar, String scopusId, String rollNo) {}
	public record NewResearcher(String name, String email, String orcid, String employeeId, Boolean isScholar, String scopusId, String rollNo) {}

	private static final String COLS = "SELECT id, name, email, orcid, employee_id AS employeeId, is_scholar AS isScholar, scopus_id AS scopusId, roll_no AS rollNo FROM researcher";
	private final JdbcClient db;
	private final AccessService access;

	public ResearcherController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	@GetMapping
	List<Researcher> list(HttpServletRequest req) {
		var v = access.visible(access.actor(req));
		if (v.all()) return db.sql(COLS + " ORDER BY id").query(Researcher.class).list();
		if (v.ids().isEmpty()) return List.of();
		return db.sql(COLS + " WHERE id IN (:ids) ORDER BY id").param("ids", v.ids()).query(Researcher.class).list();
	}

	public record Lookup(Researcher researcher, String institute, String department, List<Map<String, Object>> publications, long grants) {}

	/** Finds one person by employee ID, ORCID or Scopus ID. Only people in the caller's slice are found. */
	@GetMapping("/lookup")
	Lookup lookup(@RequestParam String kind, @RequestParam String value, HttpServletRequest req) {
		Actor a = access.actor(req);
		String col = switch (kind) { case "employee" -> "employee_id"; case "orcid" -> "orcid"; case "scopus" -> "scopus_id"; default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST); };
		Researcher r = db.sql(COLS + " WHERE " + col + " = :v").param("v", value.trim()).query(Researcher.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (!access.visible(a).allows(r.id())) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		access.logDrillDown(a, r.id());
		var unit = db.sql("""
			SELECT ou.name AS department, (SELECT cu.name FROM org_unit_closure c JOIN org_unit cu ON cu.id = c.ancestor_id WHERE c.descendant_id = ou.id AND cu.type = 'campus' ORDER BY c.depth DESC LIMIT 1) AS institute
			FROM appointment ap JOIN org_unit ou ON ou.id = ap.org_unit_id WHERE ap.researcher_id = :r AND ap.valid_from <= current_date AND (ap.valid_to IS NULL OR ap.valid_to >= current_date) ORDER BY ap.id LIMIT 1""")
			.param("r", r.id()).query((rs, n) -> new String[] { rs.getString("institute"), rs.getString("department") }).optional().orElse(new String[] { null, null });
		var pubs = db.sql("SELECT p.id, p.title, p.venue, p.pub_year AS year, p.doi, p.type FROM publication p JOIN publication_author a ON a.publication_id = p.id WHERE a.researcher_id = :r AND p.entry_status = 'approved' ORDER BY p.pub_year DESC")
			.param("r", r.id()).query().listOfRows();
		long grants = db.sql("SELECT count(DISTINCT grant_id) FROM grant_investigator gi JOIN research_grant g ON g.id = gi.grant_id WHERE gi.researcher_id = :r AND g.status IN ('submitted','sanctioned')").param("r", r.id()).query(Long.class).single();
		return new Lookup(r, unit[0], unit[1], pubs, grants);
	}

	/** Not visible and not found look the same, so existence is never revealed. */
	@GetMapping("/{id}")
	Researcher get(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!access.visible(a).allows(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		Researcher r = db.sql(COLS + " WHERE id = :id").param("id", id).query(Researcher.class).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		access.logDrillDown(a, id);
		return r;
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody NewResearcher r, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (r.name() == null || r.name().isBlank() || r.name().length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		long id = db.sql("INSERT INTO researcher(name, email, orcid, employee_id, is_scholar, scopus_id, roll_no) VALUES (:n, :e, :o, :emp, :s, :sc, :rn) RETURNING id")
			.param("n", r.name()).param("e", r.email()).param("o", r.orcid()).param("emp", r.employeeId()).param("s", Boolean.TRUE.equals(r.isScholar())).param("sc", r.scopusId()).param("rn", r.rollNo())
			.query(Long.class).single();
		return Map.of("id", id);
	}
}
