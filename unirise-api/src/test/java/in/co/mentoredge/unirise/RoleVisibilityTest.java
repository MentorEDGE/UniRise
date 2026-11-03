package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;
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

/** One case per role: who sees which people (ACCESS_AND_VISIBILITY_MODEL.md §3). Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.admin-key=test-admin")
class RoleVisibilityTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static String service;
	static long r1, r2, r3, r4, r5, d1, d2, school;
	static String tR1, tR2, tHod, tDean, tExec, tViewer, tExpired;

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
	@Autowired @Qualifier("tenantJdbc") JdbcClient tenantJdbc;

	HttpResponse<String> call(String method, String path, String[] headers, String body) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).header("Content-Type", "application/json");
		for (int i = 0; headers != null && i < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	String svc(String method, String path, String body) throws Exception {
		var r = call(method, path, new String[] { "X-API-Key", service }, body);
		assertTrue(r.statusCode() < 300, path + " -> " + r.statusCode());
		return r.body();
	}

	static String field(String json, String name) {
		var m = Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find(), json);
		return m.group(1);
	}

	long create(String path, String body) throws Exception { return Long.parseLong(field(svc("POST", path, body), "id")); }

	long researcher(String name, boolean scholar, long unit) throws Exception {
		long id = create("/api/researchers", "{\"name\":\"" + name + "\",\"isScholar\":" + scholar + "}");
		create("/api/appointments", "{\"researcherId\":" + id + ",\"orgUnitId\":" + unit + "}");
		return id;
	}

	/** Invites an email, optionally linked to a researcher, and returns a signed-in session token. */
	String login(String email, Long researcherId, String grantRole, Long scope, String validTo) throws Exception {
		String inv = svc("POST", "/api/auth/invitations", "{\"email\":\"" + email + "\"" + (researcherId == null ? "" : ",\"researcherId\":" + researcherId) + "}");
		long userId = Long.parseLong(field(inv, "userId"));
		if (grantRole != null) {
			create("/api/role-grants", "{\"userId\":" + userId + ",\"role\":\"" + grantRole + "\"" + (scope == null ? "" : ",\"scopeUnitId\":" + scope)
				+ (validTo == null ? "" : ",\"validTo\":\"" + validTo + "\"") + "}");
		}
		var r = call("POST", "/api/auth/redeem", null, "{\"token\":\"" + field(inv, "token") + "\"}");
		assertEquals(200, r.statusCode());
		return field(r.body(), "token");
	}

	TreeSet<Long> visible(String token) throws Exception {
		var r = call("GET", "/api/researchers", new String[] { "Authorization", "Bearer " + token }, null);
		assertEquals(200, r.statusCode());
		var out = new TreeSet<Long>();
		var m = Pattern.compile("\"id\":(\\d+)").matcher(r.body());
		while (m.find()) out.add(Long.parseLong(m.group(1)));
		return out;
	}

	int status(String token, String path) throws Exception {
		return call("GET", path, new String[] { "Authorization", "Bearer " + token }, null).statusCode();
	}

	@BeforeAll
	static void clear() { in.co.mentoredge.unirise.tenancy.TenantContext.clear(); }

	synchronized void setup() throws Exception {
		if (service != null) return;
		var r = call("POST", "/api/platform/tenants", new String[] { "X-Admin-Key", "test-admin" }, "{\"slug\":\"gamma\",\"name\":\"Gamma University\"}");
		assertEquals(201, r.statusCode());
		service = field(r.body(), "apiKey");
		long univ = create("/api/org-units", "{\"type\":\"campus\",\"name\":\"Gamma\"}");
		school = create("/api/org-units", "{\"parentId\":" + univ + ",\"type\":\"school\",\"name\":\"Sciences\"}");
		d1 = create("/api/org-units", "{\"parentId\":" + school + ",\"type\":\"department\",\"name\":\"Physics\"}");
		d2 = create("/api/org-units", "{\"parentId\":" + school + ",\"type\":\"department\",\"name\":\"Chemistry\"}");
		r1 = researcher("Ravi", false, d1);
		r2 = researcher("Supervisor Sita", false, d1);
		r3 = researcher("Scholar Sam", true, d1);
		r4 = researcher("Chem Chitra", false, d2);
		r5 = researcher("Head Hari", false, d1);
		create("/api/relationships", "{\"mentorId\":" + r2 + ",\"menteeId\":" + r3 + ",\"type\":\"primary\"}");
		tR1 = login("ravi@g.example", r1, null, null, null);
		tR2 = login("sita@g.example", r2, null, null, null);
		tHod = login("hari@g.example", r5, "HOD", d1, null);
		tDean = login("dean@g.example", null, "DEAN", school, null);
		tExec = login("vc@g.example", null, "EXECUTIVE", null, null);
		tViewer = login("registrar@g.example", null, "VIEWER", d2, null);
		tExpired = login("old@g.example", r4, "HOD", d1, "2020-01-01");
	}

	@Test
	void eachRoleSeesOnlyItsSlice() throws Exception {
		setup();
		assertEquals(new TreeSet<>(List.of(r1)), visible(tR1));                       // researcher: self
		assertEquals(new TreeSet<>(List.of(r2, r3)), visible(tR2));                   // supervisor: self + mentee
		assertEquals(new TreeSet<>(List.of(r1, r2, r3, r5)), visible(tHod));          // HoD: department
		assertEquals(new TreeSet<>(List.of(r1, r2, r3, r4, r5)), visible(tDean));     // Dean: school
		assertEquals(new TreeSet<>(List.of(r1, r2, r3, r4, r5)), visible(tExec));     // Executive: everyone
		assertEquals(new TreeSet<>(List.of(r4)), visible(tViewer));                   // read-only viewer: Chemistry only
		assertEquals(new TreeSet<>(List.of(r4)), visible(tExpired));                  // expired grant gives nothing beyond self
	}

	@Test
	void anInvisiblePersonLooksLikeAMissingOne() throws Exception {
		setup();
		assertEquals(404, status(tR1, "/api/researchers/" + r2));
		assertEquals(404, status(tR2, "/api/researchers/" + r1));
		assertEquals(404, status(tHod, "/api/researchers/" + r4));
		assertEquals(200, status(tR2, "/api/researchers/" + r3));
	}

	@Test
	void onlyAdminsCanChangeStructure() throws Exception {
		setup();
		var h = new String[] { "Authorization", "Bearer " + tR1, "Content-Type", "application/json" };
		assertEquals(403, call("POST", "/api/researchers", h, "{\"name\":\"x\"}").statusCode());
		assertEquals(403, call("POST", "/api/org-units", h, "{\"type\":\"group\",\"name\":\"x\"}").statusCode());
		assertEquals(403, call("POST", "/api/role-grants", h, "{\"userId\":1,\"role\":\"RESEARCH_ADMIN\"}").statusCode());
		assertEquals(403, call("POST", "/api/auth/invitations", h, "{\"email\":\"a@b.c\"}").statusCode());
	}

	@Test
	void researcherSeesOnlyTheirOwnUnitInTheTree() throws Exception {
		setup();
		var r = call("GET", "/api/org-units", new String[] { "Authorization", "Bearer " + tR1 }, null);
		assertEquals(1, r.body().split("\"id\"", -1).length - 1);
		assertEquals(4, svc("GET", "/api/org-units", null).split("\"id\"", -1).length - 1); // admin sees the whole tree
	}

	@Test
	void namedDrillDownsByDeanAndExecutiveAreLogged() throws Exception {
		setup();
		long before = tenantJdbcCount(tenant("gamma"));
		assertEquals(200, status(tDean, "/api/researchers/" + r1));
		assertEquals(200, status(tExec, "/api/researchers/" + r4));
		assertEquals(200, status(tHod, "/api/researchers/" + r1)); // HoD is not logged
		assertEquals(before + 2, tenantJdbcCount(tenant("gamma")));
	}

	long tenantJdbcCount(String slug) {
		in.co.mentoredge.unirise.tenancy.TenantContext.set(slug);
		try { return tenantJdbc.sql("SELECT count(*) FROM access_log").query(Long.class).single(); }
		finally { in.co.mentoredge.unirise.tenancy.TenantContext.clear(); }
	}

	static String tenant(String s) { return s; }

	@Test
	void invitationsAreOneTimeAndSessionsNeedARealToken() throws Exception {
		setup();
		String inv = svc("POST", "/api/auth/invitations", "{\"email\":\"once@g.example\"}");
		String body = "{\"token\":\"" + field(inv, "token") + "\"}";
		assertEquals(200, call("POST", "/api/auth/redeem", null, body).statusCode());
		assertEquals(401, call("POST", "/api/auth/redeem", null, body).statusCode());
		assertEquals(401, call("POST", "/api/auth/redeem", null, "{\"token\":\"nope\"}").statusCode());
		assertEquals(401, status("not-a-session", "/api/me"));
		assertEquals(401, status(field(inv, "token"), "/api/me")); // an invitation is not a session
	}

	@Test
	void unusualPathsDoNotSkipAuthentication() throws Exception {
		setup();
		for (String p : new String[] { "//api/researchers", "/api/./researchers", "/api/platform/../researchers", "/x/..;/api/researchers", "/api/researchers;a=b", "/api/%72esearchers", "//api/platform/tenants" }) {
			int s = call(p.contains("tenants") ? "POST" : "GET", p, null, p.contains("tenants") ? "{\"slug\":\"evil\",\"name\":\"x\"}" : null).statusCode();
			assertTrue(s >= 400, p + " -> " + s);
		}
		assertEquals(401, call("POST", "/api/platform/tenants", new String[] { "X-API-Key", service }, "{\"slug\":\"evil\",\"name\":\"x\"}").statusCode());
	}
}
