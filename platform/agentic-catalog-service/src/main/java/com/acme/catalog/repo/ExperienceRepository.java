package com.acme.catalog.repo;

import com.acme.catalog.domain.Experience;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ExperienceRepository extends JpaRepository<Experience, String> {
    List<Experience> findByTenantIdAndSoftDeletedAtIsNullOrderByName(String tenantId);
    List<Experience> findByTenantIdAndApprovalStateAndSoftDeletedAtIsNullOrderByName(String tenantId, String approvalState);
    Optional<Experience> findByTenantIdAndId(String tenantId, String id);
    Optional<Experience> findFirstByTenantIdAndNameAndSoftDeletedAtIsNull(String tenantId, String name);
}
