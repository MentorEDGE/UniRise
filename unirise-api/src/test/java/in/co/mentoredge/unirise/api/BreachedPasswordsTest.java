package in.co.mentoredge.unirise.api;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

/** The breached-password check, with a stand-in for the range API (no network). */
class BreachedPasswordsTest {
	// SHA-1("P@ssw0rd") = 21BD12DC183F740EE76F27B78EB39C8AD972A757.
	@Test
	void aListedPasswordIsRefusedOnlyThePrefixIsSentAndOutagesDoNotBlock() {
		var sent = new java.util.ArrayList<String>();
		var check = new BreachedPasswords((prefix) -> { sent.add(prefix); return "1D72CD07550416C216D8AD296BF5C0AE8E0:10\r\n2DC183F740EE76F27B78EB39C8AD972A757:52579\r\n0000000000000000000000000000000000A:0"; });
		assertEquals(BreachedPasswords.MESSAGE, check.problem("P@ssw0rd"));
		assertEquals(java.util.List.of("21BD1"), sent, "only the first 5 characters of the hash leave the server");
		assertNull(check.problem("Kestrel-Harbour-48"));
		assertNull(new BreachedPasswords((p) -> "2DC183F740EE76F27B78EB39C8AD972A757:0").problem("P@ssw0rd"), "padding lines (count 0) are not breaches");
		assertNull(new BreachedPasswords((p) -> null).problem("P@ssw0rd"), "the service being unreachable never blocks a password");
	}

	@Test
	void theRulesRefuseEasyPasswords() {
		for (String weak : new String[] { "Short1", "Unirise2026", "Password12345", "qwerty12345", "aaaaaaaa11", "lettersonlyhere", "1234567890" })
			assertNotNull(Passwords.problem(weak), weak);
		assertNotNull(Passwords.problem("Meera2026xyz", "meera@abc.example"), "built from the email address");
		assertNull(Passwords.problem("Kestrel-Harbour-48", "meera@abc.example"));
		assertNull(Passwords.problem("Strongpass11"));
	}
}
