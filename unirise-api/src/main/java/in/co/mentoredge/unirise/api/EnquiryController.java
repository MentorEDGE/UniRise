package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * Public "Talk to Our Team" enquiries (G24), as in the prototype server: required fields, consent, a hidden honeypot
 * field and 5 enquiries an hour per address. Stored in the control plane. shortcut: the email to the team is sent once
 * SES is wired (phase 7); until then delivered stays false.
 */
@RestController
public class EnquiryController {
	private static final String EMAIL = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
	private final JdbcClient control;

	public EnquiryController(@Qualifier("controlJdbc") JdbcClient control) { this.control = control; }

	@PostMapping("/api/enquiries")
	ResponseEntity<?> enquire(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
		String key = "enquiry:" + req.getRemoteAddr();
		if (control.sql("SELECT count(*) FROM sign_in_failure WHERE key = :k AND failures >= 5 AND window_end > now()").param("k", key).query(Long.class).single() > 0) {
			return AuthController.error(HttpStatus.TOO_MANY_REQUESTS, "Too many enquiries from this connection. Please try again later or email corporate@mentoredge.co.in.");
		}
		Map<String, Object> b = body == null ? Map.of() : body;
		if (!Json.str(b.get("website"), 200).isEmpty()) return ResponseEntity.ok(Map.of("ok", true)); // only automated spam fills the hidden field
		Map<String, Object> e = new LinkedHashMap<>();
		for (String[] f : new String[][] { { "institutionName", "200" }, { "institutionType", "80" }, { "country", "80" }, { "state", "80" }, { "city", "80" }, { "contactName", "200" },
			{ "designation", "120" }, { "email", "200" }, { "phone", "30" }, { "facultyCount", "40" }, { "interest", "120" }, { "message", "3000" } }) {
			e.put(f[0], Json.str(b.get(f[0]), Integer.parseInt(f[1])).trim());
		}
		e.put("email", ((String) e.get("email")).toLowerCase());
		Map<String, String> required = new LinkedHashMap<>();
		for (String[] r : new String[][] { { "institutionName", "Organisation name" }, { "institutionType", "Organisation type" }, { "contactName", "Contact name" }, { "email", "Work email" },
			{ "country", "Country" }, { "state", "State" }, { "city", "City" }, { "facultyCount", "Approximate number of faculty members" }, { "interest", "Area of interest" } }) required.put(r[0], r[1]);
		List<String> missing = required.entrySet().stream().filter(x -> ((String) e.get(x.getKey())).isEmpty()).map(Map.Entry::getValue).toList();
		if (!missing.isEmpty()) return AuthController.error(HttpStatus.BAD_REQUEST, "Please fill in: " + String.join(", ", missing) + ".");
		if (!((String) e.get("email")).matches(EMAIL)) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter a valid work email address.");
		String phone = (String) e.get("phone");
		if (!phone.isEmpty() && !phone.matches("[+\\d][\\d\\s()-]{6,}")) return AuthController.error(HttpStatus.BAD_REQUEST, "Enter a valid phone number.");
		if (!"yes".equals(b.get("consent")) && !Boolean.TRUE.equals(b.get("consent"))) return AuthController.error(HttpStatus.BAD_REQUEST, "Please agree that we may contact you about this enquiry.");
		control.sql("""
			INSERT INTO sign_in_failure(key, failures, window_end) VALUES (:k, 1, now() + interval '60 minutes')
			ON CONFLICT (key) DO UPDATE SET failures = CASE WHEN sign_in_failure.window_end > now() THEN sign_in_failure.failures + 1 ELSE 1 END,
			window_end = CASE WHEN sign_in_failure.window_end > now() THEN sign_in_failure.window_end ELSE now() + interval '60 minutes' END""").param("k", key).update();
		control.sql("INSERT INTO enquiry(data, delivery_note) VALUES (CAST(:d AS jsonb), 'email not configured (SES, phase 7)')").param("d", Json.write(e)).update();
		return ResponseEntity.ok(Map.of("ok", true));
	}
}
