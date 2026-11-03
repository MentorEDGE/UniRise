package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/grants")
public class GrantController {
	public record Investigator(Long researcherId, String name, String role, boolean isLead, String institution, String department, BigDecimal sharePct) {}
	public record Body(String unit, String type, String source, String utn, String title, String description, String callTitle, String agency, String agencyComment,
		LocalDate appliedOn, BigDecimal appliedAmount, Integer durationMonths, Boolean matchingGrant, String remarks, List<Investigator> investigators, Long ownerId, Integer version) {}
	public record Row(long id, String unit, String type, String source, String status, String utn, String title, String description, String callTitle, String agency,
		String agencyComment, LocalDate appliedOn, LocalDate enteredOn, LocalDate sanctionedOn, BigDecimal appliedAmount, BigDecimal sanctionedAmount, Integer durationMonths,
		boolean matchingGrant, String remarks, String reviewComment, long ownerId, int version) {}
	public record View(Row grant, List<Investigator> investigators) {}
	public record Review(String action, String comment, BigDecimal sanctionedAmount, LocalDate sanctionedOn) {}

	private final JdbcClient db;
	private final AccessService access;
	private final EntryWorkflow flow;

	public GrantController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access, EntryWorkflow flow) {
		this.db = db;
		this.access = access;
		this.flow = flow;
	}

	@GetMapping
	Map<String, Object> list(@RequestParam(required = false) String status, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size, HttpServletRequest req) {
		Actor a = access.actor(req);
		size = Math.max(1, Math.min(size, 200));
		page = Math.max(0, page);
		String where = " WHERE true" + flow.scope(a, "owner_id") + (status == null ? "" : " AND status = :status");
		var count = flow.bindScope(db.sql("SELECT count(*) FROM research_grant" + where), a);
		var rows = flow.bindScope(db.sql("SELECT * FROM research_grant" + where + " ORDER BY id DESC LIMIT :size OFFSET :off"), a).param("size", size).param("off", (long) page * size);
		if (status != null) { count = count.param("status", status); rows = rows.param("status", status); }
		return EntryWorkflow.page(rows.query(Row.class).list().stream().map(this::view).toList(), count.query(Long.class).single(), page, size);
	}

	@GetMapping("/{id}")
	View get(@PathVariable long id, HttpServletRequest req) {
		flow.head(access.actor(req), EntryWorkflow.GRANT, id);
		return view(db.sql("SELECT * FROM research_grant WHERE id = :id").param("id", id).query(Row.class).single());
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody Body b, HttpServletRequest req) {
		Actor a = access.actor(req);
		draftChecks(b);
		long id = db.sql("""
			INSERT INTO research_grant(unit, type, source, utn, title, description, call_title, agency, agency_comment, applied_on, applied_amount, duration_months, matching_grant, remarks, owner_id)
			VALUES (:unit, :type, :source, :utn, :title, :desc, :call, :agency, :ac, :on, :amt, :dur, :mg, :rem, :owner) RETURNING id""")
			.params(fields(b)).param("owner", flow.ownerForNew(a, b.ownerId())).query(Long.class).single();
		investigators(id, b.investigators());
		return Map.of("id", id);
	}

	@PutMapping("/{id}")
	Map<String, Integer> update(@PathVariable long id, @RequestBody Body b, HttpServletRequest req) {
		flow.requireEditable(access.actor(req), EntryWorkflow.GRANT, id);
		draftChecks(b);
		int n = db.sql("""
			UPDATE research_grant SET unit=:unit, type=:type, source=:source, utn=:utn, title=:title, description=:desc, call_title=:call, agency=:agency, agency_comment=:ac,
			applied_on=:on, applied_amount=:amt, duration_months=:dur, matching_grant=:mg, remarks=:rem, version = version + 1 WHERE id = :id AND version = :v""")
			.params(fields(b)).param("id", id).param("v", b.version() == null ? -1 : b.version()).update();
		if (n != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "stale version");
		db.sql("DELETE FROM grant_investigator WHERE grant_id = :id").param("id", id).update();
		investigators(id, b.investigators());
		return Map.of("version", b.version() + 1);
	}

	/** Submitting needs the wizard's finished state: a title, an agency, exactly one lead, and shares that total 100%. */
	@PostMapping("/{id}/submit")
	void submit(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		flow.requireEditable(a, EntryWorkflow.GRANT, id);
		Row g = db.sql("SELECT * FROM research_grant WHERE id = :id").param("id", id).query(Row.class).single();
		List<Investigator> inv = investigators(id);
		bad(g.title() == null || g.title().isBlank(), "title");
		bad(g.agency() == null || g.agency().isBlank(), "agency");
		bad(inv.stream().filter(Investigator::isLead).count() != 1, "lead");
		bad(inv.stream().map(Investigator::sharePct).reduce(BigDecimal.ZERO, BigDecimal::add).compareTo(new BigDecimal("100")) != 0, "shares");
		flow.submit(a, EntryWorkflow.GRANT, id);
	}

	@PostMapping("/{id}/review")
	Map<String, String> review(@PathVariable long id, @RequestBody Review r, HttpServletRequest req) {
		String status = flow.review(access.actor(req), EntryWorkflow.GRANT, id, r.action(), r.comment());
		if (status.equals("sanctioned")) {
			db.sql("UPDATE research_grant SET sanctioned_amount = COALESCE(:amt, applied_amount), sanctioned_on = COALESCE(:on, current_date) WHERE id = :id")
				.param("amt", r.sanctionedAmount()).param("on", r.sanctionedOn()).param("id", id).update();
		}
		return Map.of("status", status);
	}

	private static Map<String, Object> fields(Body b) {
		var m = new java.util.HashMap<String, Object>();
		m.put("unit", b.unit()); m.put("type", b.type()); m.put("source", b.source()); m.put("utn", b.utn()); m.put("title", b.title().trim()); m.put("desc", b.description());
		m.put("call", b.callTitle()); m.put("agency", b.agency()); m.put("ac", b.agencyComment()); m.put("on", b.appliedOn());
		m.put("amt", b.appliedAmount() == null ? BigDecimal.ZERO : b.appliedAmount()); m.put("dur", b.durationMonths()); m.put("mg", Boolean.TRUE.equals(b.matchingGrant())); m.put("rem", b.remarks());
		return m;
	}

	/** A draft only needs a title and sane numbers; the strict rules apply on submit. */
	private static void draftChecks(Body b) {
		bad(b == null || b.title() == null || b.title().isBlank() || b.title().length() > 500, "title");
		bad(b.appliedAmount() != null && b.appliedAmount().signum() < 0, "amount");
		bad(b.durationMonths() != null && (b.durationMonths() < 1 || b.durationMonths() > 600), "duration");
		if (b.investigators() != null) for (Investigator i : b.investigators()) {
			bad(i.name() == null || i.name().isBlank() || i.role() == null || !List.of("PI", "Co-PI", "Collaborator").contains(i.role()), "investigator");
			bad(i.sharePct() == null || i.sharePct().signum() < 0 || i.sharePct().compareTo(new BigDecimal("100")) > 0, "share");
		}
	}

	private static void bad(boolean cond, String field) {
		if (cond) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field);
	}

	private void investigators(long id, List<Investigator> list) {
		if (list == null) return;
		for (Investigator i : list) {
			db.sql("INSERT INTO grant_investigator(grant_id, researcher_id, name, role, is_lead, institution, department, share_pct) VALUES (:g, :r, :n, :role, :l, :i, :d, :s)")
				.param("g", id).param("r", i.researcherId()).param("n", i.name()).param("role", i.role()).param("l", i.isLead()).param("i", i.institution())
				.param("d", i.department()).param("s", i.sharePct()).update();
		}
	}

	private List<Investigator> investigators(long id) {
		return db.sql("SELECT researcher_id, name, role, is_lead, institution, department, share_pct FROM grant_investigator WHERE grant_id = :id ORDER BY id")
			.param("id", id).query(Investigator.class).list();
	}

	private View view(Row g) { return new View(g, investigators(g.id())); }
}
