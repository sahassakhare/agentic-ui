package com.acme.catalog.support;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Embed keys: raw shown once, only the SHA-256 hash is stored. Ports embed-key.ts. */
public final class EmbedKey {
    private static final SecureRandom RNG = new SecureRandom();
    private static final String PREFIX = "emb_";
    private EmbedKey() {}

    public static String mint() {
        byte[] b = new byte[32];
        RNG.nextBytes(b);
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    public static String hash(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(raw.trim().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public static String prefixOf(String raw) {
        String body = raw.startsWith(PREFIX) ? raw.substring(PREFIX.length()) : raw;
        return PREFIX + body.substring(0, Math.min(4, body.length())) + "…";
    }
}
