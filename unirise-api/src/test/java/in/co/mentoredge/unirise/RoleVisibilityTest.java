package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Who sees which people under the three roles (BACKEND_PLAN G1, ACCESS_AND_VISIBILITY_MODEL.md). Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false" })
class RoleVisibilityTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static Caller service, office, ravi, chitra, dean;
	static long r1, r2, r4, d1, d2;

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

	@BeforeAll
	static void clear() { in.co.mentoredge.unirise.tenancy.TenantContext.clear(); }

	TreeSet<Long> visible(Caller c) throws Exception {
		var r = api.call("GET", "/api/researchers", c, null);
		assertEquals(200, r.statusCode());
		var out = new TreeSet<Long>();
		var m = Pattern.compile("\"id\":(\\d+)").matcher(r.body());
		while (m.find()) out.add(Long.parseLong(m.group(1)));
		return out;
	}

	synchronized void setup() throws Exception {
		api = new TestApi(port);
		if (service != null) return;
		var inst = api.provision("gamma", "office@gamma.example");
		service = TestApi.key(inst);
		office = api.signIn(inst.officeEmail(), inst.officePassword());
		long univ = api.create("/api/org-units", office, "{\"type\":\"campus\",\"name\":\"Gamma\"}");
		long school = api.create("/api/org-units", office, "{\"parentId\":" + univ + ",\"type\":\"school\",\"name\":\"Sciences\"}");
		d1 = api.create("/api/org-units", office, "{\"parentId\":" + school + ",\"type\":\"department\",\"name\":\"Physics\"}");
		d2 = api.create("/api/org-units", office, "{\"parentId\":" + school + ",\"type\":\"department\",\"name\":\"Chemistry\"}");
		r1 = api.create("/api/researchers", office, "{\"name\":\"Ravi\",\"employeeId\":\"GAM1\"}");
		r2 = api.create("/api/researchers", office, "{\"name\":\"Sita\",\"employeeId\":\"GAM2\"}");
		r4 = api.create("/api/researchers", office, "{\"name\":\"Chitra\",\"employeeId\":\"GAM4\"}");
		api.create("/api/appointments", office, "{\"researcherId\":" + r1 + ",\"orgUnitId\":" + d1 + "}");
		api.create("/api/appointments", office, "{\"researcherId\":" + r2 + ",\"orgUnitId\":" + d1 + "}");
		api.create("/api/appointments", office, "{\"researcherId\":" + r4 + ",\"orgUnitId\":" + d2 + "}");
		ravi = api.faculty(office, "Ravi", "ravi@gamma.example", "GAM1", "Physics");
		chitra = api.faculty(office, "Chitra", "chitra@gamma.example", "GAM4", "Chemistry");
		dean = api.management(office, "Dean", "dean@gamma.example");
	}

	@Test
	void eachRoleSeesOnlyItsSlice() throws Exception {
		setup();
		assertEquals(new TreeSet<>(List.of(r1)), visible(ravi));                      // faculty: themselves
		assertEquals(new TreeSet<>(List.of(r4)), visible(chitra));
		assertEquals(new TreeSet<>(List.of(r1, r2, r4)), visible(dean));              // management: the whole institution
		assertEquals(new TreeSet<>(List.of(r1, r2, r4)), visible(office));            // the Office of Research: everyone
	}

	@Test
	void anInvisiblePersonLooksLikeAMissingOne() throws Exception {
		setup();
		assertEquals(404, api.call("GET", "/api/researchers/" + r2, ravi, null).statusCode());
		assertEquals(404, api.call("GET", "/api/researchers/" + r1, chitra, null).statusCode());
		assertEquals(404, api.call("GET", "/api/researchers/999999", ravi, null).statusCode());
		assertEquals(200, api.call("GET", "/api/researchers/" + r1, ravi, null).statusCode());
		assertEquals(200, api.call("GET", "/api/researchers/" + r1, dean, null).statusCode());
	}

	@Test
	void onlyTheOfficeChangesStructure() throws Exception {
		setup();
		for (Caller c : new Caller[] { ravi, dean }) {
			assertEquals(403, api.call("POST", "/api/researchers", c, "{\"name\":\"x\"}").statusCode());
			assertEquals(403, api.call("POST", "/api/org-units", c, "{\"type\":\"group\",\"name\":\"x\"}").statusCode());
			assertEquals(403, api.call("POST", "/api/appointments", c, "{\"researcherId\":" + r1 + ",\"orgUnitId\":" + d2 + "}").statusCode());
			assertEquals(403, api.call("POST", "/api/office/users", c, "{\"role\":\"management\",\"name\":\"x\",\"email\":\"x@gamma.example\"}").statusCode());
		}
	}

	@Test
	void facultySeeOnlyTheirOwnUnitInTheTree() throws Exception {
		setup();
		assertEquals(1, api.call("GET", "/api/org-units", ravi, null).body().split("\"id\"", -1).length - 1);
		assertEquals(4, api.call("GET", "/api/org-units", dean, null).body().split("\"id\"", -1).length - 1);   // management: the whole tree
		assertEquals(4, api.call("GET", "/api/org-units", office, null).body().split("\"id\"", -1).length - 1);
	}

	@Test
	void unusualPathsDoNotSkipAuthentication() throws Exception {
		setup();
		for (String p : new String[] { "//api/researchers", "/api/./researchers", "/api/platform/../researchers", "/x/..;/api/researchers", "/api/researchers;a=b", "/api/%72esearchers", "//api/platform/tenants",
			"/api/login/../researchers", "/api/logout;/../researchers" }) {
			int s = api.call(p.contains("tenants") ? "POST" : "GET", p, Caller.NOBODY, p.contains("tenants") ? "{\"slug\":\"evil\",\"name\":\"x\"}" : null).statusCode();
			assertTrue(s >= 400, p + " -> " + s);
		}
		assertEquals(401, api.call("POST", "/api/platform/tenants", service, "{\"slug\":\"evil\",\"name\":\"x\"}").statusCode());
		assertEquals(401, api.call("GET", "/api/researchers", new Caller(null, "unirise_sid=" + "0".repeat(64)), null).statusCode());
	}
}
