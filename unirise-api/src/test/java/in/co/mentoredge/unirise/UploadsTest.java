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
	properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false", "app.uploads.bucket=unirise-test-uploads", "app.uploads.malware-scan=true",
		"spring.main.allow-bean-definition-overriding=true" }) // the stand-in below replaces the real S3 client
class UploadsTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final HttpClient NO_REDIRECT = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
	/** The virus-scan tag of each object, as GuardDuty would set it (A9). */
	static final java.util.Map<String, String> SCAN = new java.util.concurrent.ConcurrentHashMap<>();
	/** Keys deleted from the bucket (files no entry uses any more). */
	static final java.util.Set<String> DELETED = java.util.concurrent.ConcurrentHashMap.newKeySet();
	/** What the bucket listing returns (key → last modified), for the abandoned-upload sweep. */
	static final java.util.Map<String, java.time.Instant> LISTING = new java.util.concurrent.ConcurrentHashMap<>();

	@org.springframework.boot.test.context.TestConfiguration
	static class FakeS3 {
		@org.springframework.context.annotation.Bean
		software.amazon.awssdk.services.s3.S3Client s3Client() {
			return new software.amazon.awssdk.services.s3.S3Client() {
				@Override public String serviceName() { return "s3"; }
				@Override public void close() {}
				@Override public software.amazon.awssdk.services.s3.model.ListObjectsV2Response listObjectsV2(software.amazon.awssdk.services.s3.model.ListObjectsV2Request r) {
					var objects = LISTING.entrySet().stream().map((e) -> software.amazon.awssdk.services.s3.model.S3Object.builder().key(e.getKey()).lastModified(e.getValue()).size(100L).build()).toList();
					return software.amazon.awssdk.services.s3.model.ListObjectsV2Response.builder().contents(objects).isTruncated(false).build();
				}
				@Override public software.amazon.awssdk.services.s3.model.DeleteObjectResponse deleteObject(software.amazon.awssdk.services.s3.model.DeleteObjectRequest r) {
					DELETED.add(r.key());
					return software.amazon.awssdk.services.s3.model.DeleteObjectResponse.builder().build();
				}
				@Override public software.amazon.awssdk.services.s3.model.GetObjectTaggingResponse getObjectTagging(software.amazon.awssdk.services.s3.model.GetObjectTaggingRequest r) {
					var tags = SCAN.containsKey(r.key()) ? java.util.List.of(software.amazon.awssdk.services.s3.model.Tag.builder().key("GuardDutyMalwareScanStatus").value(SCAN.get(r.key())).build()) : java.util.List.<software.amazon.awssdk.services.s3.model.Tag>of();
					return software.amazon.awssdk.services.s3.model.GetObjectTaggingResponse.builder().tagSet(tags).build();
				}
			};
		}
	}

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
	@org.springframework.beans.factory.annotation.Autowired in.co.mentoredge.unirise.api.UploadCleanup cleanup;

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
		String rec = "{\"record\":{\"entryType\":\"Journal Article\",\"title\":\"Uploads\",\"venue\":\"J\",\"year\":2024,\"doi\":\"10.5555/uploads\",\"pdfName\":\"evil paper.pdf\","
			+"\"authors\":[{\"kind\":\"Faculty\",\"code\":\"UPL001\",\"name\":\"Asha Rao\"}],"
			+ "\"attachments\":[{\"field\":\"pdfName\",\"key\":\"" + key + "\",\"name\":\"evil paper.pdf\",\"size\":2048}]},\"submit\":false}";
		var saved = api.call("POST", "/api/records/publications", fac, rec);
		assertEquals(200, saved.statusCode(), saved.body());
		// A key from another institution is refused.
		var foreign = api.call("POST", "/api/records/publications", fac, rec.replace("\"key\":\"upl/", "\"key\":\"abc/"));
		assertEquals(400, foreign.statusCode(), foreign.body());

		// A9: not scanned yet, or flagged, means no link even for the owner.
		var waiting = download(fac, key);
		assertEquals(409, waiting.statusCode());
		assertTrue(waiting.body().contains("still being checked for viruses"), waiting.body());
		SCAN.put(key, "THREATS_FOUND");
		var flagged = download(fac, key);
		assertEquals(403, flagged.statusCode());
		assertTrue(flagged.body().contains("flagged this file as unsafe") && flagged.headers().firstValue("Content-Type").orElse("").startsWith("text/html"), flagged.body());
		SCAN.put(key, "NO_THREATS_FOUND");
		// Downloads of a draft's file: the owner only. The Office of Research gets it once the entry is submitted (a draft
		// is private to its author, QA finding 2026-11-20); a colleague and management never (not approved).
		var mine = download(fac, key);
		assertEquals(302, mine.statusCode());
		String loc = mine.headers().firstValue("Location").orElseThrow();
		assertTrue(loc.contains("unirise-test-uploads") && loc.contains("X-Amz-Expires=300") && loc.contains("response-content-disposition"), loc);
		assertEquals(404, download(office, key).statusCode(), "the Office does not see drafts");
		String id = TestApi.field(saved.body(), "result");
		var submitted = api.call("POST", "/api/records/publications", fac, rec.replace("\"record\":{", "\"record\":{\"id\":\"" + id + "\",").replace("\"submit\":false", "\"submit\":true"));
		assertEquals(200, submitted.statusCode(), submitted.body());
		assertEquals(302, download(office, key).statusCode(), "submitted: the Office can review the file");
		assertEquals(404, download(other, key).statusCode());
		assertEquals(404, download(mgmt, key).statusCode());
		assertEquals(404, download(fac, key.replace("evil", "other")).statusCode()); // not attached to anything
		assertEquals(401, download(Caller.NOBODY, key).statusCode());
	}

	@Test
	void filesNoEntryUsesAnyMoreAreRemovedFromTheBucket() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("upc", "office@upc.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Meena Das", "meena@upc.example", "UPC001", "Physics");
		String a = TestApi.field(upload(api, fac, "first.pdf", "application/pdf", 100, 200), "key");
		String b = TestApi.field(upload(api, fac, "second.pdf", "application/pdf", 100, 200), "key");
		java.util.function.BiFunction<String, String, String> fdp = (id, key) -> "{\"record\":{" + (id == null ? "" : "\"id\":\"" + id + "\",") + "\"role\":\"Attended\",\"programmeType\":\"FDP\",\"title\":\"Files\",\"organiser\":\"O\","
			+ "\"fromDate\":\"2026-01-01\",\"toDate\":\"2026-01-02\",\"hours\":8,\"certificateName\":\"c.pdf\",\"attachments\":[{\"field\":\"certificateName\",\"key\":\"" + key + "\",\"name\":\"c.pdf\",\"size\":100}]},\"submit\":false}";
		var first = api.call("POST", "/api/records/fdps", fac, fdp.apply(null, a));
		assertEquals(200, first.statusCode(), first.body());
		String id = TestApi.field(first.body(), "result");
		// A second entry using the same file keeps it alive when the first lets it go.
		var twin = api.call("POST", "/api/records/fdps", fac, fdp.apply(null, a));
		assertEquals(200, twin.statusCode(), twin.body());
		assertEquals(200, api.call("POST", "/api/records/fdps", fac, fdp.apply(id, b)).statusCode());
		assertFalse(DELETED.contains(a), "still attached to the other entry");
		assertEquals(200, api.call("DELETE", "/api/records/fdps/" + TestApi.field(twin.body(), "result"), fac, null).statusCode());
		assertTrue(DELETED.contains(a), "replaced and no longer used: removed from the bucket");
		assertFalse(DELETED.contains(b));
		assertEquals(200, api.call("DELETE", "/api/records/fdps/" + id, fac, null).statusCode());
		assertTrue(DELETED.contains(b), "a deleted draft's file is removed");
	}

	@Test
	void officeDocumentsAndImagesUploadProgramsAndWebPagesDoNot() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("upt", "office@upt.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Lata Menon", "lata@upt.example", "UPT001", "Physics");
		for (String[] ok : new String[][] { { "budget.xlsx", "spreadsheetml" }, { "proposal.docx", "wordprocessingml" }, { "talk.pptx", "presentationml" }, { "notes.txt", "text/plain" }, { "data.csv", "text/csv" }, { "scan.jpeg", "image/jpeg" }, { "bundle.zip", "application/zip" } }) {
			String body = upload(api, fac, ok[0], "", 100, 200); // the browser's own type is not trusted; the extension decides
			assertTrue(body.contains(ok[1]), ok[0] + " → " + body);
		}
		for (String bad : new String[] { "x.exe", "page.html", "image.svg", "script.js", "noextension", "macro.docm" }) upload(api, fac, bad, "application/pdf", 100, 400);
		// A Word file downloads; a PDF opens in the tab.
		String doc = TestApi.field(upload(api, fac, "report.docx", "", 100, 200), "key");
		String rec = "{\"record\":{\"role\":\"Attended\",\"programmeType\":\"FDP\",\"title\":\"Docs\",\"organiser\":\"O\",\"fromDate\":\"2026-01-01\",\"toDate\":\"2026-01-02\",\"hours\":8,"
			+ "\"certificateName\":\"report.docx\",\"attachments\":[{\"field\":\"certificateName\",\"key\":\"" + doc + "\",\"name\":\"report.docx\",\"size\":100}]},\"submit\":false}";
		assertEquals(200, api.call("POST", "/api/records/fdps", fac, rec).statusCode());
		SCAN.put(doc, "NO_THREATS_FOUND");
		String loc = download(fac, doc).headers().firstValue("Location").orElseThrow();
		assertTrue(java.net.URLDecoder.decode(loc, "UTF-8").contains("attachment; filename=\"report.docx\""), loc);
		// A name with non-Latin letters: a plain fallback plus the exact name encoded as UTF-8 (it used to fail to download).
		String ru = TestApi.field(upload(api, fac, "спец & (1).pdf", "", 100, 200), "key");
		String rec2 = "{\"record\":{\"role\":\"Attended\",\"programmeType\":\"FDP\",\"title\":\"Names\",\"organiser\":\"O\",\"fromDate\":\"2026-01-01\",\"toDate\":\"2026-01-02\",\"hours\":8,"
			+ "\"certificateName\":\"спец & (1).pdf\",\"attachments\":[{\"field\":\"certificateName\",\"key\":\"" + ru + "\",\"name\":\"спец & (1).pdf\",\"size\":100}]},\"submit\":false}";
		assertEquals(200, api.call("POST", "/api/records/fdps", fac, rec2).statusCode());
		SCAN.put(ru, "NO_THREATS_FOUND");
		String header = java.net.URLDecoder.decode(download(fac, ru).headers().firstValue("Location").orElseThrow(), "UTF-8");
		assertTrue(header.contains("inline; filename=\"____ & (1).pdf\"; filename*=UTF-8''%D1%81%D0%BF%D0%B5%D1%86%20%26%20%281%29.pdf"), header);
	}

	@Test
	void abandonedUploadsAreSweptAfterADay() throws Exception {
		TestApi api = new TestApi(port);
		var inst = api.provision("ups", "office@ups.example");
		Caller office = api.signIn(inst.officeEmail(), inst.officePassword());
		api.create("/api/org-units", office, "{\"type\":\"department\",\"name\":\"Physics\"}");
		Caller fac = api.faculty(office, "Hari Nair", "hari@ups.example", "UPS001", "Physics");
		String used = TestApi.field(upload(api, fac, "kept.pdf", "", 100, 200), "key");
		String abandoned = TestApi.field(upload(api, fac, "left.pdf", "", 100, 200), "key");
		String fresh = TestApi.field(upload(api, fac, "now.pdf", "", 100, 200), "key");
		String rec = "{\"record\":{\"role\":\"Attended\",\"programmeType\":\"FDP\",\"title\":\"Kept\",\"organiser\":\"O\",\"fromDate\":\"2026-01-01\",\"toDate\":\"2026-01-02\",\"hours\":8,"
			+ "\"certificateName\":\"kept.pdf\",\"attachments\":[{\"field\":\"certificateName\",\"key\":\"" + used + "\",\"name\":\"kept.pdf\",\"size\":100}]},\"submit\":false}";
		assertEquals(200, api.call("POST", "/api/records/fdps", fac, rec).statusCode());
		var old = java.time.Instant.now().minus(java.time.Duration.ofHours(30));
		LISTING.clear();
		LISTING.put(used, old); LISTING.put(abandoned, old); LISTING.put(fresh, java.time.Instant.now().minus(java.time.Duration.ofHours(2)));
		LISTING.put("malware-protection-resource-validation-object", old); // not an upload: never touched
		DELETED.clear();
		assertEquals(1, cleanup.sweep());
		assertEquals(java.util.Set.of(abandoned), java.util.Set.copyOf(DELETED), "only the day-old file no entry uses");
	}
}
