package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/** Request limits on every API call (2026-11-24), with low limits so the test is quick. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.rate-limit.per-minute=20", "app.rate-limit.writes-per-minute=5", "app.rate-limit.per-address-per-minute=30" })
class RateLimitTest {
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

	@Test
	void tooManyRequestsInAMinuteAreRefusedPerSessionAndPerAddress() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("rla", "office@rla.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		// 40 reads (twice the limit, so one window boundary cannot hide it): some are refused, with Retry-After.
		boolean refused = false;
		for (int i = 0; i < 40 && !refused; i++) {
			var r = api.call("GET", "/api/notifications", office, null);
			if (r.statusCode() == 429) {
				refused = true;
				assertTrue(r.body().contains("Too many requests") && r.headers().firstValue("Retry-After").orElse("").equals("60"), r.body());
			} else assertEquals(200, r.statusCode());
		}
		assertTrue(refused, "a session over the limit is refused");
		// Changes have a lower limit.
		Caller other = api.signIn(inst.officeEmail(), inst.officePassword());
		boolean writeRefused = false;
		for (int i = 0; i < 12 && !writeRefused; i++) writeRefused = api.call("POST", "/api/notifications/read", other, "{\"all\":true}").statusCode() == 429;
		assertTrue(writeRefused, "too many changes are refused");
		// Without a session, per client address.
		boolean addressRefused = false;
		for (int i = 0; i < 70 && !addressRefused; i++) addressRefused = api.call("POST", "/api/password/forgot", Caller.NOBODY, "{\"email\":\"x" + i + "@rla.example\"}").statusCode() == 429
			&& api.call("GET", "/api/session", Caller.NOBODY, null).statusCode() == 429;
		assertTrue(addressRefused, "an address over the limit is refused");
	}
}
