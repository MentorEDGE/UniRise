package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Provisioner;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Invitation sign-in for sandbox and demo tenants (TRD §3); OIDC replaces it for real customers.
 * shortcut: the invitation token is returned to the admin instead of emailed, wire SES before inviting real people.
 */
@RestController
@RequestMapping("/api")
public class AuthController {
	public record Invite(String email, Long researcherId) {}
	public record Redeem(String token) {}
	public record Me(Long userId, Long researcherId, boolean service, List<Actor.Grant> grants) {}

	private final JdbcClient tenant, control;
	private final TenantDirectory directory;
	private final AccessService access;

	public AuthController(@Qualifier("tenantJdbc") JdbcClient tenant, @Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, AccessService access) {
		this.tenant = tenant;
		this.control = control;
		this.directory = directory;
		this.access = access;
	}

	@PostMapping("/auth/invitations")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Object> invite(@RequestBody Invite i, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (i.email() == null || !i.email().matches("[^@\\s]+@[^@\\s]+")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		long userId = tenant.sql("""
			INSERT INTO app_user(email, researcher_id) VALUES (lower(:e), :r)
			ON CONFLICT (email) DO UPDATE SET researcher_id = COALESCE(EXCLUDED.researcher_id, app_user.researcher_id) RETURNING id""")
			.param("e", i.email()).param("r", i.researcherId()).query(Long.class).single();
		String token = Provisioner.randomHex(32);
		control.sql("""
			INSERT INTO user_token(token_hash, institution_id, app_user_id, kind, expires_at)
			VALUES (:h, (SELECT id FROM institution WHERE slug = :s), :u, 'invite', now() + interval '7 days')""")
			.param("h", Provisioner.hash(token)).param("s", TenantContext.require()).param("u", userId).update();
		return Map.of("userId", userId, "token", token);
	}

	/** Public: trades a one-time invitation for a 12-hour session token. */
	@PostMapping("/auth/redeem")
	Map<String, String> redeem(@RequestBody Redeem r) {
		if (r.token() == null || r.token().length() > 200) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
		String h = Provisioner.hash(r.token());
		var hit = directory.byToken(h, "invite").orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
		if (control.sql("UPDATE user_token SET used_at = now() WHERE token_hash = :h AND used_at IS NULL").param("h", h).update() != 1) {
			throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); // lost a race: already redeemed
		}
		String session = Provisioner.randomHex(32);
		control.sql("INSERT INTO user_token(token_hash, institution_id, app_user_id, kind, expires_at) VALUES (:h, :i, :u, 'session', now() + interval '12 hours')")
			.param("h", Provisioner.hash(session)).param("i", hit.tenant().id()).param("u", hit.userId()).update();
		return Map.of("token", session);
	}

	@GetMapping("/me")
	Me me(HttpServletRequest req) {
		Actor a = access.actor(req);
		return new Me(a.userId(), a.researcherId(), a.service(), a.grants());
	}
}
