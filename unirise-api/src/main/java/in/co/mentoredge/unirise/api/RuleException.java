package in.co.mentoredge.unirise.api;

import org.springframework.http.HttpStatus;

/** A rule broken by the request, with the message the user sees (as RuleError in rdms-web/src/lib/domain.ts). */
public class RuleException extends RuntimeException {
	final HttpStatus status;

	RuleException(HttpStatus status, String message) {
		super(message);
		this.status = status;
	}

	static RuleException invalid(String m) { return new RuleException(HttpStatus.BAD_REQUEST, m); }

	static RuleException forbid(String m) { return new RuleException(HttpStatus.FORBIDDEN, m); }

	static RuleException notFound(String what) { return new RuleException(HttpStatus.NOT_FOUND, what + " not found."); }
}
