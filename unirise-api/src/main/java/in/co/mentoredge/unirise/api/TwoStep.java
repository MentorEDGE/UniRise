package in.co.mentoredge.unirise.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Two-step sign-in with an authenticator app (2026-11-24). Required for the Office of Research and Top-Level
 * Management (whose accounts reach the whole institution), optional for faculty. Accounts loaded from the sample data are
 * not required to use it: their shared password is published on the sign-in page, so a shared authenticator would add
 * nothing. Each account also gets 10 one-time recovery codes for a lost phone; the Office can reset it for someone.
 * Codes are accepted once (the last time step is kept), for the current 30 seconds or one step either side.
 */
@Component
public class TwoStep {
	private static final SecureRandom RANDOM = new SecureRandom();
	private final JdbcClient control;
	/** Roles that must use it (app.security.two-step-roles, default office and management). */
	private final java.util.Set<String> roles;

	public TwoStep(@Qualifier("controlJdbc") JdbcClient control, @org.springframework.beans.factory.annotation.Value("${app.security.two-step-roles:office,management}") String roles) {
		this.control = control;
		this.roles = java.util.Arrays.stream(roles.split(",")).map(String::trim).filter((r) -> !r.isEmpty()).collect(java.util.stream.Collectors.toSet());
	}

	public record State(boolean enabled, boolean pending, int recoveryLeft) {}

	/** Whether the role must use two-step sign-in. */
	public boolean required(String role, String createdBy) {
		return roles.contains(role) && !DecisionMail.DEMO.equals(createdBy);
	}

	public State state(long institutionId, long userId) {
		return control.sql("SELECT totp_enabled_at IS NOT NULL, totp_secret IS NOT NULL, jsonb_array_length(recovery_codes) FROM account_login WHERE institution_id = :i AND app_user_id = :u")
			.param("i", institutionId).param("u", userId).query((r, n) -> new State(r.getBoolean(1), r.getBoolean(2) && !r.getBoolean(1), r.getInt(3))).optional()
			.orElse(new State(false, false, 0));
	}

	/** Starts setting up the app: a new secret, kept until the first code confirms it. Not while already on. */
	public String setup(long institutionId, long userId) {
		if (state(institutionId, userId).enabled()) throw RuleException.invalid("Two-step sign-in is already on.");
		String secret = Totp.newSecret();
		control.sql("UPDATE account_login SET totp_secret = :s, totp_last_step = NULL WHERE institution_id = :i AND app_user_id = :u AND totp_enabled_at IS NULL")
			.param("s", secret).param("i", institutionId).param("u", userId).update();
		return secret;
	}

	/** Confirms the app with its first code and turns two-step sign-in on. Returns the new recovery codes (shown once). */
	public List<String> enable(long institutionId, long userId, String code) {
		String secret = control.sql("SELECT totp_secret FROM account_login WHERE institution_id = :i AND app_user_id = :u AND totp_enabled_at IS NULL")
			.param("i", institutionId).param("u", userId).query(String.class).optional().orElse(null);
		if (secret == null) throw RuleException.invalid("Start setting up the authenticator app first.");
		long step = Totp.verify(secret, code, System.currentTimeMillis() / 1000);
		if (step < 0) throw RuleException.invalid("That code is not right. Check the time on your phone and enter the newest 6-digit code.");
		control.sql("UPDATE account_login SET totp_enabled_at = now(), totp_last_step = :s WHERE institution_id = :i AND app_user_id = :u")
			.param("s", step).param("i", institutionId).param("u", userId).update();
		return newRecoveryCodes(institutionId, userId);
	}

	/** A code from the app (used once) or one of the recovery codes (used up). */
	public boolean verify(long institutionId, long userId, String code) {
		if (code == null) return false;
		String c = code.trim();
		if (c.replaceAll("\\s", "").matches("\\d{6}")) {
			String secret = control.sql("SELECT totp_secret FROM account_login WHERE institution_id = :i AND app_user_id = :u AND totp_enabled_at IS NOT NULL")
				.param("i", institutionId).param("u", userId).query(String.class).optional().orElse(null);
			long step = Totp.verify(secret, c, System.currentTimeMillis() / 1000);
			return step >= 0 && control.sql("UPDATE account_login SET totp_last_step = :s WHERE institution_id = :i AND app_user_id = :u AND (totp_last_step IS NULL OR totp_last_step < :s)")
				.param("s", step).param("i", institutionId).param("u", userId).update() == 1; // a code works once
		}
		String h = hash(c);
		return control.sql("UPDATE account_login SET recovery_codes = recovery_codes - :h WHERE institution_id = :i AND app_user_id = :u AND totp_enabled_at IS NOT NULL AND jsonb_exists(recovery_codes, :h)")
			.param("h", h).param("i", institutionId).param("u", userId).update() == 1;
	}

	/** Ten new one-time recovery codes (the old ones stop working). */
	public List<String> newRecoveryCodes(long institutionId, long userId) {
		List<String> codes = new ArrayList<>(), hashes = new ArrayList<>();
		for (int i = 0; i < 10; i++) {
			byte[] b = new byte[7];
			RANDOM.nextBytes(b);
			String raw = Totp.base32(b).substring(0, 10);
			codes.add(raw.substring(0, 5) + "-" + raw.substring(5));
			hashes.add(hash(raw));
		}
		control.sql("UPDATE account_login SET recovery_codes = CAST(:c AS jsonb) WHERE institution_id = :i AND app_user_id = :u")
			.param("c", Json.write(hashes)).param("i", institutionId).param("u", userId).update();
		return codes;
	}

	/** Turns it off (the person, when not required, or the Office for someone who lost their phone). */
	public void reset(long institutionId, long userId) {
		control.sql("UPDATE account_login SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = '[]' WHERE institution_id = :i AND app_user_id = :u")
			.param("i", institutionId).param("u", userId).update();
	}

	/** Recovery codes are compared without dashes, spaces or case. */
	static String hash(String code) {
		try {
			String n = code.toUpperCase().replaceAll("[^A-Z2-7]", "");
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(n.getBytes(StandardCharsets.UTF_8)));
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	/** The link an authenticator app reads from the QR code. */
	static String uri(String email, String secret) {
		return "otpauth://totp/UniRise:" + java.net.URLEncoder.encode(email, StandardCharsets.UTF_8).replace("+", "%20") + "?secret=" + secret + "&issuer=UniRise&algorithm=SHA1&digits=6&period=30";
	}
}
