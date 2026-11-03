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

/** Milestones, confidential meeting logs, reminders and restricted projects. Needs Docker. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.admin-key=test-admin")
class ProgressTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static String service, scholar, mentor, other, hod, dean;
	static long rScholar, rMentor, rOther, rHod;

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

	String login(String email, Long researcher, String role, Long scope) throws Exception {
		var inv = call("POST", "/api/auth/invitations", service, "{\"email\":\"" + email + "\"" + (researcher == null ? "" : ",\"researcherId\":" + researcher) + "}");
		long uid = Long.parseLong(field(inv.body(), "userId"));
		if (role != null) create("/api/role-grants", service, "{\"userId\":" + uid + ",\"role\":\"" + role + "\"" + (scope == null ? "" : ",\"scopeUnitId\":" + scope) + "}");
		return field(call("POST", "/api/auth/redeem", null, "{\"token\":\"" + field(inv.body(), "token") + "\"}").body(), "token");
	}

	synchronized void setup() throws Exception {
		if (service != null) return;
		var rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/platform/tenants")).header("X-Admin-Key", "test-admin").header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString("{\"slug\":\"epsilon\",\"name\":\"Epsilon\"}")).build();
		service = field(HTTP.send(rq, HttpResponse.BodyHandlers.ofString()).body(), "apiKey");
		long univ = create("/api/org-units", service, "{\"type\":\"campus\",\"name\":\"E\"}");
		long dept = create("/api/org-units", service, "{\"parentId\":" + univ + ",\"type\":\"department\",\"name\":\"Physics\"}");
		rScholar = create("/api/researchers", service, "{\"name\":\"Sam Scholar\",\"isScholar\":true}");
		rMentor = create("/api/researchers", service, "{\"name\":\"Maya Mentor\"}");
		rOther = create("/api/researchers", service, "{\"name\":\"Omar Other\"}");
		rHod = create("/api/researchers", service, "{\"name\":\"Hana Head\"}");
		for (long r : new long[] { rScholar, rMentor, rOther, rHod }) create("/api/appointments", service, "{\"researcherId\":" + r + ",\"orgUnitId\":" + dept + "}");
		create("/api/relationships", service, "{\"mentorId\":" + rMentor + ",\"menteeId\":" + rScholar + ",\"type\":\"primary\"}");
		scholar = login("sam@e.example", rScholar, null, null);
		mentor = login("maya@e.example", rMentor, null, null);
		other = login("omar@e.example", rOther, null, null);
		hod = login("hana@e.example", rHod, "HOD", dept);
		dean = login("dean@e.example", null, "DEAN", univ);
	}

	@Test
	void onlyTheSupervisorManagesMilestonesAndTheScholarCannotSelfApprove() throws Exception {
		setup();
		LocalDate in30 = LocalDate.now().plusDays(30);
		String body = "{\"scholarId\":" + rScholar + ",\"stage\":\"Proposal\",\"dueDate\":\"" + in30 + "\"}";
		assertEquals(403, call("POST", "/api/milestones", scholar, body).statusCode());
		assertEquals(404, call("POST", "/api/milestones", other, body).statusCode());          // cannot even see the scholar
		assertEquals(403, call("POST", "/api/milestones", hod, body).statusCode());            // heads see, supervisors manage
		long id = create("/api/milestones", mentor, body);

		assertTrue(call("GET", "/api/milestones?scholarId=" + rScholar, scholar, null).body().contains("upcoming"));
		assertEquals(404, call("GET", "/api/milestones?scholarId=" + rScholar, other, null).statusCode());
		assertEquals(200, call("GET", "/api/milestones?scholarId=" + rScholar, hod, null).statusCode());

		assertEquals(409, call("POST", "/api/milestones/" + id + "/approve", mentor, "{}").statusCode()); // not completed yet
		assertEquals(200, call("POST", "/api/milestones/" + id + "/complete", scholar, null).statusCode());
		assertEquals(403, call("POST", "/api/milestones/" + id + "/approve", scholar, "{}").statusCode());
		assertEquals(200, call("POST", "/api/milestones/" + id + "/approve", mentor, "{\"feedback\":\"Good\"}").statusCode());
		assertTrue(call("GET", "/api/milestones?scholarId=" + rScholar, scholar, null).body().contains("\"status\":\"done\""));
	}

	@Test
	void meetingNotesAreVisibleOnlyToTheScholarAndTheirSupervisors() throws Exception {
		setup();
		String note = "{\"scholarId\":" + rScholar + ",\"heldOn\":\"" + LocalDate.now() + "\",\"notes\":\"Struggling with the literature review\"}";
		assertEquals(404, call("POST", "/api/meeting-logs", service, note).statusCode());      // not even the tenant admin key
		assertEquals(404, call("POST", "/api/meeting-logs", hod, note).statusCode());
		assertEquals(404, call("POST", "/api/meeting-logs", scholar, note).statusCode());
		create("/api/meeting-logs", mentor, note);
		for (String t : new String[] { scholar, mentor }) assertTrue(call("GET", "/api/meeting-logs?scholarId=" + rScholar, t, null).body().contains("literature review"));
		for (String t : new String[] { service, hod, dean, other }) assertEquals(404, call("GET", "/api/meeting-logs?scholarId=" + rScholar, t, null).statusCode());
	}

	@Test
	void remindersEscalateToTheHeadOnlyWhenWellOverdue() throws Exception {
		setup();
		create("/api/milestones", mentor, "{\"scholarId\":" + rScholar + ",\"stage\":\"Coursework\",\"dueDate\":\"" + LocalDate.now().minusDays(45) + "\"}");
		create("/api/milestones", mentor, "{\"scholarId\":" + rScholar + ",\"stage\":\"Seminar\",\"dueDate\":\"" + LocalDate.now().plusDays(5) + "\"}");
		String forScholar = call("GET", "/api/reminders", scholar, null).body();
		assertTrue(forScholar.contains("\"level\":\"escalated\"") && forScholar.contains("\"level\":\"soon\""), forScholar);
		assertTrue(forScholar.contains("Hana Head"), "escalated reminder also goes to the HoD");
		String forHod = call("GET", "/api/reminders", hod, null).body();
		assertTrue(forHod.contains("Coursework") && !forHod.contains("Seminar"), forHod);   // the head hears only about the escalated one
		assertEquals("[]", call("GET", "/api/reminders", other, null).body());
		assertEquals(200, call("PUT", "/api/settings", service, "{\"escalationDays\":60}").statusCode());
		assertFalse(call("GET", "/api/reminders", hod, null).body().contains("Coursework"));  // 45 days is now below the escalation threshold
		assertEquals(403, call("PUT", "/api/settings", mentor, "{\"escalationDays\":5}").statusCode());
	}

	@Test
	void confidentialProjectsAreRestrictedToOutsiders() throws Exception {
		setup();
		long secret = create("/api/projects", mentor, "{\"title\":\"Defence work\",\"sensitivity\":\"confidential\",\"summary\":\"NDA\",\"memberIds\":[" + rScholar + "]}");
		long open = create("/api/projects", mentor, "{\"title\":\"Open study\",\"status\":\"active\"}");
		String forMember = call("GET", "/api/projects/" + secret, scholar, null).body();
		assertTrue(forMember.contains("Defence work") && forMember.contains("\"restricted\":false"));
		String forHod = call("GET", "/api/projects/" + secret, hod, null).body();
		assertTrue(forHod.contains("\"restricted\":true") && !forHod.contains("Defence") && !forHod.contains("NDA"), forHod);
		assertFalse(call("GET", "/api/projects", dean, null).body().contains("Defence"));
		assertTrue(call("GET", "/api/projects", hod, null).body().contains("Open study"));
		assertEquals(404, call("GET", "/api/projects/" + secret, other, null).statusCode());  // not in scope: does not exist
		assertEquals(404, call("PUT", "/api/projects/" + open, scholar, "{\"title\":\"Hijack\"}").statusCode()); // scholar is not on the open project and cannot see it
	}
}
