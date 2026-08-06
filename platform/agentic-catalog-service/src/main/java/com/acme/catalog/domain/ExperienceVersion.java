package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** An immutable version snapshot appended on every experience create/update/
 *  transition/rollback (change management). */
@Entity
@Table(name = "experience_versions")
public class ExperienceVersion {
    @Id public String id;
    public String tenantId;
    public String experienceId;
    public int versionNo;
    public String snapshot;             // JSON of the mutable experience shape
    public String reason;               // create | update | transition:<action> | rollback:v<n>
    public Instant createdAt;
    public String createdBy;
}
