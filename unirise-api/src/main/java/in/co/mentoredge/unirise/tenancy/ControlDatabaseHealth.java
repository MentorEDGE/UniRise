package in.co.mentoredge.unirise.tenancy;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Health of the control-plane database, shown as "controlDatabase" on /actuator/health and its readiness group.
 *
 * Spring's own database check stays off (management.health.db.enabled=false) because it would also probe the tenant
 * routing data source, which has no tenant outside a request. Without any database check, the health page said UP for
 * 11 days while the dev database was unusable (2026-11-04 to 2026-11-15). Every request needs the control plane, so
 * this check is enough to tell "the API can serve" from "the API is up but cannot read anything". When it fails, the
 * load balancer sees 503 and ECS replaces the task, and a deployment whose tasks cannot reach the database rolls back.
 */
@Component("controlDatabase")
public class ControlDatabaseHealth implements HealthIndicator {
	private final JdbcClient control;

	public ControlDatabaseHealth(@Qualifier("controlJdbc") JdbcClient control) {
		this.control = control;
	}

	@Override
	public Health health() {
		try {
			Integer one = control.sql("SELECT 1").query(Integer.class).single();
			return one != null && one == 1 ? Health.up().build() : Health.down().build();
		} catch (RuntimeException e) {
			// No exception details on a public page: they can name hosts and users.
			return Health.down().build();
		}
	}
}
