package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Migrator;
import in.co.mentoredge.unirise.tenancy.Provisioner;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/platform")
public class PlatformController {
	public record NewTenant(String slug, String name) {}

	private final Provisioner provisioner;
	private final Migrator migrator;

	public PlatformController(Provisioner provisioner, Migrator migrator) {
		this.provisioner = provisioner;
		this.migrator = migrator;
	}

	/** The API key in the response is shown once; only its hash is stored. */
	@PostMapping("/tenants")
	@ResponseStatus(HttpStatus.CREATED)
	Provisioner.Created create(@RequestBody NewTenant body) { return provisioner.provision(body.slug(), body.name()); }

	@PostMapping("/migrations")
	List<Migrator.Result> migrateAll() { return migrator.migrateAll(); }
}
