package in.co.mentoredge.unirise.tenancy;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

/**
 * Chooses where institution database passwords live: app.secrets.store=database (local runs, tests) or aws (AWS
 * Secrets Manager, required on AWS before real data). With aws, passwords still in the control-plane table are moved
 * into Secrets Manager at start-up.
 */
@Configuration
public class SecretsConfig {
	private static final Logger log = LoggerFactory.getLogger(SecretsConfig.class);

	@Bean
	SecretStore secretStore(AppProperties props, @Qualifier("controlJdbc") JdbcClient control, ObjectProvider<SecretsManagerClient> client) {
		var table = new SecretStore.Database(control);
		if (!"aws".equals(props.secrets().store())) return new SecretStore.Cached(table, Duration.ofMinutes(5));
		// The region comes from AWS_REGION (set in the ECS task) and credentials from the task role.
		SecretsManagerClient c = client.getIfAvailable(() -> SecretsManagerClient.builder().httpClientBuilder(UrlConnectionHttpClient.builder()).build());
		return new SecretStore.Cached(new SecretStore.Aws(c, props.secrets().prefix(), table), Duration.ofMinutes(5));
	}

	/** Moves passwords out of the control-plane table once Secrets Manager is in use. Runs at every start; usually nothing to move. */
	@Bean
	ApplicationRunner moveSecretsToAws(SecretStore store, @Qualifier("controlJdbc") JdbcClient control) {
		return (args) -> {
			if (store instanceof SecretStore.Cached cached && cached.inner() instanceof SecretStore.Aws aws) {
				var result = aws.moveFrom(new SecretStore.Database(control), log);
				if (result.moved() + result.failed() > 0) log.info("Secrets Manager: {} institution passwords moved, {} failed", result.moved(), result.failed());
			}
		};
	}
}
