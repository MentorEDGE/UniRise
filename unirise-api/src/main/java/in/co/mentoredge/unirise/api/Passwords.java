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
	/** Words found in the most common leaked passwords, and the site's own name (2026-11-24). */
	static final java.util.List<String> COMMON = java.util.List.of("password", "passw0rd", "unirise", "mentoredge", "qwerty", "asdfgh", "zxcvbn", "letmein",
		"welcome", "admin", "iloveyou", "monkey", "dragon", "football", "princess", "sunshine", "abc123", "123456", "654321", "111111", "000000",
		"changeme", "secret", "india123", "test123", "default");
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
		if (password == null || password.length() < 10) return "Use at least 10 characters.";
		if (password.length() > 128) return "Use at most 128 characters.";
		if (!password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*")) return "Use letters and at least one number.";
		String p = password.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]", "");
		if (p.chars().distinct().count() < 5 || COMMON.stream().anyMatch(p::contains))
			return "This password is too easy to guess. Avoid common words, the name of the site and long runs of the same characters.";
		return null;
	}

	/** As above, and not built from the person's own email address. */
	public static String problem(String password, String email) {
		String p = problem(password);
		if (p != null || email == null) return p;
		String local = email.toLowerCase(java.util.Locale.ROOT).replaceAll("@.*", "").replaceAll("[^a-z0-9]", "");
		if (local.length() >= 4 && password.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]", "").contains(local))
			return "Do not use your email address in your password.";
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
