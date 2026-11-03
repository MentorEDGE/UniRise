package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Report catalogue, CSV export, researcher lookup and period snapshots. Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.admin-key=test-admin")
class ReportTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static String service, tokA, tokB, tokX;
	static long rA, rB, rX, campus, d1;

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

	HttpResponse<String> call(String method, String path, String token, String body) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).header("Content-Type", "application/json");
		if (token != null) {
			if (token.equals(service)) b.header("X-API-Key", token); else b.header("Authorization", "Bearer " + token);
		}
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	static String field(String json, String name) {
		var m = Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find(), json);
		return m.group(1);
	}

	long create(String path, String token, String body) throws Exception {
		var r = call("POST", path, token, body);
		assertEquals(201, r.statusCode(), path + " " + r.body());
		return Long.parseLong(field(r.body(), "id"));
	}

	String login(String email, long researcher) throws Exception {
		var inv = call("POST", "/api/auth/invitations", service, "{\"email\":\"" + email + "\",\"researcherId\":" + researcher + "}");
		return field(call("POST", "/api/auth/redeem", null, "{\"token\":\"" + field(inv.body(), "token") + "\"}").body(), "token");
	}

	String paper(String owner, long ownerId, String doi, int year, String venue, String extraAuthors) throws Exception {
		String body = "{\"title\":\"P " + doi + "\",\"doi\":\"" + doi + "\",\"venue\":\"" + venue + "\",\"type\":\"journal-article\",\"year\":" + year + ",\"authors\":[{\"researcherId\":" + ownerId
			+ ",\"kind\":\"internal-faculty\",\"name\":\"Own\"}" + extraAuthors + "]}";
		String id = String.valueOf(create("/api/publications", owner, body));
		assertEquals(200, call("POST", "/api/publications/" + id + "/submit", owner, null).statusCode());
		assertEquals(200, call("POST", "/api/publications/" + id + "/review", service, "{\"action\":\"approve\"}").statusCode());
		return id;
	}

	synchronized void setup() throws Exception {
		if (service != null) return;
		var rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/platform/tenants")).header("X-Admin-Key", "test-admin").header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString("{\"slug\":\"zeta\",\"name\":\"Zeta\"}")).build();
		service = field(HTTP.send(rq, HttpResponse.BodyHandlers.ofString()).body(), "apiKey");
		campus = create("/api/org-units", service, "{\"type\":\"campus\",\"name\":\"Zeta Campus\"}");
		d1 = create("/api/org-units", service, "{\"parentId\":" + campus + ",\"type\":\"department\",\"name\":\"Physics\"}");
		long d2 = create("/api/org-units", service, "{\"parentId\":" + campus + ",\"type\":\"department\",\"name\":\"Chemistry\"}");
		rA = create("/api/researchers", service, "{\"name\":\"Asha\",\"employeeId\":\"E1\",\"orcid\":\"0000-0001\",\"scopusId\":\"S1\"}");
		rB = create("/api/researchers", service, "{\"name\":\"Bala\",\"employeeId\":\"E2\"}");
		rX = create("/api/researchers", service, "{\"name\":\"Xena\",\"employeeId\":\"E3\"}");
		create("/api/appointments", service, "{\"researcherId\":" + rA + ",\"orgUnitId\":" + d1 + ",\"validFrom\":\"2020-01-01\"}");
		create("/api/appointments", service, "{\"researcherId\":" + rB + ",\"orgUnitId\":" + d1 + ",\"validFrom\":\"2020-01-01\"}");
		create("/api/appointments", service, "{\"researcherId\":" + rX + ",\"orgUnitId\":" + d2 + ",\"validFrom\":\"2020-01-01\"}");
		tokA = login("a@z.example", rA);
		tokB = login("b@z.example", rB);
		tokX = login("x@z.example", rX);
		paper(tokA, rA, "10.1000/p1", 2024, "J1", ",{\"kind\":\"external\",\"name\":\"Ext\",\"institution\":\"MIT\",\"continent\":\"North America\"}");
		paper(tokB, rB, "10.1000/p2", 2025, "J1", ",{\"researcherId\":" + rA + ",\"kind\":\"internal-faculty\",\"name\":\"Asha\"}");
		paper(tokX, rX, "10.1000/p3", 2025, "=SUM(1)", "");
		// a grant by Asha: 1000 applied, 800 sanctioned; a second one left as a draft must not count
		String g = "{\"title\":\"G1\",\"type\":\"Research\",\"agency\":\"DST\",\"appliedAmount\":1000,\"appliedOn\":\"2025-03-01\",\"investigators\":[{\"researcherId\":" + rA
			+ ",\"name\":\"Asha\",\"role\":\"PI\",\"isLead\":true,\"sharePct\":100}]}";
		long gid = create("/api/grants", tokA, g);
		assertEquals(200, call("POST", "/api/grants/" + gid + "/submit", tokA, null).statusCode());
		assertEquals(200, call("POST", "/api/grants/" + gid + "/review", service, "{\"action\":\"approve\",\"sanctionedAmount\":800,\"sanctionedOn\":\"2025-06-01\"}").statusCode());
		create("/api/grants", tokA, g.replace("G1", "Draft only"));
	}

	@Test
	void publicationReportsCountOnlyApprovedWorkOncePerGroup() throws Exception {
		setup();
		String byYear = call("GET", "/api/reports/pub-university", service, null).body();
		assertTrue(byYear.contains("[2024,1]") && (byYear.contains("[2025,2]") || byYear.contains("[2025,3]")), byYear);
		String dept = call("GET", "/api/reports/pub-institute-department", service, null).body();
		assertTrue(dept.contains("[\"Zeta Campus\",\"Chemistry\",1]") && (dept.contains("[\"Zeta Campus\",\"Physics\",2]") || dept.contains("[\"Zeta Campus\",\"Physics\",3]")), dept); // p2 has two Physics authors but counts once
		assertTrue(call("GET", "/api/reports/pub-employee-count", service, null).body().contains("[\"E1\",\"Asha\",2]"));
		assertTrue(call("GET", "/api/reports/pub-inter-institution", service, null).body().contains("[\"MIT\",1]"));
		assertTrue(call("GET", "/api/reports/pub-continent", service, null).body().contains("[\"North America\",1]"));
		assertTrue(call("GET", "/api/reports/pub-university?from=2025-01-01&to=2025-12-31", service, null).body().contains("[2025,"));
		assertFalse(call("GET", "/api/reports/pub-university?from=2025-01-01", service, null).body().contains("2024"));
	}

	@Test
	void reportsOnlyCoverTheCallersOwnSlice() throws Exception {
		setup();
		String forB = call("GET", "/api/reports/pub-university", tokB, null).body();
		assertTrue((forB.contains("[2025,1]") || forB.contains("[2025,2]")) && !forB.contains("2024"), forB); // Bala sees her own paper only (Asha is a co-author of p2, not of p1)
		assertEquals("[]", call("GET", "/api/reports/pub-journal", tokX, null).body().contains("J1") ? "J1 leaked" : "[]"); // Xena sees none of the Physics papers
	}

	@Test
	void personReportsDoNotNameCoAuthorsOutsideTheCallersSlice() throws Exception {
		setup();
		String forB = call("GET", "/api/reports/pub-employee", tokB, null).body();
		assertTrue(forB.contains("E2") && !forB.contains("E1") && !forB.contains("Asha"), forB);   // p2 is co-authored by Asha, who Bala cannot see
		assertFalse(call("GET", "/api/reports/grant-employee", tokB, null).body().contains("E1"));
		// a user with only an IT_ADMIN grant has no research scope at all
		var inv = call("POST", "/api/auth/invitations", service, "{\"email\":\"it@z.example\"}");
		create("/api/role-grants", service, "{\"userId\":" + field(inv.body(), "userId") + ",\"role\":\"IT_ADMIN\"}");
		String it = field(call("POST", "/api/auth/redeem", null, "{\"token\":\"" + field(inv.body(), "token") + "\"}").body(), "token");
		assertEquals("[]", call("GET", "/api/org-units", it, null).body());
		assertEquals("[]", call("GET", "/api/researchers", it, null).body());
	}

	@Test
	void grantReportsUseTheChosenDateBasisAndIgnoreDrafts() throws Exception {
		setup();
		String byType = call("GET", "/api/reports/grant-type", service, null).body();
		assertTrue(byType.contains("[\"Research\",1,1000.00,800.00]"), byType);
		assertTrue(call("GET", "/api/reports/grant-year-received", service, null).body().contains("[2025,800.00]"));
		assertTrue(call("GET", "/api/reports/grant-type?basis=sanctioned&from=2025-05-01&to=2025-07-01", service, null).body().contains("Research"));
		assertFalse(call("GET", "/api/reports/grant-type?basis=sanctioned&from=2026-01-01", service, null).body().contains("Research"));
		assertEquals(400, call("GET", "/api/reports/grant-type?basis=bogus", service, null).statusCode());
		assertEquals(404, call("GET", "/api/reports/no-such-report", service, null).statusCode());
		assertTrue(call("GET", "/api/reports/grant-sharing", service, null).body().contains("[\"G1\",\"Asha\",\"PI\",100.00]"));
	}

	@Test
	void csvExportNeutralisesSpreadsheetFormulas() throws Exception {
		setup();
		var r = call("GET", "/api/reports/pub-journal/export?format=csv", service, null);
		assertEquals(200, r.statusCode());
		assertTrue(r.headers().firstValue("Content-Disposition").orElse("").contains("pub-journal.csv"));
		assertTrue(r.body().contains("\"'=SUM(1)\""), r.body());
		assertEquals(400, call("GET", "/api/reports/pub-journal/export?format=pdf", service, null).statusCode());
	}

	@Test
	void lookupFindsPeopleOnlyInsideTheCallersSlice() throws Exception {
		setup();
		var ok = call("GET", "/api/researchers/lookup?kind=employee&value=E1", service, null);
		assertEquals(200, ok.statusCode());
		assertTrue(ok.body().contains("Zeta Campus") && ok.body().contains("Physics") && ok.body().contains("\"grants\":1"), ok.body());
		assertEquals(200, call("GET", "/api/researchers/lookup?kind=orcid&value=0000-0001", service, null).statusCode());
		assertEquals(200, call("GET", "/api/researchers/lookup?kind=scopus&value=S1", service, null).statusCode());
		assertEquals(404, call("GET", "/api/researchers/lookup?kind=employee&value=E1", tokX, null).statusCode());   // another department's researcher
		assertEquals(404, call("GET", "/api/researchers/lookup?kind=employee&value=NOPE", service, null).statusCode());
		assertEquals(400, call("GET", "/api/researchers/lookup?kind=ssn&value=1", service, null).statusCode());
	}

	@Test
	void closingAPeriodFreezesTheNumbers() throws Exception {
		setup();
		long id = create("/api/periods", service, "{\"label\":\"2025\",\"startsOn\":\"2025-01-01\",\"endsOn\":\"2025-12-31\"}");
		assertEquals(404, call("GET", "/api/periods/" + id + "/snapshot", service, null).statusCode());   // not closed yet
		assertEquals(403, call("POST", "/api/periods/" + id + "/close", tokA, null).statusCode());
		assertEquals(200, call("POST", "/api/periods/" + id + "/close", service, null).statusCode());
		assertEquals(409, call("POST", "/api/periods/" + id + "/close", service, null).statusCode());
		String before = call("GET", "/api/periods/" + id + "/snapshot", service, null).body();
		assertTrue(before.contains("\"unitId\":" + campus + ",\"metric\":\"publications\",\"value\":2"), before);
		paper(tokB, rB, "10.1000/late", 2025, "J9", "");   // approved after the close
		assertEquals(before, call("GET", "/api/periods/" + id + "/snapshot", service, null).body());
		String own = call("GET", "/api/periods/" + id + "/snapshot", tokA, null).body();
		assertTrue(own.contains("\"unitId\":" + d1) && !own.contains("\"unitId\":" + campus + ","), own);   // sees only her own unit
	}
}
