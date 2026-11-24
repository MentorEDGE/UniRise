package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Pattern;

/**
 * Test helper for the phase 2 sign-in model: provision an institution, create accounts through the Office of Research's
 * user management, and sign people in the way a browser does (session cookie, X-RDMS header on every change).
 */
final class TestApi {
	static final HttpClient HTTP = HttpClient.newHttpClient();
	static final String OPERATOR = "test-admin";
	final int port;

	TestApi(int port) { this.port = port; }

	record Institution(String slug, String apiKey, String officeEmail, String officePassword) {}

	/** A caller: the institution's service key, a signed-in browser session, or nobody. */
	record Caller(String apiKey, String cookie) {
		static final Caller NOBODY = new Caller(null, null);
	}

	Institution provision(String slug, String officeEmail) throws Exception {
		var r = HTTP.send(HttpRequest.newBuilder(URI.create(url("/api/platform/tenants"))).header("X-Admin-Key", OPERATOR).header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString("{\"slug\":\"" + slug + "\",\"name\":\"" + slug.toUpperCase() + " University\"" + (officeEmail == null ? "" : ",\"officeEmail\":\"" + officeEmail + "\"") + "}")).build(),
			HttpResponse.BodyHandlers.ofString());
		assertEquals(201, r.statusCode(), r.body());
		return new Institution(slug, field(r.body(), "apiKey"), officeEmail, officeEmail == null ? null : field(r.body(), "temporaryPassword"));
	}

	HttpResponse<String> call(String method, String path, Caller c, String body) throws Exception {
		return call(method, path, c, body, true);
	}

	/** csrf=false leaves out the X-RDMS header, as a cross-site form would. */
	HttpResponse<String> call(String method, String path, Caller c, String body, boolean csrf) throws Exception {
		var b = HttpRequest.newBuilder(URI.create(url(path)))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).header("Content-Type", "application/json");
		if (c != null && c.apiKey() != null) b.header("X-API-Key", c.apiKey());
		if (c != null && c.cookie() != null) b.header("Cookie", c.cookie());
		if (csrf && (c == null || c.apiKey() == null)) b.header("X-RDMS", "1");
		return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
	}

	/** The service key of an institution. */
	static Caller key(Institution i) { return new Caller(i.apiKey(), null); }

	HttpResponse<String> login(String email, String password) throws Exception {
		return call("POST", "/api/login", Caller.NOBODY, "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}");
	}

	/** Signs in and returns the browser session; fails the test if sign-in fails. */
	Caller signIn(String email, String password) throws Exception {
		var r = login(email, password);
		assertEquals(200, r.statusCode(), r.body());
		return new Caller(null, sessionCookie(r));
	}

	static String sessionCookie(HttpResponse<String> r) {
		String set = r.headers().allValues("Set-Cookie").stream().filter(h -> h.startsWith("unirise_sid=")).findFirst().orElseThrow();
		return set.substring(0, set.indexOf(';'));
	}

	/** The Office of Research (or the service key) creates an account; returns {id, temporaryPassword}. */
	String[] createUser(Caller office, String role, String name, String email, String employeeCode, String department) throws Exception {
		var r = call("POST", "/api/office/users", office, "{\"role\":\"" + role + "\",\"name\":\"" + name + "\",\"email\":\"" + email + "\""
			+ (employeeCode == null ? "" : ",\"employeeCode\":\"" + employeeCode + "\"") + (department == null ? "" : ",\"department\":\"" + department + "\"") + ",\"designation\":\"Professor\"}");
		assertEquals(200, r.statusCode(), r.body());
		return new String[] { field(r.body(), "id"), field(r.body(), "temporaryPassword") };
	}

	/** Creates a faculty account for a researcher (by employee code) and signs them in. */
	Caller faculty(Caller office, String name, String email, String employeeCode, String department) throws Exception {
		return signIn(email, createUser(office, "faculty", name, email, employeeCode, department)[1]);
	}

	Caller management(Caller office, String name, String email) throws Exception {
		return signIn(email, createUser(office, "management", name, email, null, null)[1]);
	}

	long create(String path, Caller c, String body) throws Exception {
		var r = call("POST", path, c, body);
		assertEquals(201, r.statusCode(), path + " " + r.body());
		return Long.parseLong(field(r.body(), "id"));
	}

	String url(String path) { return "http://localhost:" + port + path; }

	static String field(String json, String name) {
		var m = Pattern.compile("\"" + name + "\":\"?([^\",}]+)").matcher(json);
		assertTrue(m.find(), name + " in " + json);
		return m.group(1);
	}
}
