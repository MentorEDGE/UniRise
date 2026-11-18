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

/** Email to users: invitations from the Office of Research and "Forgot password?" links, through a stand-in for SES. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.mail.from=UniRise <no-reply@dev.example>", "app.mail.configuration-set=test-set", "app.mail.site-url=https://site.example/",
	"spring.main.allow-bean-definition-overriding=true" })
class PasswordLinksTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final List<SendEmailRequest> SENT = new CopyOnWriteArrayList<>();
	static final AtomicBoolean DOWN = new AtomicBoolean(false);
	static final Pattern LINK = Pattern.compile("https://site\\.example/#/set-password\\?t=([A-Za-z0-9_-]{43})");
	static Institution abc;

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
		assertEquals("Set your UniRise password", m.content().simple().subject().data());
		assertEquals("test-set", m.configurationSetName());
		assertTrue(m.content().simple().body().text().data().contains("ABC University") && m.content().simple().body().text().data().contains("7 days"));
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
		assertTrue(log.contains("Password link emailed") && log.contains("Password set from an emailed link"), log);
	}

	@Test
	void forgotPasswordEmailsAResetLinkAndRevealsNothing() throws Exception {
		setup();
		String temp = field(newUser("ravi@abc.example", false), "temporaryPassword"); // no invitation: a temporary password as before
		Caller laptop = api.signIn("ravi@abc.example", temp);
		int before = SENT.size();

		var unknown = api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"nobody@abc.example\"}");
		var known = api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"Ravi@ABC.example\"}");
		assertEquals(200, unknown.statusCode());
		assertEquals(unknown.body(), known.body(), "the same answer whether or not the account exists");
		var first = mailTo("ravi@abc.example", before);
		assertEquals("Reset your UniRise password", first.content().simple().subject().data());
		assertTrue(first.content().simple().body().text().data().contains("1 hour"));
		Thread.sleep(300);
		assertTrue(SENT.stream().skip(before).noneMatch(r -> r.destination().toAddresses().contains("nobody@abc.example")));

		// A second request replaces the first link; the old password works until a link is used.
		int mid = SENT.size();
		api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}");
		var second = mailTo("ravi@abc.example", mid);
		assertEquals(404, set(token(first), "NewPass123"));
		assertEquals(200, api.login("ravi@abc.example", temp).statusCode());
		assertTrue(check(token(second)).contains("\"purpose\":\"reset\""));
		assertEquals(200, set(token(second), "NewPass123"));
		assertEquals(401, api.call("GET", "/api/session", laptop, null).statusCode(), "a reset signs the account out everywhere");
		assertEquals(401, api.login("ravi@abc.example", temp).statusCode());
		assertEquals(200, api.login("ravi@abc.example", "NewPass123").statusCode());

		// A fourth request for the same email within 15 minutes is refused; browsers must send the request header.
		assertEquals(200, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}").statusCode()); // the third
		assertEquals(429, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"ravi@abc.example\"}").statusCode());
		assertEquals(403, api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"x@abc.example\"}", false).statusCode());
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
		api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"sunil@abc.example\"}");
		Thread.sleep(500);
		assertEquals(before, SENT.size(), "no reset email for a suspended account");

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
}
