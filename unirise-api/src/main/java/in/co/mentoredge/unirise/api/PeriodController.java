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

/** Reporting periods. Closing one freezes the per-unit figures so later edits cannot move reported numbers (PRD R29). */
@RestController
@RequestMapping("/api/periods")
public class PeriodController {
	public record Period(long id, String label, LocalDate startsOn, LocalDate endsOn, java.time.OffsetDateTime closedAt) {}
	public record NewPeriod(String label, LocalDate startsOn, LocalDate endsOn) {}
	public record Metric(long unitId, String metric, BigDecimal value) {}

	private final JdbcClient db;
	private final AccessService access;

	public PeriodController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	@GetMapping
	List<Period> list(HttpServletRequest req) {
		access.actor(req);
		return db.sql("SELECT id, label, starts_on, ends_on, closed_at FROM period ORDER BY starts_on DESC, id DESC").query(Period.class).list();
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> create(@RequestBody NewPeriod p, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (p == null || p.label() == null || p.label().isBlank() || p.startsOn() == null || p.endsOn() == null || p.endsOn().isBefore(p.startsOn())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		return Map.of("id", db.sql("INSERT INTO period(label, starts_on, ends_on) VALUES (:l, :s, :e) RETURNING id").param("l", p.label()).param("s", p.startsOn()).param("e", p.endsOn()).query(Long.class).single());
	}

	/** Takes the snapshot in one transaction with the close, and refuses a second close. */
	@PostMapping("/{id}/close")
	void close(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		access.requireAdmin(a);
		var p = db.sql("SELECT id, label, starts_on, ends_on, closed_at FROM period WHERE id = :id").param("id", id).query(Period.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (p.closedAt() != null) throw new ResponseStatusException(HttpStatus.CONFLICT, "already closed");
		// every (unit, person) pair once, so joint appointments inside one subtree do not double count
		String ur = "WITH ur AS (SELECT DISTINCT c.ancestor_id AS unit_id, ap.researcher_id FROM appointment ap JOIN org_unit_closure c ON c.descendant_id = ap.org_unit_id "
			+ "WHERE ap.valid_from <= :end AND (ap.valid_to IS NULL OR ap.valid_to >= :start)) ";
		var s = db.sql(ur + "INSERT INTO period_snapshot SELECT :id, u.id, 'researchers', count(ur.researcher_id) FROM org_unit u LEFT JOIN ur ON ur.unit_id = u.id GROUP BY u.id");
		bind(s, p, id).update();
		bind(db.sql(ur + "INSERT INTO period_snapshot SELECT :id, u.id, 'publications', count(DISTINCT pb.id) FROM org_unit u LEFT JOIN ur ON ur.unit_id = u.id "
			+ "LEFT JOIN publication pb ON pb.owner_id = ur.researcher_id AND pb.entry_status = 'approved' AND pb.pub_year BETWEEN :fy AND :ty GROUP BY u.id"), p, id).update();
		bind(db.sql(ur + "INSERT INTO period_snapshot SELECT :id, u.id, 'grants', count(DISTINCT g.id) FROM org_unit u LEFT JOIN ur ON ur.unit_id = u.id "
			+ "LEFT JOIN research_grant g ON g.owner_id = ur.researcher_id AND g.status = 'sanctioned' AND g.sanctioned_on BETWEEN :start AND :end GROUP BY u.id"), p, id).update();
		bind(db.sql(ur + "INSERT INTO period_snapshot SELECT :id, u.id, 'sanctioned_amount', COALESCE(sum(g.sanctioned_amount), 0) FROM org_unit u LEFT JOIN ur ON ur.unit_id = u.id "
			+ "LEFT JOIN research_grant g ON g.owner_id = ur.researcher_id AND g.status = 'sanctioned' AND g.sanctioned_on BETWEEN :start AND :end GROUP BY u.id"), p, id).update();
		db.sql("UPDATE period SET closed_at = now(), closed_by = :by WHERE id = :id").param("by", a.userId()).param("id", id).update();
	}

	private static JdbcClient.StatementSpec bind(JdbcClient.StatementSpec s, Period p, long id) {
		return s.param("id", id).param("start", p.startsOn()).param("end", p.endsOn()).param("fy", p.startsOn().getYear()).param("ty", p.endsOn().getYear());
	}

	/** Frozen figures, limited to the units the caller may see. */
	@GetMapping("/{id}/snapshot")
	List<Metric> snapshot(@PathVariable long id, HttpServletRequest req) {
		var ids = access.visibleUnitIds(access.actor(req));
		Long closed = db.sql("SELECT count(*) FROM period WHERE id = :id AND closed_at IS NOT NULL").param("id", id).query(Long.class).single();
		if (closed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		return db.sql("SELECT org_unit_id AS unitId, metric, value FROM period_snapshot WHERE period_id = :id ORDER BY org_unit_id, metric").param("id", id).query(Metric.class).list()
			.stream().filter(m -> ids == null || ids.contains(m.unitId())).toList();
	}
}
