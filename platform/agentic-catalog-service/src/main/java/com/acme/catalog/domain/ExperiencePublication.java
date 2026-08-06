package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** A publication of an approved experience for headless consumption — pins a
 *  version + a frozen render bundle behind a hashed, origin-pinned embed key. */
@Entity
@Table(name = "experience_publications")
public class ExperiencePublication {
    @Id public String id;
    public String tenantId;
    public String experienceId;
    public String experienceName;
    public int publishedVersionNo;
    public String keyHash;              // SHA-256 hex of the raw embed key
    public String keyPrefix;
    public String allowedOrigins;       // JSON array
    public String bundle;               // JSON: frozen render manifest
    public String status;               // active | revoked
    public Instant publishedAt;
    public String publishedBy;
    public Instant revokedAt;
}
