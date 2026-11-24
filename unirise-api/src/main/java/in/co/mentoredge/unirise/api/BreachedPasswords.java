package in.co.mentoredge.unirise.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Refuses a new password that appears in known data breaches (2026-11-24), using the free "Have I Been Pwned"
 * range API with k-anonymity: only the first 5 characters of the password's SHA-1 leave the server, never the password,
 * and responses are padded so their size reveals nothing. If the service cannot be reached the check is skipped
 * (the password rules still apply), so an outage never stops anyone setting a password.
 */
@Component
public class BreachedPasswords {
	private static final Logger log = LoggerFactory.getLogger(BreachedPasswords.class);
	static final String MESSAGE = "This password has appeared in a known data breach, so it is unsafe. Choose a different one.";
	private final Function<String, String> range;

	@org.springframework.beans.factory.annotation.Autowired
	public BreachedPasswords(@Value("${app.security.breached-passwords-url:https://api.pwnedpasswords.com/range/}") String url) {
		HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
		this.range = url.isBlank() ? (p) -> "" : (prefix) -> {
			try {
				var res = http.send(HttpRequest.newBuilder(URI.create(url + prefix)).timeout(Duration.ofSeconds(3)).header("Add-Padding", "true")
					.header("User-Agent", "UniRise-password-check").GET().build(), HttpResponse.BodyHandlers.ofString());
				return res.statusCode() == 200 ? res.body() : null;
			} catch (Exception e) {
				return null;
			}
		};
	}

	/** For tests: a stand-in for the range API. */
	BreachedPasswords(Function<String, String> range) { this.range = range; }

	/** The message to show when the password is breached, otherwise null (also when the check could not run). */
	public String problem(String password) {
		if (password == null || password.isEmpty()) return null;
		String sha;
		try { sha = HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance("SHA-1").digest(password.getBytes(StandardCharsets.UTF_8))); }
		catch (Exception e) { return null; }
		String body = range.apply(sha.substring(0, 5));
		if (body == null) { log.warn("Breached-password check skipped: the service could not be reached"); return null; }
		String suffix = sha.substring(5);
		for (String line : body.split("\\r?\\n")) {
			int c = line.indexOf(':');
			if (c > 0 && line.substring(0, c).trim().toUpperCase(Locale.ROOT).equals(suffix)) {
				int n;
				try { n = Integer.parseInt(line.substring(c + 1).trim()); } catch (NumberFormatException e) { n = 1; }
				if (n > 0) return MESSAGE; // padding lines have a count of 0
			}
		}
		return null;
	}
}
