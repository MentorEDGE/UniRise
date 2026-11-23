package in.co.mentoredge.unirise.api;

import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * Setting a password from an emailed link (public; the link's secret is the credential):
 * POST /api/password/forgot {email}            no email: tells the person to ask their Office of Research, who resets the
 *                                              password (2026-11-23). The answer is the same for every email.
 * POST /api/password/check {token}             whether the link still works, and whose it is (for the page's heading).
 * POST /api/password/set {token, password}     sets the password, uses up the link and signs the account out everywhere.
 */
@RestController
@RequestMapping("/api/password")
public class PasswordController {
	public record Forgot(String email) {}
	public record Check(String token) {}
	public record SetPassword(String token, String password) {}

	static final int PER_EMAIL = 3, PER_ADDRESS = 20;
	static final String ASK_OFFICE = "Your institution's Office of Research can reset your password. Contact them and they will send you a temporary password.";
	static final String GONE = "This link has expired or has already been used. Ask for a new one with “Forgot password?” on the sign-in page, or ask your Office of Research.";
	private static final Logger log = LoggerFactory.getLogger(PasswordController.class);

	private final PasswordLinks links;
	private final JdbcClient control;
	private final Sessions sessions;
	private final SignInThrottle throttle;
	private final AdminLog audit;
	private final ExecutorService background = Executors.newVirtualThreadPerTaskExecutor();

	public PasswordController(PasswordLinks links, @Qualifier("controlJdbc") JdbcClient control, Sessions sessions, SignInThrottle throttle, AdminLog audit) {
		this.links = links;
		this.control = control;
		this.sessions = sessions;
		this.throttle = throttle;
		this.audit = audit;
	}

	@PreDestroy
	void stop() { background.shutdown(); }

	@PostMapping("/forgot")
	ResponseEntity<?> forgot(@RequestBody(required = false) Forgot body, HttpServletRequest req) {
		String email = body == null || body.email() == null ? "" : body.email().trim().toLowerCase();
		if (email.isEmpty() || email.length() > 200 || !email.contains("@")) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter your email address.");
		String byEmail = "forgot-email:" + email, byAddress = "forgot-ip:" + req.getRemoteAddr();
		if (throttle.blocked(byEmail, PER_EMAIL) || throttle.blocked(byAddress, PER_ADDRESS)) {
			return AuthController.error(HttpStatus.TOO_MANY_REQUESTS, "Too many requests. Try again in 15 minutes.");
		}
		throttle.fail(byEmail);
		throttle.fail(byAddress);
		// No email (2026-11-23): UniRise sends nothing itself; the Office of Research resets passwords and emails the
		// temporary one from its own address. The answer is the same for every email, so it reveals nothing.
		return ResponseEntity.ok(Map.of("ok", true, "message", ASK_OFFICE));
	}

	@PostMapping("/check")
	ResponseEntity<?> check(@RequestBody(required = false) Check body) {
		var found = links.find(body == null ? null : body.token());
		if (found.isEmpty()) return AuthController.error(HttpStatus.NOT_FOUND, GONE);
		var a = found.get().account();
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("purpose", found.get().purpose());
		m.put("email", a.email());
		m.put("name", a.name());
		m.put("institution", a.institution());
		return ResponseEntity.ok(m);
	}

	@PostMapping("/set")
	ResponseEntity<?> set(@RequestBody(required = false) SetPassword body) {
		String password = body == null ? null : body.password();
		if (links.find(body == null ? null : body.token()).isEmpty()) return AuthController.error(HttpStatus.NOT_FOUND, GONE);
		String problem = Passwords.problem(password);
		if (problem != null) return AuthController.error(HttpStatus.BAD_REQUEST, problem);
		var used = links.use(body.token());
		if (used.isEmpty()) return AuthController.error(HttpStatus.NOT_FOUND, GONE);
		var a = used.get().account();
		control.sql("UPDATE account_login SET password_hash = :h, password_set_at = now(), must_change_password = false WHERE institution_id = :i AND app_user_id = :u")
			.param("h", Passwords.hash(password)).param("i", a.tenant().id()).param("u", a.userId()).update();
		sessions.endAll(a.tenant().id(), a.userId(), null);
		throttle.clear("email:" + a.email()); // a locked sign-in is unlocked by the new password
		links.inTenant(a.tenant().slug(), () -> {
			audit.record(null, PasswordLinks.INVITE.equals(used.get().purpose()) ? "Password set from an emailed link" : "Password reset from an emailed link", a.email(), null);
			return null;
		});
		return ResponseEntity.ok(Map.of("ok", true, "email", a.email()));
	}

}
