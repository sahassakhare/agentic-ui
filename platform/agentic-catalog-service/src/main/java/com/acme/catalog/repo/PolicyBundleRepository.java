package com.acme.catalog.repo;

import com.acme.catalog.domain.PolicyBundle;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PolicyBundleRepository extends JpaRepository<PolicyBundle, String> {
    List<PolicyBundle> findByTenantIdOrderByCreatedAtDesc(String tenantId);
    Optional<PolicyBundle> findByTenantIdAndId(String tenantId, String id);
    List<PolicyBundle> findByTenantIdAndIsActiveTrue(String tenantId);
    Optional<PolicyBundle> findFirstByTenantIdAndName(String tenantId, String name);
}
