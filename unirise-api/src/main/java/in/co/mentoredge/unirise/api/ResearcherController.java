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
	public record Researcher(long id, String name, String email, String orcid, String employeeId, boolean isScholar) {}
	public record NewResearcher(String name, String email, String orcid, String employeeId, Boolean isScholar) {}

	private static final String COLS = "SELECT id, name, email, orcid, employee_id AS employeeId, is_scholar AS isScholar FROM researcher";
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
		long id = db.sql("INSERT INTO researcher(name, email, orcid, employee_id, is_scholar) VALUES (:n, :e, :o, :emp, :s) RETURNING id")
			.param("n", r.name()).param("e", r.email()).param("o", r.orcid()).param("emp", r.employeeId()).param("s", Boolean.TRUE.equals(r.isScholar()))
			.query(Long.class).single();
		return Map.of("id", id);
	}
}
