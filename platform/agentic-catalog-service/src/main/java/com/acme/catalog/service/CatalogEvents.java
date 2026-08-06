package com.acme.catalog.service;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * In-process catalog mutation bus + SSE fan-out (ports catalog-bus + stream).
 * Controllers call {@link #publish} after each write; connected {@code /stream}
 * clients for that tenant get a hint and re-fetch (drives the composer's live
 * re-hydrate). Single-process — fine for self-hosted; a shared bus is a later step.
 */
@Service
public class CatalogEvents {
    private record Client(String tenant, SseEmitter emitter) {}
    private final List<Client> clients = new CopyOnWriteArrayList<>();

    public SseEmitter subscribe(String tenant) {
        SseEmitter emitter = new SseEmitter(0L); // no timeout
        Client c = new Client(tenant, emitter);
        clients.add(c);
        emitter.onCompletion(() -> clients.remove(c));
        emitter.onTimeout(() -> clients.remove(c));
        try { emitter.send(SseEmitter.event().comment("connected")); } catch (IOException ignored) {}
        return emitter;
    }

    public void publish(String tenant, String entityType, String operation, String entityId) {
        Map<String, Object> event = Map.of(
                "tenantId", tenant, "entityType", entityType, "operation", operation,
                "entityId", entityId, "occurredAt", java.time.Instant.now().toString());
        for (Client c : clients) {
            if (!c.tenant().equals(tenant)) continue;
            try { c.emitter().send(SseEmitter.event().data(event)); }
            catch (Exception e) { clients.remove(c); }
        }
    }
}
