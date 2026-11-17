package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sesv2.SesV2Client;

/**
 * Emails "Talk to our team" enquiries to the UniRise team (BACKEND_PLAN A1a, G24) through Amazon SES. The enquiry is
 * stored first; this sends it, with Reply-To set to the person who enquired, and records the result on the enquiry.
 * Enquiries that could not be sent are retried every 30 minutes for a week. With no sender or recipient configured
 * (local runs) nothing is sent and enquiries are only stored.
 */
@Component
public class EnquiryMail {
	private static final Logger log = LoggerFactory.getLogger(EnquiryMail.class);
	private static final List<String[]> FIELDS = List.of(
		new String[] { "institutionName", "Organisation" }, new String[] { "institutionType", "Type" }, new String[] { "contactName", "Contact" },
		new String[] { "designation", "Designation" }, new String[] { "email", "Email" }, new String[] { "phone", "Phone" },
		new String[] { "city", "City" }, new String[] { "state", "State" }, new String[] { "country", "Country" },
		new String[] { "facultyCount", "Faculty members (approx.)" }, new String[] { "interest", "Area of interest" }, new String[] { "message", "Message" });

	private final JdbcClient control;
	private final AppProperties.Mail mail;
	private final SesV2Client ses;

	public EnquiryMail(@Qualifier("controlJdbc") JdbcClient control, AppProperties props, Optional<SesV2Client> ses) {
		this.control = control;
		this.mail = props.mail();
		this.ses = ses.orElse(null);
	}

	public boolean on() { return ses != null && !mail.from().isEmpty() && !mail.enquiriesTo().isEmpty(); }

	/** Sends one stored enquiry and records the outcome. Never throws: the enquiry is safe in the database either way. */
	public void send(long id) {
		if (!on()) return;
		Map<String, Object> e = Json.obj(Json.MAPPER.readValue(control.sql("SELECT data::text FROM enquiry WHERE id = :i").param("i", id).query(String.class).single(), Map.class));
		try {
			String org = clean(Json.str(e.get("institutionName"), 200));
			StringBuilder text = new StringBuilder("A new enquiry from the UniRise website (\"Talk to our team\").\n\n");
			for (String[] f : FIELDS) {
				String v = Json.str(e.get(f[0]), 3000).trim();
				if (!v.isEmpty()) text.append(f[1]).append(": ").append(f[0].equals("message") ? "\n" + v : clean(v)).append('\n');
			}
			text.append("\nReply to this email to answer ").append(clean(Json.str(e.get("contactName"), 200))).append(" directly.\nEnquiry #").append(id).append('\n');
			String replyTo = Json.str(e.get("email"), 200);
			var res = ses.sendEmail((b) -> {
				b.fromEmailAddress(mail.from()).destination((d) -> d.toAddresses(mail.enquiriesTo()))
					.content((c) -> c.simple((m) -> m.subject((s) -> s.data("UniRise enquiry: " + org).charset("UTF-8")).body((bd) -> bd.text((t) -> t.data(text.toString()).charset("UTF-8")))));
				if (replyTo.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) b.replyToAddresses(replyTo);
				if (!mail.configurationSet().isEmpty()) b.configurationSetName(mail.configurationSet());
			});
			control.sql("UPDATE enquiry SET delivered = true, delivery_note = :n WHERE id = :i").param("n", "sent to the UniRise team, SES message " + res.messageId()).param("i", id).update();
			log.info("Enquiry {} emailed to the UniRise team", id);
		} catch (RuntimeException ex) {
			control.sql("UPDATE enquiry SET delivery_note = :n WHERE id = :i").param("n", "not sent yet: " + Json.str(ex.getMessage(), 300)).param("i", id).update();
			log.warn("Enquiry {} could not be emailed yet: {}", id, ex.getMessage());
		}
	}

	/** Retries enquiries of the last week that were not sent (for example while the team's address awaited verification). */
	@Scheduled(initialDelay = 60_000, fixedDelay = 30 * 60_000)
	public void retry() {
		if (!on()) return;
		for (Long id : control.sql("SELECT id FROM enquiry WHERE NOT delivered AND at > now() - interval '7 days' ORDER BY id").query(Long.class).list()) send(id);
	}

	/** One line, no control characters (subject and field values). */
	private static String clean(String s) { return s.replaceAll("[\\p{Cntrl}]", " ").trim(); }
}
