package com.acme.catalog.web;

import com.acme.catalog.service.CapabilityService;
import com.acme.catalog.service.CatalogEvents;
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
    public Map<String, Object> get(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        return views.capability(svc.get(tenant, id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Capability not found")));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@PathVariable String tenant, @RequestBody JsonNode body) {
        var actor = current.requireTenant(tenant);
        var c = svc.create(tenant, body, actor.id());
        events.publish(tenant, "capability", "create", c.id);
        return ResponseEntity.status(HttpStatus.CREATED).body(views.capability(c));
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable String tenant, @PathVariable String id, @RequestBody JsonNode patch) {
        current.requireTenant(tenant);
        var c = svc.update(tenant, id, patch);
        events.publish(tenant, "capability", "update", c.id);
        return views.capability(c);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        var c = svc.softDelete(tenant, id);
        events.publish(tenant, "capability", "delete", c.id);
        return ResponseEntity.noContent().build();
    }
}
