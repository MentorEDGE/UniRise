package in.co.mentoredge.unirise.api;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;

/**
 * Password hashing and the password rules (same rules as rdms-web/server/auth.ts). Hashes carry their algorithm id, so
 * the algorithm can be strengthened later without resetting anyone's password.
 */
public final class Passwords {
	private static final String ID = "pbkdf2@SpringSecurity_v5_8";
	private static final PasswordEncoder ENCODER = new DelegatingPasswordEncoder(ID, Map.of(ID, Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8()));
	private static final SecureRandom RANDOM = new SecureRandom();
	/** Checked against when the email is unknown, so timing does not reveal which accounts exist. */
	private static final String DUMMY = ENCODER.encode(randomPassword());

	private Passwords() {}

	public static String hash(String password) { return ENCODER.encode(password); }

	public static boolean matches(String password, String hash) {
		try { return password != null && hash != null && ENCODER.matches(password, hash); } catch (IllegalArgumentException e) { return false; }
	}

	/** Spends the same time as a real check. */
	public static void burn(String password) { ENCODER.matches(password == null ? "" : password, DUMMY); }

	/** Null when acceptable, otherwise the message to show. */
	public static String problem(String password) {
		if (password == null || password.length() < 8) return "Use at least 8 characters.";
		if (password.length() > 128) return "Use at most 128 characters.";
		if (!password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*")) return "Use letters and at least one number.";
		return null;
	}

	/** A temporary password: 12 characters, shown once to the Office of Research. Always has letters and a digit. */
	public static String randomPassword() {
		while (true) {
			byte[] b = new byte[9];
			RANDOM.nextBytes(b);
			String p = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
			if (problem(p) == null) return p;
		}
	}
}
