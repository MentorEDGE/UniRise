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
	public record NewTenant(String slug, String name) {}

	private final Provisioner provisioner;
	private final Migrator migrator;
	private final TenantLifecycle lifecycle;

	public PlatformController(Provisioner provisioner, Migrator migrator, TenantLifecycle lifecycle) {
		this.lifecycle = lifecycle;
		this.provisioner = provisioner;
		this.migrator = migrator;
	}

	/** The API key in the response is shown once; only its hash is stored. */
	@PostMapping("/tenants")
	@ResponseStatus(HttpStatus.CREATED)
	Provisioner.Created create(@RequestBody NewTenant body, jakarta.servlet.http.HttpServletRequest req) {
		operatorOnly(req);
		return provisioner.provision(body.slug(), body.name()); }

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
