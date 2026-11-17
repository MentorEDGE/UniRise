package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import in.co.mentoredge.unirise.tenancy.SecretStore;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.*;

/**
 * BACKEND_PLAN A2: institution database passwords in AWS Secrets Manager (an in-memory stand-in here), none in the
 * control-plane database; passwords left in the table keep working until they are moved, and moving empties it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
	properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false", "app.secrets.store=aws", "app.secrets.prefix=unirise/test/tenant/" })
class SecretsManagerTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final Map<String, String> AWS = new ConcurrentHashMap<>();

	/** Secrets Manager as far as the API uses it: create, put, get, delete by name. */
	@TestConfiguration
	static class FakeAws {
		@Bean
		SecretsManagerClient secretsManagerClient() {
			return new SecretsManagerClient() {
				@Override public String serviceName() { return "secretsmanager"; }
				@Override public void close() {}
				@Override public GetSecretValueResponse getSecretValue(GetSecretValueRequest r) {
					String v = AWS.get(r.secretId());
					if (v == null) throw ResourceNotFoundException.builder().message("not found").build();
					return GetSecretValueResponse.builder().name(r.secretId()).secretString(v).build();
				}
				@Override public PutSecretValueResponse putSecretValue(PutSecretValueRequest r) {
					if (!AWS.containsKey(r.secretId())) throw ResourceNotFoundException.builder().message("not found").build();
					AWS.put(r.secretId(), r.secretString());
					return PutSecretValueResponse.builder().build();
				}
				@Override public CreateSecretResponse createSecret(CreateSecretRequest r) {
					assertTrue(r.tags().stream().anyMatch(t -> t.key().equals("Project") && t.value().equals("UniRise")), "secrets are labelled UniRise");
					AWS.put(r.name(), r.secretString());
					return CreateSecretResponse.builder().name(r.name()).build();
				}
				@Override public DeleteSecretResponse deleteSecret(DeleteSecretRequest r) {
					assertEquals(7L, r.recoveryWindowInDays(), "a deleted institution's secret can be restored for 7 days");
					AWS.remove(r.secretId());
					return DeleteSecretResponse.builder().build();
				}
			};
		}
	}

	@DynamicPropertySource
	static void props(DynamicPropertyRegistry r) {
		PG.start();
		r.add("app.control.url", PG::getJdbcUrl);
		r.add("app.control.user", PG::getUsername);
		r.add("app.control.password", PG::getPassword);
		r.add("app.tenants.host", PG::getHost);
		r.add("app.tenants.port", () -> PG.getMappedPort(5432));
	}

	@Value("${local.server.port}") int port;
	@Autowired @Qualifier("controlJdbc") JdbcClient control;
	@Autowired SecretStore store;

	long tableRows() { return control.sql("SELECT count(*) FROM institution_secret").query(Long.class).single(); }

	@Test
	void passwordsLiveInSecretsManagerAndOldOnesAreMovedThere() throws Exception {
		TestApi api = new TestApi(port);
		var sec = api.provision("sec", "office@sec.example");
		assertEquals(0, tableRows(), "no password in the control-plane database");
		String secret = AWS.get("unirise/test/tenant/sec");
		assertNotNull(secret, "the new institution's password is in Secrets Manager");
		assertFalse(api.call("GET", "/api/data", api.signIn(sec.officeEmail(), sec.officePassword()), null).body().contains(secret), "never sent to a browser");

		// An institution created before the switch: its password is still in the table, and it keeps working.
		var old = api.provision("old", "office@old.example");
		String pw = AWS.remove("unirise/test/tenant/old");
		new SecretStore.Database(control).put("old", pw);
		var cached = (SecretStore.Cached) store;
		Caller o = api.signIn(old.officeEmail(), old.officePassword());
		assertEquals(200, api.call("GET", "/api/data", o, null).statusCode());
		assertEquals(1, tableRows());

		// Moving: written, read back, then removed from the table. Everything keeps working.
		var moved = ((SecretStore.Aws) cached.inner()).moveFrom(new SecretStore.Database(control), LoggerFactory.getLogger(getClass()));
		assertEquals(1, moved.moved());
		assertEquals(0, moved.failed());
		assertEquals(0, tableRows());
		assertEquals(pw, AWS.get("unirise/test/tenant/old"));
		assertEquals(200, api.call("GET", "/api/data", api.signIn(old.officeEmail(), old.officePassword()), null).statusCode());

		// Deleting a secret through the store removes it (restorable for 7 days on AWS) and the cache forgets it.
		store.delete("old");
		assertTrue(store.get("old").isEmpty());
	}
}
