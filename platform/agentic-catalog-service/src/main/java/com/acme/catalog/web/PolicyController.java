package com.acme.catalog.web;

import com.acme.catalog.service.CatalogEvents;
import com.acme.catalog.service.PolicyService;
import com.acme.catalog.tenant.CurrentActor;
import tools.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/catalogs/{tenant}/policy/bundles")
public class PolicyController {
    private final PolicyService svc;
    private final Views views;
    private final CurrentActor current;
    private final CatalogEvents events;

    public PolicyController(PolicyService svc, Views views, CurrentActor current, CatalogEvents events) {
        this.svc = svc; this.views = views; this.current = current; this.events = events;
    }

    @GetMapping
    public Map<String, Object> list(@PathVariable String tenant) {
        current.requireTenant(tenant);
        List<Map<String, Object>> items = svc.list(tenant).stream().map(views::policy).toList();
        return Map.of("items", items, "total", items.size());
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        return views.policy(svc.get(tenant, id));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@PathVariable String tenant, @RequestBody JsonNode body) {
        var actor = current.requireTenant(tenant);
        var b = svc.create(tenant, body, actor.id());
        events.publish(tenant, "policy_bundle", "create", b.id);
        return ResponseEntity.status(HttpStatus.CREATED).body(views.policy(b));
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable String tenant, @PathVariable String id, @RequestBody JsonNode patch) {
        current.requireTenant(tenant);
        var b = svc.update(tenant, id, patch);
        events.publish(tenant, "policy_bundle", "update", b.id);
        return views.policy(b);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        svc.delete(tenant, id);
        events.publish(tenant, "policy_bundle", "delete", id);
        return ResponseEntity.noContent().build();
    }
}
