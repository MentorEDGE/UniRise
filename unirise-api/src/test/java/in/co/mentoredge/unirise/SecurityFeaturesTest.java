package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/** Security features added on 2026-11-24: password confirmation for sensitive actions, stronger passwords, append-only audit. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.security.breached-passwords-url=" })
class SecurityFeaturesTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");

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

	/** A raw call without the helper's automatic confirmation. */
	java.net.http.HttpResponse<String> raw(TestApi api, String method, String path, Caller c, String body) throws Exception {
		String pw = TestApi.PASSWORDS.remove(c.cookie());
		try { return api.call(method, path, c, body); } finally { if (pw != null) TestApi.PASSWORDS.put(c.cookie(), pw); }
	}

	@Test
	void sensitiveActionsNeedThePasswordAgain() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("sec", "office@sec.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		String body = "{\"role\":\"management\",\"name\":\"Dean Q\",\"email\":\"dean@sec.example\",\"designation\":\"Dean\"}";
		var refused = raw(api, "POST", "/api/office/users", office, body);
		assertEquals(403, refused.statusCode());
		assertTrue(refused.body().contains("\"code\":\"confirm-password\""), refused.body());
		assertEquals(400, raw(api, "POST", "/api/account/confirm", office, "{\"password\":\"WrongPass99\"}").statusCode());
		assertEquals(200, raw(api, "POST", "/api/account/confirm", office, "{\"password\":\"" + inst.officePassword() + "\"}").statusCode());
		var created = raw(api, "POST", "/api/office/users", office, body);
		assertEquals(200, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(200, raw(api, "POST", "/api/office/users/" + id + "/reset-password", office, "{}").statusCode(), "within 5 minutes: no second prompt");
		// Five wrong passwords sign the account out everywhere.
		for (int i = 0; i < 4; i++) assertEquals(400, raw(api, "POST", "/api/account/confirm", office, "{\"password\":\"WrongPass9" + i + "\"}").statusCode());
		assertEquals(401, raw(api, "POST", "/api/account/confirm", office, "{\"password\":\"WrongPass95\"}").statusCode());
		assertEquals(401, api.call("GET", "/api/session", office, null).statusCode());
		// The service key has no password and is not asked.
		assertEquals(200, api.call("POST", "/api/office/users/" + id + "/reset-password", TestApi.key(inst), "{}").statusCode());
		// Faculty changing their own profile are not asked.
		Caller office2 = api.signIn(inst.officeEmail(), inst.officePassword());
		String log = api.call("GET", "/api/office/audit", office2, null).body();
		assertTrue(log.contains("Signed out after wrong passwords"), log);
	}

	@Test
	void newPasswordsMustBeHardToGuess() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("pwd", "office@pwd.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		String cur = inst.officePassword();
		for (String weak : new String[] { "Short1", "Unirise2026", "Password12345", "qwerty12345", "aaaaaaaa11", "office2026x", "lettersonlyhere" }) {
			var r = api.call("POST", "/api/account/password", office, "{\"current\":\"" + cur + "\",\"next\":\"" + weak + "\"}");
			assertEquals(400, r.statusCode(), weak + " → " + r.body());
		}
		var same = api.call("POST", "/api/account/password", office, "{\"current\":\"" + cur + "\",\"next\":\"" + cur + "\"}");
		assertTrue(same.body().contains("different"), same.body());
		assertEquals(200, api.call("POST", "/api/account/password", office, "{\"current\":\"" + cur + "\",\"next\":\"Kestrel-Harbour-48\"}").statusCode());
	}

	@Test
	void theAuditLogCannotBeChangedAndRecordsExports() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("aud", "office@aud.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		assertEquals(200, api.call("POST", "/api/audit/export", office, "{\"name\":\"publications_report\",\"rows\":42}").statusCode());
		assertTrue(api.call("GET", "/api/office/audit", office, null).body().contains("Data exported"));
		String url = PG.getJdbcUrl().replaceAll("/[^/?]+(\\?|$)", "/tenant_aud$1");
		try (var c = java.sql.DriverManager.getConnection(url, PG.getUsername(), PG.getPassword()); var st = c.createStatement()) {
			for (String sql : new String[] { "UPDATE admin_log SET detail = 'changed'", "DELETE FROM admin_log", "TRUNCATE admin_log" }) {
				var e = assertThrows(java.sql.SQLException.class, () -> st.executeUpdate(sql), sql);
				assertTrue(e.getMessage().contains("cannot be changed or deleted"), e.getMessage());
			}
		}
		try (var c = java.sql.DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()); var st = c.createStatement()) {
			assertThrows(java.sql.SQLException.class, () -> st.executeUpdate("DELETE FROM platform_access_log"));
		}
	}
}
