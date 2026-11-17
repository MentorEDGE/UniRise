package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * A1b record files: upload links only for faculty and the Office, only PDF/JPEG/PNG up to 10 MB, keys inside the
 * caller's institution, and download links only for files on records the caller can see. Links are signed locally
 * with dummy credentials, so no AWS account is used.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
	properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false", "app.uploads.bucket=unirise-test-uploads" })
class UploadsTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient NO_REDIRECT = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

	@DynamicPropertySource
	static void props(DynamicPropertyRegistry r) {
		System.setProperty("aws.region", "ap-south-1");
		System.setProperty("aws.accessKeyId", "AKIATESTONLY0000000");
		System.setProperty("aws.secretAccessKey", "test-only-secret");
		PG.start();
		r.add("app.control.url", PG::getJdbcUrl);
		r.add("app.control.user", PG::getUsername);
		r.add("app.control.password", PG::getPassword);
		r.add("app.tenants.host", PG::getHost);
		r.add("app.tenants.port", () -> PG.getMappedPort(5432));
	}

	@Value("${local.server.port}") int port;

	String upload(TestApi api, Caller c, String name, String type, long size, int expected) throws Exception {
		var r = api.call("POST", "/api/uploads", c, "{\"name\":\"" + name + "\",\"type\":\"" + type + "\",\"size\":" + size + "}");
		assertEquals(expected, r.statusCode(), r.body());
		return r.body();
	}

	HttpResponse<String> download(Caller c, String key) throws Exception {
		var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/uploads/file?key=" + java.net.URLEncoder.encode(key, "UTF-8"))).GET();
		if (c.cookie() != null) b.header("Cookie", c.cookie());
		return NO_REDIRECT.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	@Test
	void filesGoToTheBucketAndOnlyTheRightPeopleGetThemBack() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("upl", "office@upl.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Asha Rao", "asha@upl.example", "UPL001", "Physics");
		Caller other = api.faculty(office, "Ravi Iyer", "ravi@upl.example", "UPL002", "Physics");
		Caller mgmt = api.management(office, "Director", "director@upl.example");

		// Upload links: faculty and Office only; PDF, JPEG, PNG; at most 10 MB; the name cannot climb out of its folder.
		String body = upload(api, fac, "../../evil paper.pdf", "application/pdf", 2048, 200);
		String key = TestApi.field(body, "key");
		assertTrue(key.matches("^upl/[0-9]+/[0-9a-f-]{36}/evil paper\\.pdf$"), key);
		assertTrue(TestApi.field(body, "url").contains("unirise-test-uploads") && TestApi.field(body, "url").contains("X-Amz-Signature"), body);
		upload(api, fac, "x.exe", "application/x-msdownload", 10, 400);
		upload(api, fac, "big.pdf", "application/pdf", 11L * 1024 * 1024, 400);
		upload(api, mgmt, "m.pdf", "application/pdf", 10, 403);

		// The file is attached to a draft publication.
		String rec = "{\"record\":{\"entryType\":\"Journal Article\",\"title\":\"Uploads\",\"venue\":\"J\",\"year\":2024,\"pdfName\":\"evil paper.pdf\","
			+ "\"authors\":[{\"kind\":\"Faculty\",\"code\":\"UPL001\",\"name\":\"Asha Rao\"}],"
			+ "\"attachments\":[{\"field\":\"pdfName\",\"key\":\"" + key + "\",\"name\":\"evil paper.pdf\",\"size\":2048}]},\"submit\":false}";
		var saved = api.call("POST", "/api/records/publications", fac, rec);
		assertEquals(200, saved.statusCode(), saved.body());
		// A key from another institution is refused.
		var foreign = api.call("POST", "/api/records/publications", fac, rec.replace("\"key\":\"upl/", "\"key\":\"abc/"));
		assertEquals(400, foreign.statusCode(), foreign.body());

		// Downloads: the owner and the Office get a short-lived link; a colleague and management (draft) do not.
		var mine = download(fac, key);
		assertEquals(302, mine.statusCode());
		String loc = mine.headers().firstValue("Location").orElseThrow();
		assertTrue(loc.contains("unirise-test-uploads") && loc.contains("X-Amz-Expires=300") && loc.contains("response-content-disposition"), loc);
		assertEquals(302, download(office, key).statusCode());
		assertEquals(404, download(other, key).statusCode());
		assertEquals(404, download(mgmt, key).statusCode());
		assertEquals(404, download(fac, key.replace("evil", "other")).statusCode()); // not attached to anything
		assertEquals(401, download(Caller.NOBODY, key).statusCode());
	}
}
