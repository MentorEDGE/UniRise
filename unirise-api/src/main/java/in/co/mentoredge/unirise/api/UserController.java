package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * User management by the institution's Office of Research (BACKEND_PLAN G19, G23). The Office creates faculty and
 * Top-Level Management accounts; each person either gets an emailed link to set their own password (where email is set
 * up) or a temporary password from the Office. There is no self-registration. Office of Research accounts are
 * provisioned by the UniRise team. Same requests and responses as rdms-web/server/app.ts.
 */
@RestController
@RequestMapping("/api/office")
public class UserController {
	public record NewUser(String role, String title, String name, String email, String employeeCode, String department, String designation, String status, Boolean invite) {}
	public record StatusChange(String status, String reason) {}
	public record RoleChange(String role) {}

	private static final String EMAIL = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
	private final JdbcClient db, control;
	private final AccessService access;
	private final TenantDirectory directory;
	private final Sessions sessions;
	private final AdminLog log;
	private final InstitutionSettings settings;
	private final Profiles profiles;
	private final PasswordLinks links;

	public UserController(@Qualifier("tenantJdbc") JdbcClient db, @Qualifier("controlJdbc") JdbcClient control, AccessService access, TenantDirectory directory, Sessions sessions, AdminLog log,
		InstitutionSettings settings, Profiles profiles, PasswordLinks links) {
		this.links = links;
		this.settings = settings;
		this.profiles = profiles;
		this.db = db;
		this.control = control;
		this.access = access;
		this.directory = directory;
		this.sessions = sessions;
		this.log = log;
	}

	@GetMapping("/users")
	List<Map<String, Object>> users(HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		return db.sql("""
			SELECT u.*, r.employee_id FROM app_user u LEFT JOIN researcher r ON r.id = u.researcher_id
			ORDER BY u.role = 'office' DESC, u.role, u.name""").query((r, n) -> {
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("id", String.valueOf(r.getLong("id")));
			m.put("email", r.getString("email"));
			m.put("name", r.getString("name"));
			m.put("title", nz(r.getString("title")));
			m.put("role", r.getString("role"));
			m.put("status", r.getString("status"));
			m.put("institutionId", TenantContext.require());
			m.put("facultyId", r.getString("employee_id"));
			m.put("designation", nz(r.getString("designation")));
			m.put("department", nz(r.getString("department")));
			m.put("employeeCode", nz(r.getString("employee_id")));
			m.put("note", "");
			m.put("requestedAt", r.getTimestamp("created_at").toInstant().toString());
			m.put("reviewedBy", r.getString("created_by"));
			m.put("reviewedAt", r.getTimestamp("created_at").toInstant().toString());
			m.put("reviewNote", nz(r.getString("status_reason")));
			m.put("affiliationVerified", true);
			return m;
		}).list();
	}

	/**
	 * Creates a faculty or Top-Level Management account. With "invite" (and email set up, and the account active) the
	 * person is emailed a link to set their own password; otherwise, or if the email fails, the answer carries a
	 * temporary password, shown once.
	 */
	@PostMapping("/users")
	ResponseEntity<?> create(@RequestBody(required = false) NewUser b, HttpServletRequest req) {
		Actor office = access.actor(req);
		access.requireAdmin(office);
		if (b == null) return AuthController.error(HttpStatus.BAD_REQUEST, "Choose Faculty or Top-Level Management.");
		String role = Actor.MANAGEMENT.equals(b.role()) ? Actor.MANAGEMENT : Actor.FACULTY.equals(b.role()) ? Actor.FACULTY : "";
		String name = s(b.name(), 200), email = s(b.email(), 200).toLowerCase(), designation = s(b.designation(), 100), department = s(b.department(), 200), title = s(b.title(), 10);
		if (role.isEmpty()) return AuthController.error(HttpStatus.BAD_REQUEST, "Choose Faculty or Top-Level Management.");
		if (name.isEmpty()) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter the full name.");
		if (!email.matches(EMAIL)) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter a valid email address.");
		if (emailTaken(email)) return AuthController.error(HttpStatus.BAD_REQUEST, "An account with this email already exists.");
		String status = "deactivated".equals(b.status()) ? "deactivated" : "active";
		Long researcherId = null;
		String code = s(b.employeeCode(), 20);
		if (role.equals(Actor.FACULTY)) {
			if (!code.matches("[A-Za-z0-9-]{3,20}")) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter the employee code (3-20 letters or digits).");
			if (!settings.departments().stream().anyMatch(d -> d.equalsIgnoreCase(department))) return AuthController.error(HttpStatus.BAD_REQUEST, "Choose the department.");
			Long unit = departmentId(department);
			researcherId = db.sql("SELECT id FROM researcher WHERE lower(employee_id) = lower(:c)").param("c", code).query(Long.class).optional().orElse(null);
			if (researcherId != null && db.sql("SELECT count(*) FROM app_user WHERE researcher_id = :r AND status IN ('active','suspended')").param("r", researcherId).query(Long.class).single() > 0) {
				return AuthController.error(HttpStatus.BAD_REQUEST, "Faculty profile " + code + " is already linked to another account.");
			}
			if (researcherId == null) { // the faculty profile is created with the account
				researcherId = db.sql("""
					INSERT INTO researcher(name, email, employee_id, title, designation, department, joining_date) VALUES (:n, :e, :c, :t, :d, :dep, :j) RETURNING id""")
					.param("n", name).param("e", email).param("c", code).param("t", title.isEmpty() ? "Dr." : title).param("d", designation.isEmpty() ? "Assistant Professor" : designation)
					.param("dep", department).param("j", Records.today()).query(Long.class).single();
				if (unit != null) db.sql("INSERT INTO appointment(researcher_id, org_unit_id, designation) VALUES (:r, :u, :d)").param("r", researcherId).param("u", unit).param("d", designation).update();
				profiles.putBiodata(code, Profiles.blank(code));
			}
		}
		long userId = db.sql("""
			INSERT INTO app_user(email, researcher_id, role, status, name, title, designation, department, created_by)
			VALUES (:e, :r, :role, :st, :n, :t, :d, :dep, :by) RETURNING id""")
			.param("e", email).param("r", researcherId).param("role", role).param("st", status).param("n", name).param("t", title)
			.param("d", designation).param("dep", department).param("by", office.name()).query(Long.class).single();
		String temp = Passwords.randomPassword();
		try {
			control.sql("INSERT INTO account_login(email, institution_id, app_user_id, password_hash) VALUES (:e, :i, :u, :h)")
				.param("e", email).param("i", institutionId()).param("u", userId).param("h", Passwords.hash(temp)).update();
		} catch (DuplicateKeyException race) { // the same email was registered in another institution a moment ago
			db.sql("DELETE FROM app_user WHERE id = :u").param("u", userId).update();
			return AuthController.error(HttpStatus.BAD_REQUEST, "An account with this email already exists.");
		}
		log.record(office, "Account created", email, role + (role.equals(Actor.FACULTY) ? " · profile " + code : ""));
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", String.valueOf(userId));
		if (Boolean.TRUE.equals(b.invite())) {
			String why = invite(userId, office);
			if (why == null) { out.put("invited", true); return ResponseEntity.ok(out); }
			out.put("inviteProblem", why);
		}
		out.put("invited", false);
		out.put("temporaryPassword", temp);
		return ResponseEntity.ok(out);
	}

	/** Emails the person a link to set their password (7 days). The current password keeps working until they use it. */
	@PostMapping("/users/{id}/invite")
	ResponseEntity<?> sendInvite(@PathVariable long id, HttpServletRequest req) {
		Actor office = access.actor(req);
		access.requireAdmin(office);
		target(id, office);
		String why = invite(id, office);
		return why == null ? ResponseEntity.ok(Map.of("ok", true)) : AuthController.error(HttpStatus.CONFLICT, why);
	}

	/** Null when the invitation was emailed, otherwise why not (in words for the Office). */
	private String invite(long userId, Actor office) {
		if (!links.on()) return "Email is not set up here, so no invitation was sent.";
		var account = links.account(institutionId(), userId);
		if (account.isEmpty()) return "The account is not active, so no invitation was sent. Activate it first.";
		try {
			links.send(account.get(), PasswordLinks.INVITE);
		} catch (RuntimeException e) {
			return "The invitation email could not be sent.";
		}
		log.record(office, "Password link emailed", account.get().email(), "invitation, works for 7 days");
		return null;
	}

	/** Activate, suspend or deactivate. Suspending or deactivating ends the person's sessions at once. */
	@PostMapping("/users/{id}/status")
	ResponseEntity<?> status(@PathVariable long id, @RequestBody(required = false) StatusChange c, HttpServletRequest req) {
		Actor office = access.actor(req);
		access.requireAdmin(office);
		Target t = target(id, office);
		String status = c == null ? "" : s(c.status(), 20), reason = c == null ? "" : s(c.reason(), 500);
		if (!List.of("active", "suspended", "deactivated").contains(status)) return AuthController.error(HttpStatus.BAD_REQUEST, "Unknown status.");
		if (!status.equals("active") && reason.isEmpty()) return AuthController.error(HttpStatus.BAD_REQUEST, "Give a reason.");
		if (status.equals("active") && t.researcherId() != null && db.sql("SELECT count(*) FROM app_user WHERE researcher_id = :r AND status IN ('active','suspended') AND id <> :u")
			.param("r", t.researcherId()).param("u", id).query(Long.class).single() > 0) {
			return AuthController.error(HttpStatus.BAD_REQUEST, "Another account is already linked to this faculty profile.");
		}
		db.sql("UPDATE app_user SET status = :s, status_reason = :why WHERE id = :u").param("s", status).param("why", reason.isEmpty() ? null : reason).param("u", id).update();
		if (!status.equals("active")) sessions.endAll(institutionId(), id, null);
		log.record(office, "Account " + (status.equals("active") ? "activated" : status), t.email(), reason.isEmpty() ? null : reason);
		return ResponseEntity.ok(Map.of("ok", true));
	}

	/** Moves an account between Faculty and Top-Level Management; signs the person out. */
	@PostMapping("/users/{id}/role")
	ResponseEntity<?> role(@PathVariable long id, @RequestBody(required = false) RoleChange c, HttpServletRequest req) {
		Actor office = access.actor(req);
		access.requireAdmin(office);
		Target t = target(id, office);
		String role = c == null ? "" : Actor.MANAGEMENT.equals(c.role()) ? Actor.MANAGEMENT : Actor.FACULTY.equals(c.role()) ? Actor.FACULTY : "";
		if (role.isEmpty()) return AuthController.error(HttpStatus.BAD_REQUEST, "Unknown role.");
		if (role.equals(Actor.FACULTY) && t.researcherId() == null) return AuthController.error(HttpStatus.BAD_REQUEST, "This account has no faculty profile. Create a faculty account instead.");
		db.sql("UPDATE app_user SET role = :r WHERE id = :u").param("r", role).param("u", id).update();
		sessions.endAll(institutionId(), id, null);
		log.record(office, "Role changed to " + role, t.email(), null);
		return ResponseEntity.ok(Map.of("ok", true));
	}

	/** Issues a new temporary password (shown once) and signs the person out everywhere. */
	@PostMapping("/users/{id}/reset-password")
	ResponseEntity<?> resetPassword(@PathVariable long id, HttpServletRequest req) {
		Actor office = access.actor(req);
		access.requireAdmin(office);
		Target t = target(id, office);
		String temp = Passwords.randomPassword();
		control.sql("UPDATE account_login SET password_hash = :h, password_set_at = now() WHERE institution_id = :i AND app_user_id = :u")
			.param("h", Passwords.hash(temp)).param("i", institutionId()).param("u", id).update();
		sessions.endAll(institutionId(), id, null);
		log.record(office, "Password reset", t.email(), null);
		return ResponseEntity.ok(Map.of("temporaryPassword", temp));
	}

	/** The institution's audit log, newest first. */
	@GetMapping("/audit")
	List<Map<String, Object>> audit(HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		return db.sql("SELECT id, at, actor_name, action, target, detail FROM admin_log ORDER BY at DESC, id DESC LIMIT 500").query((r, n) -> {
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("id", r.getLong("id"));
			m.put("at", r.getTimestamp("at").toInstant().toString());
			m.put("actorName", r.getString("actor_name"));
			m.put("action", r.getString("action"));
			m.put("target", r.getString("target"));
			m.put("detail", r.getString("detail"));
			return m;
		}).list();
	}

	record Target(long id, String email, String role, Long researcherId) {}

	/**
	 * A faculty or management account of this institution. Office of Research accounts belong to the UniRise team, and
	 * nobody changes their own account here; both look like a missing account.
	 */
	private Target target(long id, Actor office) {
		Target t = db.sql("SELECT id, email, role, researcher_id FROM app_user WHERE id = :u").param("u", id)
			.query((r, n) -> new Target(r.getLong("id"), r.getString("email"), r.getString("role"), (Long) r.getObject("researcher_id"))).optional()
			.orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(HttpStatus.NOT_FOUND));
		if (t.role().equals(Actor.OFFICE) || (office.userId() != null && office.userId() == id)) throw new org.springframework.web.server.ResponseStatusException(HttpStatus.NOT_FOUND);
		return t;
	}

	private boolean emailTaken(String email) {
		return control.sql("SELECT count(*) FROM account_login WHERE email = :e").param("e", email).query(Long.class).single() > 0
			|| db.sql("SELECT count(*) FROM app_user WHERE email = :e").param("e", email).query(Long.class).single() > 0;
	}

	/** Departments are the institution's org units of type department (G21). */
	private Long departmentId(String name) {
		return name.isEmpty() ? null : db.sql("SELECT id FROM org_unit WHERE type = 'department' AND lower(name) = lower(:n) ORDER BY id LIMIT 1").param("n", name).query(Long.class).optional().orElse(null);
	}

	private long institutionId() {
		return directory.bySlug(TenantContext.require()).orElseThrow().id();
	}

	private static String s(String v, int max) { return v == null ? "" : v.trim().length() > max ? v.trim().substring(0, max) : v.trim(); }

	private static String nz(String v) { return v == null ? "" : v; }
}
