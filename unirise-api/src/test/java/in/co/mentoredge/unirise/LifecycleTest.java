package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Tenant lifecycle (suspend, export, delete, usage), CSV onboarding import and the backup scripts. Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.tenants.retention-days=0" })
class LifecycleTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static final String OP = "test-admin";

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

	HttpResponse<byte[]> raw(String method, String path, String header, String value, String body, String contentType) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).header("Content-Type", contentType);
		if (header != null) b.header(header, value);
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
	}

	HttpResponse<String> call(String method, String path, String header, String value, String body) throws Exception {
		var r = raw(method, path, header, value, body, "application/json");
		return new FakeResponse(r);
	}

	record FakeResponse(HttpResponse<byte[]> r) implements HttpResponse<String> {
		public int statusCode() { return r.statusCode(); }
		public String body() { return new String(r.body(), java.nio.charset.StandardCharsets.UTF_8); }
		public java.net.http.HttpRequest request() { return r.request(); }
		public java.util.Optional<HttpResponse<String>> previousResponse() { return java.util.Optional.empty(); }
		public java.net.http.HttpHeaders headers() { return r.headers(); }
		public java.net.URI uri() { return r.uri(); }
		public java.net.http.HttpClient.Version version() { return r.version(); }
		public java.util.Optional<javax.net.ssl.SSLSession> sslSession() { return java.util.Optional.empty(); }
	}

	static String field(String json, String name) {
		var m = Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find(), json);
		return m.group(1);
	}

	String tenant(String slug) throws Exception {
		var r = call("POST", "/api/platform/tenants", "X-Admin-Key", OP, "{\"slug\":\"" + slug + "\",\"name\":\"" + slug + " uni\"}");
		assertEquals(201, r.statusCode());
		return field(r.body(), "apiKey");
	}

	@Test
	void suspendExportAndDeleteFollowTheExitProcess() throws Exception {
		String key = tenant("lifea");
		assertEquals(201, call("POST", "/api/researchers", "X-API-Key", key, "{\"name\":\"Keep Me\"}").statusCode());
		assertEquals(401, call("GET", "/api/platform/tenants", null, null, null).statusCode());
		assertEquals(401, call("GET", "/api/platform/tenants", "X-API-Key", key, null).statusCode());
		assertTrue(call("GET", "/api/platform/tenants", "X-Admin-Key", OP, null).body().contains("lifea"));

		assertEquals(400, call("POST", "/api/platform/tenants/lifea/status", "X-Admin-Key", OP, "{\"status\":\"suspended\"}").statusCode());          // a reason is required
		assertEquals(400, call("POST", "/api/platform/tenants/lifea/status", "X-Admin-Key", OP, "{\"status\":\"closed\",\"reason\":\"x\"}").statusCode()); // closed is only reached by delete
		assertEquals(200, call("POST", "/api/platform/tenants/lifea/status", "X-Admin-Key", OP, "{\"status\":\"suspended\",\"reason\":\"unpaid invoice\"}").statusCode());
		assertEquals(403, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());
		assertEquals(200, call("POST", "/api/platform/tenants/lifea/status", "X-Admin-Key", OP, "{\"status\":\"active\",\"reason\":\"paid\"}").statusCode());
		assertEquals(200, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());

		var zip = raw("GET", "/api/platform/tenants/lifea/export", "X-Admin-Key", OP, null, "application/json");
		assertEquals(200, zip.statusCode());
		Set<String> files = new HashSet<>();
		String researchers = "";
		try (var in = new ZipInputStream(new ByteArrayInputStream(zip.body()))) {
			for (var e = in.getNextEntry(); e != null; e = in.getNextEntry()) {
				files.add(e.getName());
				if (e.getName().equals("researcher.csv")) researchers = new String(in.readAllBytes());
			}
		}
		assertTrue(files.contains("researcher.csv") && files.contains("publication.csv") && !files.contains("flyway_schema_history.csv"), files.toString());
		assertTrue(researchers.contains("Keep Me"));

		assertEquals(409, call("DELETE", "/api/platform/tenants/lifea?confirm=lifea", "X-Admin-Key", OP, null).statusCode());   // not closing yet
		assertEquals(200, call("POST", "/api/platform/tenants/lifea/status", "X-Admin-Key", OP, "{\"status\":\"closing\",\"reason\":\"contract ended\"}").statusCode());
		assertEquals(403, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());
		assertEquals(400, call("DELETE", "/api/platform/tenants/lifea?confirm=wrong", "X-Admin-Key", OP, null).statusCode());
		assertEquals(204, call("DELETE", "/api/platform/tenants/lifea?confirm=lifea", "X-Admin-Key", OP, null).statusCode());

		assertEquals(0, control.sql("SELECT count(*) FROM pg_database WHERE datname = 'tenant_lifea'").query(Long.class).single());
		assertEquals(0, control.sql("SELECT count(*) FROM pg_roles WHERE rolname = 'app_lifea'").query(Long.class).single());
		assertEquals(401, call("GET", "/api/researchers", "X-API-Key", key, null).statusCode());
		assertEquals(409, call("POST", "/api/platform/tenants", "X-Admin-Key", OP, "{\"slug\":\"lifea\",\"name\":\"again\"}").statusCode());   // a slug is never reused
		assertTrue(control.sql("SELECT count(*) FROM platform_access_log WHERE action = 'tenant.delete'").query(Long.class).single() == 1);
	}

	@Test
	void usageCountsPeopleWithCurrentAppointments() throws Exception {
		String key = tenant("lifeb");
		long unit = Long.parseLong(field(call("POST", "/api/org-units", "X-API-Key", key, "{\"type\":\"campus\",\"name\":\"C\"}").body(), "id"));
		for (String n : new String[] { "A", "B" }) {
			long id = Long.parseLong(field(call("POST", "/api/researchers", "X-API-Key", key, "{\"name\":\"" + n + "\"}").body(), "id"));
			call("POST", "/api/appointments", "X-API-Key", key, "{\"researcherId\":" + id + ",\"orgUnitId\":" + unit + "}");
		}
		call("POST", "/api/researchers", "X-API-Key", key, "{\"name\":\"No appointment\"}");
		var u = call("POST", "/api/platform/usage/refresh", "X-Admin-Key", OP, null).body();
		assertTrue(u.contains("\"slug\":\"lifeb\"") && u.contains("\"activeResearchers\":2"), u);
	}

	@Test
	void csvImportPreviewsErrorsThenCommitsIdempotently() throws Exception {
		String key = tenant("lifec");
		String units = "name,type,parent\nSci Campus,campus,\nPhysics,department,Sci Campus\nPhysics,department,Sci Campus\n";
		var up = call("POST", "/api/imports/org-units", "X-API-Key", key, null);
		assertEquals(415, up.statusCode());                                                                       // must be sent as text/csv
		assertEquals(200, new FakeResponse(raw("POST", "/api/imports/org-units?commit=true", "X-API-Key", key, units, "text/csv")).statusCode());
		assertEquals(2, call("GET", "/api/org-units", "X-API-Key", key, null).body().split("\"id\"", -1).length - 1);   // the duplicate row did not create a third unit

		String bad = "employeeId,name,email,orcid,department,kind\nE1,Asha,not-an-email,,Physics,faculty\nE2,Bala,b@x.example,,Nowhere,faculty\nE1,Asha again,,,,faculty\n,No key,,,,\n";
		var preview = new FakeResponse(raw("POST", "/api/imports/people", "X-API-Key", key, bad, "text/csv"));
		assertEquals(200, preview.statusCode());
		assertTrue(preview.body().contains("\"failed\":4") && preview.body().contains("email is not valid") && preview.body().contains("department not found")
			&& preview.body().contains("appears twice") && preview.body().contains("needs employeeId"), preview.body());
		assertEquals(409, raw("POST", "/api/imports/people?commit=true", "X-API-Key", key, bad, "text/csv").statusCode());   // errors block the commit
		assertEquals("[]", call("GET", "/api/researchers", "X-API-Key", key, null).body());

		String good = "employeeId,name,email,orcid,department,kind,title\nE1,Asha,a@x.example,0000-0002-1825-0097,Physics,faculty,Professor\nR9,Sam,,,Physics,scholar,\n";
		var first = new FakeResponse(raw("POST", "/api/imports/people?commit=true", "X-API-Key", key, good, "text/csv"));
		assertTrue(first.body().contains("\"created\":2"), first.body());
		var again = new FakeResponse(raw("POST", "/api/imports/people?commit=true", "X-API-Key", key, good.replace("Asha", "Asha Rao"), "text/csv"));
		assertTrue(again.body().contains("\"created\":0") && again.body().contains("\"updated\":2"), again.body());
		String all = call("GET", "/api/researchers", "X-API-Key", key, null).body();
		assertTrue(all.contains("Asha Rao") && all.split("\"id\"", -1).length - 1 == 2, all);
		assertEquals(1, call("GET", "/api/org-units", "X-API-Key", key, null).body().contains("Physics") ? 1 : 0);
		// a researcher cannot import
		assertEquals(401, raw("POST", "/api/imports/people", null, null, good, "text/csv").statusCode());
	}

	/** Runs a script in a postgres:16 container so the client tools match the server version (a newer pg_dump writes dumps 16 cannot restore). */
	String inDocker(Path out, String script, String... args) throws Exception {
		Path scripts = Path.of("..", "scripts").toAbsolutePath().normalize();
		var cmd = new java.util.ArrayList<>(java.util.List.of("docker", "run", "--rm", "-v", scripts + ":/s:ro", "-v", out + ":/out", "-e", "PGHOST=host.docker.internal",
			"-e", "PGPORT=" + PG.getMappedPort(5432), "-e", "PGUSER=" + PG.getUsername(), "-e", "PGPASSWORD=" + PG.getPassword(), "postgres:16", "bash", "/s/" + script));
		cmd.addAll(java.util.List.of(args));
		var p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
		String text = new String(p.getInputStream().readAllBytes());
		int code = p.waitFor();
		if (code != 0) throw new AssertionError(script + " exited " + code + ": " + text);
		return text;
	}

	@Test
	void backupScriptDumpsAndTheDrillRestoresAndComparesCounts() throws Exception {
		String key = tenant("lifed");
		call("POST", "/api/researchers", "X-API-Key", key, "{\"name\":\"Backed up\"}");
		Path dir = Files.createTempDirectory("backup");
		inDocker(dir, "tenant-backup.sh", "lifed", "/out");
		Path dump;
		try (var s = Files.list(dir)) { dump = s.findFirst().orElseThrow(); }
		String out = inDocker(dir, "restore-drill.sh", "lifed", "/out/" + dump.getFileName());
		assertTrue(out.contains("restore drill OK for lifed"), out);
		assertThrows(AssertionError.class, () -> inDocker(dir, "tenant-backup.sh", "bad;slug", "/out"));   // the slug is validated before it reaches a shell command
	}
}
