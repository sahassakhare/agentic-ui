package com.acme.catalog.service;

import com.acme.catalog.config.CatalogProperties;
import com.acme.catalog.domain.Capability;
import com.acme.catalog.domain.CapabilityVersion;
import com.acme.catalog.repo.CapabilityRepository;
import com.acme.catalog.repo.CapabilityVersionRepository;
import com.acme.catalog.support.Ids;
import com.acme.catalog.support.Json;
import com.acme.catalog.tenant.Actor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

@Service
public class CapabilityService {
    private final CapabilityRepository repo;
    private final CapabilityVersionRepository versions;
    private final CatalogProperties props;
    private final Json json;

    public CapabilityService(CapabilityRepository repo, CapabilityVersionRepository versions,
                             CatalogProperties props, Json json) {
        this.repo = repo; this.versions = versions; this.props = props; this.json = json;
    }

    public List<Capability> list(String tenant, String kind) {
        return (kind == null || kind.isBlank())
                ? repo.findByTenantIdAndSoftDeletedAtIsNullOrderByName(tenant)
                : repo.findByTenantIdAndKindAndSoftDeletedAtIsNullOrderByName(tenant, kind);
    }

    public Optional<Capability> get(String tenant, String id) {
        return repo.findByTenantIdAndId(tenant, id).filter(c -> c.softDeletedAt == null);
    }

    @Transactional
    public Capability create(String tenant, JsonNode input, String actor) {
        String kind = req(input, "kind");
        String name = req(input, "name");
        if (repo.existsByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, kind, name))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Capability \"" + name + "\" already exists");
        Instant now = Instant.now();
        Capability c = new Capability();
        c.id = Ids.uuid();
        c.tenantId = tenant;
        c.kind = kind;
        c.name = name;
        c.body = json.write(input.has("body") ? input.get("body") : json.mapper().createObjectNode());
        // New capabilities start as draft and must pass the review chain to publish.
        // A programmatic create that explicitly asks for `published` (seeds) is
        // treated as already-approved so seed data stays publishable.
        c.lifecycle = input.hasNonNull("lifecycle") ? input.get("lifecycle").asText() : "draft";
        c.approvalState = "published".equals(c.lifecycle) ? "approved" : "draft";
        c.approvalChain = "[]";
        // Provenance defaults to 'human'; only an explicit 'ai-assisted' is honored.
        c.authoredBy = "ai-assisted".equals(input.path("authoredBy").asText(null)) ? "ai-assisted" : "human";
        c.owner = input.hasNonNull("owner") ? input.get("owner").asText() : null;
        c.tags = json.write(input.has("tags") ? input.get("tags") : json.mapper().createArrayNode());
        c.requiredHostVersion = input.hasNonNull("requiredHostVersion") ? input.get("requiredHostVersion").asText() : null;
        c.createdAt = now; c.updatedAt = now; c.createdBy = actor;
        repo.save(c);
        appendVersion(tenant, c, "create", actor);
        return c;
    }

    @Transactional
    public Capability update(String tenant, String id, JsonNode patch, Long expectedVersion, String actor) {
        Capability c = get(tenant, id).orElseThrow(CapabilityService::notFound);
        // Explicit optimistic-concurrency guard: reject a stale edit early with 412.
        // (Hibernate @Version is the atomic backstop for the same-version race.)
        if (expectedVersion != null && expectedVersion != c.version) {
            throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED,
                    "Capability was modified by someone else (expected v" + expectedVersion + ", current v" + c.version + ")");
        }
        boolean bodyChanged = false;
        if (patch.has("body")) { c.body = json.write(patch.get("body")); bodyChanged = true; }
        if (patch.has("tags")) c.tags = json.write(patch.get("tags"));
        if (patch.has("owner")) c.owner = patch.get("owner").isNull() ? null : patch.get("owner").asText();
        if (patch.hasNonNull("authoredBy")) c.authoredBy = "ai-assisted".equals(patch.get("authoredBy").asText()) ? "ai-assisted" : "human";
        // A content change on an approved capability sends it back to draft so the
        // change is re-reviewed before it can be published again.
        if (bodyChanged && "approved".equals(c.approvalState)) c.approvalState = "draft";
        // Publish gate: moving lifecycle → published requires an approved capability.
        if (patch.hasNonNull("lifecycle")) {
            String next = patch.get("lifecycle").asText();
            if ("published".equals(next) && !"approved".equals(c.approvalState)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Only approved capabilities can be published (approval state: " + c.approvalState + ")");
            }
            c.lifecycle = next;
        }
        c.updatedAt = Instant.now();
        repo.save(c);
        appendVersion(tenant, c, "update", actor);
        return c;
    }

    @Transactional
    public Capability transition(String tenant, String id, String action, String comment, Actor actor) {
        Capability c = get(tenant, id).orElseThrow(CapabilityService::notFound);
        if (("approve".equals(action) || "reject".equals(action)) && !isApprover(actor)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Approving requires an approver role");
        }
        String from = c.approvalState;
        String to = ApprovalStateMachine.next(from, action);
        ObjectNode event = json.mapper().createObjectNode();
        event.put("id", Ids.uuid());
        event.put("timestamp", Instant.now().toString());
        ObjectNode a = event.putObject("actor"); a.put("userId", actor.id()); a.put("displayName", actor.id());
        event.put("action", action); event.put("fromState", from); event.put("toState", to);
        if (comment != null && !comment.isBlank()) event.put("comment", comment);
        JsonNode chainNode = json.read(c.approvalChain);
        ArrayNode chain = chainNode.isArray() ? (ArrayNode) chainNode : json.mapper().createArrayNode();
        chain.add(event);
        c.approvalChain = json.write(chain);
        c.approvalState = to;
        c.updatedAt = Instant.now();
        repo.save(c);
        appendVersion(tenant, c, "transition:" + action, actor.id());
        return c;
    }

    @Transactional
    public Capability rollback(String tenant, String id, int versionNo, String actor) {
        Capability c = get(tenant, id).orElseThrow(CapabilityService::notFound);
        CapabilityVersion v = versions.findByTenantIdAndCapabilityIdAndVersionNo(tenant, id, versionNo)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Version " + versionNo + " not found"));
        JsonNode s = json.read(v.snapshot);
        if (s.has("body")) c.body = json.write(s.get("body"));
        if (s.has("tags")) c.tags = json.write(s.get("tags"));
        c.owner = s.hasNonNull("owner") ? s.get("owner").asText() : null;
        // Restoring content re-enters the review chain (never silently republishes).
        c.approvalState = "draft";
        c.updatedAt = Instant.now();
        repo.save(c);
        appendVersion(tenant, c, "rollback:v" + versionNo, actor);
        return c;
    }

    @Transactional
    public Capability softDelete(String tenant, String id, Long expectedVersion) {
        Capability c = get(tenant, id).orElseThrow(CapabilityService::notFound);
        if (expectedVersion != null && expectedVersion != c.version) {
            throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED,
                    "Capability was modified by someone else (expected v" + expectedVersion + ", current v" + c.version + ")");
        }
        c.softDeletedAt = Instant.now();
        return repo.save(c);
    }

    public List<CapabilityVersion> versions(String tenant, String id) {
        get(tenant, id).orElseThrow(CapabilityService::notFound); // 404 if missing
        return versions.findByTenantIdAndCapabilityIdOrderByVersionNoDesc(tenant, id);
    }

    private boolean isApprover(Actor actor) {
        if (actor.authDisabled() || actor.platformAdmin()) return true;
        return !Collections.disjoint(actor.roles(), props.getAuth().approverRoleList());
    }

    private void appendVersion(String tenant, Capability c, String reason, String actor) {
        int no = versions.maxVersionNo(tenant, c.id) + 1;
        ObjectNode snap = json.mapper().createObjectNode();
        snap.set("body", json.read(c.body));
        snap.set("tags", json.read(c.tags));
        if (c.owner != null) snap.put("owner", c.owner); else snap.putNull("owner");
        snap.put("lifecycle", c.lifecycle);
        snap.put("approvalState", c.approvalState);
        CapabilityVersion v = new CapabilityVersion();
        v.id = Ids.uuid(); v.tenantId = tenant; v.capabilityId = c.id; v.versionNo = no;
        v.snapshot = json.write(snap); v.reason = reason; v.createdAt = Instant.now(); v.createdBy = actor;
        versions.save(v);
    }

    private static String req(JsonNode n, String field) {
        if (!n.hasNonNull(field) || n.get(field).asText().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is required");
        return n.get(field).asText();
    }
    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Capability not found");
    }
}
