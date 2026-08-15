package com.acme.catalog.repo;

import com.acme.catalog.domain.Capability;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Tenant-scoped capability access — tenant_id is part of every query. */
public interface CapabilityRepository extends JpaRepository<Capability, String> {
    List<Capability> findByTenantIdAndSoftDeletedAtIsNullOrderByName(String tenantId);
    List<Capability> findByTenantIdAndKindAndSoftDeletedAtIsNullOrderByName(String tenantId, String kind);
    Optional<Capability> findByTenantIdAndId(String tenantId, String id);
    Optional<Capability> findFirstByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(String tenantId, String kind, String name);
    Optional<Capability> findFirstByTenantIdAndNameAndSoftDeletedAtIsNull(String tenantId, String name);
    Optional<Capability> findFirstByTenantIdAndNameAndKindInAndSoftDeletedAtIsNull(String tenantId, String name, Collection<String> kinds);
    boolean existsByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(String tenantId, String kind, String name);
}
