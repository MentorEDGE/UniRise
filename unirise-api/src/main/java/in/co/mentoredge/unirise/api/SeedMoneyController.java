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

/** Seed money: proposals can only be created while the admin-set window is open, enforced here and not only in the UI (PRD R38). */
@RestController
@RequestMapping("/api/seed-money")
public class SeedMoneyController {
	public record Window(String label, LocalDate opensOn, LocalDate closesOn) {}
	public record Investigator(Long researcherId, String name, String investigatorType, boolean isLeadPI, String institution, String department) {}
	public record Body(String category, String title, String abstractText, List<Investigator> investigators, Long ownerId, Integer version) {}
	public record Row(long id, long windowId, String category, String title, String abstractText, String status, LocalDate appliedOn, String reviewComment, long ownerId, int version) {}
	public record View(Row proposal, List<Investigator> investigators) {}
	public record Review(String action, String comment) {}

	private static final String COLS = "SELECT id, window_id, category, title, abstract AS abstractText, status, applied_on, review_comment, owner_id, version FROM seed_proposal";
	private final JdbcClient db;
	private final AccessService access;
	private final EntryWorkflow flow;

	public SeedMoneyController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access, EntryWorkflow flow) {
		this.db = db;
		this.access = access;
		this.flow = flow;
	}

	@GetMapping("/window")
	Window window(HttpServletRequest req) {
		access.actor(req);
		return db.sql("SELECT label, opens_on, closes_on FROM seed_window ORDER BY id DESC LIMIT 1").query(Window.class).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}

	@PutMapping("/window")
	void setWindow(@RequestBody Window w, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		bad(w == null || w.label() == null || w.opensOn() == null || w.closesOn() == null || w.closesOn().isBefore(w.opensOn()), "window");
		db.sql("INSERT INTO seed_window(label, opens_on, closes_on) VALUES (:l, :o, :c)").param("l", w.label()).param("o", w.opensOn()).param("c", w.closesOn()).update();
	}

	@GetMapping
	Map<String, Object> list(@RequestParam(required = false) String status, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size, HttpServletRequest req) {
		Actor a = access.actor(req);
		size = Math.max(1, Math.min(size, 200));
		page = Math.max(0, page);
		String where = " WHERE true" + flow.scope(a, "owner_id") + (status == null ? "" : " AND status = :status");
		var count = flow.bindScope(db.sql("SELECT count(*) FROM seed_proposal" + where), a);
		var rows = flow.bindScope(db.sql(COLS + where + " ORDER BY id DESC LIMIT :size OFFSET :off"), a).param("size", size).param("off", (long) page * size);
		if (status != null) { count = count.param("status", status); rows = rows.param("status", status); }
		return EntryWorkflow.page(rows.query(Row.class).list().stream().map(this::view).toList(), count.query(Long.class).single(), page, size);
	}

	@GetMapping("/{id}")
	View get(@PathVariable long id, HttpServletRequest req) {
		flow.head(access.actor(req), EntryWorkflow.SEED, id);
		return view(db.sql(COLS + " WHERE id = :id").param("id", id).query(Row.class).single());
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		checks(b);
		Long window = db.sql("SELECT id FROM seed_window WHERE opens_on <= current_date AND closes_on >= current_date ORDER BY id DESC LIMIT 1").query(Long.class).optional().orElse(null);
		if (window == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "window closed");
		long id = db.sql("INSERT INTO seed_proposal(window_id, category, title, abstract, owner_id) VALUES (:w, :c, :t, :a, :o) RETURNING id")
			.param("w", window).param("c", b.category()).param("t", b.title().trim()).param("a", b.abstractText()).param("o", flow.ownerForNew(a, b.ownerId())).query(Long.class).single();
		investigators(id, b.investigators());
		return Map.of("id", id);
	}

	@PutMapping("/{id}")
	Map<String, Integer> update(@PathVariable long id, @RequestBody Body b, HttpServletRequest req) {
		flow.requireEditable(access.actor(req), EntryWorkflow.SEED, id);
		checks(b);
		int n = db.sql("UPDATE seed_proposal SET category=:c, title=:t, abstract=:a, version = version + 1 WHERE id = :id AND version = :v")
			.param("c", b.category()).param("t", b.title().trim()).param("a", b.abstractText()).param("id", id).param("v", b.version() == null ? -1 : b.version()).update();
		if (n != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "stale version");
		db.sql("DELETE FROM seed_investigator WHERE proposal_id = :id").param("id", id).update();
		investigators(id, b.investigators());
		return Map.of("version", b.version() + 1);
	}

	@PostMapping("/{id}/submit")
	void submit(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		flow.requireEditable(a, EntryWorkflow.SEED, id);
		long leads = db.sql("SELECT count(*) FROM seed_investigator WHERE proposal_id = :id AND is_lead_pi").param("id", id).query(Long.class).single();
		bad(leads != 1, "lead");
		flow.submit(a, EntryWorkflow.SEED, id);
	}

	@PostMapping("/{id}/review")
	Map<String, String> review(@PathVariable long id, @RequestBody Review r, HttpServletRequest req) {
		return Map.of("status", flow.review(access.actor(req), EntryWorkflow.SEED, id, r.action(), r.comment()));
	}

	private static void checks(Body b) {
		bad(b == null || b.title() == null || b.title().isBlank() || b.title().length() > 500, "title");
		if (b.investigators() != null) for (Investigator i : b.investigators()) bad(i.name() == null || i.name().isBlank(), "investigator");
	}

	private static void bad(boolean cond, String field) {
		if (cond) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field);
	}

	private void investigators(long id, List<Investigator> list) {
		if (list == null) return;
		for (Investigator i : list) {
			db.sql("INSERT INTO seed_investigator(proposal_id, researcher_id, name, investigator_type, is_lead_pi, institution, department) VALUES (:p, :r, :n, :t, :l, :i, :d)")
				.param("p", id).param("r", i.researcherId()).param("n", i.name()).param("t", i.investigatorType()).param("l", i.isLeadPI()).param("i", i.institution()).param("d", i.department()).update();
		}
	}

	private View view(Row r) {
		return new View(r, db.sql("SELECT researcher_id, name, investigator_type, is_lead_pi AS isLeadPI, institution, department FROM seed_investigator WHERE proposal_id = :id ORDER BY id")
			.param("id", r.id()).query(Investigator.class).list());
	}
}
