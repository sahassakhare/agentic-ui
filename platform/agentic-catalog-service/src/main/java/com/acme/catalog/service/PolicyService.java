package com.acme.catalog.service;

import com.acme.catalog.domain.PolicyBundle;
import com.acme.catalog.repo.PolicyBundleRepository;
import com.acme.catalog.support.Ids;
import tools.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

@Service
public class PolicyService {
    private final PolicyBundleRepository repo;
    public PolicyService(PolicyBundleRepository repo) { this.repo = repo; }

    public List<PolicyBundle> list(String tenant) { return repo.findByTenantIdOrderByCreatedAtDesc(tenant); }
    public PolicyBundle get(String tenant, String id) {
        return repo.findByTenantIdAndId(tenant, id).orElseThrow(() -> notFound());
    }

    @Transactional
    public PolicyBundle create(String tenant, JsonNode input, String actor) {
        String name = req(input, "name");
        if (repo.findFirstByTenantIdAndName(tenant, name).isPresent())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A bundle named \"" + name + "\" already exists");
        Instant now = Instant.now();
        PolicyBundle b = new PolicyBundle();
        b.id = Ids.uuid(); b.tenantId = tenant; b.name = name;
        b.regoSource = req(input, "regoSource");
        b.description = input.hasNonNull("description") ? input.get("description").asText() : null;
        b.rulePath = input.hasNonNull("rulePath") ? input.get("rulePath").asText() : "maverick/allow";
        b.isActive = input.path("isActive").asBoolean(false);
        b.createdAt = now; b.updatedAt = now; b.createdBy = actor;
        if (b.isActive) deactivateOthers(tenant, b.id);
        return repo.save(b);
    }

    @Transactional
    public PolicyBundle update(String tenant, String id, JsonNode patch) {
        PolicyBundle b = get(tenant, id);
        if (patch.hasNonNull("regoSource")) b.regoSource = patch.get("regoSource").asText();
        if (patch.has("description")) b.description = patch.get("description").isNull() ? null : patch.get("description").asText();
        if (patch.hasNonNull("rulePath")) b.rulePath = patch.get("rulePath").asText();
        if (patch.has("isActive")) {
            b.isActive = patch.get("isActive").asBoolean(false);
            if (b.isActive) deactivateOthers(tenant, b.id);
        }
        b.updatedAt = Instant.now();
        return repo.save(b);
    }

    public void delete(String tenant, String id) { repo.delete(get(tenant, id)); }

    private void deactivateOthers(String tenant, String keepId) {
        for (PolicyBundle other : repo.findByTenantIdAndIsActiveTrue(tenant)) {
            if (!other.id.equals(keepId)) { other.isActive = false; repo.save(other); }
        }
    }

    private static String req(JsonNode n, String field) {
        if (!n.hasNonNull(field) || n.get(field).asText().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is required");
        return n.get(field).asText();
    }
    private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Policy bundle not found"); }
}
