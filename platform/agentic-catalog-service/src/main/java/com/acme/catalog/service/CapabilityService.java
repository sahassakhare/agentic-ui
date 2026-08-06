package com.acme.catalog.service;

import com.acme.catalog.domain.Capability;
import com.acme.catalog.repo.CapabilityRepository;
import com.acme.catalog.support.Ids;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Service
public class CapabilityService {
    private final CapabilityRepository repo;
    private final Json json;

    public CapabilityService(CapabilityRepository repo, Json json) { this.repo = repo; this.json = json; }

    public List<Capability> list(String tenant, String kind) {
        return (kind == null || kind.isBlank())
                ? repo.findByTenantIdAndSoftDeletedAtIsNullOrderByName(tenant)
                : repo.findByTenantIdAndKindAndSoftDeletedAtIsNullOrderByName(tenant, kind);
    }

    public Optional<Capability> get(String tenant, String id) {
        return repo.findByTenantIdAndId(tenant, id).filter(c -> c.softDeletedAt == null);
    }

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
        c.lifecycle = input.hasNonNull("lifecycle") ? input.get("lifecycle").asText() : "published";
        c.owner = input.hasNonNull("owner") ? input.get("owner").asText() : null;
        c.tags = json.write(input.has("tags") ? input.get("tags") : json.mapper().createArrayNode());
        c.requiredHostVersion = input.hasNonNull("requiredHostVersion") ? input.get("requiredHostVersion").asText() : null;
        c.createdAt = now; c.updatedAt = now; c.createdBy = actor;
        return repo.save(c);
    }

    public Capability update(String tenant, String id, JsonNode patch) {
        Capability c = get(tenant, id).orElseThrow(() -> notFound());
        if (patch.has("body")) c.body = json.write(patch.get("body"));
        if (patch.hasNonNull("lifecycle")) c.lifecycle = patch.get("lifecycle").asText();
        if (patch.has("tags")) c.tags = json.write(patch.get("tags"));
        if (patch.has("owner")) c.owner = patch.get("owner").isNull() ? null : patch.get("owner").asText();
        c.updatedAt = Instant.now();
        return repo.save(c);
    }

    public Capability softDelete(String tenant, String id) {
        Capability c = get(tenant, id).orElseThrow(() -> notFound());
        c.softDeletedAt = Instant.now();
        return repo.save(c);
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
