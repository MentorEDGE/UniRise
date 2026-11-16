package in.co.mentoredge.unirise.api;

/**
 * Who is asking: the institution's service key, or a signed-in user with one of the three roles (BACKEND_PLAN G1).
 * office = the Office of Research (administers the institution and is the only reviewer); management = Top-Level
 * Management (read-only, approved data only); faculty = a faculty member (their own records only).
 */
public record Actor(Long userId, Long researcherId, boolean service, String role, String name) {
	public static final String OFFICE = "office", MANAGEMENT = "management", FACULTY = "faculty";

	static Actor serviceActor() { return new Actor(null, null, true, OFFICE, "Service key"); }

	/** The Office of Research, or the institution's service key acting for it. */
	boolean isAdmin() { return service || OFFICE.equals(role); }

	boolean isManagement() { return !service && MANAGEMENT.equals(role); }

	boolean isFaculty() { return !service && FACULTY.equals(role); }
}
