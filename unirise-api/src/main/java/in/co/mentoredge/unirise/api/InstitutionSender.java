package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.GetEmailIdentityResponse;
import software.amazon.awssdk.services.sesv2.model.NotFoundException;

/**
 * An institution's own sending address (control table {@code institution_mail}, 2026-11-23). Every email to the
 * institution's people — welcome emails with temporary passwords, password links, decisions on entries and profile
 * updates, and submission notices to the Office — is sent from it, signed by the Office of Research, with replies to
 * it. UniRise's own address is never used for them: until the domain is verified, no email is sent at all.
 * <p>
 * The Office enters the address; its domain is registered with Amazon SES (Easy DKIM) and the three DNS records shown
 * are added by the institution's IT. A domain already used by another institution, or UniRise's own, is refused, so no
 * institution can send as another.
 */
@Component
public class InstitutionSender {
	private static final Logger log = LoggerFactory.getLogger(InstitutionSender.class);
	private static final java.util.regex.Pattern ADDRESS = java.util.regex.Pattern.compile("^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}\\.)+[A-Za-z]{2,24}$");
	private final JdbcClient control;
	private final AppProperties.Mail mail;
	private final SesV2Client ses;

	public InstitutionSender(@Qualifier("controlJdbc") JdbcClient control, AppProperties props, Optional<SesV2Client> ses) {
		this.control = control;
		this.mail = props.mail();
		this.ses = ses.orElse(null);
	}

	/** A verified sender: who emails come from, how they are signed, and where replies go. */
	public record Sender(String address, String name, String institution) {
		public String from() { return mailbox(name, address); }
		public String signature() {
			return "Kind regards,\nOffice of Research\n" + oneLine(institution) + "\n\nTo contact the Office of Research, reply to this email.\n";
		}
	}

	/** Email can be sent on this server at all (SES configured and a site address for links). */
	public boolean available() { return ses != null && !mail.siteUrl().isEmpty(); }

	/** The institution's sender, only when its domain is verified. */
	public Optional<Sender> verified(long institutionId, String institutionName) {
		if (!available()) return Optional.empty();
		return control.sql("SELECT from_address, from_name FROM institution_mail WHERE institution_id = :i AND status = 'verified'").param("i", institutionId)
			.query((r, n) -> new Sender(r.getString(1), r.getString(2), institutionName)).optional();
	}

	/** For the Office's settings: address, name, status and the DNS records to add (empty map when none is set). */
	public Map<String, Object> describe(long institutionId) {
		return control.sql("SELECT from_address, from_name, domain, status, dns::text, checked_at FROM institution_mail WHERE institution_id = :i").param("i", institutionId)
			.query((r, n) -> Json.of("address", r.getString(1), "name", r.getString(2), "domain", r.getString(3), "status", r.getString(4),
				"dns", Json.list(r.getString(5)), "checkedAt", r.getTimestamp(6) == null ? null : r.getTimestamp(6).toInstant().toString(), "available", available()))
			.optional().orElse(Json.of("available", available()));
	}

	/** Sets (or changes) the address: registers its domain with SES if needed and stores the DNS records. */
	public Map<String, Object> setup(long institutionId, String address, String name, String institutionName) {
		if (!available()) throw RuleException.invalid("Email is not available on this server.");
		String a = address == null ? "" : address.trim().toLowerCase(Locale.ROOT);
		if (!ADDRESS.matcher(a).matches()) throw RuleException.invalid("Enter a valid email address, for example research@your-institution.edu.");
		String domain = a.substring(a.indexOf('@') + 1);
		String platform = platformDomain();
		if (!platform.isEmpty() && (domain.equals(platform) || domain.endsWith("." + platform) || platform.endsWith("." + domain)))
			throw RuleException.invalid("Use your institution's own address, not UniRise's.");
		if (control.sql("SELECT count(*) FROM institution_mail WHERE domain = :d AND institution_id <> :i").param("d", domain).param("i", institutionId).query(Long.class).single() > 0)
			throw RuleException.invalid("This domain is already used by another institution on UniRise. Use an address on your own domain.");
		String n = oneLine(name == null || name.isBlank() ? "Office of Research, " + institutionName : name);
		if (n.length() > 100) n = n.substring(0, 100);
		GetEmailIdentityResponse id;
		try {
			id = ses.getEmailIdentity((g) -> g.emailIdentity(domain));
		} catch (NotFoundException e) {
			ses.createEmailIdentity((c) -> {
				c.emailIdentity(domain);
				if (!mail.configurationSet().isEmpty()) c.configurationSetName(mail.configurationSet());
			});
			id = ses.getEmailIdentity((g) -> g.emailIdentity(domain));
			log.info("Registered sending domain {} for institution {}", domain, institutionId);
		}
		String old = control.sql("SELECT domain FROM institution_mail WHERE institution_id = :i").param("i", institutionId).query(String.class).optional().orElse(null);
		control.sql("""
			INSERT INTO institution_mail(institution_id, from_address, from_name, domain, status, dns, checked_at, updated_at)
			VALUES (:i, :a, :n, :d, :s, CAST(:dns AS jsonb), now(), now())
			ON CONFLICT (institution_id) DO UPDATE SET from_address = :a, from_name = :n, domain = :d, status = :s, dns = CAST(:dns AS jsonb), checked_at = now(), updated_at = now()""")
			.param("i", institutionId).param("a", a).param("n", n).param("d", domain).param("s", status(id)).param("dns", Json.write(records(domain, id))).update();
		if (old != null && !old.equals(domain)) release(old);
		return describe(institutionId);
	}

	/** Asks SES again whether the DNS records are in place. */
	public Map<String, Object> refresh(long institutionId) {
		var row = control.sql("SELECT domain FROM institution_mail WHERE institution_id = :i").param("i", institutionId).query(String.class).optional();
		if (row.isEmpty() || ses == null) return describe(institutionId);
		String domain = row.get();
		String s;
		String dns;
		try {
			var id = ses.getEmailIdentity((g) -> g.emailIdentity(domain));
			s = status(id);
			dns = Json.write(records(domain, id));
		} catch (NotFoundException e) {
			s = "failed";
			dns = "[]";
		}
		control.sql("UPDATE institution_mail SET status = :s, dns = CAST(:dns AS jsonb), checked_at = now() WHERE institution_id = :i")
			.param("s", s).param("dns", dns).param("i", institutionId).update();
		return describe(institutionId);
	}

	/** Stops sending for the institution; the SES domain is removed when no institution uses it any more. */
	public void remove(long institutionId) {
		var domain = control.sql("SELECT domain FROM institution_mail WHERE institution_id = :i").param("i", institutionId).query(String.class).optional();
		control.sql("DELETE FROM institution_mail WHERE institution_id = :i").param("i", institutionId).update();
		domain.ifPresent(this::release);
	}

	/** Sends one email from the institution's verified address. False (nothing sent) when there is none. */
	public boolean send(long institutionId, String institutionName, String to, String subject, String body) { return send(institutionId, institutionName, to, subject, body, true); }

	/** As above; sign = false for notices to the Office itself (no Office signature). */
	public boolean send(long institutionId, String institutionName, String to, String subject, String body, boolean sign) {
		var s = verified(institutionId, institutionName);
		if (s.isEmpty()) {
			log.info("Email to an account of institution {} not sent: no verified sending address", institutionId);
			return false;
		}
		ses.sendEmail((b) -> {
			b.fromEmailAddress(s.get().from()).replyToAddresses(s.get().address()).destination((d) -> d.toAddresses(to))
				.content((c) -> c.simple((m) -> m.subject((x) -> x.data(subject).charset("UTF-8")).body((bd) -> bd.text((t) -> t.data(sign ? body + s.get().signature() : body).charset("UTF-8")))));
			if (!mail.configurationSet().isEmpty()) b.configurationSetName(mail.configurationSet());
		});
		return true;
	}

	private void release(String domain) {
		if (ses == null) return;
		if (control.sql("SELECT count(*) FROM institution_mail WHERE domain = :d").param("d", domain).query(Long.class).single() > 0) return;
		try { ses.deleteEmailIdentity((d) -> d.emailIdentity(domain)); log.info("Released sending domain {}", domain); }
		catch (RuntimeException e) { log.warn("Could not remove sending domain {}: {}", domain, e.getMessage()); }
	}

	private static String status(GetEmailIdentityResponse id) {
		if (Boolean.TRUE.equals(id.verifiedForSendingStatus())) return "verified";
		var dkim = id.dkimAttributes() == null ? null : id.dkimAttributes().statusAsString();
		return "FAILED".equals(dkim) ? "failed" : "pending";
	}

	private static List<Map<String, Object>> records(String domain, GetEmailIdentityResponse id) {
		if (id.dkimAttributes() == null || id.dkimAttributes().tokens() == null) return List.of();
		return id.dkimAttributes().tokens().stream()
			.map((t) -> Json.of("type", "CNAME", "name", t + "._domainkey." + domain, "value", t + ".dkim.amazonses.com")).toList();
	}

	/** UniRise's own sending domain (from MAIL_FROM), which institutions may not use. */
	private String platformDomain() {
		var m = java.util.regex.Pattern.compile("@([^>\\s]+)").matcher(mail.from());
		return m.find() ? m.group(1).toLowerCase(Locale.ROOT) : "";
	}

	/** A From value with a display name: quoted when plain ASCII, MIME-encoded otherwise. */
	static String mailbox(String name, String address) {
		String n = oneLine(name);
		if (n.chars().allMatch((c) -> c >= 32 && c < 127)) return "\"" + n.replace("\\", "\\\\").replace("\"", "\\\"") + "\" <" + address + ">";
		return "=?UTF-8?B?" + java.util.Base64.getEncoder().encodeToString(n.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + "?= <" + address + ">";
	}

	static String oneLine(String s) { return s == null ? "" : s.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim(); }
}
