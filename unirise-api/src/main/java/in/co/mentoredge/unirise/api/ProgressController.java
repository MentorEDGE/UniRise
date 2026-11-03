package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Milestones, confidential meeting logs, reminders and the escalation setting (PRD R25-R27, ACCESS model §3). */
@RestController
@RequestMapping("/api")
public class ProgressController {
	public record Milestone(long id, long scholarId, String stage, LocalDate dueDate, LocalDate completedAt, Long approvedBy, LocalDate approvedOn, String feedback, String status) {}
	public record NewMilestone(long scholarId, String stage, LocalDate dueDate) {}
	public record Feedback(String feedback) {}
	public record NewDue(LocalDate dueDate) {}
	public record Meeting(long id, long scholarId, long mentorId, LocalDate heldOn, String notes) {}
	public record NewMeeting(long scholarId, LocalDate heldOn, String notes) {}
	public record Reminder(String id, long milestoneId, long scholarId, String scholarName, String stage, LocalDate dueDate, String level, int daysOverdue, List<String> recipients, String reason) {}
	public record Settings(int escalationDays) {}

	private static final String MS = "SELECT id, scholar_id, stage, due_date, completed_at, approved_by, approved_on, feedback, "
		+ "CASE WHEN completed_at IS NOT NULL THEN 'done' WHEN due_date < current_date THEN 'overdue' ELSE 'upcoming' END AS status FROM milestone";
	private final JdbcClient db;
	private final AccessService access;

	public ProgressController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	private void requireVisible(Actor a, long scholarId) {
		if (!access.visible(a).allows(scholarId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
	}

	/** Supervisors of the scholar, and admins, manage milestones. */
	private void requireManager(Actor a, long scholarId) {
		requireVisible(a, scholarId);
		if (!a.isAdmin() && !access.isActiveMentor(a.researcherId(), scholarId)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
	}

	private long scholarOf(long milestoneId) {
		return db.sql("SELECT scholar_id FROM milestone WHERE id = :id").param("id", milestoneId).query(Long.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}

	@GetMapping("/milestones")
	List<Milestone> milestones(@RequestParam(required = false) Long scholarId, HttpServletRequest req) {
		Actor a = access.actor(req);
		long id = scholarId != null ? scholarId : (a.researcherId() == null ? -1 : a.researcherId());
		requireVisible(a, id);
		return db.sql(MS + " WHERE scholar_id = :s ORDER BY id").param("s", id).query(Milestone.class).list();
	}

	@PostMapping("/milestones")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> addMilestone(@RequestBody NewMilestone m, HttpServletRequest req) {
		Actor a = access.actor(req);
		requireManager(a, m.scholarId());
		if (m.stage() == null || m.stage().isBlank() || m.dueDate() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		return Map.of("id", db.sql("INSERT INTO milestone(scholar_id, stage, due_date) VALUES (:s, :st, :d) RETURNING id").param("s", m.scholarId()).param("st", m.stage().trim()).param("d", m.dueDate()).query(Long.class).single());
	}

	@PutMapping("/milestones/{id}/due-date")
	void moveDue(@PathVariable long id, @RequestBody NewDue d, HttpServletRequest req) {
		requireManager(access.actor(req), scholarOf(id));
		if (d.dueDate() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		db.sql("UPDATE milestone SET due_date = :d WHERE id = :id").param("d", d.dueDate()).param("id", id).update();
	}

	/** The scholar or a manager marks the stage done; approval is separate and never by the scholar. */
	@PostMapping("/milestones/{id}/complete")
	void complete(@PathVariable long id, HttpServletRequest req) {
		Actor a = access.actor(req);
		long scholar = scholarOf(id);
		requireVisible(a, scholar);
		boolean self = a.researcherId() != null && a.researcherId() == scholar;
		if (!self && !a.isAdmin() && !access.isActiveMentor(a.researcherId(), scholar)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		db.sql("UPDATE milestone SET completed_at = COALESCE(completed_at, current_date) WHERE id = :id").param("id", id).update();
	}

	@PostMapping("/milestones/{id}/approve")
	void approve(@PathVariable long id, @RequestBody(required = false) Feedback f, HttpServletRequest req) {
		Actor a = access.actor(req);
		long scholar = scholarOf(id);
		requireManager(a, scholar);
		if (a.researcherId() != null && a.researcherId() == scholar) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		int n = db.sql("UPDATE milestone SET approved_by = :by, approved_on = current_date, feedback = :f WHERE id = :id AND completed_at IS NOT NULL")
			.param("by", a.researcherId()).param("f", f == null ? null : f.feedback()).param("id", id).update();
		if (n != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "not completed");
	}

	// --- meeting logs: the scholar and their active supervisors only; no admin, HoD, Dean or Executive path exists ---

	private boolean mayReadLogs(Actor a, long scholarId) {
		if (a.researcherId() == null) return false;
		return a.researcherId() == scholarId || access.isActiveMentor(a.researcherId(), scholarId);
	}

	@GetMapping("/meeting-logs")
	List<Meeting> meetings(@RequestParam long scholarId, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!mayReadLogs(a, scholarId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		return db.sql("SELECT id, scholar_id, mentor_id, held_on, notes FROM meeting_log WHERE scholar_id = :s ORDER BY held_on DESC, id DESC").param("s", scholarId).query(Meeting.class).list();
	}

	@PostMapping("/meeting-logs")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Long> addMeeting(@RequestBody NewMeeting m, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!access.isActiveMentor(a.researcherId(), m.scholarId())) throw new ResponseStatusException(HttpStatus.NOT_FOUND); // even admins cannot write mentoring notes
		if (m.heldOn() == null || m.notes() == null || m.notes().isBlank() || m.notes().length() > 10_000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		return Map.of("id", db.sql("INSERT INTO meeting_log(scholar_id, mentor_id, held_on, notes) VALUES (:s, :m, :d, :n) RETURNING id")
			.param("s", m.scholarId()).param("m", a.researcherId()).param("d", m.heldOn()).param("n", m.notes()).query(Long.class).single());
	}

	// --- reminders: computed on demand, so they always match the current dates. Sending (SES) comes later. ---

	@GetMapping("/reminders")
	List<Reminder> reminders(HttpServletRequest req) {
		Actor a = access.actor(req);
		var visible = access.visible(a);
		int escalation = db.sql("SELECT escalation_days FROM tenant_settings").query(Integer.class).single();
		record Due(long id, long scholarId, String name, String stage, LocalDate dueDate) {}
		List<Due> due = db.sql("""
			SELECT m.id, m.scholar_id, r.name, m.stage, m.due_date FROM milestone m JOIN researcher r ON r.id = m.scholar_id
			WHERE m.completed_at IS NULL AND m.due_date <= current_date + 14 ORDER BY m.due_date""")
			.query((rs, n) -> new Due(rs.getLong("id"), rs.getLong("scholar_id"), rs.getString("name"), rs.getString("stage"), rs.getObject("due_date", LocalDate.class))).list();
		boolean supervisorView = a.isAdmin() || a.hasRole("HOD", "DEAN", "EXECUTIVE");
		List<Reminder> out = new ArrayList<>();
		for (Due d : due) {
			if (!visible.allows(d.scholarId())) continue;
			int late = (int) java.time.temporal.ChronoUnit.DAYS.between(d.dueDate(), LocalDate.now());
			String level = late > escalation ? "escalated" : late > 0 ? "overdue" : "soon";
			boolean mine = a.researcherId() != null && (a.researcherId() == d.scholarId() || access.isActiveMentor(a.researcherId(), d.scholarId()));
			if (!mine && !(level.equals("escalated") && supervisorView)) continue; // heads only hear about escalated ones
			List<String> to = new ArrayList<>(db.sql("SELECT name FROM researcher WHERE id = :s UNION SELECT r.name FROM relationship x JOIN researcher r ON r.id = x.mentor_id WHERE x.mentee_id = :s AND x.valid_from <= current_date AND (x.valid_to IS NULL OR x.valid_to >= current_date)")
				.param("s", d.scholarId()).query(String.class).list());
			if (level.equals("escalated")) {
				to.addAll(db.sql("""
					SELECT DISTINCT r2.name FROM role_grant g JOIN app_user u ON u.id = g.app_user_id JOIN researcher r2 ON r2.id = u.researcher_id
					JOIN org_unit_closure c ON c.ancestor_id = g.scope_unit_id JOIN appointment ap ON ap.org_unit_id = c.descendant_id
					WHERE g.role = 'HOD' AND ap.researcher_id = :s AND g.valid_from <= current_date AND (g.valid_to IS NULL OR g.valid_to >= current_date)
					AND ap.valid_from <= current_date AND (ap.valid_to IS NULL OR ap.valid_to >= current_date)""").param("s", d.scholarId()).query(String.class).list());
			}
			String reason = switch (level) {
				case "soon" -> "Due within 14 days";
				case "overdue" -> "Overdue by " + late + " days";
				default -> "Overdue by " + late + " days, also sent to the head of department";
			};
			out.add(new Reminder("m" + d.id(), d.id(), d.scholarId(), d.name(), d.stage(), d.dueDate(), level, Math.max(late, 0), to, reason));
		}
		return out;
	}

	@GetMapping("/settings")
	Settings settings(HttpServletRequest req) {
		access.actor(req);
		return new Settings(db.sql("SELECT escalation_days FROM tenant_settings").query(Integer.class).single());
	}

	@PutMapping("/settings")
	void setSettings(@RequestBody Settings s, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (s.escalationDays() < 1 || s.escalationDays() > 365) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		db.sql("UPDATE tenant_settings SET escalation_days = :d").param("d", s.escalationDays()).update();
	}
}
