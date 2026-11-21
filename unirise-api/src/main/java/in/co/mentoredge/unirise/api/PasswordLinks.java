package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.sesv2.SesV2Client;

/**
 * Password links sent by email (BACKEND_PLAN: email to users, unblocked by A3). Two kinds:
 * - "invite": the Office of Research sends it when it creates an account, or later from User Management; works for 7 days.
 * - "reset": the person asks for it with "Forgot password?"; works for 1 hour.
 * The link carries a random 256-bit secret in the website's URL fragment (never sent to a server by the browser); the
 * control plane keeps only its SHA-256 hash. A link works once, and a newer link for the same account replaces it.
 * Only accounts that could sign in get links: an active account in a live institution (and, for faculty, an active
 * faculty profile).
 */
@Service
public class PasswordLinks {
	public static final String INVITE = "invite", RESET = "reset";
	static final Duration INVITE_FOR = Duration.ofDays(7), RESET_FOR = Duration.ofHours(1);
	private static final Logger log = LoggerFactory.getLogger(PasswordLinks.class);
	private static final SecureRandom RANDOM = new SecureRandom();
	private static final String FOOTER = "Kind regards,\nThe UniRise Team\nUniRise by MentorEdge\n\nThis is an automated message. Please do not reply to this email.\n";

	/** An account that may receive a link. */
	public record Account(TenantInfo tenant, long userId, String email, String name, String role, String institution) {}

	private final JdbcClient control, tenant;
	private final TenantDirectory directory;
	private final AppProperties.Mail mail;
	private final SesV2Client ses;

	public PasswordLinks(@Qualifier("controlJdbc") JdbcClient control, @Qualifier("tenantJdbc") JdbcClient tenant, TenantDirectory directory, AppProperties props, Optional<SesV2Client> ses) {
		this.control = control;
		this.tenant = tenant;
		this.directory = directory;
		this.mail = props.mail();
		this.ses = ses.orElse(null);
	}

	/** Whether password emails can be sent here (AWS: yes; local runs: no, the Office hands out temporary passwords). */
	public boolean on() { return ses != null && !mail.from().isEmpty() && !mail.siteUrl().isEmpty(); }

	/** The account behind a sign-in email, if it could sign in. */
	public Optional<Account> byEmail(String email) {
		return control.sql("SELECT institution_id, app_user_id FROM account_login WHERE email = :e").param("e", email)
			.query((r, n) -> new long[] { r.getLong(1), r.getLong(2) }).optional().flatMap(a -> account(a[0], a[1]));
	}

	/** The account, if it could sign in: active, in a live institution, and (faculty) with an active profile. */
	public Optional<Account> account(long institutionId, long userId) {
		Optional<TenantInfo> t = directory.byId(institutionId).filter(i -> i.status().matches("sandbox|pilot|active"));
		if (t.isEmpty()) return Optional.empty();
		String email = control.sql("SELECT email FROM account_login WHERE institution_id = :i AND app_user_id = :u").param("i", institutionId).param("u", userId)
			.query(String.class).optional().orElse(null);
		if (email == null) return Optional.empty();
		String institution = directory.name(institutionId);
		return inTenant(t.get().slug(), () -> tenant.sql("""
			SELECT u.name, u.role FROM app_user u LEFT JOIN researcher r ON r.id = u.researcher_id
			WHERE u.id = :u AND u.status = 'active' AND (u.role <> 'faculty' OR r.active)""").param("u", userId)
			.query((r, n) -> new Account(t.get(), userId, email, r.getString("name"), r.getString("role"), institution)).optional());
	}

	/** Creates a link and emails it. Throws if the email could not be sent (the link is then withdrawn). */
	public void send(Account a, String purpose) { send(a, purpose, null); }

	/** As above; a new account's invitation can also carry its temporary password (to be changed at first sign-in). */
	public void send(Account a, String purpose, String temporaryPassword) {
		if (!on()) throw new IllegalStateException("Password emails are not set up here.");
		String token = issue(a, purpose);
		String link = mail.siteUrl().replaceAll("/+$", "") + "/#/set-password?t=" + token;
		String signIn = mail.siteUrl().replaceAll("/+$", "") + "/#/login";
		String subject, text;
		if (INVITE.equals(purpose) && temporaryPassword != null) {
			subject = "Your UniRise account";
			text = "Dear " + oneLine(a.name()) + ",\n\n"
				+ "The Office of Research at " + oneLine(a.institution()) + " has created a UniRise account for you.\n\n"
				+ "Sign in at " + signIn + " with:\n"
				+ "  Email: " + a.email() + "\n"
				+ "  Temporary password: " + temporaryPassword + "\n\n"
				+ "When you first sign in, you will be asked to choose your own password. Please do so straight away, and do not share this email.\n\n"
				+ "Alternatively, set your own password now with this link (it can be used once and expires in 7 days):\n" + link + "\n\n"
				+ "If you were not expecting this email, please contact your institution's Office of Research.\n\n"
				+ FOOTER;
		} else if (INVITE.equals(purpose)) {
			subject = "Set your UniRise password";
			text = "Dear " + oneLine(a.name()) + ",\n\n"
				+ "The Office of Research at " + oneLine(a.institution()) + " has invited you to set the password for your UniRise account.\n\n"
				+ "To set your password, please open the link below. For your security, the link can be used only once and expires in 7 days.\n\n"
				+ link + "\n\n"
				+ "Once your password is set, you can sign in at " + signIn + " using this email address: " + a.email() + "\n\n"
				+ "If you were not expecting this invitation, you can safely ignore this email, or contact your institution's Office of Research.\n\n"
				+ FOOTER;
		} else {
			subject = "Reset your UniRise password";
			text = "Dear " + oneLine(a.name()) + ",\n\n"
				+ "We received a request to reset the password for your UniRise account at " + oneLine(a.institution()) + " (" + a.email() + ").\n\n"
				+ "To choose a new password, please open the link below. For your security, the link can be used only once and expires in 1 hour.\n\n"
				+ link + "\n\n"
				+ "If you did not request a password reset, no action is needed. Your current password will remain unchanged. "
				+ "If you receive these emails repeatedly without having asked for them, please inform your institution's Office of Research.\n\n"
				+ FOOTER;
		}
		try {
			ses.sendEmail(b -> {
				b.fromEmailAddress(mail.from()).destination(d -> d.toAddresses(a.email()))
					.content(c -> c.simple(m -> m.subject(s -> s.data(subject).charset("UTF-8")).body(bd -> bd.text(t -> t.data(text).charset("UTF-8")))));
				if (!mail.configurationSet().isEmpty()) b.configurationSetName(mail.configurationSet());
			});
			log.info("Password {} link emailed (institution {}, user {})", purpose, a.tenant().slug(), a.userId());
		} catch (RuntimeException e) {
			control.sql("DELETE FROM password_link WHERE token_hash = :h").param("h", hash(token)).update();
			log.warn("Password {} link for institution {}, user {} could not be emailed: {}", purpose, a.tenant().slug(), a.userId(), e.getMessage());
			throw e;
		}
	}

	/** A new link for the account; any unused one stops working. Returns the secret (only ever put in the email). */
	String issue(Account a, String purpose) {
		byte[] b = new byte[32];
		RANDOM.nextBytes(b);
		String token = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
		long seconds = (INVITE.equals(purpose) ? INVITE_FOR : RESET_FOR).toSeconds();
		control.sql("DELETE FROM password_link WHERE (institution_id = :i AND app_user_id = :u AND used_at IS NULL) OR expires_at < now() - interval '30 days'")
			.param("i", a.tenant().id()).param("u", a.userId()).update();
		control.sql("INSERT INTO password_link(token_hash, institution_id, app_user_id, purpose, expires_at) VALUES (:h, :i, :u, :p, now() + make_interval(secs => :s))")
			.param("h", hash(token)).param("i", a.tenant().id()).param("u", a.userId()).param("p", purpose).param("s", seconds).update();
		return token;
	}

	public record Found(String purpose, Account account) {}

	/** A link that still works, and its account (if that account could still sign in). */
	public Optional<Found> find(String token) {
		if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) return Optional.empty();
		return control.sql("SELECT institution_id, app_user_id, purpose FROM password_link WHERE token_hash = :h AND used_at IS NULL AND expires_at > now()")
			.param("h", hash(token)).query((r, n) -> new Object[] { r.getLong(1), r.getLong(2), r.getString(3) }).optional()
			.flatMap(x -> account((Long) x[0], (Long) x[1]).map(a -> new Found((String) x[2], a)));
	}

	/**
	 * Uses the link: marks it used (once only, even if two requests race) and returns it, or empty if it no longer works.
	 * The caller then sets the password.
	 */
	public Optional<Found> use(String token) {
		Optional<Found> f = find(token);
		if (f.isEmpty()) return f;
		int claimed = control.sql("UPDATE password_link SET used_at = now() WHERE token_hash = :h AND used_at IS NULL AND expires_at > now()").param("h", hash(token)).update();
		if (claimed != 1) return Optional.empty();
		control.sql("DELETE FROM password_link WHERE institution_id = :i AND app_user_id = :u AND used_at IS NULL")
			.param("i", f.get().account().tenant().id()).param("u", f.get().account().userId()).update();
		return f;
	}

	/** Runs work in the tenant's database, restoring whatever tenant was current before. */
	<T> T inTenant(String slug, Supplier<T> work) {
		String before = TenantContext.current();
		TenantContext.set(slug);
		try { return work.get(); } finally { if (before == null) TenantContext.clear(); else TenantContext.set(before); }
	}

	static String hash(String token) {
		try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
		catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
	}

	private static String oneLine(String s) { return s == null ? "" : s.replaceAll("[\\p{Cntrl}]", " ").trim(); }
}
