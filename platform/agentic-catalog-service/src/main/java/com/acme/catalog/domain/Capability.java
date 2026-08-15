package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** A catalog capability of any kind (component, form, workflow, prompt, tool, …).
 *  JSON columns (body, tags) are stored as text; see the service/DTO mappers. */
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
}
