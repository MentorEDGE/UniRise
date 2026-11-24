package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Migrator;
import in.co.mentoredge.unirise.tenancy.Provisioner;
import in.co.mentoredge.unirise.tenancy.TenantLifecycle;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/platform")
public class PlatformController {
	/** officeEmail (optional): the institution's first Office of Research account; its temporary password is in the response. */
	public record NewTenant(String slug, String name, String officeEmail, String officeName) {}

	private final Provisioner provisioner;
	private final Migrator migrator;
	private final TenantLifecycle lifecycle;
	private final DemoData demo;
	@org.springframework.beans.factory.annotation.Autowired private TwoStep twoStep;
	@org.springframework.beans.factory.annotation.Autowired private Sessions sessions;
	@org.springframework.beans.factory.annotation.Autowired @org.springframework.beans.factory.annotation.Qualifier("controlJdbc") private org.springframework.jdbc.core.simple.JdbcClient control;

	public PlatformController(Provisioner provisioner, Migrator migrator, TenantLifecycle lifecycle, DemoData demo) {
		this.demo = demo;
		this.lifecycle = lifecycle;
		this.provisioner = provisioner;
		this.migrator = migrator;
	}

	/** The API key in the response is shown once; only its hash is stored. */
	@PostMapping("/tenants")
	@ResponseStatus(HttpStatus.CREATED)
	Provisioner.Created create(@RequestBody NewTenant body, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return provisioner.provision(body.slug(), body.name(), body.officeEmail(), body.officeName()); }

	/** Loads data in the UI's shape and demo accounts into an empty sandbox institution (demos, end-to-end tests). */
	@PostMapping("/tenants/{slug}/demo-data")
	java.util.Map<String, Object> demoData(@PathVariable String slug, @RequestBody java.util.Map<String, Object> body, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return demo.load(slug, body);
	}

	@PostMapping("/migrations")
	List<Migrator.Result> migrateAll(jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return migrator.migrateAll(); }

	public record StatusChange(String status, String reason) {}

	@GetMapping("/tenants")
	List<TenantLifecycle.Summary> tenants(jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return lifecycle.list();
	}

	record ResetTwoStep(String email) {}

	/** Operator only: an Office of Research account lost its phone and no other Office account can reset it (2026-11-24). */
	@PostMapping("/tenants/{slug}/reset-2fa")
	java.util.Map<String, Object> resetTwoStep(@PathVariable String slug, @RequestBody ResetTwoStep b, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		String email = b == null || b.email() == null ? "" : b.email().trim().toLowerCase();
		var acc = control.sql("SELECT a.institution_id, a.app_user_id FROM account_login a JOIN institution i ON i.id = a.institution_id WHERE a.email = :e AND i.slug = :s")
			.param("e", email).param("s", slug).query((r, n) -> new long[] { r.getLong(1), r.getLong(2) }).optional()
			.orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "No such account"));
		twoStep.reset(acc[0], acc[1]);
		sessions.endAll(acc[0], acc[1], null);
		control.sql("INSERT INTO platform_access_log(actor, action, institution_id, reason) VALUES ('platform', 'two-step sign-in reset', :i, :e)").param("i", acc[0]).param("e", email).update();
		return java.util.Map.of("ok", true);
	}

	@PostMapping("/tenants/{slug}/status")
	void status(@PathVariable String slug, @RequestBody StatusChange c, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		lifecycle.setStatus(slug, c.status(), c.reason());
	}

	/** Contract-exit export: a zip with one CSV per table. */
	@GetMapping("/tenants/{slug}/export")
	org.springframework.http.ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody> export(@PathVariable String slug,
		@RequestParam(defaultValue = "contract exit") String reason, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		if (!slug.matches("[a-z][a-z0-9_]{2,30}")) throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST);
		return org.springframework.http.ResponseEntity.ok()
			.header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + slug + "-export.zip\"")   // slug validated above
			.contentType(org.springframework.http.MediaType.parseMediaType("application/zip")).body(out -> lifecycle.export(slug, reason, out));
	}

	@DeleteMapping("/tenants/{slug}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable String slug, @RequestParam String confirm, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		lifecycle.delete(slug, confirm);
	}

	@GetMapping("/usage")
	List<TenantLifecycle.Usage> usage(jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return lifecycle.usage();
	}

	@PostMapping("/usage/refresh")
	List<TenantLifecycle.Usage> refresh(jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return lifecycle.refreshUsage();
	}

	/** Second guard behind the filter: the handler itself refuses a request the filter did not mark as the operator's. */
	private static void operatorOnly(jakarta.servlet.http.HttpServletRequest req) {
		if (req.getAttribute("platform") == null) throw new org.springframework.web.server.ResponseStatusException(HttpStatus.UNAUTHORIZED);
	}
}
