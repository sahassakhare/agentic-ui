package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** An OPA rego policy bundle. At most one is active per tenant (enforced in the
 *  service layer); an experience's `policies` are evaluated against it. */
@Entity
@Table(name = "policy_bundles")
public class PolicyBundle {
    @Id public String id;
    public String tenantId;
    public String name;
    public String regoSource;
    public String description;
    public String rulePath;
    public boolean isActive;
    public Instant createdAt;
    public Instant updatedAt;
    public String createdBy;
}
