package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {
	/** ApiKeyFilter authenticates (API key, operator key or the session cookie) and fails closed for /api/**; Spring Security supplies headers and no HTTP session. */
	@Bean
	SecurityFilterChain chain(HttpSecurity http, TenantDirectory directory, Sessions sessions, AppProperties props) throws Exception {
		var cors = new CorsConfiguration();
		cors.setAllowedOrigins(List.of("https://dev-unirise.mentoredge.co.in"));
		cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
		cors.setAllowedHeaders(List.of("Content-Type", "X-API-Key", "X-Admin-Key", "X-RDMS"));
		cors.setAllowCredentials(true); // the session cookie: the frontend (dev-unirise) and the API (api.dev-unirise) are the same site
		var source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/api/**", cors);
		http.cors(c -> c.configurationSource(source))
			.csrf(c -> c.disable())
			.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(a -> a.anyRequest().permitAll())
			.addFilterBefore(new ApiKeyFilter(directory, sessions, props.adminKey()), UsernamePasswordAuthenticationFilter.class);
		return http.build();
	}

	/** Present only to stop Spring generating a default user and password. */
	@Bean
	InMemoryUserDetailsManager noUsers() { return new InMemoryUserDetailsManager(); }
}
