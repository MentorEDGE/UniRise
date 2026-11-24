package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * The Office of Research's own sending address (2026-11-23), under the institution's settings:
 * GET    /api/office/mail-sender          address, name, status and the DNS records for the institution's IT
 * PUT    /api/office/mail-sender {address, name}   set or change it (registers the domain with Amazon SES)
 * POST   /api/office/mail-sender/check    ask again whether the DNS records are in place
 * DELETE /api/office/mail-sender          stop sending email
 */
@RestController
@RequestMapping("/api/office/mail-sender")
public class MailSenderController {
	private final AccessService access;
	private final InstitutionSender sender;
	private final TenantDirectory directory;
	private final AdminLog log;

	public MailSenderController(AccessService access, InstitutionSender sender, TenantDirectory directory, AdminLog log) {
		this.access = access;
		this.sender = sender;
		this.directory = directory;
		this.log = log;
	}

	private Actor office(HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!a.isAdmin()) throw RuleException.forbid("Only the Office of Research can do this.");
		return a;
	}

	private long id() { return directory.bySlug(TenantContext.require()).orElseThrow().id(); }

	@GetMapping
	Map<String, Object> get(HttpServletRequest req) { office(req); return sender.describe(id()); }

	@PutMapping
	Map<String, Object> set(@RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = office(req);
		access.requireRecentPassword(req);
		long id = id();
		var out = sender.setup(id, Json.str(b == null ? null : b.get("address"), 200), Json.str(b == null ? null : b.get("name"), 200), directory.name(id));
		log.record(a, "Email sender set", String.valueOf(out.get("address")), "status " + out.get("status"));
		return out;
	}

	@PostMapping("/check")
	Map<String, Object> check(HttpServletRequest req) { office(req); return sender.refresh(id()); }

	@DeleteMapping
	Map<String, Object> remove(HttpServletRequest req) {
		Actor a = office(req);
		access.requireRecentPassword(req);
		sender.remove(id());
		log.record(a, "Email sender removed", "", "no email is sent until a new address is verified");
		return Map.of("ok", true);
	}
}
