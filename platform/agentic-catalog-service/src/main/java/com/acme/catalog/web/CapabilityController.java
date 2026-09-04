package com.acme.catalog.web;

import com.acme.catalog.service.CapabilityService;
import com.acme.catalog.service.CatalogEvents;
import com.acme.catalog.domain.Capability;
import com.acme.catalog.tenant.CurrentActor;
import tools.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/catalogs/{tenant}/capabilities")
public class CapabilityController {
    private final CapabilityService svc;
    private final Views views;
    private final CurrentActor current;
    private final CatalogEvents events;

    public CapabilityController(CapabilityService svc, Views views, CurrentActor current, CatalogEvents events) {
        this.svc = svc; this.views = views; this.current = current; this.events = events;
    }

    @GetMapping
    public Map<String, Object> list(@PathVariable String tenant, @RequestParam(required = false) String kind) {
        current.requireTenant(tenant);
        List<Map<String, Object>> items = svc.list(tenant, kind).stream().map(views::capability).toList();
        return Map.of("items", items, "total", items.size());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        Capability c = svc.get(tenant, id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Capability not found"));
        return withEtag(c);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@PathVariable String tenant, @RequestBody JsonNode body) {
        var actor = current.requireTenant(tenant);
        var c = svc.create(tenant, body, actor.id());
        events.publish(tenant, "capability", "create", c.id, c.kind);
        return ResponseEntity.status(HttpStatus.CREATED).eTag(etag(c)).body(views.capability(c));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable String tenant, @PathVariable String id,
                                                      @RequestBody JsonNode patch,
                                                      @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        var actor = current.requireTenant(tenant);
        var c = svc.update(tenant, id, patch, parseVersion(ifMatch), actor.id());
        events.publish(tenant, "capability", "update", c.id, c.kind);
        return withEtag(c);
    }

    @PostMapping("/{id}/transition")
    public ResponseEntity<Map<String, Object>> transition(@PathVariable String tenant, @PathVariable String id,
                                                          @RequestBody JsonNode body) {
        var actor = current.requireTenant(tenant);
        String action = body.path("action").asText(null);
        if (action == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "action is required");
        String comment = body.hasNonNull("comment") ? body.get("comment").asText() : null;
        var c = svc.transition(tenant, id, action, comment, actor);
        events.publish(tenant, "capability", "update", c.id, c.kind);
        return withEtag(c);
    }

    @GetMapping("/{id}/versions")
    public Map<String, Object> versions(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        return Map.of("items", svc.versions(tenant, id).stream().map(views::capabilityVersion).toList());
    }

    @PostMapping("/{id}/rollback/{versionNo}")
    public ResponseEntity<Map<String, Object>> rollback(@PathVariable String tenant, @PathVariable String id,
                                                        @PathVariable int versionNo) {
        var actor = current.requireTenant(tenant);
        var c = svc.rollback(tenant, id, versionNo, actor.id());
        events.publish(tenant, "capability", "update", c.id, c.kind);
        return withEtag(c);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String tenant, @PathVariable String id,
                                       @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        current.requireTenant(tenant);
        var c = svc.softDelete(tenant, id, parseVersion(ifMatch));
        events.publish(tenant, "capability", "delete", c.id, c.kind);
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<Map<String, Object>> withEtag(Capability c) {
        return ResponseEntity.ok().eTag(etag(c)).body(views.capability(c));
    }
    private static String etag(Capability c) { return "\"" + c.version + "\""; }
    /** Parse an If-Match header (quoted/weak/plain) to the numeric version, or null. */
    private static Long parseVersion(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank() || "*".equals(ifMatch.trim())) return null;
        String digits = ifMatch.replaceAll("[^0-9]", "");
        return digits.isEmpty() ? null : Long.parseLong(digits);
    }
}
