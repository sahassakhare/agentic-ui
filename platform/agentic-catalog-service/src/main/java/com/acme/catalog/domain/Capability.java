package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;

/** A catalog capability of any kind (component, form, workflow, prompt, tool, …).
 *  JSON columns (body, tags, approvalChain) are stored as text; see the service/DTO mappers. */
@Entity
@Table(name = "capabilities")
public class Capability {
    @Id public String id;
    public String tenantId;
    public String kind;
    public String name;
    public String body;                 // JSON object
    public String lifecycle;            // draft|published|deprecated|disabled
    public String owner;
    public String tags;                 // JSON array
    public String requiredHostVersion;
    public Instant createdAt;
    public Instant updatedAt;
    public String createdBy;
    public Instant softDeletedAt;
    /** Optimistic-concurrency token (Hibernate-managed); also the ETag. */
    @Version public long version;
    /** Approval workflow state: draft|review|approved|rejected|deprecated. */
    public String approvalState;
    /** JSON array of approval events (who/when/action/comment). */
    public String approvalChain;
    /** Authoring provenance: 'human' (default) or 'ai-assisted' — distinguishes
     *  AI-assisted drafts for audit. Nullable; treated as 'human' when absent. */
    public String authoredBy;
}
