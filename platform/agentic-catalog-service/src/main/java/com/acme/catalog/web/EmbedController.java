package com.acme.catalog.web;

import com.acme.catalog.domain.ExperiencePublication;
import com.acme.catalog.service.PublishService;
import com.acme.catalog.support.EmbedKey;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * Anonymous, key-scoped embed read for external portals (ports the embed route).
 * Auth is the origin-pinned embed key; the handler only ever echoes an active
 * publication's frozen bundle — drafts / other tenants are unreachable.
 */
@RestController
@RequestMapping("/v1/embed/{tenant}/experiences/{name}")
public class EmbedController {
    private final PublishService publish;
    private final Json json;

    public EmbedController(PublishService publish, Json json) { this.publish = publish; this.json = json; }

    @GetMapping({"", "/manifest"})
    public JsonNode manifest(@PathVariable String tenant, @PathVariable String name,
                             HttpServletRequest request, HttpServletResponse response) {
        String key = request.getHeader("x-embed-key");
        if (key == null) {
            String auth = request.getHeader("authorization");
            if (auth != null && auth.regionMatches(true, 0, "bearer ", 0, 7)) key = auth.substring(7).trim();
        }
        if (key == null || key.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing embed key");

        ExperiencePublication pub = publish.activeByKeyHash(tenant, EmbedKey.hash(key))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found"));
        if (!pub.experienceName.equals(name)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found");

        String origin = request.getHeader("origin");
        if (origin != null) {
            List<String> allowed = json.readStringList(pub.allowedOrigins);
            if (!allowed.contains(origin)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origin not allowed");
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
        }
        return json.read(pub.bundle);
    }
}
