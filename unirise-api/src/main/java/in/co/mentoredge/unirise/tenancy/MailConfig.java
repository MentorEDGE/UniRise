package in.co.mentoredge.unirise.tenancy;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.sesv2.SesV2Client;

/** Amazon SES for email (A1a), only when a sender is configured; region and credentials from the ECS task. Also turns on scheduled jobs (enquiry retries). */
@Configuration
@EnableScheduling
public class MailConfig {
	@Bean(destroyMethod = "close")
	@ConditionalOnMissingBean
	@ConditionalOnExpression("!'${app.mail.from:}'.isEmpty()")
	SesV2Client sesV2Client() {
		return SesV2Client.builder().httpClientBuilder(UrlConnectionHttpClient.builder()).build();
	}
}
