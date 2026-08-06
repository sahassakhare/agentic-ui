package com.acme.catalog.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** A business Experience — a goal plus the capabilities it requires (body).
 *  Governed by an approval state machine (draft→review→approved/…). */
@Entity
@Table(name = "experiences")
public class Experience {
    @Id public String id;
    public String tenantId;
    public String name;
    public String title;
    public String goal;
    public String body;                 // JSON: { intents, requires, produces, scopes, personas, policies, defaultLayout }
    public String approvalState;        // draft|review|approved|rejected|deprecated
    public String approvalChain;        // JSON array of approval events
    public String owner;
    public String tags;                 // JSON array
    public String version;
    public Instant createdAt;
    public Instant updatedAt;
    public String createdBy;
    public Instant softDeletedAt;
}
