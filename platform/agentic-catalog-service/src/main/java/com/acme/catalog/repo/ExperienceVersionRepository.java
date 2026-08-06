package com.acme.catalog.repo;

import com.acme.catalog.domain.ExperienceVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface ExperienceVersionRepository extends JpaRepository<ExperienceVersion, String> {
    List<ExperienceVersion> findByTenantIdAndExperienceIdOrderByVersionNoDesc(String tenantId, String experienceId);
    Optional<ExperienceVersion> findByTenantIdAndExperienceIdAndVersionNo(String tenantId, String experienceId, int versionNo);

    @Query("select coalesce(max(v.versionNo), 0) from ExperienceVersion v where v.tenantId = ?1 and v.experienceId = ?2")
    int maxVersionNo(String tenantId, String experienceId);
}
