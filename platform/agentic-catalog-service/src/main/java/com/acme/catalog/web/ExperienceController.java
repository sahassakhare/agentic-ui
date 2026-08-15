package com.acme.catalog.web;

import com.acme.catalog.service.CatalogEvents;
import com.acme.catalog.service.ExperienceService;
import com.acme.catalog.service.PlanService;
import com.acme.catalog.tenant.CurrentActor;
import tools.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/catalogs/{tenant}/experiences")
public class ExperienceController {
    private final ExperienceService svc;
    private final Views views;
    private final CurrentActor current;
    private final CatalogEvents events;

    public ExperienceController(ExperienceService svc, Views views, CurrentActor current, CatalogEvents events) {
        this.svc = svc; this.views = views; this.current = current; this.events = events;
    }

    @GetMapping
    public Map<String, Object> list(@PathVariable String tenant, @RequestParam(required = false) String approvalState) {
        current.requireTenant(tenant);
        List<Map<String, Object>> items = svc.list(tenant, approvalState).stream().map(views::experience).toList();
        var m = new LinkedHashMap<String, Object>();
        m.put("items", items); m.put("total", items.size()); m.put("limit", 100); m.put("offset", 0);
        return m;
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        return views.experience(svc.get(tenant, id));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@PathVariable String tenant, @RequestBody JsonNode body) {
        var a = current.requireTenant(tenant);
        var e = svc.create(tenant, body, a.id());
        events.publish(tenant, "experience", "create", e.id);
        return ResponseEntity.status(HttpStatus.CREATED).body(views.experience(e));
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable String tenant, @PathVariable String id, @RequestBody JsonNode patch) {
        var a = current.requireTenant(tenant);
        var e = svc.update(tenant, id, patch, a.id());
        events.publish(tenant, "experience", "update", e.id);
        return views.experience(e);
    }

    @PostMapping("/{id}/transition")
    public Map<String, Object> transition(@PathVariable String tenant, @PathVariable String id, @RequestBody JsonNode body) {
        var a = current.requireTenant(tenant);
        String action = body.path("action").asText(null);
        if (action == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "action is required");
        String comment = body.hasNonNull("comment") ? body.get("comment").asText() : null;
        var e = svc.transition(tenant, id, action, comment, a.id());
        events.publish(tenant, "experience", "update", e.id);
        return views.experience(e);
    }

    @PostMapping("/{id}/plan")
    public Map<String, Object> plan(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        var e = svc.get(tenant, id);
        PlanService.Result r = svc.plan(tenant, id);
        var m = new LinkedHashMap<String, Object>();
        m.put("id", e.id); m.put("experienceId", e.name); m.put("name", e.name);
        m.put("goal", e.goal); m.put("approvalState", e.approvalState);
        m.put("matched", r.matched().stream().map(this::ref).toList());
        m.put("unmet", r.unmet().stream().map(this::ref).toList());
        m.put("complete", r.complete());
        return m;
    }

    @GetMapping("/{id}/versions")
    public Map<String, Object> versions(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        return Map.of("items", svc.versions(tenant, id).stream().map(views::version).toList());
    }

    @PostMapping("/{id}/rollback/{versionNo}")
    public Map<String, Object> rollback(@PathVariable String tenant, @PathVariable String id, @PathVariable int versionNo) {
        var a = current.requireTenant(tenant);
        var e = svc.rollback(tenant, id, versionNo, a.id());
        events.publish(tenant, "experience", "update", e.id);
        return views.experience(e);
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<Map<String, Object>> publish(@PathVariable String tenant, @PathVariable String id, @RequestBody JsonNode body) {
        var a = current.requireTenant(tenant);
        List<String> origins = new ArrayList<>();
        body.path("allowedOrigins").forEach(o -> origins.add(o.asText()));
        var res = svc.publish(tenant, id, origins, a.id());
        events.publish(tenant, "experience", "update", id);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("publication", views.publication(res.publication()), "embedKey", res.rawKey()));
    }

    @PostMapping("/{id}/unpublish")
    public Map<String, Object> unpublish(@PathVariable String tenant, @PathVariable String id) {
        var a = current.requireTenant(tenant);
        var pub = svc.unpublish(tenant, id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "No active publication to unpublish"));
        events.publish(tenant, "experience", "update", id);
        return Map.of("status", "revoked", "publication", views.publication(pub));
    }

    @PostMapping("/{id}/publish/rotate-key")
    public Map<String, Object> rotate(@PathVariable String tenant, @PathVariable String id) {
        var a = current.requireTenant(tenant);
        var res = svc.rotateKey(tenant, id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "No active publication to rotate"));
        events.publish(tenant, "experience", "update", id);
        return Map.of("embedKey", res.rawKey(), "keyPrefix", res.publication().keyPrefix,
                "publication", views.publication(res.publication()));
    }

    @GetMapping("/{id}/publication")
    public Map<String, Object> publication(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        var m = new LinkedHashMap<String, Object>();
        m.put("publication", svc.publication(tenant, id).map(views::publication).orElse(null));
        return m;
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String tenant, @PathVariable String id) {
        current.requireTenant(tenant);
        svc.softDelete(tenant, id);
        events.publish(tenant, "experience", "delete", id);
        return ResponseEntity.noContent().build();
    }

    private Map<String, Object> ref(PlanService.Ref r) {
        var m = new LinkedHashMap<String, Object>();
        m.put("kind", r.kind());
        if (r.name() != null) m.put("name", r.name());
        if (r.tag() != null) m.put("tag", r.tag());
        if (r.via() != null) m.put("via", r.via());
        return m;
    }
}
