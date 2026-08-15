package com.acme.catalog.service;

import com.acme.catalog.domain.Experience;
import com.acme.catalog.domain.ExperiencePublication;
import com.acme.catalog.domain.ExperienceVersion;
import com.acme.catalog.repo.ExperienceRepository;
import com.acme.catalog.repo.ExperienceVersionRepository;
import com.acme.catalog.support.Ids;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Service
public class ExperienceService {
    private final ExperienceRepository repo;
    private final ExperienceVersionRepository versions;
    private final PlanService planService;
    private final PublishService publishService;
    private final Json json;

    public ExperienceService(ExperienceRepository repo, ExperienceVersionRepository versions,
                             PlanService planService, PublishService publishService, Json json) {
        this.repo = repo; this.versions = versions; this.planService = planService;
        this.publishService = publishService; this.json = json;
    }

    public List<Experience> list(String tenant, String approvalState) {
        return (approvalState == null || approvalState.isBlank())
                ? repo.findByTenantIdAndSoftDeletedAtIsNullOrderByName(tenant)
                : repo.findByTenantIdAndApprovalStateAndSoftDeletedAtIsNullOrderByName(tenant, approvalState);
    }
    public Experience get(String tenant, String id) {
        return repo.findByTenantIdAndId(tenant, id).filter(e -> e.softDeletedAt == null).orElseThrow(this::notFound);
    }

    @Transactional
    public Experience create(String tenant, JsonNode input, String actor) {
        String name = req(input, "name");
        if (repo.findFirstByTenantIdAndNameAndSoftDeletedAtIsNull(tenant, name).isPresent())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Experience \"" + name + "\" already exists");
        Instant now = Instant.now();
        Experience e = new Experience();
        e.id = Ids.uuid();
        e.tenantId = tenant;
        e.name = name;
        e.title = req(input, "title");
        e.goal = req(input, "goal");
        e.body = json.write(input.has("body") ? input.get("body") : json.mapper().createObjectNode());
        e.approvalState = input.hasNonNull("approvalState") ? input.get("approvalState").asText() : "draft";
        e.approvalChain = "[]";
        e.owner = input.hasNonNull("owner") ? input.get("owner").asText() : null;
        e.tags = json.write(input.has("tags") ? input.get("tags") : json.mapper().createArrayNode());
        e.version = input.hasNonNull("version") ? input.get("version").asText() : null;
        e.createdAt = now; e.updatedAt = now; e.createdBy = actor;
        repo.save(e);
        appendVersion(tenant, e, "create", actor);
        return e;
    }

    @Transactional
    public Experience update(String tenant, String id, JsonNode patch, String actor) {
        Experience e = get(tenant, id);
        if (patch.hasNonNull("title")) e.title = patch.get("title").asText();
        if (patch.hasNonNull("goal")) e.goal = patch.get("goal").asText();
        if (patch.has("body")) e.body = json.write(patch.get("body"));
        if (patch.has("tags")) e.tags = json.write(patch.get("tags"));
        if (patch.has("owner")) e.owner = patch.get("owner").isNull() ? null : patch.get("owner").asText();
        if (patch.has("version")) e.version = patch.get("version").isNull() ? null : patch.get("version").asText();
        e.updatedAt = Instant.now();
        repo.save(e);
        appendVersion(tenant, e, "update", actor);
        return e;
    }

    @Transactional
    public Experience transition(String tenant, String id, String action, String comment, String actor) {
        Experience e = get(tenant, id);
        String from = e.approvalState;
        String to = ApprovalStateMachine.next(from, action);
        ObjectNode event = json.mapper().createObjectNode();
        event.put("id", Ids.uuid());
        event.put("timestamp", Instant.now().toString());
        ObjectNode a = event.putObject("actor"); a.put("userId", actor); a.put("displayName", actor);
        event.put("action", action); event.put("fromState", from); event.put("toState", to);
        if (comment != null && !comment.isBlank()) event.put("comment", comment);
        var chain = (tools.jackson.databind.node.ArrayNode) json.read(e.approvalChain);
        if (!chain.isArray()) chain = json.mapper().createArrayNode();
        chain.add(event);
        e.approvalChain = json.write(chain);
        e.approvalState = to;
        e.updatedAt = Instant.now();
        repo.save(e);
        appendVersion(tenant, e, "transition:" + action, actor);
        return e;
    }

    @Transactional
    public Experience rollback(String tenant, String id, int versionNo, String actor) {
        Experience e = get(tenant, id);
        ExperienceVersion v = versions.findByTenantIdAndExperienceIdAndVersionNo(tenant, id, versionNo)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Version " + versionNo + " not found"));
        JsonNode s = json.read(v.snapshot);
        if (s.hasNonNull("title")) e.title = s.get("title").asText();
        if (s.hasNonNull("goal")) e.goal = s.get("goal").asText();
        if (s.has("body")) e.body = json.write(s.get("body"));
        if (s.has("tags")) e.tags = json.write(s.get("tags"));
        e.owner = s.hasNonNull("owner") ? s.get("owner").asText() : null;
        e.version = s.hasNonNull("version") ? s.get("version").asText() : null;
        e.updatedAt = Instant.now();
        repo.save(e);
        appendVersion(tenant, e, "rollback:v" + versionNo, actor);
        return e;
    }

    public Experience softDelete(String tenant, String id) {
        Experience e = get(tenant, id);
        e.softDeletedAt = Instant.now();
        return repo.save(e);
    }

    public List<ExperienceVersion> versions(String tenant, String id) {
        get(tenant, id); // 404 if missing
        return versions.findByTenantIdAndExperienceIdOrderByVersionNoDesc(tenant, id);
    }

    public PlanService.Result plan(String tenant, String id) { return planService.resolve(tenant, get(tenant, id)); }

    // ── publishing ──
    public PublishService.PublishResult publish(String tenant, String id, List<String> origins, String actor) {
        Experience e = get(tenant, id);
        if (!"approved".equals(e.approvalState))
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Only approved experiences can be published (current state: " + e.approvalState + ")");
        int versionNo = versions.maxVersionNo(tenant, e.id);
        return publishService.publish(tenant, e, versionNo, origins, actor);
    }
    public Optional<ExperiencePublication> unpublish(String tenant, String id) {
        get(tenant, id); return publishService.unpublish(tenant, id);
    }
    public Optional<PublishService.PublishResult> rotateKey(String tenant, String id) {
        get(tenant, id); return publishService.rotate(tenant, id);
    }
    public Optional<ExperiencePublication> publication(String tenant, String id) {
        get(tenant, id); return publishService.activeByExperienceId(tenant, id);
    }

    private void appendVersion(String tenant, Experience e, String reason, String actor) {
        int no = versions.maxVersionNo(tenant, e.id) + 1;
        ObjectNode snap = json.mapper().createObjectNode();
        snap.put("title", e.title); snap.put("goal", e.goal);
        snap.set("body", json.read(e.body)); snap.set("tags", json.read(e.tags));
        if (e.owner != null) snap.put("owner", e.owner); else snap.putNull("owner");
        if (e.version != null) snap.put("version", e.version); else snap.putNull("version");
        snap.put("approvalState", e.approvalState);
        ExperienceVersion v = new ExperienceVersion();
        v.id = Ids.uuid(); v.tenantId = tenant; v.experienceId = e.id; v.versionNo = no;
        v.snapshot = json.write(snap); v.reason = reason; v.createdAt = Instant.now(); v.createdBy = actor;
        versions.save(v);
    }

    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Experience not found"); }
    private static String req(JsonNode n, String field) {
        if (!n.hasNonNull(field) || n.get(field).asText().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is required");
        return n.get(field).asText();
    }
}
