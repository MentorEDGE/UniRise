package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.tenancy.Migrator;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantRoutingDataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** The database is the tenant boundary (MULTI_TENANCY_DESIGN.md §12). Needs Docker for Testcontainers. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.tenants.max-open-pools=1" })
class TenantIsolationTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static String keyA, keyB;

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
	@Autowired Migrator migrator;
	@Autowired TenantRoutingDataSource routing;
	@Autowired @Qualifier("tenantJdbc") JdbcClient tenantJdbc;
	@Autowired @Qualifier("controlJdbc") JdbcClient control;

	HttpResponse<String> call(String method, String path, String header, String value, String body) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body))
			.header("Content-Type", "application/json");
		if (header != null) b.header(header, value);
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	String provision(String slug) throws Exception {
		var r = call("POST", "/api/platform/tenants", "X-Admin-Key", "test-admin", "{\"slug\":\"" + slug + "\",\"name\":\"Uni " + slug + "\"}");
		assertEquals(201, r.statusCode());
		return field(r.body(), "apiKey");
	}

	static String field(String json, String name) {
		var m = java.util.regex.Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find());
		return m.group(1);
	}

	@BeforeAll
	static void clear() { TenantContext.clear(); }

	void ensureTenants() throws Exception {
		if (keyA == null) { keyA = provision("alpha"); keyB = provision("beta"); }
	}

	@Test
	void userOfOneTenantCannotReachAnotherTenantsData() throws Exception {
		ensureTenants();
		var created = call("POST", "/api/researchers", "X-API-Key", keyA, "{\"name\":\"Alice\"}");
		assertEquals(201, created.statusCode());
		long id = Long.parseLong(field(created.body(), "id"));

		assertEquals(200, call("GET", "/api/researchers/" + id, "X-API-Key", keyA, null).statusCode());
		assertEquals(404, call("GET", "/api/researchers/" + id, "X-API-Key", keyB, null).statusCode()); // guessed id in another tenant
		assertEquals("[]", call("GET", "/api/researchers", "X-API-Key", keyB, null).body());
	}

	@Test
	void missingOrWrongCredentialsFailClosed() throws Exception {
		ensureTenants();
		assertEquals(401, call("GET", "/api/researchers", null, null, null).statusCode());
		assertEquals(401, call("GET", "/api/researchers", "X-API-Key", "nope", null).statusCode());
		assertEquals(401, call("POST", "/api/platform/tenants", "X-Admin-Key", "wrong", "{}").statusCode());
		assertEquals(401, call("POST", "/api/platform/tenants", "X-API-Key", keyA, "{}").statusCode()); // a tenant key is not an operator key
		assertEquals(409, call("POST", "/api/platform/tenants", "X-Admin-Key", "test-admin", "{\"slug\":\"alpha\",\"name\":\"x\"}").statusCode());
	}

	@Test
	void codeWithoutTenantContextCannotTouchTenantData() {
		TenantContext.clear();
		var e = assertThrows(RuntimeException.class, () -> tenantJdbc.sql("SELECT 1").query(Integer.class).single());
		assertInstanceOf(IllegalStateException.class, e.getCause()); // Spring wraps the router's "No tenant in context"
	}

	@Test
	void oneTenantsLoginCannotConnectToAnotherTenantsDatabase() throws Exception {
		ensureTenants();
		String passA = control.sql("SELECT db_password FROM institution_secret s JOIN institution i ON i.id = s.institution_id WHERE slug = 'alpha'").query(String.class).single();
		String urlB = PG.getJdbcUrl().replace("/" + PG.getDatabaseName(), "/tenant_beta");
		assertThrows(SQLException.class, () -> DriverManager.getConnection(urlB, "app_alpha", passA).close());
	}

	@Test
	void failingMigrationOnOneTenantDoesNotBlockTheOthers() throws Exception {
		ensureTenants();
		String good = control.sql("SELECT db_password FROM institution_secret s JOIN institution i ON i.id = s.institution_id WHERE slug = 'beta'").query(String.class).single();
		control.sql("UPDATE institution_secret SET db_password = 'wrong' WHERE institution_id = (SELECT id FROM institution WHERE slug = 'beta')").update();
		try {
			List<Migrator.Result> results = migrator.migrateAll();
			assertTrue(results.stream().filter(r -> r.slug().equals("alpha")).findFirst().orElseThrow().ok());
			assertFalse(results.stream().filter(r -> r.slug().equals("beta")).findFirst().orElseThrow().ok());
			assertEquals(1, control.sql("SELECT count(*) FROM migration_run WHERE status = 'failed'").query(Long.class).single());
		} finally {
			control.sql("UPDATE institution_secret SET db_password = :p WHERE institution_id = (SELECT id FROM institution WHERE slug = 'beta')").param("p", good).update();
			routing.evict("beta");
		}
	}

	@Test
	void idleTenantPoolsAreEvictedUnderTheGlobalCap() throws Exception {
		ensureTenants();
		call("GET", "/api/researchers", "X-API-Key", keyA, null);
		call("GET", "/api/researchers", "X-API-Key", keyB, null);
		assertTrue(routing.openPools() <= 1);
	}
}
