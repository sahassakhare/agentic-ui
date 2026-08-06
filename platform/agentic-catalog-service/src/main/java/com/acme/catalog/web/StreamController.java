package com.acme.catalog.web;

import com.acme.catalog.service.CatalogEvents;
import com.acme.catalog.tenant.CurrentActor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class StreamController {
    private final CatalogEvents events;
    private final CurrentActor current;

    public StreamController(CatalogEvents events, CurrentActor current) { this.events = events; this.current = current; }

    /** SSE of catalog mutations for a tenant (drives the composer's live re-hydrate). */
    @GetMapping(value = "/v1/catalogs/{tenant}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String tenant) {
        current.requireTenant(tenant);
        return events.subscribe(tenant);
    }
}
