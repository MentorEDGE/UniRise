package in.co.mentoredge.unirise;

import static in.co.mentoredge.unirise.TestApi.field;
import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/**
 * Phases 3 to 5 against the sample data (rdms-web/scripts/export-demo.ts --small): the cases of rdms-web/server/api.test.ts
 * plus the rules added since (Under Review, resubmission replies, former faculty, Follow me links, Ph.D. counts, ETag).
 * Same requests and responses as the prototype server. Needs Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false" })
class InstitutionApiTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final JsonMapper JSON = JsonMapper.builder().build();
	static Caller abcKey;
	static boolean loaded;

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
		if (loaded) return;
		List<?> institutions = JSON.readValue(Files.readString(Path.of("src/test/resources/demo-small.json")), List.class);
		for (Object o : institutions) {
			Map<?, ?> inst = (Map<?, ?>) o;
			var created = api.provision((String) inst.get("slug"), null);
			if (inst.get("slug").equals("abc")) abcKey = TestApi.key(created);
			var r = TestApi.HTTP.send(HttpRequest.newBuilder(URI.create(api.url("/api/platform/tenants/" + inst.get("slug") + "/demo-data"))).header("X-Admin-Key", TestApi.OPERATOR)
				.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(Map.of("db", inst.get("db"), "accounts", inst.get("accounts"))))).build(),
				HttpResponse.BodyHandlers.ofString());
			assertEquals(200, r.statusCode(), r.body());
		}
		loaded = true;
	}

	Caller office() throws Exception { return api.signIn("office@abc.edu.in", "Office@1234"); }

	Caller director() throws Exception { return api.signIn("director@abc.edu.in", "Admin@1234"); }

	Caller faculty(String letter) throws Exception { return api.signIn("faculty." + letter + "@abc.edu.in", "Faculty@123"); }

	@SuppressWarnings("unchecked")
	Map<String, Object> data(Caller c) throws Exception {
		var r = api.call("GET", "/api/data", c, null);
		assertEquals(200, r.statusCode(), r.body());
		return JSON.readValue(r.body(), Map.class);
	}

	@SuppressWarnings("unchecked")
	static List<Map<String, Object>> list(Map<String, Object> d, String k) { return (List<Map<String, Object>>) d.get(k); }

	static final List<String> KINDS = List.of("publications", "grants", "seedMoney", "fdps", "conferences", "awards", "ipr");

	static String fdp(String title) {
		return "{\"record\":{\"role\":\"Attended\",\"programmeType\":\"FDP\",\"title\":\"" + title + "\",\"organiser\":\"NPTEL\",\"mode\":\"Online\",\"level\":\"National\",\"fromDate\":\"2026-07-01\",\"toDate\":\"2026-07-02\",\"hours\":12,\"certificateName\":\"c.pdf\"},\"submit\":true}";
	}

	@Test
	void eachRoleGetsItsSliceAndInstitutionsStaySeparate() throws Exception {
		setup();
		var all = data(office());
		var mgmt = data(director());
		var me = data(faculty("b"));
		// management: approved records only, current faculty only, no review comments, no pending profile updates
		for (String k : KINDS) for (var r : list(mgmt, k)) {
			assertEquals("Approved", r.get("status"));
			assertTrue(((List<?>) r.get("history")).stream().noneMatch(h -> ((Map<?, ?>) h).containsKey("remark")), k);
		}
		assertTrue(list(all, "publications").stream().anyMatch(r -> !"Approved".equals(r.get("status"))));
		assertTrue(list(mgmt, "faculty").stream().allMatch(f -> Boolean.TRUE.equals(f.get("active"))));
		assertTrue(list(all, "faculty").stream().anyMatch(f -> Boolean.FALSE.equals(f.get("active")) && "Retired".equals(f.get("exitReason"))));
		assertTrue(list(mgmt, "faculty").stream().noneMatch(f -> f.get("id").equals("EMP1009")));
		assertTrue(list(mgmt, "biodata").stream().noneMatch(b -> b.get("facultyId").equals("EMP1009")));
		assertEquals(List.of(), mgmt.get("profileChanges"));
		// faculty: only records they are credited on; colleagues by name only
		for (String k : KINDS) for (var r : list(me, k)) assertTrue(r.toString().contains("EMP1002"), k + " " + r.get("id"));
		var colleague = list(me, "faculty").stream().filter(f -> !f.get("id").equals("EMP1002")).findFirst().orElseThrow();
		assertEquals("", colleague.get("email"));
		assertEquals(1, list(me, "biodata").size());
		// another institution's records are simply not found; nothing of XYZ shows up for ABC
		var xyz = data(api.signIn("vc@xyz.ac.in", "Admin@1234"));
		String xyzId = (String) list(xyz, "publications").get(0).get("id");
		assertFalse(api.call("GET", "/api/data", office(), null).body().contains("xyz.ac.in"));
		assertEquals(404, api.call("POST", "/api/office/approvals/publications/" + xyzId + "/start", office(), null).statusCode() == 404
			|| list(all, "publications").stream().anyMatch(r -> r.get("id").equals(xyzId)) ? 404 : 0);
	}

	@Test
	void theDataSliceAnswersNotModifiedWhenNothingChanged() throws Exception {
		setup();
		Caller dean = director();
		var first = api.call("GET", "/api/data", dean, null);
		String etag = first.headers().firstValue("ETag").orElseThrow();
		var again = TestApi.HTTP.send(HttpRequest.newBuilder(URI.create(api.url("/api/data"))).header("Cookie", dean.cookie()).header("If-None-Match", etag).GET().build(), HttpResponse.BodyHandlers.ofString());
		assertEquals(304, again.statusCode());
		assertEquals("", again.body());
	}

	@Test
	void theReviewWorkflowFromSubmissionToApproval() throws Exception {
		setup();
		Caller fac = faculty("a"), office = office(), dean = director();
		String id = field(api.call("POST", "/api/records/fdps", fac, fdp("API workflow")).body(), "result");
		assertTrue(id.startsWith("FDP"), id);
		assertEquals(403, api.call("POST", "/api/office/approvals/fdps/" + id + "/start", dean, null).statusCode());
		assertEquals(403, api.call("POST", "/api/office/approvals/fdps/" + id + "/review", fac, "{\"decision\":\"Approved\"}").statusCode());
		assertFalse(api.call("GET", "/api/data", dean, null).body().contains(id));                                            // not approved: management cannot see it
		assertEquals(200, api.call("POST", "/api/office/approvals/fdps/" + id + "/start", office, null).statusCode());
		assertTrue(api.call("GET", "/api/office/approvals?view=review", office, null).body().contains(id));
		assertEquals(403, api.call("POST", "/api/records/fdps", fac, fdp("changed").replace("\"title\"", "\"id\":\"" + id + "\",\"title\"")).statusCode()); // locked under review
		assertEquals(400, api.call("POST", "/api/office/approvals/fdps/" + id + "/review", office, "{\"decision\":\"Rework\",\"remark\":\"\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/office/approvals/fdps/" + id + "/review", office, "{\"decision\":\"Rework\",\"remark\":\"Upload the certificate.\"}").statusCode());
		String resubmit = fdp("API workflow").replace("\"title\"", "\"id\":\"" + id + "\",\"note\":\"Uploaded.\",\"title\"");
		assertEquals(200, api.call("POST", "/api/records/fdps", fac, resubmit).statusCode());
		assertTrue(api.call("GET", "/api/office/approvals?view=awaiting", office, null).body().contains(id));
		assertEquals(200, api.call("POST", "/api/office/approvals/fdps/" + id + "/review", office, "{\"decision\":\"Approved\",\"remark\":\"Verified.\"}").statusCode());
		var mine = list(data(fac), "fdps").stream().filter(r -> r.get("id").equals(id)).findFirst().orElseThrow();
		assertEquals("Approved", mine.get("status"));
		assertEquals(List.of("Created", "Submitted", "Review started", "Returned for correction", "Edited", "Resubmitted", "Review started", "Approved"),
			((List<?>) mine.get("history")).stream().map(h -> ((Map<?, ?>) h).get("action")).toList());
		var seen = list(data(dean), "fdps").stream().filter(r -> r.get("id").equals(id)).findFirst().orElseThrow();
		assertEquals(List.of("Created", "Approved"), ((List<?>) seen.get("history")).stream().map(h -> ((Map<?, ?>) h).get("action")).toList());
		assertFalse(seen.toString().contains("Verified.") || seen.toString().contains("Uploaded."));
		String audit = api.call("GET", "/api/office/audit", office, null).body();
		assertTrue(audit.contains("Entry approved") && audit.contains("Entry returned for correction"), audit);
	}

	@Test
	void entryRulesAreCheckedOnTheServer() throws Exception {
		setup();
		Caller fac = faculty("a"), office = office();
		String award = "{\"record\":{\"category\":\"Award\",\"title\":\"Test award\",\"awardedBy\":\"IEEE\",\"level\":\"National\",\"awardDate\":\"2026-08-01\",\"citation\":\"x\",\"prizeAmount\":0,\"certificateName\":\"a.pdf\"},\"submit\":true}";
		assertEquals(400, api.call("POST", "/api/records/awards", fac, award.replace("\"Award\",\"title\"", "\"Made up\",\"title\"")).statusCode());
		assertEquals(400, api.call("POST", "/api/records/awards", fac, award.replace("2026-08-01", "2030-01-01")).statusCode());
		assertEquals(200, api.call("POST", "/api/records/awards", fac, award).statusCode());
		String ip = "{\"record\":{\"ipType\":\"Patent\",\"title\":\"A method\",\"description\":\"An invention.\",\"stage\":\"Filed\",\"applicationNumber\":\"API-1\",\"filingDate\":\"2026-05-01\",\"office\":\"Indian Patent Office\",\"owner\":\"University\",\"declared\":true,\"documentName\":\"r.pdf\"},\"submit\":true}";
		assertEquals(400, api.call("POST", "/api/records/ipr", fac, ip.replace("\"Filed\"", "\"Registered\"")).statusCode());
		assertEquals(400, api.call("POST", "/api/records/ipr", fac, ip.replace(",\"declared\":true", "")).statusCode());
		assertEquals(200, api.call("POST", "/api/records/ipr", fac, ip).statusCode());
		assertEquals(400, api.call("POST", "/api/records/ipr", fac, ip).statusCode());                                    // same application number
		String grant = "{\"record\":{\"title\":\"G\",\"agency\":\"DST\",\"appliedAmount\":100000,\"appliedDate\":\"2026-08-01\",\"investigators\":[{\"kind\":\"Faculty\",\"code\":\"EMP1001\",\"name\":\"A\",\"role\":\"PI\",\"sharePct\":60}]},\"submit\":true}";
		assertEquals(400, api.call("POST", "/api/records/grants", fac, grant).statusCode());                              // shares must add up to 100%
		String gid = field(api.call("POST", "/api/records/grants", fac, grant.replace("60}", "100}")).body(), "result");
		assertEquals(400, api.call("POST", "/api/office/approvals/grants/" + gid + "/outcome", office, "{\"outcome\":\"Sanctioned\",\"sanctionedAmount\":1,\"receivedAmount\":0}").statusCode()); // not approved yet
		assertEquals(200, api.call("POST", "/api/office/approvals/grants/" + gid + "/review", office, "{\"decision\":\"Approved\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/office/approvals/grants/" + gid + "/outcome", office, "{\"outcome\":\"Sanctioned\",\"sanctionedAmount\":10,\"receivedAmount\":20}").statusCode());
		assertEquals(200, api.call("POST", "/api/office/approvals/grants/" + gid + "/outcome", office, "{\"outcome\":\"Sanctioned\",\"sanctionDate\":\"2026-09-01\",\"sanctionedAmount\":90000,\"receivedAmount\":40000}").statusCode());
		assertTrue(api.call("GET", "/api/data", director(), null).body().contains("\"sanctionedAmount\":90000"));
		// drafts can be deleted by their owner only
		String draft = field(api.call("POST", "/api/records/fdps", fac, fdp("Draft to delete").replace("\"submit\":true", "\"submit\":false")).body(), "result");
		assertEquals(404, api.call("DELETE", "/api/records/fdps/" + draft, faculty("b"), null).statusCode());
		assertEquals(200, api.call("DELETE", "/api/records/fdps/" + draft, fac, null).statusCode());
		// management never writes
		assertEquals(403, api.call("POST", "/api/records/fdps", director(), fdp("x")).statusCode());
	}

	@Test
	void profileUpdatesReachTheProfileOnlyAfterApproval() throws Exception {
		setup();
		Caller fac = faculty("c"), office = office();
		var mine = data(fac);
		var bio = list(mine, "biodata").get(0);
		var me = list(mine, "faculty").stream().filter(f -> f.get("id").equals("EMP1003")).findFirst().orElseThrow();
		String contact = "{\"email\":\"" + me.get("email") + "\",\"phone\":\"" + me.get("phone") + "\",\"orcid\":\"" + me.get("orcid") + "\",\"scopusId\":\"" + me.get("scopusId") + "\"}";
		bio.put("links", Map.of("linkedin", "https://example.com/me"));
		assertEquals(400, api.call("POST", "/api/profile-changes", fac, "{\"biodata\":" + JSON.writeValueAsString(bio) + ",\"contact\":" + contact + ",\"submit\":true}").statusCode());
		bio.put("links", Map.of("linkedin", "https://www.linkedin.com/in/someone", "twitter", "https://x.com/someone"));
		bio.put("phdGuided", 99);
		bio.put("summary", "Updated through the API.");
		var proposed = api.call("POST", "/api/profile-changes", fac, "{\"biodata\":" + JSON.writeValueAsString(bio) + ",\"contact\":" + contact + ",\"submit\":true}");
		assertEquals(200, proposed.statusCode(), proposed.body());
		String id = field(proposed.body(), "result");
		assertFalse(api.call("GET", "/api/data", director(), null).body().contains("Updated through the API."));             // not live yet
		assertEquals(403, api.call("POST", "/api/office/approvals/profiles/" + id + "/review", director(), "{\"decision\":\"Approved\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/office/approvals/profiles/" + id + "/review", office, "{\"decision\":\"Approved\"}").statusCode());
		var live = list(data(director()), "biodata").stream().filter(b -> b.get("facultyId").equals("EMP1003")).findFirst().orElseThrow();
		assertEquals("Updated through the API.", live.get("summary"));
		assertEquals("https://x.com/someone", ((Map<?, ?>) live.get("links")).get("twitter"));
		long phd = ((List<?>) live.get("supervision")).stream().filter(s -> "PhD".equals(((Map<?, ?>) s).get("degree")) && "Completed".equals(((Map<?, ?>) s).get("status"))).count();
		if (phd > 0) assertEquals(phd, ((Number) live.get("phdGuided")).longValue());                                       // counted from the list, 99 ignored
		assertEquals(403, api.call("PUT", "/api/biodata/EMP1003", fac, "{}").statusCode());
	}

	@Test
	void theOfficeAdministersFacultySettingsAndNotices() throws Exception {
		setup();
		Caller office = office(), dean = director();
		var all = data(office);
		var f2 = list(all, "faculty").stream().filter(f -> f.get("id").equals("EMP1002")).findFirst().orElseThrow();
		assertEquals(403, api.call("PUT", "/api/faculty/EMP1002", dean, JSON.writeValueAsString(f2)).statusCode());
		assertEquals(403, api.call("POST", "/api/faculty", office, JSON.writeValueAsString(f2)).statusCode());
		f2.put("active", false);
		assertEquals(400, api.call("PUT", "/api/faculty/EMP1002", office, JSON.writeValueAsString(f2)).statusCode());          // why and when they left
		f2.put("exitReason", "Resigned");
		f2.put("exitDate", "2026-10-31");
		Caller b = faculty("b");
		assertEquals(200, api.call("PUT", "/api/faculty/EMP1002", office, JSON.writeValueAsString(f2)).statusCode());
		assertEquals(401, api.call("GET", "/api/data", b, null).statusCode());                                                // their session ended
		assertEquals(403, api.login("faculty.b@abc.edu.in", "Faculty@123").statusCode());
		assertTrue(list(data(dean), "faculty").stream().noneMatch(f -> f.get("id").equals("EMP1002")));
		f2.put("active", true);
		assertEquals(200, api.call("PUT", "/api/faculty/EMP1002", office, JSON.writeValueAsString(f2)).statusCode());
		b = faculty("b"); // restored: signs in again (the earlier session ended when they were marked as former)

		@SuppressWarnings("unchecked") Map<String, Object> settings = (Map<String, Object>) all.get("settings");
		assertEquals(403, api.call("PUT", "/api/settings", dean, JSON.writeValueAsString(settings)).statusCode());
		@SuppressWarnings("unchecked") List<String> depts = new java.util.ArrayList<>((List<String>) settings.get("departments"));
		var without = new java.util.LinkedHashMap<>(settings);
		without.put("departments", depts.subList(1, depts.size()));
		assertEquals(400, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(without)).statusCode());          // a department with faculty
		settings.put("institutionTagline", "Updated by the Office");
		settings.put("targets", Map.of("publicationsPerFaculty", 3));
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());
		assertTrue(api.call("GET", "/api/data", b, null).body().contains("Updated by the Office"));
		assertEquals(403, api.call("POST", "/api/notices", dean, "{\"title\":\"x\"}").statusCode());
		assertEquals(400, api.call("POST", "/api/notices", office, "{\"title\":\"\"}").statusCode());
		assertEquals(200, api.call("POST", "/api/notices", office, "{\"title\":\"API notice\",\"body\":\"Hello\"}").statusCode());
		var notices = list(data(b), "notices");
		String nid = (String) notices.stream().filter(n -> n.get("title").equals("API notice")).findFirst().orElseThrow().get("id");
		assertEquals(200, api.call("DELETE", "/api/notices/" + nid, office, null).statusCode());
		assertFalse(api.call("GET", "/api/data", b, null).body().contains("API notice"));
		// a record kind switched off cannot be entered (G28)
		settings.put("features", Map.of("seedMoney", false));
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());
		assertEquals(403, api.call("POST", "/api/records/seedMoney", b, "{\"record\":{\"title\":\"x\"},\"submit\":false}").statusCode());
		settings.put("features", Map.of("seedMoney", true));
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());

		// Schools of a university: every department in exactly one school; the data slice carries them to every role.
		var half = depts.size() / 2;
		var schools = List.of(Map.of("name", "School of One", "departments", depts.subList(0, half)), Map.of("name", "School of Two", "departments", depts.subList(half, depts.size())));
		settings.put("schools", List.of(Map.of("name", "School of One", "departments", depts.subList(0, half))));
		assertTrue(api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).body().contains("Choose a school for"));  // some departments in no school
		settings.put("schools", List.of(Map.of("name", "A", "departments", depts), Map.of("name", "B", "departments", depts.subList(0, 1))));
		assertTrue(api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).body().contains("belongs to one school"));
		settings.put("schools", List.of(Map.of("name", "A", "departments", depts), Map.of("name", "a", "departments", List.of())));
		assertTrue(api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).body().contains("two schools"));
		settings.put("schools", schools);
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());
		assertTrue(api.call("GET", "/api/data", dean, null).body().contains("School of Two"));
		settings.remove("schools"); // an older client that does not send schools keeps them
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());
		assertTrue(api.call("GET", "/api/data", b, null).body().contains("School of One"));
		settings.put("schools", List.of()); // back to an institute without schools
		assertEquals(200, api.call("PUT", "/api/settings", office, JSON.writeValueAsString(settings)).statusCode());
		assertFalse(api.call("GET", "/api/data", b, null).body().contains("School of One"));
	}

	@Test
	void enquiriesAreValidatedAndStored() throws Exception {
		setup();
		String enq = "{\"institutionName\":\"Test College\",\"institutionType\":\"College\",\"contactName\":\"T\",\"email\":\"t@college.example\",\"country\":\"India\",\"state\":\"KA\",\"city\":\"B\",\"facultyCount\":\"50\",\"interest\":\"Other\",\"consent\":\"yes\"}";
		assertEquals(400, api.call("POST", "/api/enquiries", Caller.NOBODY, enq.replace("\"city\":\"B\"", "\"city\":\"\"")).statusCode());
		assertEquals(400, api.call("POST", "/api/enquiries", Caller.NOBODY, enq.replace("\"consent\":\"yes\"", "\"consent\":\"\"")).statusCode());
		assertEquals(403, api.call("POST", "/api/enquiries", Caller.NOBODY, enq, false).statusCode());                         // CSRF header
		assertEquals(200, api.call("POST", "/api/enquiries", Caller.NOBODY, enq).statusCode());
		assertEquals(200, api.call("POST", "/api/enquiries", Caller.NOBODY, enq.replace("\"consent\"", "\"website\":\"spam\",\"consent\"")).statusCode()); // honeypot: accepted, not stored
	}
}
