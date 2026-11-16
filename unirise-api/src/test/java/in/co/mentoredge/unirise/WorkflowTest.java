package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Draft, submit and review for publications, grants and seed money under the three roles (BACKEND_PLAN G1): faculty
 * enter their own work, only the Office of Research reviews, Top-Level Management reads approved work only. Needs Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false" })
class WorkflowTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static Caller service, office, ravi, sita, hari, mgmt;
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
	TestApi api;

	synchronized void setup() throws Exception {
		api = new TestApi(port);
		if (service != null) return;
		assertEquals(401, api.call("POST", "/api/platform/tenants", null, null).statusCode());
		var inst = api.provision("delta", "office@delta.example");
		service = TestApi.key(inst);
		office = api.signIn(inst.officeEmail(), inst.officePassword());
		long d1 = api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Chemistry\"}");
		rRavi = api.create("/api/researchers", office, "{\"name\":\"Ravi\",\"employeeId\":\"EMP1\"}");
		rSita = api.create("/api/researchers", office, "{\"name\":\"Sita\",\"employeeId\":\"EMP2\"}");
		rHari = api.create("/api/researchers", office, "{\"name\":\"Hari\",\"employeeId\":\"EMP3\"}");
		for (long r : new long[] { rRavi, rSita, rHari }) api.create("/api/appointments", office, "{\"researcherId\":" + r + ",\"orgUnitId\":" + d1 + "}");
		ravi = api.faculty(office, "Ravi", "ravi@delta.example", "EMP1", "Physics");
		sita = api.faculty(office, "Sita", "sita@delta.example", "EMP2", "Physics");
		hari = api.faculty(office, "Hari", "hari@delta.example", "EMP3", "Physics");
		mgmt = api.management(office, "Dean", "dean@delta.example");
	}

	static final String PUB = "{\"title\":\"A study\",\"doi\":\"10.1000/xyz1\",\"venue\":\"J\",\"type\":\"journal-article\",\"year\":2025,"
		+ "\"authors\":[{\"researcherId\":%d,\"kind\":\"internal-faculty\",\"name\":\"Ravi\"},{\"kind\":\"external\",\"name\":\"Ext Author\",\"institution\":\"MIT\"}]}";

	@Test
	void publicationLifecycleWithVisibilityAndReviewRules() throws Exception {
		setup();
		var created = api.call("POST", "/api/publications", ravi, PUB.formatted(rRavi));
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(409, api.call("POST", "/api/publications", ravi, PUB.formatted(rRavi)).statusCode());               // duplicate DOI
		assertEquals(400, api.call("POST", "/api/publications", ravi, PUB.formatted(rRavi).replace("10.1000/xyz1", "bad")).statusCode());
		assertEquals(404, api.call("GET", "/api/publications/" + id, sita, null).statusCode());                          // a colleague with no link cannot see it
		assertEquals(404, api.call("GET", "/api/publications/" + id, mgmt, null).statusCode());                          // management: not approved yet
		assertEquals(200, api.call("GET", "/api/publications/" + id, office, null).statusCode());                        // the Office sees every status

		assertEquals(409, api.call("POST", "/api/publications/" + id + "/review", office, "{\"action\":\"approve\"}").statusCode()); // not submitted yet
		assertEquals(200, api.call("POST", "/api/publications/" + id + "/submit", ravi, null).statusCode());
		assertEquals(409, api.call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"")).statusCode()); // locked while submitted
		assertEquals(403, api.call("POST", "/api/publications/" + id + "/review", ravi, "{\"action\":\"approve\"}").statusCode()); // faculty do not review
		assertEquals(403, api.call("POST", "/api/publications/" + id + "/review", mgmt, "{\"action\":\"approve\"}").statusCode()); // only the Office reviews
		assertEquals(400, api.call("POST", "/api/publications/" + id + "/review", office, "{\"action\":\"rework\"}").statusCode());   // comment required
		assertEquals(200, api.call("POST", "/api/publications/" + id + "/review", office, "{\"action\":\"rework\",\"comment\":\"add DOI\"}").statusCode());

		var edit = api.call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"").replace("A study", "A better study"));
		assertEquals(200, edit.statusCode(), edit.body());
		assertEquals(409, api.call("PUT", "/api/publications/" + id, ravi, PUB.formatted(rRavi).replace("\"year\"", "\"version\":0,\"year\"")).statusCode()); // stale version
		assertEquals(200, api.call("POST", "/api/publications/" + id + "/submit", ravi, null).statusCode());
		assertEquals("approved", field(api.call("POST", "/api/publications/" + id + "/review", office, "{\"action\":\"approve\"}").body(), "entryStatus"));

		assertTrue(api.call("GET", "/api/publications", mgmt, null).body().contains("A better study"));               // approved: management sees it now
		assertEquals(200, api.call("GET", "/api/publications/" + id, mgmt, null).statusCode());
	}

	@Test
	void onlyTheOfficeReviewsAndNobodyReviewsTheirOwnWork() throws Exception {
		setup();
		String id = field(api.call("POST", "/api/publications", hari, PUB.formatted(rHari).replace("10.1000/xyz1", "10.1000/hari1")).body(), "id");
		assertEquals(200, api.call("POST", "/api/publications/" + id + "/submit", hari, null).statusCode());
		assertEquals(403, api.call("POST", "/api/publications/" + id + "/review", hari, "{\"action\":\"approve\"}").statusCode()); // own work
		assertEquals(403, api.call("POST", "/api/publications/" + id + "/review", sita, "{\"action\":\"approve\"}").statusCode()); // only the Office reviews
		assertEquals(200, api.call("POST", "/api/publications/" + id + "/review", office, "{\"action\":\"approve\"}").statusCode());
		// a co-author sees the paper but cannot approve it
		String co = PUB.formatted(rRavi).replace("10.1000/xyz1", "10.1000/coauth1").replace("{\"kind\":\"external\"", "{\"researcherId\":" + rHari + ",\"kind\":\"internal-faculty\",\"name\":\"Hari\"},{\"kind\":\"external\"");
		String id2 = field(api.call("POST", "/api/publications", ravi, co).body(), "id");
		assertEquals(200, api.call("POST", "/api/publications/" + id2 + "/submit", ravi, null).statusCode());
		assertEquals(200, api.call("GET", "/api/publications/" + id2, hari, null).statusCode());
		assertEquals(403, api.call("POST", "/api/publications/" + id2 + "/review", hari, "{\"action\":\"approve\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/publications/" + id2 + "/review", service, "{\"action\":\"approve\"}").statusCode()); // the service key acts for the Office
	}

	@Test
	void managementIsReadOnlyAndSeesApprovedWorkOnly() throws Exception {
		setup();
		assertEquals(403, api.call("POST", "/api/publications", mgmt, PUB.formatted(rRavi).replace("10.1000/xyz1", "10.1000/mgmt1")).statusCode());
		assertEquals(403, api.call("PUT", "/api/seed-money/window", mgmt, "{}").statusCode());
		assertEquals(403, api.call("POST", "/api/org-units", mgmt, "{\"type\":\"department\",\"name\":\"X\"}").statusCode());
		String draft = field(api.call("POST", "/api/publications", ravi, PUB.formatted(rRavi).replace("10.1000/xyz1", "10.1000/draft1").replace("A study", "Draft only")).body(), "id");
		assertFalse(api.call("GET", "/api/publications", mgmt, null).body().contains("Draft only"));
		assertFalse(api.call("GET", "/api/publications?status=draft", mgmt, null).body().contains("Draft only"));
		assertTrue(api.call("GET", "/api/publications", office, null).body().contains("Draft only"));
		assertEquals(404, api.call("GET", "/api/publications/" + draft, mgmt, null).statusCode());
	}

	@Test
	void grantSubmitRulesAndSanction() throws Exception {
		setup();
		String twoLeads = "{\"title\":\"G\",\"agency\":\"DST\",\"appliedAmount\":1000,\"investigators\":[{\"name\":\"A\",\"role\":\"PI\",\"isLead\":true,\"sharePct\":50},{\"name\":\"B\",\"role\":\"Co-PI\",\"isLead\":true,\"sharePct\":50}]}";
		String badShares = twoLeads.replace("\"isLead\":true,\"sharePct\":50}]", "\"isLead\":false,\"sharePct\":40}]");
		String good = twoLeads.replace("\"Co-PI\",\"isLead\":true", "\"Co-PI\",\"isLead\":false");
		for (var c : new String[][] { { twoLeads, "lead" }, { badShares, "shares" } }) {
			String id = field(api.call("POST", "/api/grants", ravi, c[0]).body(), "id");
			assertEquals(400, api.call("POST", "/api/grants/" + id + "/submit", ravi, null).statusCode(), c[1]);
		}
		var created = api.call("POST", "/api/grants", ravi, good);
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(200, api.call("POST", "/api/grants/" + id + "/submit", ravi, null).statusCode());
		assertEquals(404, api.call("GET", "/api/grants/" + id, mgmt, null).statusCode());
		var rv = api.call("POST", "/api/grants/" + id + "/review", office, "{\"action\":\"approve\",\"sanctionedAmount\":900}");
		assertEquals("sanctioned", field(rv.body(), "status"));
		assertTrue(api.call("GET", "/api/grants/" + id, ravi, null).body().contains("900"));
		assertEquals(200, api.call("GET", "/api/grants/" + id, mgmt, null).statusCode());
		assertEquals(404, api.call("GET", "/api/grants/" + id, sita, null).statusCode());
	}

	@Test
	void seedMoneyIsOnlyOpenInsideTheWindow() throws Exception {
		setup();
		String proposal = "{\"title\":\"Seed idea\",\"category\":\"Minor\",\"investigators\":[{\"name\":\"Ravi\",\"investigatorType\":\"Faculty\",\"isLeadPI\":true}]}";
		assertEquals(404, api.call("GET", "/api/seed-money/window", ravi, null).statusCode());
		assertEquals(409, api.call("POST", "/api/seed-money", ravi, proposal).statusCode());                       // no window at all
		assertEquals(403, api.call("PUT", "/api/seed-money/window", ravi, "{}").statusCode());                      // faculty cannot open it
		LocalDate today = LocalDate.now();
		assertEquals(200, api.call("PUT", "/api/seed-money/window", office, "{\"label\":\"Past\",\"opensOn\":\"" + today.minusDays(30) + "\",\"closesOn\":\"" + today.minusDays(10) + "\"}").statusCode());
		assertEquals(409, api.call("POST", "/api/seed-money", ravi, proposal).statusCode());                       // window over
		assertEquals(200, api.call("PUT", "/api/seed-money/window", office, "{\"label\":\"Q\",\"opensOn\":\"" + today.minusDays(1) + "\",\"closesOn\":\"" + today.plusDays(5) + "\"}").statusCode());
		var created = api.call("POST", "/api/seed-money", ravi, proposal);
		assertEquals(201, created.statusCode(), created.body());
		String id = field(created.body(), "id");
		assertEquals(200, api.call("POST", "/api/seed-money/" + id + "/submit", ravi, null).statusCode());
		assertEquals("approved", field(api.call("POST", "/api/seed-money/" + id + "/review", office, "{\"action\":\"approve\"}").body(), "status"));
		assertEquals(400, api.call("POST", "/api/seed-money/" + field(api.call("POST", "/api/seed-money", ravi, proposal.replace("\"isLeadPI\":true", "\"isLeadPI\":false")).body(), "id") + "/submit", ravi, null).statusCode());
	}
}
