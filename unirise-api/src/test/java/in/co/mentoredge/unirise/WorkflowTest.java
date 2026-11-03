package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Draft, submit, review for publications, grants and seed money, with visibility from the role model. Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.admin-key=test-admin")
class WorkflowTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static String service, ravi, sita, hod, otherHod;
	static long rRavi, rSita, rHari;

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
		if (token != null) b.header(token.length() == 64 && token.equals(service) ? "X-API-Key" : "Authorization", token.equals(service) ? token : "Bearer " + token);
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	static String field(String json, String name) {
		var m = Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find(), json);
		return m.group(1);
	}

	long svcCreate(String path, String body) throws Exception {
		var r = call("POST", path, service, body);
		assertEquals(201, r.statusCode(), path + r.body());
		return Long.parseLong(field(r.body(), "id"));
	}

	String login(String email, Long researcher, String role, Long scope) throws Exception {
		var inv = call("POST", "/api/auth/invitations", service, "{\"email\":\"" + email + "\"" + (researcher == null ? "" : ",\"researcherId\":" + researcher) + "}");
		long uid = Long.parseLong(field(inv.body(), "userId"));
		if (role != null) svcCreate("/api/role-grants", "{\"userId\":" + uid + ",\"role\":\"" + role + "\",\"scopeUnitId\":" + scope + "}");
		return field(call("POST", "/api/auth/redeem", null, "{\"token\":\"" + field(inv.body(), "token") + "\"}").body(), "token");
	}

	synchronized void setup() throws Exception {
		if (service != null) return;
		var r = call("POST", "/api/platform/tenants", null, null);
		assertEquals(401, r.statusCode());
		var rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/platform/tenants")).header("X-Admin-Key", "test-admin").header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString("{\"slug\":\"delta\",\"name\":\"Delta\"}")).build();
		service = field(HTTP.send(rq, HttpResponse.BodyHandlers.ofString()).body(), "apiKey");
		long d1 = svcCreate("/api/org-units", "{\"type\":\"department\",\"name\":\"Physics\"}");
		long d2 = svcCreate("/api/org-units", "{\"type\":\"department\",\"name\":\"Chemistry\"}");
		rRavi = svcCreate("/api/researchers", "{\"name\":\"Ravi\"}");
		rSita = svcCreate("/api/researchers", "{\"name\":\"Sita\"}");
		rHari = svcCreate("/api/researchers", "{\"name\":\"Hari\"}");
		long rOther = svcCreate("/api/researchers", "{\"name\":\"Olga\"}");
		for (long[] p : new long[][] { { rRavi, d1 }, { rSita, d1 }, { rHari, d1 }, { rOther, d2 } }) svcCreate("/api/appointments", "{\"researcherId\":" + p[0] + ",\"orgUnitId\":" + p[1] + "}");
		ravi = login("ravi@d.example", rRavi, null, null);
		sita = login("sita@d.example", rSita, null, null);
		hod = login("hari@d.example", rHari, "HOD", d1);
		otherHod = login("olga@d.example", rOther, "HOD", d2);
	}

	static final String PUB = "{\"title\":\"A study\",\"doi\":\"10.1000/xyz1\",\"venue\":\"J\",\"type\":\"journal-article\",\"year\":2025,"
		+ "\"authors\":[{\"researcherId\":%d,\"kind\":\"internal-faculty\",\"name\":\"Ravi\"},{\"kind\":\"external\",\"name\":\"Ext Author\",\"institution\":\"MIT\"}]}";

	@Test
	void publicationLifecycleWithVisibilityAndReviewRules() throws Exception {
		setup();
		var created = call("POST", "/api/publications", ravi, PUB.formatted(rRavi));
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(409, call("POST", "/api/publications", ravi, PUB.formatted(rRavi)).statusCode());               // duplicate DOI
		assertEquals(400, call("POST", "/api/publications", ravi, PUB.formatted(rRavi).replace("10.1000/xyz1", "bad")).statusCode());
		assertEquals(404, call("GET", "/api/publications/" + id, otherHod, null).statusCode());                      // another department cannot see it
		assertEquals(200, call("GET", "/api/publications/" + id, hod, null).statusCode());                           // own HoD can
		assertEquals(404, call("GET", "/api/publications/" + id, sita, null).statusCode());                          // a colleague with no link cannot

		assertEquals(409, call("POST", "/api/publications/" + id + "/review", hod, "{\"action\":\"approve\"}").statusCode()); // not submitted yet
		assertEquals(200, call("POST", "/api/publications/" + id + "/submit", ravi, null).statusCode());
		assertEquals(409, call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"")).statusCode()); // locked while submitted
		assertEquals(403, call("POST", "/api/publications/" + id + "/review", ravi, "{\"action\":\"approve\"}").statusCode()); // researchers do not review
		assertEquals(404, call("POST", "/api/publications/" + id + "/review", otherHod, "{\"action\":\"approve\"}").statusCode()); // outside scope
		assertEquals(400, call("POST", "/api/publications/" + id + "/review", hod, "{\"action\":\"rework\"}").statusCode());   // comment required
		assertEquals(200, call("POST", "/api/publications/" + id + "/review", hod, "{\"action\":\"rework\",\"comment\":\"add DOI\"}").statusCode());

		var edit = call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"").replace("A study", "A better study"));
		assertEquals(200, edit.statusCode(), edit.body());
		assertEquals(409, call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"")).statusCode()); // stale version
		assertEquals(200, call("POST", "/api/publications/" + id + "/submit", ravi, null).statusCode());
		var ok = call("POST", "/api/publications/" + id + "/review", hod, "{\"action\":\"approve\"}");
		assertEquals("approved", field(ok.body(), "entryStatus"));

		var list = call("GET", "/api/publications?status=approved", hod, null);
		assertTrue(list.body().contains("A better study"), list.body()); // other tests may approve more papers by the same owner
		assertEquals(0, call("GET", "/api/publications?status=approved", otherHod, null).body().split("A better study", -1).length - 1);
	}

	@Test
	void hodCannotReviewTheirOwnEntry() throws Exception {
		setup();
		var created = call("POST", "/api/publications", hod, PUB.formatted(rHari).replace("10.1000/xyz1", "10.1000/hari1"));
		String id = field(created.body(), "id");
		assertEquals(200, call("POST", "/api/publications/" + id + "/submit", hod, null).statusCode());
		assertEquals(403, call("POST", "/api/publications/" + id + "/review", hod, "{\"action\":\"approve\"}").statusCode());
		// owner who is not listed as an author is still the owner
		String noSelf = PUB.formatted(rRavi).replace("10.1000/xyz1", "10.1000/hari2");
		String id2 = field(call("POST", "/api/publications", hod, noSelf).body(), "id");
		assertEquals(200, call("POST", "/api/publications/" + id2 + "/submit", hod, null).statusCode());
		assertEquals(403, call("POST", "/api/publications/" + id2 + "/review", hod, "{\"action\":\"approve\"}").statusCode());
	}

	@Test
	void grantSubmitRulesAndSanction() throws Exception {
		setup();
		String twoLeads = "{\"title\":\"G\",\"agency\":\"DST\",\"appliedAmount\":1000,\"investigators\":[{\"name\":\"A\",\"role\":\"PI\",\"isLead\":true,\"sharePct\":50},{\"name\":\"B\",\"role\":\"Co-PI\",\"isLead\":true,\"sharePct\":50}]}";
		String badShares = twoLeads.replace("\"isLead\":true,\"sharePct\":50}]", "\"isLead\":false,\"sharePct\":40}]").replace("\"sharePct\":50", "\"sharePct\":50");
		String good = twoLeads.replace("\"Co-PI\",\"isLead\":true", "\"Co-PI\",\"isLead\":false");
		for (var c : new String[][] { { twoLeads, "lead" }, { badShares, "shares" } }) {
			String id = field(call("POST", "/api/grants", ravi, c[0]).body(), "id");
			assertEquals(400, call("POST", "/api/grants/" + id + "/submit", ravi, null).statusCode(), c[1]);
		}
		var created = call("POST", "/api/grants", ravi, good);
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(200, call("POST", "/api/grants/" + id + "/submit", ravi, null).statusCode());
		var rv = call("POST", "/api/grants/" + id + "/review", hod, "{\"action\":\"approve\",\"sanctionedAmount\":900}");
		assertEquals("sanctioned", field(rv.body(), "status"));
		assertTrue(call("GET", "/api/grants/" + id, ravi, null).body().contains("900"));
		assertEquals(404, call("GET", "/api/grants/" + id, otherHod, null).statusCode());
	}

	@Test
	void seedMoneyIsOnlyOpenInsideTheWindow() throws Exception {
		setup();
		String proposal = "{\"title\":\"Seed idea\",\"category\":\"Minor\",\"investigators\":[{\"name\":\"Ravi\",\"investigatorType\":\"Faculty\",\"isLeadPI\":true}]}";
		assertEquals(404, call("GET", "/api/seed-money/window", ravi, null).statusCode());
		assertEquals(409, call("POST", "/api/seed-money", ravi, proposal).statusCode());                       // no window at all
		assertEquals(403, call("PUT", "/api/seed-money/window", ravi, "{}").statusCode());                      // researchers cannot open it
		LocalDate today = LocalDate.now();
		assertEquals(200, call("PUT", "/api/seed-money/window", service, "{\"label\":\"Past\",\"opensOn\":\"" + today.minusDays(30) + "\",\"closesOn\":\"" + today.minusDays(10) + "\"}").statusCode());
		assertEquals(409, call("POST", "/api/seed-money", ravi, proposal).statusCode());                       // window over
		assertEquals(200, call("PUT", "/api/seed-money/window", service, "{\"label\":\"Q\",\"opensOn\":\"" + today.minusDays(1) + "\",\"closesOn\":\"" + today.plusDays(5) + "\"}").statusCode());
		var created = call("POST", "/api/seed-money", ravi, proposal);
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(200, call("POST", "/api/seed-money/" + id + "/submit", ravi, null).statusCode());
		assertEquals("approved", field(call("POST", "/api/seed-money/" + id + "/review", hod, "{\"action\":\"approve\"}").body(), "status"));
		assertEquals(400, call("POST", "/api/seed-money/" + field(call("POST", "/api/seed-money", ravi, proposal.replace("\"isLeadPI\":true", "\"isLeadPI\":false")).body(), "id") + "/submit", ravi, null).statusCode());
	}

	@Test
	void seeingSomeoneIsNotEnoughToReviewTheirWork() throws Exception {
		setup();
		// Olga heads Chemistry and mentors Ravi (Physics): she can see his work but has no review authority over Physics.
		// A fresh mentee keeps the other tests' visibility expectations intact.
		long tara = svcCreate("/api/researchers", "{\"name\":\"Tara\"}");
		svcCreate("/api/appointments", "{\"researcherId\":" + tara + ",\"orgUnitId\":" + field(call("GET", "/api/org-units", service, null).body(), "id") + "}");
		String taraToken = login("tara@d.example", tara, null, null);
		svcCreate("/api/relationships", "{\"mentorId\":" + rOtherId() + ",\"menteeId\":" + tara + ",\"type\":\"co\"}");
		String id = field(call("POST", "/api/publications", taraToken, PUB.formatted(tara).replace("10.1000/xyz1", "10.1000/scope1")).body(), "id");
		assertEquals(200, call("POST", "/api/publications/" + id + "/submit", taraToken, null).statusCode());
		assertEquals(200, call("GET", "/api/publications/" + id, otherHod, null).statusCode());
		assertEquals(403, call("POST", "/api/publications/" + id + "/review", otherHod, "{\"action\":\"approve\"}").statusCode());

		// Hari heads Physics but is a co-author, so he cannot approve this paper either.
		String co = PUB.formatted(rRavi).replace("10.1000/xyz1", "10.1000/coauth1").replace("{\"kind\":\"external\"", "{\"researcherId\":" + rHari + ",\"kind\":\"internal-faculty\",\"name\":\"Hari\"},{\"kind\":\"external\"");
		String id2 = field(call("POST", "/api/publications", ravi, co).body(), "id");
		assertEquals(200, call("POST", "/api/publications/" + id2 + "/submit", ravi, null).statusCode());
		assertEquals(403, call("POST", "/api/publications/" + id2 + "/review", hod, "{\"action\":\"approve\"}").statusCode());
		assertEquals(200, call("POST", "/api/publications/" + id2 + "/review", service, "{\"action\":\"approve\"}").statusCode()); // an admin can
	}

	long rOtherId() throws Exception {
		return Long.parseLong(field(call("GET", "/api/me", otherHod, null).body(), "researcherId"));
	}
}
