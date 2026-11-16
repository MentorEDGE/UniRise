package in.co.mentoredge.unirise.api;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Broken rules come back as {"error": message}, the shape the frontend shows to the user. */
@RestControllerAdvice
class ErrorAdvice {
	@ExceptionHandler(RuleException.class)
	ResponseEntity<Map<String, String>> rule(RuleException e) {
		return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
	}
}
