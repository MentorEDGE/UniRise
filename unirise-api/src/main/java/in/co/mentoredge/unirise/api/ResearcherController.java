package in.co.mentoredge.unirise.api;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Phase 1 stand-in for the tenant data path; replaced by the real researcher module in Phase 2. */
@RestController
@RequestMapping("/api/researchers")
public class ResearcherController {
	public record Researcher(long id, String name, String email, String orcid) {}
	public record NewResearcher(String name, String email, String orcid) {}

	private final JdbcClient db;

	public ResearcherController(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	@GetMapping
	List<Researcher> list() { return db.sql("SELECT id, name, email, orcid FROM researcher ORDER BY id").query(Researcher.class).list(); }

	@GetMapping("/{id}")
	Researcher get(@PathVariable long id) {
		return db.sql("SELECT id, name, email, orcid FROM researcher WHERE id = :id").param("id", id).query(Researcher.class).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody NewResearcher r) {
		if (r.name() == null || r.name().isBlank() || r.name().length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		long id = db.sql("INSERT INTO researcher(name, email, orcid) VALUES (:n, :e, :o) RETURNING id")
			.param("n", r.name()).param("e", r.email()).param("o", r.orcid()).query(Long.class).single();
		return Map.of("id", id);
	}
}
