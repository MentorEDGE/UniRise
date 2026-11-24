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
 * <li>{@code POST /api/uploads} {name, type, size}: faculty and the Office of Research; documents (PDF, Word, Excel,
 * PowerPoint, OpenDocument, text, CSV, RTF), images and ZIP archives up to 10 MB, chosen by the file's extension (widened
 * from PDF/JPEG/PNG on 2026-11-21). Programs and web pages (exe, js, html, svg…) are refused.
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

	/** Allowed file kinds by extension, with the content type they are stored and served with. */
	static final java.util.Map<String, String> TYPES = java.util.Map.ofEntries(
		java.util.Map.entry("pdf", "application/pdf"), java.util.Map.entry("jpg", "image/jpeg"), java.util.Map.entry("jpeg", "image/jpeg"), java.util.Map.entry("png", "image/png"),
		java.util.Map.entry("gif", "image/gif"), java.util.Map.entry("webp", "image/webp"), java.util.Map.entry("heic", "image/heic"), java.util.Map.entry("tif", "image/tiff"), java.util.Map.entry("tiff", "image/tiff"),
		java.util.Map.entry("doc", "application/msword"), java.util.Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
		java.util.Map.entry("xls", "application/vnd.ms-excel"), java.util.Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
		java.util.Map.entry("ppt", "application/vnd.ms-powerpoint"), java.util.Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
		java.util.Map.entry("odt", "application/vnd.oasis.opendocument.text"), java.util.Map.entry("ods", "application/vnd.oasis.opendocument.spreadsheet"),
		java.util.Map.entry("odp", "application/vnd.oasis.opendocument.presentation"), java.util.Map.entry("rtf", "application/rtf"), java.util.Map.entry("txt", "text/plain"),
		java.util.Map.entry("csv", "text/csv"), java.util.Map.entry("zip", "application/zip"));
	/** Shown in the browser tab; everything else downloads. */
	static final Set<String> INLINE = Set.of("pdf", "jpg", "jpeg", "png", "gif", "webp");
	static String ext(String name) { String n = name == null ? "" : name.trim().toLowerCase(); int i = n.lastIndexOf('.'); return i < 0 ? "" : n.substring(i + 1); }
	private static final List<String> KINDS = List.of("publications", "grants", "seedMoney", "fdps", "conferences", "awards", "ipr");
	private final AccessService access;
	private final DataSlice slice;
	private final AppProperties props;
	private final S3Presigner presigner;
	private final software.amazon.awssdk.services.s3.S3Client s3;
	@org.springframework.beans.factory.annotation.Autowired private AdminLog audit;

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
		String type = body == null ? null : TYPES.get(ext(body.name()));
		if (type == null) return AuthController.error(HttpStatus.BAD_REQUEST, "This kind of file cannot be uploaded. Use a document (PDF, Word, Excel, PowerPoint, OpenDocument, text, CSV), an image or a ZIP file.");
		long size = body.size() == null ? 0 : body.size();
		if (size <= 0 || size > props.uploads().maxBytes()) return AuthController.error(HttpStatus.BAD_REQUEST, "Files can be at most " + props.uploads().maxBytes() / (1024 * 1024) + " MB.");
		String key = TenantContext.require() + "/" + a.userId() + "/" + UUID.randomUUID() + "/" + safeName(body.name());
		var put = presigner.presignPutObject((p) -> p.signatureDuration(Duration.ofMinutes(10))
			.putObjectRequest((o) -> o.bucket(props.uploads().bucket()).key(key).contentType(type).contentLength(size)));
		return ResponseEntity.ok(Map.of("key", key, "url", put.url().toString(), "headers", Map.of("Content-Type", type)));
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
		if (s3 != null) { // the file's contents must match its type (2026-11-24)
			byte[] head = head(key);
			if (head == null) return page(HttpStatus.NOT_FOUND, "This file is no longer stored. Upload it again.");
			if (!contentMatches(ext(name), head)) {
				audit.record(a, "File refused: contents do not match its type", name, "entry " + Json.str(found.get("recordId"), 40));
				return page(HttpStatus.FORBIDDEN, "This file's contents do not match its type (." + ext(name) + "), so it cannot be opened. Upload the original file again.");
			}
		}
		var get = presigner.presignGetObject((p) -> p.signatureDuration(Duration.ofMinutes(5))
			.getObjectRequest((o) -> o.bucket(props.uploads().bucket()).key(key)
				.responseContentDisposition(disposition(name))));
		audit.record(a, "File opened", name, "entry " + Json.str(found.get("recordId"), 40)); // who opened which file, in the audit log (2026-11-24)
		return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(get.url().toString())).header("Cache-Control", "no-store").build();
	}

	/**
	 * Content-Disposition for a stored file: "inline" for what a browser shows, "attachment" otherwise. The header only
	 * carries plain characters, so the name goes in twice: a plain fallback, and the exact name encoded as UTF-8
	 * (RFC 6266/5987), which browsers prefer. A name with Cyrillic, Devanagari or other letters then downloads with its
	 * own name; before 2026-11-23 such names made the download fail.
	 */
	static String disposition(String name) {
		String n = name == null ? "file" : name.replaceAll("[\\r\\n]", " ").trim();
		String plain = n.replaceAll("[^\\x20-\\x7E]", "_").replaceAll("[\"\\\\]", "_");
		String exact = java.net.URLEncoder.encode(n, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20").replace("*", "%2A");
		return (INLINE.contains(ext(n)) ? "inline" : "attachment") + "; filename=\"" + plain + "\"; filename*=UTF-8''" + exact;
	}

	/**
	 * Whether a file's first bytes match its extension (2026-11-24): a renamed program or web page is not served as a
	 * document. Text and CSV have no signature, so they only must not look binary (no NUL bytes) or be a program.
	 */
	static boolean contentMatches(String ext, byte[] b) {
		java.util.function.Predicate<String> starts = (sig) -> {
			byte[] s = sig.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
			if (b.length < s.length) return false;
			for (int i = 0; i < s.length; i++) if (b[i] != s[i]) return false;
			return true;
		};
		return switch (ext) {
			case "pdf" -> starts.test("%PDF-");
			case "png" -> starts.test("\u0089PNG\r\n\u001a\n");
			case "jpg", "jpeg" -> starts.test("ÿØÿ");
			case "gif" -> starts.test("GIF87a") || starts.test("GIF89a");
			case "webp" -> starts.test("RIFF") && b.length >= 12 && new String(b, 8, 4, java.nio.charset.StandardCharsets.ISO_8859_1).equals("WEBP");
			case "heic" -> b.length >= 12 && new String(b, 4, 4, java.nio.charset.StandardCharsets.ISO_8859_1).equals("ftyp");
			case "tif", "tiff" -> starts.test("II*\u0000") || starts.test("MM\u0000*");
			case "docx", "xlsx", "pptx", "odt", "ods", "odp", "zip" -> starts.test("PK\u0003\u0004") || starts.test("PK\u0005\u0006");
			case "doc", "xls", "ppt" -> starts.test("ÐÏ\u0011à¡±\u001aá");
			case "rtf" -> starts.test("{\\rtf");
			case "txt", "csv" -> { for (byte x : b) if (x == 0) yield false; yield !starts.test("MZ") && !starts.test("\u007fELF"); }
			default -> false;
		};
	}

	/** The first bytes of a stored file (32 at most), or null when it is missing. */
	byte[] head(String key) {
		try {
			return s3.getObjectAsBytes((g) -> g.bucket(props.uploads().bucket()).key(key).range("bytes=0-31")).asByteArray();
		} catch (software.amazon.awssdk.services.s3.model.NoSuchKeyException e) {
			return null;
		}
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
			if (key.equals(file.get("key"))) { var out = new java.util.LinkedHashMap<>(file); out.put("recordId", Json.obj(r).get("id")); return out; }
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
