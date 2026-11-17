package in.co.mentoredge.unirise;

import static org.junit.jupiter.api.Assertions.*;

import in.co.mentoredge.unirise.TestApi.Caller;
import in.co.mentoredge.unirise.api.EnquiryMail;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
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
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;
import software.amazon.awssdk.services.sesv2.model.SendEmailResponse;
import software.amazon.awssdk.services.sesv2.model.SesV2Exception;

/** A1a: enquiries are stored, then emailed to the team with Reply-To the enquirer; failures are recorded and retried. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { "app.admin-key=test-admin", "app.session.secure-cookie=false",
	"app.mail.from=UniRise <no-reply@dev.example>", "app.mail.enquiries-to=team@corp.example", "app.mail.configuration-set=test-set",
	"spring.main.allow-bean-definition-overriding=true" }) // the stand-in replaces the real SES client
class EnquiryMailTest {
	static final PostgreSQLContainer PG = new PostgreSQLContainer("postgres:16");
	static final List<SendEmailRequest> SENT = new CopyOnWriteArrayList<>();
	static final AtomicBoolean DOWN = new AtomicBoolean(false);

	@TestConfiguration
	static class FakeSes {
		@Bean
		SesV2Client sesV2Client() {
			return new SesV2Client() {
				@Override public String serviceName() { return "ses"; }
				@Override public void close() {}
				@Override public SendEmailResponse sendEmail(SendEmailRequest r) {
					if (DOWN.get()) throw SesV2Exception.builder().message("Email address is not verified.").build();
					SENT.add(r);
					return SendEmailResponse.builder().messageId("m-" + SENT.size()).build();
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
	@Autowired EnquiryMail mail;

	static String enquiry(String org, String extra) {
		return "{\"institutionName\":\"" + org + "\",\"institutionType\":\"University\",\"contactName\":\"Meera Nair\",\"email\":\"Meera@Univ.Example\",\"country\":\"India\","
			+ "\"state\":\"Kerala\",\"city\":\"Kochi\",\"facultyCount\":\"200\",\"interest\":\"Research analytics\",\"message\":\"We would like a demo.\",\"consent\":\"yes\"" + extra + "}";
	}

	@Test
	void enquiriesAreEmailedToTheTeamAndRetriedWhenSendingFails() throws Exception {
		TestApi api = new TestApi(port);
		assertEquals(200, api.call("POST", "/api/enquiries", Caller.NOBODY, enquiry("Univ One\\r\\nBcc: x@evil.example", "")).statusCode());
		assertEquals(1, SENT.size());
		var m = SENT.get(0);
		assertEquals(List.of("team@corp.example"), m.destination().toAddresses());
		assertEquals(List.of("meera@univ.example"), m.replyToAddresses(), "the team replies straight to the enquirer");
		assertEquals("test-set", m.configurationSetName());
		String subject = m.content().simple().subject().data();
		assertTrue(subject.startsWith("UniRise enquiry: Univ One") && !subject.contains("\n") && !subject.contains("\r"), subject);
		String body = m.content().simple().body().text().data();
		assertTrue(body.contains("Meera Nair") && body.contains("We would like a demo.") && body.contains("Research analytics"), body);
		assertTrue(control.sql("SELECT delivered FROM enquiry ORDER BY id DESC LIMIT 1").query(Boolean.class).single());

		// The spam trap still takes nothing.
		assertEquals(200, api.call("POST", "/api/enquiries", Caller.NOBODY, enquiry("Bot", ",\"website\":\"x\"")).statusCode());
		assertEquals(1, SENT.size());

		// SES refuses (for example, the team's address awaits verification): the enquiry is kept, the request still succeeds, and a retry sends it.
		DOWN.set(true);
		assertEquals(200, api.call("POST", "/api/enquiries", Caller.NOBODY, enquiry("Univ Two", "")).statusCode());
		assertFalse(control.sql("SELECT delivered FROM enquiry ORDER BY id DESC LIMIT 1").query(Boolean.class).single());
		assertTrue(control.sql("SELECT delivery_note FROM enquiry ORDER BY id DESC LIMIT 1").query(String.class).single().startsWith("not sent yet"));
		DOWN.set(false);
		mail.retry();
		assertEquals(2, SENT.size());
		assertTrue(control.sql("SELECT bool_and(delivered) FROM enquiry WHERE data->>'institutionName' LIKE 'Univ%'").query(Boolean.class).single());
	}
}
