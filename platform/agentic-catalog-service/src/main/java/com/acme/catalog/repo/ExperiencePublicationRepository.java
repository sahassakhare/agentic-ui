package com.acme.catalog.repo;

import com.acme.catalog.domain.ExperiencePublication;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ExperiencePublicationRepository extends JpaRepository<ExperiencePublication, String> {
    Optional<ExperiencePublication> findFirstByTenantIdAndExperienceIdAndStatus(String tenantId, String experienceId, String status);
    Optional<ExperiencePublication> findFirstByTenantIdAndExperienceNameAndStatus(String tenantId, String experienceName, String status);
    Optional<ExperiencePublication> findFirstByKeyHashAndTenantIdAndStatus(String keyHash, String tenantId, String status);
}
