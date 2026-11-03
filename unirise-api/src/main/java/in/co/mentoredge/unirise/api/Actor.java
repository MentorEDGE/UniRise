package in.co.mentoredge.unirise.api;

import java.util.List;

/** Who is asking: a tenant service key (full tenant admin) or a signed-in user with their current grants. */
public record Actor(Long userId, Long researcherId, boolean service, List<Grant> grants) {
	public record Grant(String role, Long scopeUnitId) {}

	static Actor serviceActor() { return new Actor(null, null, true, List.of()); }

	boolean isAdmin() { return service || grants.stream().anyMatch(g -> g.role().equals("RESEARCH_ADMIN") && g.scopeUnitId() == null); }

	boolean hasRole(String... roles) {
		for (Grant g : grants) for (String r : roles) if (g.role().equals(r)) return true;
		return false;
	}
}
