package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.List;
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
	@org.springframework.beans.factory.annotation.Autowired private TwoStep twoStep;
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
		// Two-step sign-in (2026-11-24): required for the Office and management, optional for faculty. The password alone
		// only opens a 10-minute half-finished sign-in; the session starts after the authenticator code.
		long userId = found.get().userId();
		String createdBy = inTenant(inst.get(), () -> tenant.sql("SELECT coalesce(created_by, '') FROM app_user WHERE id = :u").param("u", userId).query(String.class).single());
		var two = twoStep.state(found.get().institutionId(), userId);
		if (two.enabled() || twoStep.required((String) user.get("role"), createdBy)) {
			sessions.endTwoStep(twoStepCookie(req));
			setTwoStepCookie(res, sessions.startTwoStep(found.get().institutionId(), userId), 600);
			return ResponseEntity.ok(Json.of("twoStep", two.enabled() ? "verify" : "setup", "email", email));
		}
		return finish(inst.get(), user, userId, req, res);
	}

	/** Starts the session once every check (and, where used, the authenticator code) has passed. */
	private ResponseEntity<?> finish(TenantInfo inst, Map<String, Object> user, long userId, HttpServletRequest req, HttpServletResponse res) {
		sessions.end(ApiKeyFilter.cookie(req)); // a new sign-in replaces any session this browser had
		boolean office = Actor.OFFICE.equals(user.get("role"));
		setCookie(res, sessions.start(inst.id(), userId, office, req.getHeader("User-Agent"), req.getRemoteAddr()), -1);
		control.sql("UPDATE account_login SET last_sign_in_at = now() WHERE institution_id = :i AND app_user_id = :u").param("i", inst.id()).param("u", userId).update();
		String email = (String) user.get("email");
		if (office) inTenant(inst, () -> { log.record(new Actor(userId, null, false, Actor.OFFICE, (String) user.get("name")), "Office of Research signed in", email, null); return null; });
		return ResponseEntity.ok(sessionBody(inst, user));
	}

	// ---------- two-step sign-in during sign-in (the half-finished sign-in cookie) ----------

	static final String TWO_STEP_COOKIE = "unirise_2fa";
	record Code(String code) {}

	private String twoStepCookie(HttpServletRequest req) {
		if (req.getCookies() == null) return null;
		for (var c : req.getCookies()) if (TWO_STEP_COOKIE.equals(c.getName())) return c.getValue();
		return null;
	}

	private void setTwoStepCookie(HttpServletResponse res, String value, int maxAge) {
		res.addHeader("Set-Cookie", TWO_STEP_COOKIE + "=" + value + "; HttpOnly; SameSite=Strict; Path=/api/login" + (secureCookie ? "; Secure" : "") + "; Max-Age=" + maxAge);
	}

	/** The half-finished sign-in, re-checked (the account or institution may have changed in the 10 minutes). */
	private record Pending(TenantInfo inst, long userId, Map<String, Object> user, String email) {}

	private Optional<Pending> pending(HttpServletRequest req) {
		var p = sessions.readTwoStep(twoStepCookie(req));
		if (p.isEmpty()) return Optional.empty();
		var inst = directory.byId(p.get()[0]).filter((t) -> t.status().matches("sandbox|pilot|active"));
		if (inst.isEmpty()) return Optional.empty();
		Map<String, Object> user = inTenant(inst.get(), () -> userRow(p.get()[1]));
		if (user == null || !"active".equals(user.get("status"))) return Optional.empty();
		return Optional.of(new Pending(inst.get(), p.get()[1], user, (String) user.get("email")));
	}

	private static final String EXPIRED = "Your sign-in has expired. Enter your email and password again.";

	/** The code from the authenticator app (or a recovery code) completes the sign-in. */
	@PostMapping("/login/2fa")
	ResponseEntity<?> twoStepVerify(@RequestBody(required = false) Code body, HttpServletRequest req, HttpServletResponse res) {
		var p = pending(req);
		if (p.isEmpty()) return error(HttpStatus.UNAUTHORIZED, EXPIRED);
		String key = "2fa:" + p.get().inst().id() + ":" + p.get().userId();
		if (throttle.blocked(key, 5)) { sessions.endTwoStep(twoStepCookie(req)); return error(HttpStatus.TOO_MANY_REQUESTS, "Too many wrong codes. Try again in 15 minutes."); }
		if (!twoStep.verify(p.get().inst().id(), p.get().userId(), body == null ? null : body.code())) {
			throttle.fail(key);
			return error(HttpStatus.BAD_REQUEST, "That code is not right. Enter the newest 6-digit code from your authenticator app, or a recovery code.");
		}
		throttle.clear(key);
		sessions.endTwoStep(twoStepCookie(req));
		setTwoStepCookie(res, "", 0);
		return finish(p.get().inst(), p.get().user(), p.get().userId(), req, res);
	}

	/** First sign-in with two-step required: a new secret for the authenticator app (shown as a QR code). */
	@PostMapping("/login/2fa/setup")
	ResponseEntity<?> twoStepSetupAtSignIn(HttpServletRequest req) {
		var p = pending(req);
		if (p.isEmpty()) return error(HttpStatus.UNAUTHORIZED, EXPIRED);
		String secret = twoStep.setup(p.get().inst().id(), p.get().userId());
		return ResponseEntity.ok(Json.of("secret", secret, "uri", TwoStep.uri(p.get().email(), secret)));
	}

	/** The first code confirms the app: two-step sign-in is on, the recovery codes are shown once, and the session starts. */
	@PostMapping("/login/2fa/enable")
	ResponseEntity<?> twoStepEnableAtSignIn(@RequestBody(required = false) Code body, HttpServletRequest req, HttpServletResponse res) {
		var p = pending(req);
		if (p.isEmpty()) return error(HttpStatus.UNAUTHORIZED, EXPIRED);
		var codes = twoStep.enable(p.get().inst().id(), p.get().userId(), body == null ? null : body.code());
		inTenant(p.get().inst(), () -> { log.record(new Actor(p.get().userId(), null, false, (String) p.get().user().get("role"), (String) p.get().user().get("name")), "Two-step sign-in turned on", p.get().email(), null); return null; });
		sessions.endTwoStep(twoStepCookie(req));
		setTwoStepCookie(res, "", 0);
		@SuppressWarnings("unchecked") var out = (ResponseEntity<Map<String, Object>>) finish(p.get().inst(), p.get().user(), p.get().userId(), req, res);
		Map<String, Object> body2 = new java.util.LinkedHashMap<>(out.getBody());
		body2.put("recoveryCodes", codes);
		return ResponseEntity.status(out.getStatusCode()).headers(out.getHeaders()).body(body2);
	}

	// ---------- two-step sign-in and signed-in devices, from the Account page ----------

	private long[] me(HttpServletRequest req) {
		Actor a = access.actor(req);
		if (a.userId() == null) throw RuleException.invalid("The service key has no account.");
		return new long[] { (Long) req.getAttribute("institutionId"), a.userId() };
	}

	@GetMapping("/account/2fa")
	Map<String, Object> twoStepState(HttpServletRequest req) {
		long[] m = me(req);
		var s = twoStep.state(m[0], m[1]);
		String role = access.actor(req).role();
		String createdBy = tenant.sql("SELECT coalesce(created_by, '') FROM app_user WHERE id = :u").param("u", m[1]).query(String.class).single();
		return Json.of("enabled", s.enabled(), "required", twoStep.required(role, createdBy), "recoveryCodesLeft", s.recoveryLeft());
	}

	@PostMapping("/account/2fa/setup")
	Map<String, Object> twoStepSetup(HttpServletRequest req) {
		long[] m = me(req);
		String secret = twoStep.setup(m[0], m[1]);
		String email = control.sql("SELECT email FROM account_login WHERE institution_id = :i AND app_user_id = :u").param("i", m[0]).param("u", m[1]).query(String.class).single();
		return Json.of("secret", secret, "uri", TwoStep.uri(email, secret));
	}

	@PostMapping("/account/2fa/enable")
	Map<String, Object> twoStepEnable(@RequestBody(required = false) Code body, HttpServletRequest req) {
		long[] m = me(req);
		var codes = twoStep.enable(m[0], m[1], body == null ? null : body.code());
		log.record(access.actor(req), "Two-step sign-in turned on", access.actor(req).name(), null);
		return Json.of("recoveryCodes", codes);
	}

	/** Faculty may turn it off again (with a current code); the Office and management may not. */
	@PostMapping("/account/2fa/disable")
	ResponseEntity<?> twoStepDisable(@RequestBody(required = false) Code body, HttpServletRequest req) {
		long[] m = me(req);
		Actor a = access.actor(req);
		String createdBy = tenant.sql("SELECT coalesce(created_by, '') FROM app_user WHERE id = :u").param("u", m[1]).query(String.class).single();
		if (twoStep.required(a.role(), createdBy)) return error(HttpStatus.FORBIDDEN, "Two-step sign-in is required for your role.");
		if (!twoStep.verify(m[0], m[1], body == null ? null : body.code())) return error(HttpStatus.BAD_REQUEST, "That code is not right.");
		twoStep.reset(m[0], m[1]);
		log.record(a, "Two-step sign-in turned off", a.name(), null);
		return ResponseEntity.ok(Map.of("ok", true));
	}

	/** New recovery codes (the old ones stop working); needs a current code. */
	@PostMapping("/account/2fa/recovery-codes")
	ResponseEntity<?> recoveryCodes(@RequestBody(required = false) Code body, HttpServletRequest req) {
		long[] m = me(req);
		if (!twoStep.verify(m[0], m[1], body == null ? null : body.code())) return error(HttpStatus.BAD_REQUEST, "That code is not right.");
		return ResponseEntity.ok(Json.of("recoveryCodes", twoStep.newRecoveryCodes(m[0], m[1])));
	}

	@GetMapping("/account/sessions")
	List<Map<String, Object>> mySessions(HttpServletRequest req) {
		long[] m = me(req);
		return sessions.list(m[0], m[1], (String) req.getAttribute("sessionHash"));
	}

	@PostMapping("/account/sessions/end-others")
	Map<String, Object> endOtherSessions(HttpServletRequest req) {
		long[] m = me(req);
		sessions.endAll(m[0], m[1], (String) req.getAttribute("sessionHash"));
		return Map.of("ok", true);
	}

	@PostMapping("/account/sessions/{id}/end")
	ResponseEntity<?> endSession(@PathVariable String id, HttpServletRequest req) {
		long[] m = me(req);
		return sessions.endOne(m[0], m[1], id) ? ResponseEntity.ok(Map.of("ok", true)) : error(HttpStatus.NOT_FOUND, "That session has already ended.");
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
