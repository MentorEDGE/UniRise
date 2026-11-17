package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * Record files (BACKEND_PLAN A1b, G25): PDFs, certificates and documents go straight from the browser to the private
 * uploads bucket with a short-lived link; the API never handles the bytes.
 *
 * <ul>
 * <li>{@code POST /api/uploads} {name, type, size}: faculty and the Office of Research; PDF, JPEG or PNG up to 10 MB.
 * Answers {key, url, headers}: the browser PUTs the file to url, then saves the record with the key in attachments.</li>
 * <li>{@code GET /api/uploads/file?key=}: only when the key is attached to a record in the caller's own data (the same
 * rules as GET /api/data, so management sees files of approved records of current faculty only). Redirects to a link
 * that works for 5 minutes.</li>
 * </ul>
 * With no bucket configured (local runs) both answer 404 and the UI keeps file names only, as before.
 */
@RestController
@RequestMapping("/api/uploads")
public class UploadController {
	public record NewUpload(String name, String type, Long size) {}

	static final Set<String> TYPES = Set.of("application/pdf", "image/jpeg", "image/png");
	private static final List<String> KINDS = List.of("publications", "grants", "seedMoney", "fdps", "conferences", "awards", "ipr");
	private final AccessService access;
	private final DataSlice slice;
	private final AppProperties props;
	private final S3Presigner presigner;
	private final software.amazon.awssdk.services.s3.S3Client s3;

	public UploadController(AccessService access, DataSlice slice, AppProperties props, java.util.Optional<S3Presigner> presigner, java.util.Optional<software.amazon.awssdk.services.s3.S3Client> s3) {
		this.access = access;
		this.slice = slice;
		this.props = props;
		this.presigner = presigner.orElse(null);
		this.s3 = s3.orElse(null);
	}

	private boolean off() { return props.uploads().bucket().isEmpty() || presigner == null; }

	@PostMapping
	ResponseEntity<?> create(@RequestBody(required = false) NewUpload body, HttpServletRequest req) {
		if (off()) return AuthController.error(HttpStatus.NOT_FOUND, "File uploads are not available here.");
		Actor a = access.actor(req);
		if (a.isManagement() || a.userId() == null) return AuthController.error(HttpStatus.FORBIDDEN, "Only faculty and the Office of Research upload files.");
		if (body == null || body.type() == null || !TYPES.contains(body.type())) return AuthController.error(HttpStatus.BAD_REQUEST, "Upload a PDF, JPEG or PNG file.");
		long size = body.size() == null ? 0 : body.size();
		if (size <= 0 || size > props.uploads().maxBytes()) return AuthController.error(HttpStatus.BAD_REQUEST, "Files can be at most " + props.uploads().maxBytes() / (1024 * 1024) + " MB.");
		String key = TenantContext.require() + "/" + a.userId() + "/" + UUID.randomUUID() + "/" + safeName(body.name());
		var put = presigner.presignPutObject((p) -> p.signatureDuration(Duration.ofMinutes(10))
			.putObjectRequest((o) -> o.bucket(props.uploads().bucket()).key(key).contentType(body.type()).contentLength(size)));
		return ResponseEntity.ok(Map.of("key", key, "url", put.url().toString(), "headers", Map.of("Content-Type", body.type())));
	}

	@GetMapping("/file")
	ResponseEntity<?> file(@RequestParam String key, HttpServletRequest req) {
		if (off()) return AuthController.error(HttpStatus.NOT_FOUND, "File uploads are not available here.");
		Actor a = access.actor(req);
		if (!Records.FILE_KEY.matcher(key).matches() || !key.startsWith(TenantContext.require() + "/")) return AuthController.error(HttpStatus.NOT_FOUND, "File not found.");
		var found = attachedTo(slice.build(a), key);
		if (found == null) return AuthController.error(HttpStatus.NOT_FOUND, "File not found.");
		String name = Json.str(found.get("name"), 150);
		if (props.uploads().malwareScan()) { // A9: GuardDuty tags each object with its scan result
			String scan = s3.getObjectTagging((t) -> t.bucket(props.uploads().bucket()).key(key)).tagSet().stream()
				.filter((t) -> t.key().equals("GuardDutyMalwareScanStatus")).map(software.amazon.awssdk.services.s3.model.Tag::value).findFirst().orElse("");
			switch (scan) {
				case "NO_THREATS_FOUND" -> {}
				case "" -> { return page(HttpStatus.CONFLICT, "This file is still being checked for viruses. Try again in a minute."); }
				case "THREATS_FOUND" -> { return page(HttpStatus.FORBIDDEN, "The virus scan flagged this file as unsafe, so it cannot be opened. Remove it from the entry and upload a clean copy."); }
				default -> { return page(HttpStatus.FORBIDDEN, "This file could not be checked for viruses (" + scan.toLowerCase().replace('_', ' ') + "). Upload it again, or contact your Office of Research."); }
			}
		}
		var get = presigner.presignGetObject((p) -> p.signatureDuration(Duration.ofMinutes(5))
			.getObjectRequest((o) -> o.bucket(props.uploads().bucket()).key(key)
				.responseContentDisposition("inline; filename=\"" + name.replaceAll("[\"\\\\\\r\\n]", "_") + "\"")));
		return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(get.url().toString())).header("Cache-Control", "no-store").build();
	}

	/** A file link opens in a browser tab, so a refusal is a short readable page rather than JSON. */
	private static ResponseEntity<String> page(HttpStatus status, String message) {
		String html = "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>UniRise file</title>"
			+ "<body style=\"font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 20px\"><h1 style=\"font-size:20px\">UniRise</h1><p>"
			+ message.replace("&", "&amp;").replace("<", "&lt;") + "</p><p><a href=\"javascript:window.close()\">Close this tab</a></p>";
		return ResponseEntity.status(status).contentType(org.springframework.http.MediaType.TEXT_HTML).header("Cache-Control", "no-store").body(html);
	}

	/** The attachment with this key on any record in the caller's data, or null. */
	static Map<String, Object> attachedTo(Map<String, Object> data, String key) {
		for (String kind : KINDS) for (Object r : Json.arr(data.get(kind))) for (Object f : Json.arr(Json.obj(r).get("attachments"))) {
			Map<String, Object> file = Json.obj(f);
			if (key.equals(file.get("key"))) return file;
		}
		return null;
	}

	/** A file name safe as the last part of a key: no path, no control characters, at most 150 characters. */
	static String safeName(String name) {
		String base = name == null ? "" : name.replace('\\', '/');
		base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").replaceAll("[^A-Za-z0-9._ ()-]", "_").trim();
		if (base.isEmpty() || base.equals(".") || base.equals("..")) base = "file";
		return base.length() > 150 ? base.substring(base.length() - 150) : base;
	}
}
