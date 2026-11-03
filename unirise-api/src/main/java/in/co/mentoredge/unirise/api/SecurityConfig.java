package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
	/** Stateless key auth is done by ApiKeyFilter (fails closed for /api/**); Spring Security supplies headers and no session. */
	@Bean
	SecurityFilterChain chain(HttpSecurity http, TenantDirectory directory, AppProperties props) throws Exception {
		http.csrf(c -> c.disable())
			.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(a -> a.anyRequest().permitAll())
			.addFilterBefore(new ApiKeyFilter(directory, props.adminKey()), UsernamePasswordAuthenticationFilter.class);
		return http.build();
	}

	/** Present only to stop Spring generating a default user and password. */
	@Bean
	InMemoryUserDetailsManager noUsers() { return new InMemoryUserDetailsManager(); }
}
