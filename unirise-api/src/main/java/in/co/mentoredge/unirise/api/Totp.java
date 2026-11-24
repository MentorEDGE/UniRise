package in.co.mentoredge.unirise.api;

import java.nio.ByteBuffer;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Authenticator-app codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as Google/Microsoft Authenticator use. */
final class Totp {
	private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	private static final SecureRandom RANDOM = new SecureRandom();

	private Totp() {}

	/** A new 160-bit secret, in base32 for the app. */
	static String newSecret() {
		byte[] b = new byte[20];
		RANDOM.nextBytes(b);
		return base32(b);
	}

	static long step(long epochSeconds) { return epochSeconds / 30; }

	static String code(String secret, long step) {
		try {
			Mac mac = Mac.getInstance("HmacSHA1");
			mac.init(new SecretKeySpec(decode(secret), "HmacSHA1"));
			byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
			int o = h[h.length - 1] & 0x0f;
			int n = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1_000_000;
			return String.format("%06d", n);
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	/** The time step the code belongs to (now, or one step either side for clock drift), or -1. Constant-time compare. */
	static long verify(String secret, String code, long nowSeconds) {
		if (secret == null || code == null) return -1;
		String c = code.replaceAll("\\s", "");
		if (!c.matches("\\d{6}")) return -1;
		long now = step(nowSeconds);
		long found = -1;
		for (long s = now - 1; s <= now + 1; s++)
			if (java.security.MessageDigest.isEqual(code(secret, s).getBytes(), c.getBytes())) found = s;
		return found;
	}

	static String base32(byte[] data) {
		StringBuilder out = new StringBuilder();
		int buffer = 0, bits = 0;
		for (byte b : data) {
			buffer = (buffer << 8) | (b & 0xff);
			bits += 8;
			while (bits >= 5) { out.append(ALPHABET.charAt((buffer >> (bits - 5)) & 31)); bits -= 5; }
		}
		if (bits > 0) out.append(ALPHABET.charAt((buffer << (5 - bits)) & 31));
		return out.toString();
	}

	static byte[] decode(String s) {
		String t = s.toUpperCase().replaceAll("[^A-Z2-7]", "");
		ByteBuffer out = ByteBuffer.allocate(t.length() * 5 / 8);
		int buffer = 0, bits = 0;
		for (char ch : t.toCharArray()) {
			buffer = (buffer << 5) | ALPHABET.indexOf(ch);
			bits += 5;
			if (bits >= 8) { out.put((byte) (buffer >> (bits - 8))); bits -= 8; }
		}
		return java.util.Arrays.copyOf(out.array(), out.position());
	}
}
