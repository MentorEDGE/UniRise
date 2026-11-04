package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * On RDS the application cannot be a superuser. This runs the whole tenant lifecycle as a plain login that has only CREATEROLE, CREATEDB and
 * pg_signal_backend (the "unirise_app" role of infra/README.md), including a TLS-style JDBC parameter. Needs Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.tenants.retention-days=0" })
class NonSuperuserTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();

	@DynamicPropertySource
	static void props(DynamicPropertyRegistry r) throws Exception {
		PG.start();
		try (var c = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()); var st = c.createStatement()) {
			st.execute("CREATE ROLE unirise_app LOGIN PASSWORD 'app-pw' CREATEROLE CREATEDB");
			st.execute("GRANT pg_signal_backend TO unirise_app");
			st.execute("CREATE DATABASE ctrl OWNER unirise_app");
		}
		r.add("app.control.url", () -> PG.getJdbcUrl().replace("/" + PG.getDatabaseName(), "/ctrl"));
		r.add("app.control.user", () -> "unirise_app");
		r.add("app.control.password", () -> "app-pw");
		r.add("app.tenants.host", PG::getHost);
		r.add("app.tenants.port", () -> PG.getMappedPort(5432));
		r.add("app.tenants.jdbc-params", () -> "sslmode=disable");   // stands in for sslmode=require on RDS; proves the parameter reaches every connection
	}

	@Value("${local.server.port}") int port;

	HttpResponse<String> call(String method, String path, String header, String value, String body) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).header("Content-Type", "application/json");
		if (header != null) b.header(header, value);
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	@Test
	void provisionUseSuspendExportAndDeleteWorkWithoutSuperuserRights() throws Exception {
		var created = call("POST", "/api/platform/tenants", "X-Admin-Key", "test-admin", "{\"slug\":\"nosuper\",\"name\":\"No Super\"}");
		assertEquals(201, created.statusCode(), created.body());
		var m = Pattern.compile("\"apiKey\":\"([0-9a-f]+)\"").matcher(created.body());
		assertTrue(m.find());
		String key = m.group(1);

		assertEquals(201, call("POST", "/api/researchers", "X-API-Key", key, "{\"name\":\"Works\"}").statusCode());
		assertEquals(200, call("POST", "/api/platform/tenants/nosuper/status", "X-Admin-Key", "test-admin", "{\"status\":\"suspended\",\"reason\":\"test\"}").statusCode());
		assertEquals(403, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());
		assertEquals(200, call("POST", "/api/platform/tenants/nosuper/status", "X-Admin-Key", "test-admin", "{\"status\":\"active\",\"reason\":\"test\"}").statusCode());
		assertEquals(200, call("GET", "/api/platform/tenants/nosuper/export", "X-Admin-Key", "test-admin", null).statusCode());
		assertEquals(200, call("POST", "/api/platform/migrations", "X-Admin-Key", "test-admin", null).statusCode());

		// an open pooled connection must not block the drop: delete terminates it
		assertEquals(200, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());
		assertEquals(200, call("POST", "/api/platform/tenants/nosuper/status", "X-Admin-Key", "test-admin", "{\"status\":\"closing\",\"reason\":\"exit\"}").statusCode());
		assertEquals(204, call("DELETE", "/api/platform/tenants/nosuper?confirm=nosuper", "X-Admin-Key", "test-admin", null).statusCode());
		try (var c = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()); var st = c.createStatement();
			 var rs = st.executeQuery("SELECT (SELECT count(*) FROM pg_database WHERE datname = 'tenant_nosuper') + (SELECT count(*) FROM pg_roles WHERE rolname = 'app_nosuper')")) {
			rs.next();
			assertEquals(0, rs.getInt(1));
		}
	}
}
