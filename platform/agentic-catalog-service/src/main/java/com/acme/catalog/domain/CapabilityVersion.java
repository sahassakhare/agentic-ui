package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** An immutable version snapshot appended on every capability create/update/
 *  transition/rollback (change management) — mirrors {@link ExperienceVersion}. */
@Entity
@Table(name = "capability_versions")
public class CapabilityVersion {
    @Id public String id;
    public String tenantId;
    public String capabilityId;
    public int versionNo;
    public String snapshot;             // JSON of the mutable capability shape
    public String reason;               // create | update | transition:<action> | rollback:v<n>
    public Instant createdAt;
    public String createdBy;
}
