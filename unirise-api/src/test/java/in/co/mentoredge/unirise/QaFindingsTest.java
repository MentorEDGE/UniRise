package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Regression tests for the defects found in the QA audit of 2026-11-20. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false" })
class QaFindingsTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");

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

	@Test
	void draftsArePrivateToTheirAuthorUntilSubmitted() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("qad", "office@qad.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Asha Rao", "asha@qad.example", "QAD001", "Physics");
		String rec = "{\"record\":{\"entryType\":\"Book\",\"title\":\"Private draft\",\"venue\":\"P\",\"year\":2024,\"authors\":[{\"kind\":\"Faculty\",\"code\":\"QAD001\",\"name\":\"Asha Rao\"}]},\"submit\":false}";
		var saved = api.call("POST", "/api/records/publications", fac, rec);
		assertEquals(200, saved.statusCode(), saved.body());
		String id = TestApi.field(saved.body(), "result");
		assertFalse(api.call("GET", "/api/data", office, null).body().contains(id), "the Office does not receive a draft");
		assertTrue(api.call("GET", "/api/data", fac, null).body().contains(id), "the author does");
		assertEquals(200, api.call("POST", "/api/records/publications", fac, rec.replace("\"record\":{", "\"record\":{\"id\":\"" + id + "\",").replace("\"submit\":false", "\"submit\":true")).statusCode());
		assertTrue(api.call("GET", "/api/data", office, null).body().contains(id), "submitted: the Office receives it");
		// A draft profile update is private too.
		var draft = api.call("POST", "/api/profile-changes", fac, "{\"biodata\":{\"summary\":\"Draft summary\"},\"contact\":{\"email\":\"asha@qad.example\"},\"submit\":false}");
		assertEquals(200, draft.statusCode(), draft.body());
		assertFalse(api.call("GET", "/api/data", office, null).body().contains("Draft summary"), "the Office does not receive a draft profile update");
	}

	@Test
	void phoneNumbersAreChecked() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("qap", "office@qap.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Ravi Iyer", "ravi@qap.example", "QAP001", "Physics");
		var bad = api.call("POST", "/api/profile-changes", fac, "{\"biodata\":{\"summary\":\"x\"},\"contact\":{\"email\":\"ravi@qap.example\",\"phone\":\"abc\"},\"submit\":true}");
		assertEquals(400, bad.statusCode(), bad.body());
		assertTrue(bad.body().contains("valid phone number"), bad.body());
		var good = api.call("POST", "/api/profile-changes", fac, "{\"biodata\":{\"summary\":\"x\"},\"contact\":{\"email\":\"ravi@qap.example\",\"phone\":\"+91 98765 43210\"},\"submit\":true}");
		assertEquals(200, good.statusCode(), good.body());
		var office1 = api.call("PUT", "/api/faculty/QAP001", office, "{\"title\":\"Dr.\",\"name\":\"Ravi Iyer\",\"designation\":\"Professor\",\"department\":\"Physics\",\"email\":\"ravi@qap.example\",\"phone\":\"call me\",\"active\":true}");
		assertEquals(400, office1.statusCode(), "the Office's edit of official details checks the phone too: " + office1.body());
	}

	@Test
	void notificationsReachTheRightPeopleAndCanBeMarkedRead() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("qan", "office@qan.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller asha = api.faculty(office, "Asha Rao", "asha@qan.example", "QAN001", "Physics");
		Caller ravi = api.faculty(office, "Ravi Iyer", "ravi@qan.example", "QAN002", "Physics");
		Caller dean = api.management(office, "Dean", "dean@qan.example");
		String rec = "{\"record\":{\"entryType\":\"Book\",\"title\":\"Notified book\",\"venue\":\"P\",\"year\":2024,\"authors\":[{\"kind\":\"Faculty\",\"code\":\"QAN001\",\"name\":\"Asha Rao\"}]},\"submit\":true}";
		String id = TestApi.field(api.call("POST", "/api/records/publications", asha, rec).body(), "result");
		String officeNotes = api.call("GET", "/api/notifications", office, null).body();
		assertTrue(officeNotes.contains("New submission: publication " + id) && officeNotes.contains("\"unread\":1"), officeNotes);
		assertEquals(200, api.call("POST", "/api/office/approvals/publications/" + id + "/review", office, "{\"decision\":\"Rework\",\"remark\":\"Add the ISBN\"}").statusCode());
		String mine = api.call("GET", "/api/notifications", asha, null).body();
		assertTrue(mine.contains("Changes requested: publication " + id) && mine.contains("Add the ISBN") && mine.contains("\"link\":\"/submissions\""), mine);
		assertTrue(api.call("GET", "/api/notifications", ravi, null).body().contains("\"unread\":0"), "a colleague hears nothing");
		assertTrue(api.call("GET", "/api/notifications", dean, null).body().contains("\"unread\":0"));
		// a notice reaches every faculty member
		assertEquals(200, api.call("POST", "/api/notices", office, "{\"title\":\"Library hours\",\"body\":\"Open till 9\"}").statusCode());
		assertTrue(api.call("GET", "/api/notifications", ravi, null).body().contains("Notice: Library hours"));
		// mark one read, then all
		String noteId = TestApi.field(mine, "id");
		var one = api.call("POST", "/api/notifications/read", asha, "{\"ids\":[" + noteId + "]}");
		assertTrue(one.body().contains("\"unread\":1"), one.body()); // the notice is still unread
		var all = api.call("POST", "/api/notifications/read", asha, "{\"all\":true}");
		assertTrue(all.body().contains("\"unread\":0"), all.body());
		// someone else's ids are ignored
		assertTrue(api.call("POST", "/api/notifications/read", ravi, "{\"ids\":[" + noteId + "]}").body().contains("\"unread\":1"));
		assertEquals(401, api.call("GET", "/api/notifications", Caller.NOBODY, null).statusCode());
	}
}
