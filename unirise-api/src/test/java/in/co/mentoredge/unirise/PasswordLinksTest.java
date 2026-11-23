package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import in.co.mentoredge.unirise.TestApi.Institution;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;
import software.amazon.awssdk.services.sesv2.model.SendEmailResponse;
import software.amazon.awssdk.services.sesv2.model.SesV2Exception;

/**
 * Email to users, through a stand-in for SES: invitations and decisions come only from the institution's own verified
 * Office of Research address (never UniRise's); "Forgot password?" sends nothing and points to the Office.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.mail.from=UniRise <no-reply@dev.example>", "app.mail.configuration-set=test-set", "app.mail.site-url=https://site.example/",
	"spring.main.allow-bean-definition-overriding=true" })
class PasswordLinksTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final List<SendEmailRequest> SENT = new CopyOnWriteArrayList<>();
	static final AtomicBoolean DOWN = new AtomicBoolean(false);
	static final Pattern LINK = Pattern.compile("https://site\\.example/#/set-password\\?t=([A-Za-z0-9_-]{43})");
	static Institution abc;
	/** SES domain identities: domain → verified (DNS records in place). */
	static final java.util.Map<String, Boolean> IDENTITIES = new java.util.concurrent.ConcurrentHashMap<>();

	@TestConfiguration
	static class FakeSes {
		@Bean
		SesV2Client sesV2Client() {
			return new SesV2Client() {
				@Override public String serviceName() { return "ses"; }
				@Override public void close() {}
				@Override public SendEmailResponse sendEmail(SendEmailRequest r) {
					if (DOWN.get()) throw SesV2Exception.builder().message("Throttling").build();
					SENT.add(r);
					return SendEmailResponse.builder().messageId("m-" + SENT.size()).build();
				}
				@Override public software.amazon.awssdk.services.sesv2.model.GetEmailIdentityResponse getEmailIdentity(software.amazon.awssdk.services.sesv2.model.GetEmailIdentityRequest r) {
					Boolean ok = IDENTITIES.get(r.emailIdentity());
					if (ok == null) throw software.amazon.awssdk.services.sesv2.model.NotFoundException.builder().message("not found").build();
					return software.amazon.awssdk.services.sesv2.model.GetEmailIdentityResponse.builder().verifiedForSendingStatus(ok)
						.dkimAttributes((d) -> d.tokens("tok1", "tok2", "tok3").status(ok ? "SUCCESS" : "PENDING")).build();
				}
				@Override public software.amazon.awssdk.services.sesv2.model.CreateEmailIdentityResponse createEmailIdentity(software.amazon.awssdk.services.sesv2.model.CreateEmailIdentityRequest r) {
					IDENTITIES.put(r.emailIdentity(), false);
					return software.amazon.awssdk.services.sesv2.model.CreateEmailIdentityResponse.builder().build();
				}
				@Override public software.amazon.awssdk.services.sesv2.model.DeleteEmailIdentityResponse deleteEmailIdentity(software.amazon.awssdk.services.sesv2.model.DeleteEmailIdentityRequest r) {
					IDENTITIES.remove(r.emailIdentity());
					return software.amazon.awssdk.services.sesv2.model.DeleteEmailIdentityResponse.builder().build();
				}
			};
		}
	}

	@DynamicPropertySource
	static void props(DynamicPropertyRegistry r) {
		PG.start();
		r.add("app.control.url", PG::getJdbcUrl);
		r.add("app.control.user", PG::getUsername);
		r.add("app.control.password", PG::getPassword);
		r.add("app.tenants.host", PG::getHost);
		r.add("app.tenants.port", () -> PG.getMappedPort(5432));
	}

	@Value("${local.server.port}") int port;
	@Autowired @Qualifier("controlJdbc") JdbcClient control;
	TestApi api;
	Caller office;

	synchronized void setup() throws Exception {
		api = new TestApi(port);
		if (abc == null) {
			abc = api.provision("abc", "office@abc.example");
			Caller o = api.signIn(abc.officeEmail(), abc.officePassword());
			api.create("/api/org-units", o, "{\"type\":\"department\",\"name\":\"Physics\"}");
			// ABC's Office sets its own address; its IT adds the DNS records; the Office checks again: verified.
			assertTrue(api.call("PUT", "/api/office/mail-sender", o, "{\"address\":\"research@abc.example\"}").body().contains("\"status\":\"pending\""));
			IDENTITIES.put("abc.example", true);
			assertTrue(api.call("POST", "/api/office/mail-sender/check", o, null).body().contains("\"status\":\"verified\""));
		}
		office = api.signIn(abc.officeEmail(), abc.officePassword());
	}

	String newUser(String email, boolean invite) throws Exception {
		var r = api.call("POST", "/api/office/users", office, "{\"role\":\"management\",\"name\":\"Meera Nair\",\"email\":\"" + email + "\",\"designation\":\"Dean\",\"invite\":" + invite + "}");
		assertEquals(200, r.statusCode(), r.body());
		return r.body();
	}

	/** The newest email to this address (waits briefly: "Forgot password?" sends after answering). */
	SendEmailRequest mailTo(String email, int before) throws Exception {
		for (int i = 0; i < 50; i++) {
			var m = SENT.stream().skip(before).filter(r -> r.destination().toAddresses().contains(email)).reduce((a, b) -> b);
			if (m.isPresent()) return m.get();
			Thread.sleep(100);
		}
		return fail("no email to " + email);
	}

	static String token(SendEmailRequest m) {
		var x = LINK.matcher(m.content().simple().body().text().data());
		assertTrue(x.find(), m.content().simple().body().text().data());
		return x.group(1);
	}

	String check(String token) throws Exception { return api.call("POST", "/api/password/check", Caller.NOBODY, "{\"token\":\"" + token + "\"}").body(); }

	int set(String token, String password) throws Exception {
		return api.call("POST", "/api/password/set", Caller.NOBODY, "{\"token\":\"" + token + "\",\"password\":\"" + password + "\"}").statusCode();
	}

	@Test
	void anInvitationLetsThePersonSetTheirOwnPasswordOnce() throws Exception {
		setup();
		int before = SENT.size();
		String body = newUser("meera@abc.example", true);
		assertTrue(body.contains("\"invited\":true") && !body.contains("temporaryPassword"), "nobody sees a password: " + body);
		var m = mailTo("meera@abc.example", before);
		assertEquals("Your UniRise account", m.content().simple().subject().data());
		assertEquals("test-set", m.configurationSetName());
		// From the Office of Research's own address, never UniRise's; replies go to the Office.
		assertEquals("\"Office of Research, ABC University\" <research@abc.example>", m.fromEmailAddress());
		assertEquals(List.of("research@abc.example"), m.replyToAddresses());
		String mailBody = m.content().simple().body().text().data();
		assertTrue(mailBody.contains("ABC University") && mailBody.contains("7 days") && mailBody.contains("Email: meera@abc.example") && mailBody.contains("choose your own password"), mailBody);
		assertTrue(mailBody.contains("Kind regards,\nOffice of Research\nABC University") && !mailBody.contains("UniRise Team") && !mailBody.contains("MentorEdge"), mailBody);
		// The temporary password in the welcome email works, and the person must change it first.
		var tm = java.util.regex.Pattern.compile("Temporary password: (\\S+)").matcher(mailBody);
		assertTrue(tm.find(), mailBody);
		var first = api.login("meera@abc.example", tm.group(1));
		assertEquals(200, first.statusCode(), first.body());
		assertTrue(first.body().contains("\"mustChangePassword\":true"), first.body());
		Caller meera = new Caller(null, TestApi.sessionCookie(first));
		assertEquals(200, api.call("POST", "/api/account/password", meera, "{\"current\":\"" + tm.group(1) + "\",\"next\":\"Changed123\"}").statusCode());
		assertTrue(api.call("GET", "/api/session", meera, null).body().contains("\"mustChangePassword\":false"));
		String t = token(m);
		String info = check(t);
		assertTrue(info.contains("\"purpose\":\"invite\"") && info.contains("meera@abc.example") && info.contains("Meera Nair"), info);
		String hash = control.sql("SELECT token_hash FROM password_link ORDER BY created_at DESC LIMIT 1").query(String.class).single();
		assertNotEquals(t, hash, "only a hash of the link is stored");

		assertEquals(400, set(t, "short"));                                    // the usual password rules
		assertEquals(200, set(t, "MyOwnPass1"));
		assertEquals(200, api.login("meera@abc.example", "MyOwnPass1").statusCode());
		assertEquals(404, set(t, "Another1pass"), "a link works once");
		assertTrue(check(t).contains("expired or has already been used"));
		assertEquals(404, api.call("POST", "/api/password/check", Caller.NOBODY, "{\"token\":\"nonsense\"}").statusCode());
		String log = api.call("GET", "/api/office/audit", office, null).body();
		assertTrue(log.contains("Welcome email sent") && log.contains("Password set from an emailed link") && log.contains("Email sender set"), log);
	}

	@Test
	void forgotPasswordSendsNothingAndPointsToTheOffice() throws Exception {
		setup();
		String temp = field(newUser("ravi@abc.example", false), "temporaryPassword");
		int before = SENT.size();
		var unknown = api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"nobody@abc.example\"}");
		var known = api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"Ravi@ABC.example\"}");
		assertEquals(200, known.statusCode());
		assertEquals(unknown.body(), known.body(), "the same answer whether or not the account exists");
		assertTrue(known.body().contains("Office of Research can reset your password"), known.body());
		Thread.sleep(500);
		assertEquals(before, SENT.size(), "no email at all");
		assertEquals(200, api.login("ravi@abc.example", temp).statusCode(), "the password is unchanged");
		// Still limited (three per email in 15 minutes), and browsers must send the request header.
		assertEquals(200, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}").statusCode());
		assertEquals(429, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}").statusCode());
		assertEquals(403, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"x@abc.example\"}", false).statusCode());
	}

	@Test
	void withoutAVerifiedAddressOfItsOwnAnInstitutionSendsNoEmail() throws Exception {
		setup();
		var xyz = api.provision("xyz", "office@xyz.example");
		Caller o = api.signIn(xyz.officeEmail(), xyz.officePassword());
		api.create("/api/org-units", o, "{\"type\":\"department\",\"name\":\"Physics\"}");
		// Not someone else's domain, and not UniRise's.
		var taken = api.call("PUT", "/api/office/mail-sender", o, "{\"address\":\"dean@abc.example\"}");
		assertEquals(400, taken.statusCode()); assertTrue(taken.body().contains("another institution"), taken.body());
		var ours = api.call("PUT", "/api/office/mail-sender", o, "{\"address\":\"office@dev.example\"}");
		assertEquals(400, ours.statusCode()); assertTrue(ours.body().contains("not UniRise"), ours.body());
		assertEquals(400, api.call("PUT", "/api/office/mail-sender", o, "{\"address\":\"not an address\"}").statusCode());
		// No address: the account is created, nothing is sent, and the Office is told why and sees a temporary password.
		int before = SENT.size();
		var r = api.call("POST", "/api/office/users", o, "{\"role\":\"management\",\"name\":\"Zoya Khan\",\"email\":\"zoya@xyz.example\",\"designation\":\"Dean\",\"invite\":true}");
		assertTrue(r.body().contains("\"invited\":false") && r.body().contains("not verified") && r.body().contains("temporaryPassword"), r.body());
		// Decisions without an address: no email either.
		Caller f = api.faculty(o, "Ravi Iyer", "ravi.iyer@xyz.example", "XYZ001", "Physics");
		String rec = "{\"record\":{\"entryType\":\"Book\",\"title\":\"Quiet book\",\"venue\":\"P\",\"year\":2024,\"authors\":[{\"kind\":\"Faculty\",\"code\":\"XYZ001\",\"name\":\"Ravi Iyer\"}]},\"submit\":true}";
		String id = TestApi.field(api.call("POST", "/api/records/publications", f, rec).body(), "result");
		assertEquals(200, api.call("POST", "/api/office/approvals/publications/" + id + "/review", o, "{\"decision\":\"Approved\"}").statusCode());
		Thread.sleep(600);
		assertEquals(before, SENT.size(), "no email for an institution without a verified address");
		// Set up, but the DNS records are not in yet: shown to the Office, still nothing sent.
		String set = api.call("PUT", "/api/office/mail-sender", o, "{\"address\":\"Research@XYZ.example\",\"name\":\"Research Office, XYZ\"}").body();
		assertTrue(set.contains("\"status\":\"pending\"") && set.contains("tok1._domainkey.xyz.example") && set.contains("tok1.dkim.amazonses.com") && set.contains("research@xyz.example"), set);
		String uid = TestApi.field(api.call("POST", "/api/office/users", o, "{\"role\":\"management\",\"name\":\"Amit Rao\",\"email\":\"amit@xyz.example\",\"designation\":\"Dean\",\"invite\":false}").body(), "id");
		var pending = api.call("POST", "/api/office/users/" + uid + "/invite", o, "{}");
		assertEquals(409, pending.statusCode()); assertTrue(pending.body().contains("not verified"), pending.body());
		// Verified: emails go out from XYZ's address, with the name the Office chose.
		IDENTITIES.put("xyz.example", true);
		assertTrue(api.call("POST", "/api/office/mail-sender/check", o, null).body().contains("\"status\":\"verified\""));
		assertEquals(200, api.call("POST", "/api/office/users/" + uid + "/invite", o, "{}").statusCode());
		var m = mailTo("amit@xyz.example", before);
		assertEquals("\"Research Office, XYZ\" <research@xyz.example>", m.fromEmailAddress());
		// Only the Office manages it; removing it stops email and releases the domain.
		Caller faculty = f;
		assertEquals(403, api.call("PUT", "/api/office/mail-sender", faculty, "{\"address\":\"me@xyz.example\"}").statusCode());
		assertEquals(200, api.call("DELETE", "/api/office/mail-sender", o, null).statusCode());
		assertFalse(IDENTITIES.containsKey("xyz.example"), "domain released");
		assertTrue(IDENTITIES.containsKey("abc.example"), "another institution's domain is untouched");
	}

	@Test
	void onlyAccountsThatCouldSignInGetLinksAndLinksExpire() throws Exception {
		setup();
		String id = field(newUser("sunil@abc.example", false), "id");
		var r = api.call("POST", "/api/office/users/" + id + "/invite", office, "{}");
		assertEquals(200, r.statusCode(), r.body());
		String t = token(mailTo("sunil@abc.example", 0));

		// Suspending the account: its link stops working, and no new one is sent.
		assertEquals(200, api.call("POST", "/api/office/users/" + id + "/status", office, "{\"status\":\"suspended\",\"reason\":\"on leave\"}").statusCode());
		assertEquals(404, api.call("POST", "/api/password/check", Caller.NOBODY, "{\"token\":\"" + t + "\"}").statusCode());
		var refused = api.call("POST", "/api/office/users/" + id + "/invite", office, "{}");
		assertEquals(409, refused.statusCode());
		assertTrue(refused.body().contains("not active"), refused.body());
		int before = SENT.size();

		// Reactivated: a fresh link works until it expires.
		assertEquals(200, api.call("POST", "/api/office/users/" + id + "/status", office, "{\"status\":\"active\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/office/users/" + id + "/invite", office, "{}").statusCode());
		String fresh = token(mailTo("sunil@abc.example", before));
		control.sql("UPDATE password_link SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL").update();
		assertEquals(404, set(fresh, "Expired123"));
	}

	@Test
	void whenTheEmailFailsTheOfficeGetsATemporaryPasswordInstead() throws Exception {
		setup();
		DOWN.set(true);
		try {
			String body = newUser("asha@abc.example", true);
			assertTrue(body.contains("\"invited\":false") && body.contains("could not be sent"), body);
			assertEquals(200, api.login("asha@abc.example", field(body, "temporaryPassword")).statusCode());
			long accountId = control.sql("SELECT app_user_id FROM account_login WHERE email = 'asha@abc.example'").query(Long.class).single();
			assertEquals(0, control.sql("SELECT count(*) FROM password_link WHERE app_user_id = :u AND used_at IS NULL").param("u", accountId).query(Long.class).single(), "no link left behind");
		} finally {
			DOWN.set(false);
		}
	}

	@Test
	void decisionEmailsGoToTheFacultyMemberButNeverToSampleAccounts() throws Exception {
		setup();
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Chemistry\"}");
		Caller nita = api.faculty(office, "Nita Shah", "nita@abc.example", "ABC101", "Chemistry");
		String rec = "{\"record\":{\"entryType\":\"Book\",\"title\":\"Mailed book\",\"venue\":\"P\",\"year\":2024,\"authors\":[{\"kind\":\"Faculty\",\"code\":\"ABC101\",\"name\":\"Nita Shah\"}]},\"submit\":true}";
		String id = TestApi.field(api.call("POST", "/api/records/publications", nita, rec).body(), "result");
		// The Office of Research is emailed about the submission.
		var sub = mailTo("office@abc.example", 0);
		assertTrue(SENT.stream().anyMatch((r) -> r.destination().toAddresses().contains("office@abc.example") && r.content().simple().subject().data().equals("New submission: publication " + id + " from Nita Shah")),
			sub.content().simple().subject().data());
		int before = SENT.size();
		assertEquals(200, api.call("POST", "/api/office/approvals/publications/" + id + "/review", office, "{\"decision\":\"Approved\"}").statusCode());
		var m = mailTo("nita@abc.example", before);
		assertEquals("Approved: publication " + id, m.content().simple().subject().data());
		assertTrue(m.content().simple().body().text().data().contains("We have approved your Publication " + id + " “Mailed book”"), m.content().simple().body().text().data());
		assertEquals("\"Office of Research, ABC University\" <research@abc.example>", m.fromEmailAddress());
		assertTrue(SENT.stream().noneMatch((x) -> x.fromEmailAddress().contains("dev.example")), "nothing is ever sent from UniRise's address");
		// Profile updates are emailed the same way (here: changes requested, with what to change).
		var pc = api.call("POST", "/api/profile-changes", nita, "{\"biodata\":{\"summary\":\"New summary\"},\"contact\":{\"email\":\"nita@abc.example\"},\"submit\":true}");
		assertEquals(200, pc.statusCode(), pc.body());
		String pcId = TestApi.field(pc.body(), "result");
		int p0 = SENT.size();
		assertEquals(200, api.call("POST", "/api/office/approvals/profiles/" + pcId + "/review", office, "{\"decision\":\"Rework\",\"remark\":\"Add your keywords\"}").statusCode());
		var pm = mailTo("nita@abc.example", p0);
		Thread.sleep(300);
		assertTrue(SENT.stream().anyMatch((r) -> r.destination().toAddresses().contains("office@abc.example") && r.content().simple().subject().data().startsWith("New submission: profile update " + pcId)), "the Office is emailed about profile updates too");
		assertEquals("Changes requested: profile update " + pcId, pm.content().simple().subject().data());
		assertTrue(pm.content().simple().body().text().data().contains("Add your keywords"));
		// The same for an account loaded from the sample data: no email.
		Caller demo = api.faculty(office, "Sample Person", "sample@abc.example", "ABC102", "Chemistry");
		try (var c = java.sql.DriverManager.getConnection(PG.getJdbcUrl().replaceAll("/[^/?]+(\\?|$)", "/tenant_abc$1"), PG.getUsername(), PG.getPassword())) {
			c.createStatement().executeUpdate("UPDATE app_user SET created_by = 'UniRise demo data' WHERE email = 'sample@abc.example'");
		}
		String id2 = TestApi.field(api.call("POST", "/api/records/publications", demo, rec.replace("ABC101", "ABC102").replace("Nita Shah", "Sample Person").replace("Mailed", "Sample")).body(), "result");
		int mid = SENT.size();
		assertEquals(200, api.call("POST", "/api/office/approvals/publications/" + id2 + "/review", office, "{\"decision\":\"Rejected\",\"remark\":\"QA\"}").statusCode());
		Thread.sleep(800);
		assertTrue(SENT.stream().skip(mid).noneMatch((r) -> r.destination().toAddresses().contains("sample@abc.example")), "sample accounts are never emailed");
	}
}
