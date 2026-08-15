package com.acme.catalog.support;

import java.util.UUID;

/** App-generated UUIDs (portable — no DB uuid type dependency). */
public final class Ids {
    private Ids() {}
    public static String uuid() { return UUID.randomUUID().toString(); }
}
