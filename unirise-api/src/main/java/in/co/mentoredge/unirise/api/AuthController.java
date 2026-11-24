package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * Email and password sign-in for the pilot (decision D1; OIDC follows in phase 8). Same requests and responses as the
 * rdms-web prototype server (rdms-web/server/app.ts), so the frontend switches over without changes:
 * POST /api/login, POST /api/admin/login (Office of Research only), POST /api/logout, GET /api/session,
 * POST /api/account/password.
 */
@RestController
@RequestMapping("/api")
public class AuthController {
	public record Credentials(String email, String password) {}
	public record PasswordChange(String current, String next) {}

	private static final String INVALID = "Invalid email or password.";
	private final JdbcClient tenant, control;
	private final TenantDirectory directory;
	private final Sessions sessions;
	private final SignInThrottle throttle;
	private final AdminLog log;
	private final AccessService access;
	private final boolean secureCookie;
	@org.springframework.beans.factory.annotation.Autowired private BreachedPasswords breached;

	public AuthController(@Qualifier("tenantJdbc") JdbcClient tenant, @Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, Sessions sessions,
		SignInThrottle throttle, AdminLog log, AccessService access, @Value("${app.session.secure-cookie:true}") boolean secureCookie) {
		this.tenant = tenant;
		this.control = control;
		this.directory = directory;
		this.sessions = sessions;
		this.throttle = throttle;
		this.log = log;
		this.access = access;
		this.secureCookie = secureCookie;
	}

	record Login(long institutionId, long userId, String hash) {}

	@PostMapping("/login")
	ResponseEntity<?> login(@RequestBody(required = false) Credentials c, HttpServletRequest req, HttpServletResponse res) { return signIn(c, false, req, res); }

	/** The Office of Research's own sign-in: any other account is refused as if the password were wrong. */
	@PostMapping("/admin/login")
	ResponseEntity<?> adminLogin(@RequestBody(required = false) Credentials c, HttpServletRequest req, HttpServletResponse res) { return signIn(c, true, req, res); }

	private ResponseEntity<?> signIn(Credentials c, boolean officeOnly, HttpServletRequest req, HttpServletResponse res) {
		String email = c == null || c.email() == null ? "" : c.email().trim().toLowerCase();
		String password = c == null || c.password() == null ? "" : c.password();
		if (email.length() > 200 || password.length() > 200) return error(HttpStatus.UNAUTHORIZED, INVALID);
		String byEmail = "email:" + email, byAddress = "ip:" + req.getRemoteAddr();
		if (throttle.blocked(byEmail, SignInThrottle.PER_EMAIL) || throttle.blocked(byAddress, SignInThrottle.PER_ADDRESS)) {
			return error(HttpStatus.TOO_MANY_REQUESTS, "Too many failed attempts. Try again in 15 minutes.");
		}
		Optional<Login> found = control.sql("SELECT institution_id, app_user_id, password_hash FROM account_login WHERE email = :e").param("e", email)
			.query((r, n) -> new Login(r.getLong("institution_id"), r.getLong("app_user_id"), r.getString("password_hash"))).optional();
		if (found.isEmpty()) Passwords.burn(password);
		Optional<TenantInfo> inst = found.flatMap(f -> directory.byId(f.institutionId()));
		// A suspended institution's database is closed to requests, so decide from the control plane alone: the right
		// password gets the suspension message, a wrong one the usual answer (nothing is revealed either way).
		if (inst.isPresent() && !inst.get().status().matches("sandbox|pilot|active")) {
			if (!Passwords.matches(password, found.get().hash())) {
				throttle.fail(byEmail);
				throttle.fail(byAddress);
				return error(HttpStatus.UNAUTHORIZED, INVALID);
			}
			return error(HttpStatus.FORBIDDEN, "Your institution’s access is suspended. Contact the UniRise team.");
		}
		Map<String, Object> user = inst.isEmpty() ? null : inTenant(inst.get(), () -> userRow(found.get().userId()));
		boolean eligible = user != null && (!officeOnly || Actor.OFFICE.equals(user.get("role")));
		if (!eligible || !Passwords.matches(password, found.get().hash())) {
			throttle.fail(byEmail);
			throttle.fail(byAddress);
			if (user != null && Actor.OFFICE.equals(user.get("role"))) inTenant(inst.get(), () -> { log.record(null, "Office of Research sign-in failed", email, null); return null; });
			return error(HttpStatus.UNAUTHORIZED, INVALID);
		}
		throttle.clear(byEmail);
		String status = (String) user.get("status");
		if (!"active".equals(status)) {
			return error(HttpStatus.FORBIDDEN, "suspended".equals(status) ? "Your account is suspended. Contact your Office of Research." : "Your account has been deactivated.");
		}
		if (!inst.get().status().matches("sandbox|pilot|active")) return error(HttpStatus.FORBIDDEN, "Your institution’s access is suspended. Contact the UniRise team.");
		if (Actor.FACULTY.equals(user.get("role")) && !Boolean.TRUE.equals(inTenant(inst.get(), () -> tenant.sql("SELECT r.active FROM app_user u JOIN researcher r ON r.id = u.researcher_id WHERE u.id = :u")
			.param("u", found.get().userId()).query(Boolean.class).optional().orElse(false)))) {
			return error(HttpStatus.FORBIDDEN, "Your faculty profile is inactive. Contact your institution’s Office of Research.");
		}
		sessions.end(ApiKeyFilter.cookie(req)); // a new sign-in replaces any session this browser had
		boolean office = Actor.OFFICE.equals(user.get("role"));
		setCookie(res, sessions.start(found.get().institutionId(), found.get().userId(), office), -1);
		if (office) inTenant(inst.get(), () -> { log.record(new Actor(found.get().userId(), null, false, Actor.OFFICE, (String) user.get("name")), "Office of Research signed in", email, null); return null; });
		return ResponseEntity.ok(sessionBody(inst.get(), user));
	}

	@PostMapping("/logout")
	Map<String, Object> logout(HttpServletRequest req, HttpServletResponse res) {
		sessions.end(ApiKeyFilter.cookie(req));
		setCookie(res, "", 0);
		return Map.of("ok", true);
	}

	@GetMapping("/session")
	ResponseEntity<?> session(HttpServletRequest req) {
		Object institutionId = req.getAttribute("institutionId");
		if (institutionId == null) return error(HttpStatus.UNAUTHORIZED, "Not signed in.");
		Actor a = access.actor(req);
		TenantInfo inst = directory.byId((Long) institutionId).orElseThrow();
		return ResponseEntity.ok(sessionBody(inst, userRow(a.userId())));
	}

	/** Changing the password signs the account out everywhere except this browser. */
	@PostMapping("/account/password")
	ResponseEntity<?> changePassword(@RequestBody(required = false) PasswordChange body, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (a.userId() == null) return error(HttpStatus.BAD_REQUEST, "The service key has no password.");
		long institutionId = (Long) req.getAttribute("institutionId");
		String hash = control.sql("SELECT password_hash FROM account_login WHERE institution_id = :i AND app_user_id = :u").param("i", institutionId).param("u", a.userId())
			.query(String.class).optional().orElse(null);
		if (body == null || !Passwords.matches(body.current(), hash)) return error(HttpStatus.BAD_REQUEST, "Current password is incorrect.");
		String email = control.sql("SELECT email FROM account_login WHERE institution_id = :i AND app_user_id = :u").param("i", institutionId).param("u", a.userId()).query(String.class).optional().orElse(null);
		String problem = Passwords.problem(body.next(), email);
		if (problem == null && Passwords.matches(body.next(), hash)) problem = "Choose a password different from your current one.";
		if (problem == null) problem = breached.problem(body.next());
		if (problem != null) return error(HttpStatus.BAD_REQUEST, problem);
		control.sql("UPDATE account_login SET password_hash = :h, password_set_at = now(), must_change_password = false WHERE institution_id = :i AND app_user_id = :u")
			.param("h", Passwords.hash(body.next())).param("i", institutionId).param("u", a.userId()).update();
		sessions.endAll(institutionId, a.userId(), (String) req.getAttribute("sessionHash"));
		return ResponseEntity.ok(Map.of("ok", true));
	}

	record Confirm(String password) {}

	/**
	 * Confirms the password in this session, unlocking sensitive actions for 5 minutes (2026-11-24). Five wrong
	 * passwords within 15 minutes sign the account out everywhere: a borrowed browser cannot keep guessing.
	 */
	@PostMapping("/account/confirm")
	ResponseEntity<?> confirm(@RequestBody(required = false) Confirm body, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (a.userId() == null) return ResponseEntity.ok(Map.of("ok", true));
		long institutionId = (Long) req.getAttribute("institutionId");
		String key = "confirm:" + institutionId + ":" + a.userId();
		String hash = control.sql("SELECT password_hash FROM account_login WHERE institution_id = :i AND app_user_id = :u").param("i", institutionId).param("u", a.userId())
			.query(String.class).optional().orElse(null);
		if (body == null || !Passwords.matches(body.password(), hash)) {
			throttle.fail(key);
			if (throttle.blocked(key, 5)) {
				sessions.endAll(institutionId, a.userId(), null);
				throttle.clear(key);
				log.record(a, "Signed out after wrong passwords", a.name(), "5 wrong passwords when confirming a sensitive action");
				return error(HttpStatus.UNAUTHORIZED, "Too many wrong passwords. You have been signed out.");
			}
			return error(HttpStatus.BAD_REQUEST, "That password is incorrect.");
		}
		throttle.clear(key);
		sessions.confirm((String) req.getAttribute("sessionHash"));
		return ResponseEntity.ok(Map.of("ok", true));
	}

	// ---------- shared with UserController ----------

	/** The account as the frontend's User type describes it. */
	Map<String, Object> userRow(long userId) {
		return tenant.sql("""
			SELECT u.id, u.email, u.name, u.title, u.role, u.status, u.designation, u.department, r.employee_id
			FROM app_user u LEFT JOIN researcher r ON r.id = u.researcher_id WHERE u.id = :u""").param("u", userId)
			.query((r, n) -> {
				Map<String, Object> m = new LinkedHashMap<>();
				m.put("id", String.valueOf(r.getLong("id")));
				m.put("email", r.getString("email"));
				m.put("name", r.getString("name"));
				m.put("role", r.getString("role"));
				m.put("status", r.getString("status"));
				m.put("institutionId", TenantContext.require());
				if (r.getString("employee_id") != null) m.put("facultyId", r.getString("employee_id"));
				m.put("designation", r.getString("designation"));
				return m;
			}).optional().orElse(null);
	}

	private Map<String, Object> sessionBody(TenantInfo inst, Map<String, Object> user) {
		Map<String, Object> institution = new LinkedHashMap<>();
		institution.put("id", inst.slug());
		institution.put("slug", inst.slug());
		institution.put("name", directory.name(inst.id()));
		institution.put("status", inst.status().equals("suspended") ? "suspended" : "active");
		Map<String, Object> body = new LinkedHashMap<>(); // user first, then institution, as in the prototype
		if (user != null) { // signed in with a password someone else chose: the website asks for a new one first
			user = new LinkedHashMap<>(user);
			user.put("mustChangePassword", control.sql("SELECT must_change_password FROM account_login WHERE institution_id = :i AND app_user_id = :u")
				.param("i", inst.id()).param("u", Long.parseLong((String) user.get("id"))).query(Boolean.class).optional().orElse(false));
		}
		body.put("user", user);
		body.put("institution", institution);
		return body;
	}

	private <T> T inTenant(TenantInfo t, java.util.function.Supplier<T> work) {
		TenantContext.set(t.slug());
		try { return work.get(); } finally { TenantContext.clear(); }
	}

	private void setCookie(HttpServletResponse res, String value, int maxAge) {
		res.addHeader("Set-Cookie", Sessions.COOKIE + "=" + value + "; HttpOnly; SameSite=Strict; Path=/" + (secureCookie ? "; Secure" : "") + (maxAge >= 0 ? "; Max-Age=" + maxAge : ""));
	}

	static ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
		return ResponseEntity.status(status).body(Map.of("error", message));
	}
}
