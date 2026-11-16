package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import in.co.mentoredge.unirise.TestApi.Institution;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Phase 2 (BACKEND_PLAN G1, G2, G19, G23): email and password sign-in, browser sessions, request forgery protection,
 * lockout, user management by the Office of Research and its audit log. The cases follow rdms-web/server/api.test.ts.
 * Needs Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false" })
class SignInAndUserManagementTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static Institution abc, xyz;

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

	synchronized void setup() throws Exception {
		api = new TestApi(port);
		if (abc != null) return;
		abc = api.provision("abc", "office@abc.example");
		xyz = api.provision("xyz", "office@xyz.example");
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller xoffice = api.signIn(xyz.officeEmail(), xyz.officePassword());
		api.create("/api/org-units", xoffice, "{\"type\":\"department\",\"name\":\"Physics\"}");
	}

	/** The health page tests the control-plane database (A8): it said UP for 11 days while the dev database was unusable. */
	@Test
	void healthChecksTheDatabaseAndSaysDownWhenItCannotBeReached() throws Exception {
		api = new TestApi(port);
		for (String p : new String[] { "/actuator/health", "/actuator/health/readiness", "/actuator/health/liveness" }) {
			var r = api.call("GET", p, Caller.NOBODY, null);
			assertEquals(200, r.statusCode(), p);
			assertTrue(r.body().contains("\"status\":\"UP\""), p + " " + r.body());
			assertFalse(r.body().contains("jdbc") || r.body().contains(PG.getUsername()), "no connection details on a public page: " + r.body());
		}
		var unreachable = new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:postgresql://127.0.0.1:1/none?connectTimeout=2", "x", "x");
		var down = new in.co.mentoredge.unirise.tenancy.ControlDatabaseHealth(JdbcClient.create(unreachable)).health();
		assertEquals("DOWN", down.getStatus().getCode());
		assertTrue(down.getDetails().isEmpty(), "no error details: " + down.getDetails());
		assertEquals("UP", new in.co.mentoredge.unirise.tenancy.ControlDatabaseHealth(control).health().getStatus().getCode());
	}

	@Test
	void provisioningCreatesTheFirstOfficeAccountAndSignInFindsTheInstitution() throws Exception {
		setup();
		var r = api.login("OFFICE@abc.example", abc.officePassword());                      // email is not case sensitive
		assertEquals(200, r.statusCode(), r.body());
		assertTrue(r.body().contains("\"role\":\"office\"") && r.body().contains("\"slug\":\"abc\""), r.body());
		String cookie = r.headers().allValues("Set-Cookie").stream().filter(h -> h.startsWith("unirise_sid=")).findFirst().orElseThrow();
		assertTrue(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict") && cookie.contains("Path=/"), cookie);
		Caller office = new Caller(null, TestApi.sessionCookie(r));
		assertTrue(api.call("GET", "/api/session", office, null).body().contains("office@abc.example"));
		assertEquals(401, api.call("GET", "/api/session", Caller.NOBODY, null).statusCode());
		assertEquals(401, api.login("office@abc.example", "wrong-password1").statusCode());
		assertEquals(401, api.login("nobody@abc.example", "whatever1").statusCode());
		// only the Office of Research may use the Office sign-in
		assertEquals(200, api.call("POST", "/api/admin/login", Caller.NOBODY, "{\"email\":\"office@abc.example\",\"password\":\"" + abc.officePassword() + "\"}").statusCode());
		String[] dean = api.createUser(office, "management", "Dean", "dean.admin@abc.example", null, null);
		assertEquals(401, api.call("POST", "/api/admin/login", Caller.NOBODY, "{\"email\":\"dean.admin@abc.example\",\"password\":\"" + dean[1] + "\"}").statusCode());
	}

	@Test
	void browserChangesNeedTheRequestHeaderAndSessionsEndOnSignOut() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		assertEquals(403, api.call("POST", "/api/office/users", office, "{}", false).statusCode());                          // no X-RDMS: a cross-site form
		assertEquals(403, api.call("POST", "/api/login", Caller.NOBODY, "{\"email\":\"a@b.c\",\"password\":\"x\"}", false).statusCode());
		assertEquals(200, api.call("GET", "/api/office/users", office, null).statusCode());                                   // reads do not need it
		assertEquals(200, api.call("POST", "/api/logout", office, null).statusCode());
		assertEquals(401, api.call("GET", "/api/office/users", office, null).statusCode());                                   // the session is gone
		assertEquals(401, api.call("GET", "/api/office/users", new Caller(null, "unirise_sid=forged"), null).statusCode());
	}

	@Test
	void idleSessionsExpireFasterForTheOffice() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		String[] u = api.createUser(office, "management", "Registrar", "registrar@abc.example", null, null);
		Caller registrar = api.signIn("registrar@abc.example", u[1]);
		// 45 minutes idle: past the Office's 30 minutes, inside everyone else's 8 hours
		control.sql("UPDATE user_token SET last_seen_at = now() - interval '45 minutes' WHERE kind = 'session'").update();
		assertEquals(401, api.call("GET", "/api/session", office, null).statusCode());
		assertEquals(200, api.call("GET", "/api/session", registrar, null).statusCode());
		control.sql("UPDATE user_token SET expires_at = now() - interval '1 second' WHERE kind = 'session'").update();       // 12 hours after sign-in
		assertEquals(401, api.call("GET", "/api/session", registrar, null).statusCode());
	}

	@Test
	void fiveFailuresLockAnEmailForFifteenMinutesEvenAcrossRestarts() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		String pw = api.createUser(office, "management", "Locked", "locked@abc.example", null, null)[1];
		for (int i = 0; i < 5; i++) assertEquals(401, api.login("locked@abc.example", "wrong-pass" + i).statusCode());
		assertEquals(429, api.login("locked@abc.example", pw).statusCode());                                                // even the right password
		assertEquals(5, control.sql("SELECT failures FROM sign_in_failure WHERE key = 'email:locked@abc.example'").query(Integer.class).single()); // in the database, not in memory
		control.sql("UPDATE sign_in_failure SET window_end = now() - interval '1 second' WHERE key = 'email:locked@abc.example'").update();
		assertEquals(200, api.login("locked@abc.example", pw).statusCode());
		control.sql("DELETE FROM sign_in_failure").update(); // do not lock other tests out by address
	}

	@Test
	void twentyFailuresFromOneAddressLockThatAddressOnly() throws Exception {
		setup();
		java.util.function.BiFunction<String, String, Integer> from = (address, email) -> {
			try {
				return TestApi.HTTP.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(api.url("/api/login"))).header("Content-Type", "application/json").header("X-RDMS", "1")
					.header("X-Forwarded-For", address).POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"password\":\"Wrong-pass1\"}")).build(),
					java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode();
			} catch (Exception e) { throw new RuntimeException(e); }
		};
		for (int i = 0; i < 20; i++) assertEquals(401, from.apply("203.0.113.7", "guess" + i + "@abc.example"));   // different emails, one address
		assertEquals(429, from.apply("203.0.113.7", "guess-new@abc.example"));
		assertEquals(401, from.apply("198.51.100.9", "guess-new@abc.example"));                                       // another person behind the same load balancer is not affected
		control.sql("DELETE FROM sign_in_failure").update();
	}

	@Test
	void theOfficeManagesAccountsAndOnlyTheOffice() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		// faculty accounts need an employee code and a department; the faculty profile is created with the account
		assertEquals(400, api.call("POST", "/api/office/users", office, "{\"role\":\"faculty\",\"name\":\"F\",\"email\":\"f@abc.example\",\"department\":\"Physics\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/office/users", office, "{\"role\":\"faculty\",\"name\":\"F\",\"email\":\"f@abc.example\",\"employeeCode\":\"EMP7\",\"department\":\"Nowhere\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/office/users", office, "{\"role\":\"office\",\"name\":\"O\",\"email\":\"o2@abc.example\"}").statusCode()); // Office accounts come from UniRise
		String[] fac = api.createUser(office, "faculty", "Asha", "asha@abc.example", "EMP7", "Physics");
		assertEquals(400, api.call("POST", "/api/office/users", office, "{\"role\":\"faculty\",\"name\":\"Asha2\",\"email\":\"asha2@abc.example\",\"employeeCode\":\"EMP7\",\"department\":\"Physics\"}").statusCode()); // profile already linked
		assertEquals(400, api.call("POST", "/api/office/users", office, "{\"role\":\"management\",\"name\":\"Dup\",\"email\":\"ASHA@abc.example\"}").statusCode()); // email taken
		Caller xoffice = api.signIn(xyz.officeEmail(), xyz.officePassword());
		assertEquals(400, api.call("POST", "/api/office/users", xoffice, "{\"role\":\"management\",\"name\":\"Dup\",\"email\":\"asha@abc.example\"}").statusCode()); // across institutions too

		Caller asha = api.signIn("asha@abc.example", fac[1]);
		var me = api.call("GET", "/api/session", asha, null).body();
		assertTrue(me.contains("\"role\":\"faculty\"") && me.contains("\"facultyId\":\"EMP7\""), me);
		assertEquals(403, api.call("GET", "/api/office/users", asha, null).statusCode());
		assertEquals(403, api.call("POST", "/api/office/users", asha, "{\"role\":\"management\",\"name\":\"X\",\"email\":\"x@abc.example\"}").statusCode());
		String[] dean = api.createUser(office, "management", "Dean", "dean@abc.example", null, null);
		Caller deanS = api.signIn("dean@abc.example", dean[1]);
		assertEquals(403, api.call("GET", "/api/office/users", deanS, null).statusCode());
		assertEquals(403, api.call("POST", "/api/office/users/" + fac[0] + "/reset-password", deanS, null).statusCode());
		assertEquals(403, api.call("GET", "/api/office/audit", deanS, null).statusCode());

		// suspend: needs a reason, ends the person's sessions at once, refuses sign-in; reactivate restores it
		assertEquals(400, api.call("POST", "/api/office/users/" + fac[0] + "/status", office, "{\"status\":\"suspended\",\"reason\":\"\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/office/users/" + fac[0] + "/status", office, "{\"status\":\"suspended\",\"reason\":\"On leave\"}").statusCode());
		assertEquals(401, api.call("GET", "/api/session", asha, null).statusCode());
		var refused = api.login("asha@abc.example", fac[1]);
		assertEquals(403, refused.statusCode());
		assertTrue(refused.body().contains("suspended"), refused.body());
		assertEquals(200, api.call("POST", "/api/office/users/" + fac[0] + "/status", office, "{\"status\":\"active\"}").statusCode());
		asha = api.signIn("asha@abc.example", fac[1]);

		// changing the role signs the person out; a management account cannot become faculty without a profile
		assertEquals(200, api.call("POST", "/api/office/users/" + fac[0] + "/role", office, "{\"role\":\"management\"}").statusCode());
		assertEquals(401, api.call("GET", "/api/session", asha, null).statusCode());
		assertEquals(200, api.call("POST", "/api/office/users/" + fac[0] + "/role", office, "{\"role\":\"faculty\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/office/users/" + dean[0] + "/role", office, "{\"role\":\"faculty\"}").statusCode());

		// reset password: a new temporary password, old one and old sessions stop working
		Caller deanAgain = api.signIn("dean@abc.example", dean[1]);
		var reset = api.call("POST", "/api/office/users/" + dean[0] + "/reset-password", office, null);
		assertEquals(200, reset.statusCode());
		assertEquals(401, api.call("GET", "/api/session", deanAgain, null).statusCode());
		assertEquals(401, api.login("dean@abc.example", dean[1]).statusCode());
		assertEquals(200, api.login("dean@abc.example", field(reset.body(), "temporaryPassword")).statusCode());

		// the Office cannot change its own account or another Office account here, or an account of another institution
		String officeId = field(api.call("GET", "/api/session", office, null).body(), "id");
		assertEquals(404, api.call("POST", "/api/office/users/" + officeId + "/status", office, "{\"status\":\"suspended\",\"reason\":\"x\"}").statusCode());
		assertEquals(404, api.call("POST", "/api/office/users/" + fac[0] + "/status", xoffice, "{\"status\":\"suspended\",\"reason\":\"x\"}").statusCode()); // XYZ has no such account
		assertFalse(api.call("GET", "/api/office/users", xoffice, null).body().contains("abc.example\""));

		// everything above is in the audit log, newest first
		String audit = api.call("GET", "/api/office/audit", office, null).body();
		for (String action : new String[] { "Account created", "Account suspended", "Account activated", "Role changed to management", "Password reset", "Office of Research signed in" }) {
			assertTrue(audit.contains(action), action + " missing from " + audit);
		}
		String list = api.call("GET", "/api/office/users", office, null).body();
		assertTrue(list.contains("\"employeeCode\":\"EMP7\"") && list.contains("\"reviewNote\":\"\"") && list.contains("dean@abc.example"), list);
	}

	@Test
	void changingYourPasswordKeepsThisBrowserAndSignsOutTheOthers() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		String pw = api.createUser(office, "management", "Treasurer", "treasurer@abc.example", null, null)[1];
		Caller laptop = api.signIn("treasurer@abc.example", pw);
		Caller phone = api.signIn("treasurer@abc.example", pw);
		assertEquals(400, api.call("POST", "/api/account/password", laptop, "{\"current\":\"wrong\",\"next\":\"NewPass123\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/account/password", laptop, "{\"current\":\"" + pw + "\",\"next\":\"short\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/account/password", laptop, "{\"current\":\"" + pw + "\",\"next\":\"onlyletters\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/account/password", laptop, "{\"current\":\"" + pw + "\",\"next\":\"NewPass123\"}").statusCode());
		assertEquals(200, api.call("GET", "/api/session", laptop, null).statusCode());
		assertEquals(401, api.call("GET", "/api/session", phone, null).statusCode());
		assertEquals(401, api.login("treasurer@abc.example", pw).statusCode());
		assertEquals(200, api.login("treasurer@abc.example", "NewPass123").statusCode());
	}

	@Test
	void theOldModelsEndpointsAreParked() throws Exception {
		setup();
		Caller office = api.signIn(abc.officeEmail(), abc.officePassword());
		for (String path : new String[] { "/api/milestones", "/api/meeting-logs", "/api/reminders", "/api/projects", "/api/periods", "/api/auth/redeem" }) {
			assertEquals(404, api.call("GET", path, office, null).statusCode(), path);
		}
		assertEquals(404, api.call("POST", "/api/role-grants", office, "{}").statusCode());
		assertEquals(404, api.call("POST", "/api/relationships", office, "{}").statusCode());
	}
}
