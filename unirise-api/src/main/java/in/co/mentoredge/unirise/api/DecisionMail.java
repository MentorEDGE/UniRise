package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import jakarta.annotation.PreDestroy;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sesv2.SesV2Client;

/**
 * Emails a faculty member when the Office of Research decides on one of their entries or profile updates: approved,
 * changes requested or rejected; and emails the Office of Research when something is submitted (2026-11-21). Sent after the decision is saved, in the background; a failure is logged and
 * never undoes the decision. Sent only from the institution's own verified Office of Research address
 * ({@link InstitutionSender}, 2026-11-23), never from UniRise. Accounts loaded from the sample data ('UniRise demo data') are never emailed: their
 * addresses are made up, but their domains may be real.
 */
@Component
public class DecisionMail {
	private static final Logger log = LoggerFactory.getLogger(DecisionMail.class);
	static final String DEMO = "UniRise demo data";
	private final JdbcClient db;
	private final TenantDirectory directory;
	private final AppProperties.Mail mail;
	private final SesV2Client ses;
	private final ExecutorService background = Executors.newVirtualThreadPerTaskExecutor();
	@org.springframework.beans.factory.annotation.Autowired private InstitutionSender sender;

	public DecisionMail(@Qualifier("tenantJdbc") JdbcClient db, TenantDirectory directory, AppProperties props, Optional<SesV2Client> ses) {
		this.db = db;
		this.directory = directory;
		this.mail = props.mail();
		this.ses = ses.orElse(null);
	}

	@PreDestroy
	void stop() { background.shutdown(); }

	boolean on() { return ses != null && !mail.siteUrl().isEmpty(); }

	/** decision: Approved, Rework or Rejected. Called inside the tenant's request. */
	public void decided(String facultyCode, String kind, String id, String recordName, String decision, String remark) {
		if (!on()) return;
		record To(String email, String name) {}
		var to = db.sql("""
			SELECT u.email, u.name FROM app_user u JOIN researcher r ON r.id = u.researcher_id
			WHERE r.employee_id = :c AND u.role = 'faculty' AND u.status = 'active' AND coalesce(u.created_by, '') <> :demo ORDER BY u.id LIMIT 1""")
			.param("c", facultyCode).param("demo", DEMO).query((r, n) -> new To(r.getString("email"), r.getString("name"))).optional();
		if (to.isEmpty()) return;
		String institution = directory.bySlug(TenantContext.require()).map(t -> directory.name(t.id())).orElse("your institution");
		String label = Notifier.LABEL.getOrDefault(kind, "Entry");
		String what = label + " " + id + (recordName.isEmpty() ? "" : " " + recordName);
		String site = mail.siteUrl().replaceAll("/+$", "");
		String subject, text;
		switch (decision) {
			case "Approved" -> {
				subject = "Approved: " + label.toLowerCase() + " " + id;
				text = "Dear " + clean(to.get().name()) + ",\n\nWe have approved your " + clean(what) + ".\n\n"
					+ (remark.isEmpty() ? "" : "Our comment:\n" + remark + "\n\n")
					+ "You can see it under My Submissions: " + site + "/#/submissions\n\n";
			}
			case "Rework" -> {
				subject = "Changes requested: " + label.toLowerCase() + " " + id;
				text = "Dear " + clean(to.get().name()) + ",\n\nWe need some changes to your " + clean(what) + " before we can approve it.\n\n"
					+ "What to change:\n" + remark + "\n\n"
					+ "Please correct the entry and resubmit it from My Submissions: " + site + "/#/submissions\n\n";
			}
			default -> {
				subject = "Not approved: " + label.toLowerCase() + " " + id;
				text = "Dear " + clean(to.get().name()) + ",\n\nWe were not able to approve your " + clean(what) + ".\n\n"
					+ "Reason:\n" + remark + "\n\n"
					+ "If you have questions, reply to this email. Details: " + site + "/#/submissions\n\n";
			}
		}
		String email = to.get().email();
		long institutionId = directory.bySlug(TenantContext.require()).orElseThrow().id();
		background.submit(() -> {
			try {
				// From the institution's own Office of Research address only; none verified means no email (2026-11-23).
				if (sender.send(institutionId, institution, email, subject, text)) log.info("Decision email sent for {} ({})", id, decision);
			} catch (RuntimeException e) {
				log.warn("Decision email for {} could not be sent: {}", id, e.getMessage());
			}
		});
	}

	/**
	 * Tells the institution's Office of Research accounts that a faculty member submitted (or resubmitted) an entry or a
	 * profile update (2026-11-21). kind is an entry kind or "profiles"; recordName may be empty.
	 */
	public void submitted(String kind, String id, String recordName, String facultyName, boolean again, String note) {
		if (!on()) return;
		var to = db.sql("SELECT email FROM app_user WHERE role = 'office' AND status = 'active' AND coalesce(created_by, '') <> :demo").param("demo", DEMO).query(String.class).list();
		if (to.isEmpty()) return;
		String institution = directory.bySlug(TenantContext.require()).map(t -> directory.name(t.id())).orElse("your institution");
		String label = Notifier.LABEL.getOrDefault(kind, "Entry");
		String site = mail.siteUrl().replaceAll("/+$", "");
		String subject = (again ? "Resubmitted: " : "New submission: ") + label.toLowerCase() + " " + id + " from " + clean(facultyName);
		String body = "Dear Office of Research,\n\n" + clean(facultyName) + " has " + (again ? "resubmitted" : "submitted") + " a " + label.toLowerCase() + " for review at " + clean(institution) + ":\n\n"
			+ "  " + label + " " + id + (recordName.isEmpty() ? "" : " " + clean(recordName)) + "\n"
			+ (note.isEmpty() ? "" : "\nTheir note to you:\n" + note + "\n")
			+ "\nReview it under Approvals: " + site + "/#/approvals?view=awaiting&kind=" + kind + "\n";
		long institutionId = directory.bySlug(TenantContext.require()).orElseThrow().id();
		for (String email : to) background.submit(() -> {
			try {
				if (sender.send(institutionId, institution, email, subject, body, false)) log.info("Submission email sent to the Office for {}", id);
			} catch (RuntimeException e) {
				log.warn("Submission email for {} could not be sent: {}", id, e.getMessage());
			}
		});
	}

	private static String clean(String s) { return s == null ? "" : s.replaceAll("[\\p{Cntrl}]", " ").trim(); }
}
