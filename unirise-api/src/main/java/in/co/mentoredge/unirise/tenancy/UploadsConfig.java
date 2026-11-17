package in.co.mentoredge.unirise.tenancy;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** The S3 link signer for record files, only when an uploads bucket is configured (A1b). Region and credentials from the ECS task. */
@Configuration
public class UploadsConfig {
	@Bean(destroyMethod = "close")
	@ConditionalOnExpression("!'${app.uploads.bucket:}'.isEmpty()")
	S3Presigner s3Presigner() {
		return S3Presigner.create();
	}

	/** Reads the virus-scan result (an object tag) before a file is opened (A9). */
	@Bean(destroyMethod = "close")
	@ConditionalOnExpression("!'${app.uploads.bucket:}'.isEmpty()")
	software.amazon.awssdk.services.s3.S3Client s3Client() {
		return software.amazon.awssdk.services.s3.S3Client.builder().httpClientBuilder(software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient.builder()).build();
	}
}
