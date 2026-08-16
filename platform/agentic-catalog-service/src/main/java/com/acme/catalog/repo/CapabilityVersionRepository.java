package com.acme.catalog.repo;

import com.acme.catalog.domain.CapabilityVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface CapabilityVersionRepository extends JpaRepository<CapabilityVersion, String> {
    List<CapabilityVersion> findByTenantIdAndCapabilityIdOrderByVersionNoDesc(String tenantId, String capabilityId);
    Optional<CapabilityVersion> findByTenantIdAndCapabilityIdAndVersionNo(String tenantId, String capabilityId, int versionNo);

    @Query("select coalesce(max(v.versionNo), 0) from CapabilityVersion v where v.tenantId = ?1 and v.capabilityId = ?2")
    int maxVersionNo(String tenantId, String capabilityId);
}
