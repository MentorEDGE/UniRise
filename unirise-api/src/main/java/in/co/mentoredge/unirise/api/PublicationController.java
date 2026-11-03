package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/publications")
public class PublicationController {
	public record Author(Long researcherId, String kind, String name, String institution, String department, String email, LocalDate endDate, String continent) {}
	public record Body(String title, String doi, String venue, String type, Integer year, Integer month, String issn, String category, Boolean projectRef,
		String projectDetails, Boolean studentPublication, List<Author> authors, Long ownerId, Integer version) {}
	public record Row(long id, String title, String doi, String venue, String type, int year, Integer month, String issn, String category, boolean projectRef,
		String projectDetails, boolean studentPublication, String entryStatus, String reviewComment, long ownerId, int version) {}
	public record View(long id, String title, String doi, String venue, String type, int year, Integer month, String issn, String category, boolean projectRef,
		String projectDetails, boolean studentPublication, String entryStatus, String reviewComment, long ownerId, int version, List<Author> authors, List<Long> authorIds) {}
	public record Review(String action, String comment) {}

	private static final Set<String> TYPES = Set.of("journal-article", "conference-paper", "book-chapter", "book", "technical-report", "preprint", "patent");
	private static final Set<String> KINDS = Set.of("internal-faculty", "internal-student", "external", "ex-faculty", "ex-student");
	private static final String COLS = """
		SELECT p.id, p.title, p.doi, p.venue, p.type, p.pub_year AS year, p.pub_month AS month, p.issn, p.category, p.project_ref, p.project_details,
		p.student_publication, p.entry_status, p.review_comment, p.owner_id, p.version FROM publication p""";
	private final JdbcClient db;
	private final AccessService access;
	private final EntryWorkflow flow;

	public PublicationController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access, EntryWorkflow flow) {
		this.db = db;
		this.access = access;
		this.flow = flow;
	}

	/** A publication is visible through its owner or through any internal author the caller may see. */
	private String scope(Actor a) {
		return access.visible(a).all() ? "" : " AND (p.owner_id IN (:ids) OR p.id IN (SELECT publication_id FROM publication_author WHERE researcher_id IN (:ids)))";
	}

	@GetMapping
	Map<String, Object> list(@RequestParam(required = false) String q, @RequestParam(required = false) Integer year, @RequestParam(required = false) String type,
		@RequestParam(required = false) String status, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size, HttpServletRequest req) {
		Actor a = access.actor(req);
		size = Math.max(1, Math.min(size, 200));
		page = Math.max(0, page);
		String where = " WHERE true" + scope(a) + (q == null ? "" : " AND (p.title ILIKE :q OR p.doi ILIKE :q OR p.venue ILIKE :q)")
			+ (year == null ? "" : " AND p.pub_year = :year") + (type == null ? "" : " AND p.type = :type") + (status == null ? "" : " AND p.entry_status = :status");
		var count = flow.bindScope(db.sql("SELECT count(*) FROM publication p" + where), a);
		var rows = flow.bindScope(db.sql(COLS + where + " ORDER BY p.pub_year DESC, p.id DESC LIMIT :size OFFSET :off"), a).param("size", size).param("off", (long) page * size);
		if (q != null) { count = count.param("q", "%" + q + "%"); rows = rows.param("q", "%" + q + "%"); }
		if (year != null) { count = count.param("year", year); rows = rows.param("year", year); }
		if (type != null) { count = count.param("type", type); rows = rows.param("type", type); }
		if (status != null) { count = count.param("status", status); rows = rows.param("status", status); }
		return EntryWorkflow.page(views(rows.query(Row.class).list()), count.query(Long.class).single(), page, size);
	}

	@GetMapping("/{id}")
	View get(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		var s = flow.bindScope(db.sql(COLS + " WHERE p.id = :id" + scope(a)).param("id", id), a);
		return views(s.query(Row.class).list()).stream().findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		validate(b);
		long owner = flow.ownerForNew(a, b.ownerId());
		try {
			long id = db.sql("""
				INSERT INTO publication(title, doi, venue, type, pub_year, pub_month, issn, category, project_ref, project_details, student_publication, owner_id)
				VALUES (:title, :doi, :venue, :type, :year, :month, :issn, :cat, :pr, :pd, :sp, :owner) RETURNING id""")
				.params(fields(b)).param("owner", owner).query(Long.class).single();
			authors(id, b.authors());
			return Map.of("id", id);
		} catch (DuplicateKeyException e) {
			throw new ResponseStatusException(HttpStatus.CONFLICT, "doi");
		}
	}

	@PutMapping("/{id}")
	Map<String, Integer> update(@PathVariable long id, @RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		flow.requireEditable(a, EntryWorkflow.PUB, id);
		validate(b);
		try {
			int n = db.sql("""
				UPDATE publication SET title=:title, doi=:doi, venue=:venue, type=:type, pub_year=:year, pub_month=:month, issn=:issn, category=:cat,
				project_ref=:pr, project_details=:pd, student_publication=:sp, version = version + 1 WHERE id = :id AND version = :v""")
				.params(fields(b)).param("id", id).param("v", b.version() == null ? -1 : b.version()).update();
			if (n != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "stale version"); // saved by someone else since you loaded it
			db.sql("DELETE FROM publication_author WHERE publication_id = :id").param("id", id).update();
			authors(id, b.authors());
			return Map.of("version", b.version() + 1);
		} catch (DuplicateKeyException e) {
			throw new ResponseStatusException(HttpStatus.CONFLICT, "doi");
		}
	}

	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable long id, HttpServletRequest req) {
		var h = flow.requireEditable(access.actor(req), EntryWorkflow.PUB, id);
		if (!h.status().equals("draft")) throw new ResponseStatusException(HttpStatus.CONFLICT, "only drafts can be deleted");
		db.sql("DELETE FROM publication WHERE id = :id").param("id", id).update();
	}

	@PostMapping("/{id}/submit")
	void submit(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		flow.requireEditable(a, EntryWorkflow.PUB, id);
		if (db.sql("SELECT count(*) FROM publication_author WHERE publication_id = :id").param("id", id).query(Long.class).single() == 0) {
			throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "authors");
		}
		flow.submit(a, EntryWorkflow.PUB, id);
	}

	@PostMapping("/{id}/review")
	Map<String, String> review(@PathVariable long id, @RequestBody Review r, HttpServletRequest req) {
		return Map.of("entryStatus", flow.review(access.actor(req), EntryWorkflow.PUB, id, r.action(), r.comment()));
	}

	private static Map<String, Object> fields(Body b) {
		var m = new java.util.HashMap<String, Object>();
		m.put("title", b.title().trim()); m.put("doi", blankToNull(b.doi())); m.put("venue", b.venue()); m.put("type", b.type()); m.put("year", b.year());
		m.put("month", b.month()); m.put("issn", b.issn()); m.put("cat", b.category()); m.put("pr", Boolean.TRUE.equals(b.projectRef()));
		m.put("pd", b.projectDetails()); m.put("sp", Boolean.TRUE.equals(b.studentPublication()));
		return m;
	}

	private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }

	private static void validate(Body b) {
		bad(b == null || b.title() == null || b.title().isBlank() || b.title().length() > 500, "title");
		bad(b.type() == null || !TYPES.contains(b.type()), "type");
		bad(b.year() == null || b.year() < 1900 || b.year() > 2100, "year");
		bad(b.month() != null && (b.month() < 1 || b.month() > 12), "month");
		bad(b.doi() != null && !b.doi().isBlank() && !b.doi().trim().matches("10\\.\\d{4,9}/\\S+"), "doi");
		bad(b.authors() == null || b.authors().isEmpty() || b.authors().size() > 200, "authors");
		for (Author x : b.authors()) bad(x.name() == null || x.name().isBlank() || x.kind() == null || !KINDS.contains(x.kind()), "author");
	}

	private static void bad(boolean cond, String field) {
		if (cond) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field);
	}

	private void authors(long id, List<Author> list) {
		int pos = 0;
		for (Author x : list) {
			db.sql("""
				INSERT INTO publication_author(publication_id, position, researcher_id, kind, name, institution, department, email, end_date, continent)
				VALUES (:p, :pos, :r, :k, :n, :i, :d, :e, :end, :c)""")
				.param("p", id).param("pos", pos++).param("r", x.researcherId()).param("k", x.kind()).param("n", x.name()).param("i", x.institution())
				.param("d", x.department()).param("e", x.email()).param("end", x.endDate()).param("c", x.continent()).update();
		}
	}

	private List<View> views(List<Row> rows) {
		if (rows.isEmpty()) return List.of();
		var byPub = new java.util.HashMap<Long, List<Author>>();
		var ids = new java.util.HashMap<Long, List<Long>>();
		db.sql("""
			SELECT publication_id, researcher_id, kind, name, institution, department, email, end_date, continent FROM publication_author
			WHERE publication_id IN (:ids) ORDER BY publication_id, position""").param("ids", rows.stream().map(Row::id).toList())
			.query((r, n) -> {
				long pid = r.getLong("publication_id");
				Long rid = (Long) r.getObject("researcher_id");
				byPub.computeIfAbsent(pid, k -> new java.util.ArrayList<>()).add(new Author(rid, r.getString("kind"), r.getString("name"), r.getString("institution"),
					r.getString("department"), r.getString("email"), r.getObject("end_date", LocalDate.class), r.getString("continent")));
				if (rid != null) ids.computeIfAbsent(pid, k -> new java.util.ArrayList<>()).add(rid);
				return pid;
			}).list();
		return rows.stream().map(r -> new View(r.id(), r.title(), r.doi(), r.venue(), r.type(), r.year(), r.month(), r.issn(), r.category(), r.projectRef(), r.projectDetails(),
			r.studentPublication(), r.entryStatus(), r.reviewComment(), r.ownerId(), r.version(), byPub.getOrDefault(r.id(), List.of()), ids.getOrDefault(r.id(), List.of()))).toList();
	}
}
