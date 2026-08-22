package com.acme.catalog.web;

import com.acme.catalog.domain.Capability;
import com.acme.catalog.domain.Experience;
import com.acme.catalog.domain.ExperiencePublication;
import com.acme.catalog.domain.ExperienceVersion;
import com.acme.catalog.domain.PolicyBundle;
import com.acme.catalog.support.Json;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Entity → API JSON (camelCase; JSON columns parsed to real objects/arrays;
 *  timestamps ISO-8601). Matches the shapes the Angular services expect. */
@Component
public class Views {
    private final Json json;
    public Views(Json json) { this.json = json; }

    public Map<String, Object> capability(Capability c) {
        var m = new LinkedHashMap<String, Object>();
        m.put("id", c.id); m.put("tenantId", c.tenantId); m.put("kind", c.kind); m.put("name", c.name);
        m.put("body", json.read(c.body)); m.put("lifecycle", c.lifecycle); m.put("owner", c.owner);
        m.put("tags", json.read(c.tags)); m.put("requiredHostVersion", c.requiredHostVersion);
        m.put("version", c.version);
        m.put("approvalState", c.approvalState);
        m.put("approvalChain", json.read(c.approvalChain == null ? "[]" : c.approvalChain));
        m.put("authoredBy", c.authoredBy == null ? "human" : c.authoredBy);
        m.put("createdAt", iso(c.createdAt)); m.put("updatedAt", iso(c.updatedAt));
        m.put("createdBy", c.createdBy); m.put("softDeletedAt", iso(c.softDeletedAt));
        return m;
    }

    public Map<String, Object> capabilityVersion(com.acme.catalog.domain.CapabilityVersion v) {
        var m = new LinkedHashMap<String, Object>();
        m.put("versionNo", v.versionNo); m.put("snapshot", json.read(v.snapshot));
        m.put("reason", v.reason); m.put("createdAt", iso(v.createdAt)); m.put("createdBy", v.createdBy);
        return m;
    }

    public Map<String, Object> experience(Experience e) {
        var m = new LinkedHashMap<String, Object>();
        m.put("id", e.id); m.put("tenantId", e.tenantId); m.put("name", e.name);
        m.put("title", e.title); m.put("goal", e.goal); m.put("body", json.read(e.body));
        m.put("approvalState", e.approvalState); m.put("approvalChain", json.read(e.approvalChain));
        m.put("owner", e.owner); m.put("tags", json.read(e.tags)); m.put("version", e.version);
        m.put("createdAt", iso(e.createdAt)); m.put("updatedAt", iso(e.updatedAt));
        m.put("createdBy", e.createdBy); m.put("softDeletedAt", iso(e.softDeletedAt));
        return m;
    }

    public Map<String, Object> version(ExperienceVersion v) {
        var m = new LinkedHashMap<String, Object>();
        m.put("versionNo", v.versionNo); m.put("snapshot", json.read(v.snapshot));
        m.put("reason", v.reason); m.put("createdAt", iso(v.createdAt)); m.put("createdBy", v.createdBy);
        return m;
    }

    /** Public publication projection — never leaks keyHash or the bundle. */
    public Map<String, Object> publication(ExperiencePublication p) {
        var m = new LinkedHashMap<String, Object>();
        m.put("id", p.id); m.put("experienceId", p.experienceId); m.put("experienceName", p.experienceName);
        m.put("publishedVersionNo", p.publishedVersionNo); m.put("keyPrefix", p.keyPrefix);
        m.put("allowedOrigins", json.read(p.allowedOrigins)); m.put("status", p.status);
        m.put("publishedAt", iso(p.publishedAt)); m.put("publishedBy", p.publishedBy);
        return m;
    }

    public Map<String, Object> policy(PolicyBundle b) {
        var m = new LinkedHashMap<String, Object>();
        m.put("id", b.id); m.put("tenantId", b.tenantId); m.put("name", b.name);
        m.put("regoSource", b.regoSource); m.put("description", b.description); m.put("rulePath", b.rulePath);
        m.put("isActive", b.isActive); m.put("createdAt", iso(b.createdAt)); m.put("updatedAt", iso(b.updatedAt));
        m.put("createdBy", b.createdBy);
        return m;
    }

    private static String iso(Instant i) { return i == null ? null : i.toString(); }
}
