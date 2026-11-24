package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/** Two-step sign-in (2026-11-24), signed-in devices and the access review, with two-step required as on AWS. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.security.two-step-roles=office,management" })
class TwoStepTest {
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

	// ---------- an authenticator app, for the test ----------

	static String code(String secret, long step) throws Exception {
		String t = secret.toUpperCase().replaceAll("[^A-Z2-7]", ""), abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
		ByteBuffer key = ByteBuffer.allocate(t.length() * 5 / 8);
		int buffer = 0, bits = 0;
		for (char ch : t.toCharArray()) { buffer = (buffer << 5) | abc.indexOf(ch); bits += 5; if (bits >= 8) { key.put((byte) (buffer >> (bits - 8))); bits -= 8; } }
		Mac mac = Mac.getInstance("HmacSHA1");
		mac.init(new SecretKeySpec(java.util.Arrays.copyOf(key.array(), key.position()), "HmacSHA1"));
		byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
		int o = h[h.length - 1] & 0x0f;
		return String.format("%06d", ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1_000_000);
	}

	static long now() { return System.currentTimeMillis() / 30_000; }

	static String idOf(String users, String email) {
		var m = java.util.regex.Pattern.compile("\"id\":\"(\\d+)\",\"email\":\"" + java.util.regex.Pattern.quote(email) + "\"").matcher(users);
		assertTrue(m.find(), email + " in " + users);
		return m.group(1);
	}

	static String pendingCookie(HttpResponse<String> r) {
		String set = r.headers().allValues("Set-Cookie").stream().filter((h) -> h.startsWith("unirise_2fa=")).findFirst().orElseThrow(() -> new AssertionError("no two-step cookie: " + r.headers()));
		assertTrue(set.contains("HttpOnly") && set.contains("SameSite=Strict") && set.contains("Path=/api/login") && set.contains("Max-Age=600"), set);
		return set.substring(0, set.indexOf(';'));
	}

	@Test
	void theOfficeMustUseAnAuthenticatorAndCodesWorkOnce() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("tsa", "office@tsa.example");
		// Password alone: no session, only the half-finished sign-in, which reaches no data.
		var first = api.login(inst.officeEmail(), inst.officePassword());
		assertEquals(200, first.statusCode());
		assertTrue(first.body().contains("\"twoStep\":\"setup\""), first.body());
		assertTrue(first.headers().allValues("Set-Cookie").stream().noneMatch((h) -> h.startsWith("unirise_sid=")), "no session yet");
		Caller pending = new Caller(null, pendingCookie(first));
		assertEquals(401, api.call("GET", "/api/data", pending, null).statusCode());
		// Set up the app.
		var setup = api.call("POST", "/api/login/2fa/setup", pending, null);
		assertEquals(200, setup.statusCode(), setup.body());
		String secret = field(setup.body(), "secret");
		assertTrue(setup.body().contains("otpauth://totp/UniRise:office%40tsa.example?secret=" + secret + "&issuer=UniRise"), setup.body());
		assertEquals(400, api.call("POST", "/api/login/2fa/enable", pending, "{\"code\":\"000000\"}").statusCode());
		long S = now(); // the code's time step; later codes use S or S+1, so the test does not depend on the clock
		var on = api.call("POST", "/api/login/2fa/enable", pending, "{\"code\":\"" + code(secret, S) + "\"}");
		assertEquals(200, on.statusCode(), on.body());
		Caller office = new Caller(null, TestApi.sessionCookie(on));
		assertEquals(10, on.body().split("\"[A-Z2-7]{5}-[A-Z2-7]{5}\"", -1).length - 1, "ten recovery codes: " + on.body());
		String recovery = on.body().replaceAll("(?s).*\"recoveryCodes\":\\[\"([A-Z2-7-]{11})\".*", "$1");
		assertEquals(200, api.call("GET", "/api/data", office, null).statusCode());
		assertEquals(401, api.call("POST", "/api/login/2fa/enable", pending, "{\"code\":\"123456\"}").statusCode(), "the half-finished sign-in is used up");
		// Next sign-in: a code is needed; the same code does not work twice; a recovery code works once.
		var again = api.login(inst.officeEmail(), inst.officePassword());
		assertTrue(again.body().contains("\"twoStep\":\"verify\""), again.body());
		Caller p2 = new Caller(null, pendingCookie(again));
		assertEquals(400, api.call("POST", "/api/login/2fa", p2, "{\"code\":\"" + code(secret, S) + "\"}").statusCode(), "a code works once");
		var viaRecovery = api.call("POST", "/api/login/2fa", p2, "{\"code\":\"" + recovery.toLowerCase() + "\"}");
		assertEquals(200, viaRecovery.statusCode(), viaRecovery.body());
		var third = api.login(inst.officeEmail(), inst.officePassword());
		Caller p3 = new Caller(null, pendingCookie(third));
		assertEquals(400, api.call("POST", "/api/login/2fa", p3, "{\"code\":\"" + recovery + "\"}").statusCode(), "a recovery code works once");
		var viaApp = api.call("POST", "/api/login/2fa", p3, "{\"code\":\"" + code(secret, S + 1) + "\"}");
		assertEquals(200, viaApp.statusCode(), viaApp.body());
		// Five wrong codes lock the half-finished sign-in.
		var fourth = api.login(inst.officeEmail(), inst.officePassword());
		Caller p4 = new Caller(null, pendingCookie(fourth));
		for (int i = 0; i < 5; i++) assertEquals(400, api.call("POST", "/api/login/2fa", p4, "{\"code\":\"11111" + i + "\"}").statusCode());
		assertEquals(429, api.call("POST", "/api/login/2fa", p4, "{\"code\":\"" + code(secret, now()) + "\"}").statusCode());
		// The Office may not turn it off; the audit log records it was turned on.
		Caller o = new Caller(null, TestApi.sessionCookie(viaApp));
		assertEquals(403, api.call("POST", "/api/account/2fa/disable", o, "{\"code\":\"123456\"}").statusCode());
		assertTrue(api.call("GET", "/api/account/2fa", o, null).body().contains("\"required\":true"));
		assertTrue(api.call("GET", "/api/office/audit", o, null).body().contains("Two-step sign-in turned on"));
	}

	@Test
	void facultyMayOptInAndTheOfficeCanResetSomeoneWhoLostTheirPhone() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("tsb", "office@tsb.example");
		// The Office signs in through its own two-step setup.
		var l = api.login(inst.officeEmail(), inst.officePassword());
		Caller p = new Caller(null, pendingCookie(l));
		String osecret = field(api.call("POST", "/api/login/2fa/setup", p, null).body(), "secret");
		Caller office = new Caller(null, TestApi.sessionCookie(api.call("POST", "/api/login/2fa/enable", p, "{\"code\":\"" + code(osecret, now()) + "\"}")));
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		String[] fac = api.createUser(office, "faculty", "Asha Rao", "asha@tsb.example", "TSB001", "Physics");
		// Faculty: no second step until they choose it.
		var fl = api.login("asha@tsb.example", fac[1]);
		assertTrue(fl.body().contains("\"user\"") && !fl.body().contains("twoStep"), fl.body());
		Caller asha = new Caller(null, TestApi.sessionCookie(fl));
		assertTrue(api.call("GET", "/api/account/2fa", asha, null).body().contains("\"required\":false"));
		String fsecret = field(api.call("POST", "/api/account/2fa/setup", asha, null).body(), "secret");
		long F = now();
		assertEquals(200, api.call("POST", "/api/account/2fa/enable", asha, "{\"code\":\"" + code(fsecret, F) + "\"}").statusCode());
		assertTrue(api.login("asha@tsb.example", fac[1]).body().contains("\"twoStep\":\"verify\""));
		// Signed-in devices: two sessions; "sign out other devices" keeps this one.
		var second = api.login("asha@tsb.example", fac[1]);
		Caller phone = new Caller(null, TestApi.sessionCookie(api.call("POST", "/api/login/2fa", new Caller(null, pendingCookie(second)), "{\"code\":\"" + code(fsecret, F + 1) + "\"}")));
		String list = api.call("GET", "/api/account/sessions", asha, null).body();
		assertEquals(2, list.split("\"signedInAt\"", -1).length - 1, list);
		assertTrue(list.contains("\"current\":true") && list.contains("\"current\":false"), list);
		assertEquals(200, api.call("POST", "/api/account/sessions/end-others", asha, "{}").statusCode());
		assertEquals(401, api.call("GET", "/api/data", phone, null).statusCode());
		assertEquals(200, api.call("GET", "/api/data", asha, null).statusCode());
		// The access review: last sign-in and two-step status for every account.
		String users = api.call("GET", "/api/office/users", office, null).body();
		assertTrue(users.contains("\"lastSignInAt\":\"20") && users.contains("\"twoStep\":true") && users.contains("\"twoStepRequired\":true"), users);
		// Lost phone: the Office resets it; their sessions end; they set it up again at the next sign-in.
		String ashaId = idOf(users, "asha@tsb.example");
		assertEquals(200, api.call("POST", "/api/office/users/" + ashaId + "/reset-2fa", office, "{}").statusCode());
		assertEquals(401, api.call("GET", "/api/data", asha, null).statusCode());
		assertTrue(api.login("asha@tsb.example", fac[1]).body().contains("\"user\""), "faculty, not required: straight in after the reset");
		String officeId = idOf(users, "office@tsb.example");
		assertEquals(400, api.call("POST", "/api/office/users/" + officeId + "/reset-2fa", office, "{}").statusCode(), "not their own");
		// The UniRise operator can reset an Office account.
		int refused = api.call("POST", "/api/platform/tenants/tsb/reset-2fa", Caller.NOBODY, "{\"email\":\"office@tsb.example\"}").statusCode();
		assertTrue(refused == 401 || refused == 403, "operator only: " + refused);
		var op = java.net.http.HttpClient.newHttpClient().send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:" + port + "/api/platform/tenants/tsb/reset-2fa"))
			.header("X-Admin-Key", "test-admin").header("Content-Type", "application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\"email\":\"office@tsb.example\"}")).build(),
			HttpResponse.BodyHandlers.ofString());
		assertEquals(200, op.statusCode(), op.body());
		assertTrue(api.login(inst.officeEmail(), inst.officePassword()).body().contains("\"twoStep\":\"setup\""));
	}

	@Test
	void sampleDataAccountsAreNotRequiredToUseIt() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("tsc", "office@tsc.example");
		var l = api.login(inst.officeEmail(), inst.officePassword());
		Caller p = new Caller(null, pendingCookie(l));
		String s = field(api.call("POST", "/api/login/2fa/setup", p, null).body(), "secret");
		Caller office = new Caller(null, TestApi.sessionCookie(api.call("POST", "/api/login/2fa/enable", p, "{\"code\":\"" + code(s, now()) + "\"}")));
		String[] dean = api.createUser(office, "management", "Demo Dean", "dean@tsc.example", null, null);
		assertTrue(api.login("dean@tsc.example", dean[1]).body().contains("\"twoStep\":\"setup\""), "a real management account must");
		try (var c = java.sql.DriverManager.getConnection(PG.getJdbcUrl().replaceAll("/[^/?]+(\\?|$)", "/tenant_tsc$1"), PG.getUsername(), PG.getPassword())) {
			c.createStatement().executeUpdate("UPDATE app_user SET created_by = 'UniRise demo data' WHERE email = 'dean@tsc.example'");
		}
		assertTrue(api.login("dean@tsc.example", dean[1]).body().contains("\"user\""), "a sample-data account signs straight in");
	}
}
